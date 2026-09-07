package cash

import (
	"context"
	"errors"
	"fmt"
	"time"

	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/internal/risk"
	"github.com/usezoracle/tapp/api/internal/risk/forensics"
	"github.com/usezoracle/tapp/api/internal/risk/vision"
)

var (
	// ErrAlreadyPledged means these notes, or this photograph, are already in
	// an open pledge. This is the double-spend guard reporting, and it is the
	// most important refusal this package makes.
	ErrAlreadyPledged = errors.New("these notes are already pledged")

	// ErrRefused means screening would not accept the pledge. The reason is
	// carried with it and is written to be shown to the person.
	ErrRefused = errors.New("pledge refused")

	// ErrNoAgent means nobody nearby can take this handover.
	ErrNoAgent = errors.New("no agent nearby can take this right now")
)

// Recogniser reads banknotes out of a photograph.
type Recogniser interface {
	Analyze(ctx context.Context, image []byte, declared money.Amount) (*vision.Result, error)
}

// Assessor decides whether a pledge should proceed.
type Assessor interface {
	Assess(ctx context.Context, s risk.Subject) (*risk.Assessment, error)
}

// Service creates and settles cash pledges.
type Service struct {
	Pool       *pgxpool.Pool
	Recogniser Recogniser
	Risk       Assessor
	Now        func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// Pledge accepts a photograph of cash and opens a pledge if it survives
// screening.
//
// The order is deliberate. Recognition runs first because it is what produces
// the note identities, then risk assesses everything including that reading,
// then the notes are claimed. Claiming before assessing would leave rejected
// pledges holding notes hostage; assessing before recognising would mean the
// engine judged a photograph nobody had read.
func (s *Service) Pledge(ctx context.Context, req Request) (*Pledge, error) {
	if err := req.Valid(); err != nil {
		return nil, err
	}

	reading, err := s.Recogniser.Analyze(ctx, req.Image, req.Declared)
	if err != nil {
		// A recogniser that cannot be reached has not approved anything, and
		// telling somebody to retake a photograph that was fine sends them
		// round a loop that cannot terminate.
		return nil, fmt.Errorf("cash: %w", err)
	}

	assessment, err := s.Risk.Assess(ctx, risk.Subject{
		Kind:        "pledge",
		UserID:      req.TraderID,
		AmountMinor: req.Declared.Minor(),
		Currency:    string(req.Declared.Currency()),
		Image:       req.Image,
		Device:      req.Device,
		Lat:         &req.Lat,
		Lng:         &req.Lng,
		At:          s.now(),
	})
	if err != nil {
		return nil, fmt.Errorf("cash: %w", err)
	}

	imageHash := forensics.SHA256(req.Image)
	dhash, err := forensics.DHash(req.Image)
	if err != nil {
		// Not a decodable image. Said plainly, because "unknown format" from
		// deep in an image library tells the person holding a phone nothing
		// they can act on.
		return nil, fmt.Errorf("%w: that file is not a photo we can read. "+
			"Take the picture with your camera rather than attaching a file", ErrRefused)
	}

	now := s.now()
	pledge := &Pledge{
		ID: uuid.New(), TraderID: req.TraderID,
		Declared: req.Declared, Counted: reading.Total,
		Lat: req.Lat, Lng: req.Lng,
		RiskScore: assessment.Score,
		CreatedAt: now, ExpiresAt: now.Add(PledgeTTL),
	}

	switch assessment.Decision {
	case risk.Deny, risk.Review:
		pledge.State = StateRefused
		pledge.RefusedReason = assessment.Reason
	default:
		pledge.State = StateOpen
	}

	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if err := s.insertPledge(ctx, tx, pledge, imageHash, dhash, assessment.ID); err != nil {
		return nil, err
	}

	// Claim the notes only when the pledge is actually open. A refused pledge
	// that held notes would let somebody lock up their own cash by
	// photographing it badly -- or lock up a rival's by photographing theirs.
	if pledge.State == StateOpen {
		if err := s.claimNotes(ctx, tx, pledge.ID, reading); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	if pledge.State == StateRefused {
		return pledge, fmt.Errorf("%w: %s", ErrRefused, pledge.RefusedReason)
	}
	return pledge, nil
}

func (s *Service) insertPledge(
	ctx context.Context, tx pgx.Tx, p *Pledge, imageHash, dhash string, riskID uuid.UUID,
) error {
	err := tx.QueryRow(ctx, `
		INSERT INTO cash_pledges
			(id, trader_id, currency, declared_minor, counted_minor, state,
			 lat, lng, image_sha256, image_dhash, risk_id, risk_score,
			 refused_reason, expires_at)
		VALUES ($1, $2, $3::currency, $4, $5, $6::pledge_state, $7, $8, $9, $10, $11, $12, $13, $14)
		RETURNING ref`,
		p.ID, p.TraderID, string(p.Declared.Currency()),
		p.Declared.Minor(), p.Counted.Minor(), string(p.State),
		p.Lat, p.Lng, imageHash, dhash, riskID, p.RiskScore,
		nullIfEmpty(p.RefusedReason), p.ExpiresAt).Scan(&p.Ref)
	if err != nil {
		if isUnique(err, "cash_pledges_image_live") {
			// The same photograph, twice. The most obvious attack there is.
			return fmt.Errorf("%w: this photograph is already in an open pledge", ErrAlreadyPledged)
		}
		return fmt.Errorf("cash: open pledge: %w", err)
	}
	return nil
}

// claimNotes records each banknote, and the database refuses any that are
// already claimed.
//
// The guard is a pair of partial unique indexes rather than a lookup, so it
// holds under concurrency and cannot be forgotten by a future code path. Two
// requests photographing the same notes at the same instant both reach the
// insert; one of them loses.
func (s *Service) claimNotes(ctx context.Context, tx pgx.Tx, pledgeID uuid.UUID, r *vision.Result) error {
	for _, n := range r.Notes {
		_, err := tx.Exec(ctx, `
			INSERT INTO pledged_notes
				(pledge_id, currency, denomination_minor, serial, serial_confidence, note_phash)
			VALUES ($1, $2::currency, $3, $4, $5, $6)`,
			pledgeID, string(n.Denomination.Currency()), n.Denomination.Minor(),
			nullIfEmpty(n.Serial), n.SerialConfidence, n.PHash)
		if err != nil {
			if isUnique(err, "pledged_notes_serial_live") || isUnique(err, "pledged_notes_phash_live") {
				return fmt.Errorf("%w: at least one of these notes is in another open pledge",
					ErrAlreadyPledged)
			}
			return fmt.Errorf("cash: claim note: %w", err)
		}
	}
	return nil
}

// release frees a pledge's notes so they can be pledged again.
//
// Correct in every closing case: if the pledge settled the agent now holds the
// notes and may bank them; if it expired the trader still has them and may try
// again. Keeping them claimed forever would mean one abandoned pledge
// permanently burned somebody's money.
func release(ctx context.Context, tx pgx.Tx, pledgeID uuid.UUID) error {
	_, err := tx.Exec(ctx,
		`UPDATE pledged_notes SET released = true WHERE pledge_id = $1 AND NOT released`, pledgeID)
	if err != nil {
		return fmt.Errorf("cash: release notes: %w", err)
	}
	return nil
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// isUnique reports whether err is a violation of a specific unique index.
//
// The constraint name is checked, not just the error class, because this
// package has three unique indexes that mean different things: the same
// photograph twice, the same serial twice, and the same note appearance twice.
// Reporting them identically would tell somebody their notes were already
// pledged when what actually happened was that they resent the same picture.
func isUnique(err error, constraint string) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) &&
		pgErr.Code == "23505" &&
		strings.Contains(pgErr.ConstraintName, constraint)
}
