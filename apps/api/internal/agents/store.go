package agents

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/money"
)

var (
	// ErrNotFound means no such agent.
	ErrNotFound = errors.New("agents: no such agent")
	// ErrDuplicate means this operator already registered these premises.
	ErrDuplicate = errors.New("agents: these premises are already registered")
)

// Store reads and writes the agent network.
type Store struct{ Pool *pgxpool.Pool }

// Register adds premises, unverified.
//
// Registration is open and verification is not. Anybody can put their shop
// forward; until somebody has confirmed it exists, it takes no handovers. The
// alternative -- trusting a self-declared address -- reintroduces exactly the
// anonymous counterparty that tying handovers to premises exists to remove.
func (s *Store) Register(ctx context.Context, r Registration) (*Agent, error) {
	if err := r.Valid(); err != nil {
		return nil, err
	}

	var a Agent
	err := s.Pool.QueryRow(ctx, `
		INSERT INTO agents (operator_id, name, kind, address, phone, lat, lng, opens_at, closes_at)
		VALUES ($1, $2, $3::agent_kind, $4, $5, $6, $7, $8::time, $9::time)
		RETURNING id, operator_id, name, kind, address, COALESCE(phone, ''),
		          lat, lng, to_char(opens_at, 'HH24:MI'), to_char(closes_at, 'HH24:MI'),
		          verified, active, settled_count, disputed_count`,
		r.OperatorID, r.Name, string(r.Kind), r.Address, nullIfEmpty(r.Phone),
		r.Lat, r.Lng, r.OpensAt, r.ClosesAt).
		Scan(&a.ID, &a.OperatorID, &a.Name, &a.Kind, &a.Address, &a.Phone,
			&a.Lat, &a.Lng, &a.OpensAt, &a.ClosesAt,
			&a.Verified, &a.Active, &a.SettledCount, &a.DisputedCount)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, ErrDuplicate
		}
		return nil, fmt.Errorf("agents: register: %w", err)
	}
	return &a, nil
}

// Verify marks premises as confirmed to exist.
func (s *Store) Verify(ctx context.Context, id uuid.UUID) error {
	tag, err := s.Pool.Exec(ctx, `
		UPDATE agents SET verified = true, verified_at = now(), updated_at = now()
		 WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("agents: verify: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// Search is a nearby query.
type Search struct {
	Lat, Lng float64
	// RadiusM bounds the walk. Zero means DefaultRadiusM.
	RadiusM int
	// Amount, when set, restricts results to agents whose float can actually
	// cover it. An agent who cannot pay is not a result, however close.
	Amount money.Amount
	// OpenAt filters to agents open at this time. Zero means do not filter.
	OpenAt time.Time
	Limit  int
}

const (
	// DefaultRadiusM is a walk somebody carrying cash would make.
	DefaultRadiusM = 5_000
	MaxRadiusM     = 50_000
	DefaultLimit   = 20
	MaxLimit       = 100
)

// Nearby finds usable agents close to a point, nearest first.
//
// A bounding box narrows the rows before any distance is computed, so the
// index does the work and the trigonometry runs over a handful of candidates
// rather than the whole table. PostGIS would do this more elegantly; at this
// scale it would also be an extension to install, operate and upgrade for a
// query that fits in twenty lines.
//
// Float is read from the ledger per candidate rather than cached on the row.
// An agent's capacity to hand out cash IS a balance, and a stored copy of it
// is wrong within a day.
func (s *Store) Nearby(ctx context.Context, q Search) ([]Agent, error) {
	if q.Lat < MinLat || q.Lat > MaxLat || q.Lng < MinLng || q.Lng > MaxLng {
		return nil, fmt.Errorf("agents: %.4f,%.4f is outside Nigeria", q.Lat, q.Lng)
	}
	if q.RadiusM <= 0 {
		q.RadiusM = DefaultRadiusM
	}
	if q.RadiusM > MaxRadiusM {
		q.RadiusM = MaxRadiusM
	}
	if q.Limit <= 0 {
		q.Limit = DefaultLimit
	}
	if q.Limit > MaxLimit {
		q.Limit = MaxLimit
	}

	// A degree of latitude is ~111km everywhere; a degree of longitude shrinks
	// with the cosine of latitude. Nigeria sits near the equator so the
	// difference is small, but computing it is one line and assuming it is not
	// is the kind of shortcut that quietly misses agents at the north of the
	// country.
	latSpan := float64(q.RadiusM) / 111_000
	lngSpan := latSpan / math.Max(math.Cos(q.Lat*math.Pi/180), 0.01)

	rows, err := s.Pool.Query(ctx, `
		SELECT id, operator_id, name, kind, address, COALESCE(phone, ''),
		       lat, lng, to_char(opens_at, 'HH24:MI'), to_char(closes_at, 'HH24:MI'),
		       verified, active, settled_count, disputed_count
		  FROM agents
		 WHERE active AND verified
		   AND lat BETWEEN $1 AND $2
		   AND lng BETWEEN $3 AND $4`,
		q.Lat-latSpan, q.Lat+latSpan, q.Lng-lngSpan, q.Lng+lngSpan)
	if err != nil {
		return nil, fmt.Errorf("agents: nearby: %w", err)
	}
	defer rows.Close()

	var candidates []Agent
	for rows.Next() {
		var a Agent
		if err := rows.Scan(&a.ID, &a.OperatorID, &a.Name, &a.Kind, &a.Address, &a.Phone,
			&a.Lat, &a.Lng, &a.OpensAt, &a.ClosesAt,
			&a.Verified, &a.Active, &a.SettledCount, &a.DisputedCount); err != nil {
			return nil, err
		}
		metres := int(DistanceM(q.Lat, q.Lng, a.Lat, a.Lng))
		if metres > q.RadiusM {
			// The bounding box is a square and the radius is a circle; the
			// corners have to go.
			continue
		}
		a.DistanceM = metres
		candidates = append(candidates, a)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	sortByDistance(candidates)

	out := make([]Agent, 0, q.Limit)
	for i := range candidates {
		a := candidates[i]

		if !q.OpenAt.IsZero() {
			open, err := a.openAt(q.OpenAt)
			if err != nil {
				return nil, err
			}
			a.OpenNow = open
			if !open {
				continue
			}
		}

		if q.Amount.IsPositive() {
			float, err := ledger.Balance(ctx, s.Pool,
				ledger.Agent(a.ID), ledger.KindAgentFloat, q.Amount.Currency())
			if err != nil {
				return nil, err
			}
			a.Float = float
			if cmp, err := float.Cmp(q.Amount); err != nil || cmp < 0 {
				continue
			}
		}

		out = append(out, a)
		if len(out) == q.Limit {
			break
		}
	}
	return out, nil
}

// openAt reports whether the agent is open at a given moment.
func (a Agent) openAt(t time.Time) (bool, error) {
	opens, err := time.Parse("15:04", a.OpensAt)
	if err != nil {
		return false, fmt.Errorf("agents: %s has an unreadable opening time %q", a.ID, a.OpensAt)
	}
	closes, err := time.Parse("15:04", a.ClosesAt)
	if err != nil {
		return false, fmt.Errorf("agents: %s has an unreadable closing time %q", a.ID, a.ClosesAt)
	}

	local := t.Local()
	minutes := local.Hour()*60 + local.Minute()
	return minutes >= opens.Hour()*60+opens.Minute() &&
		minutes < closes.Hour()*60+closes.Minute(), nil
}

// DistanceM is the great-circle distance between two points, in metres.
func DistanceM(lat1, lng1, lat2, lng2 float64) float64 {
	const earthM = 6_371_000.0
	rad := func(d float64) float64 { return d * math.Pi / 180 }

	dLat, dLng := rad(lat2-lat1), rad(lng2-lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(rad(lat1))*math.Cos(rad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return earthM * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}

func sortByDistance(a []Agent) {
	for i := 1; i < len(a); i++ {
		for j := i; j > 0 && a[j].DistanceM < a[j-1].DistanceM; j-- {
			a[j], a[j-1] = a[j-1], a[j]
		}
	}
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func isUniqueViolation(err error) bool {
	var pgErr interface{ SQLState() string }
	return errors.As(err, &pgErr) && pgErr.SQLState() == "23505"
}
