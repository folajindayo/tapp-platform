package cash

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/money"
)

// View is a pledge together with the handover it is waiting on, if any.
//
// The two travel together because they are one thing to the person holding the
// cash: they took a photograph and now they are walking somewhere. Making the
// app fetch them separately would let it draw a matched pledge with no agent
// attached for one render, which looks exactly like a match that fell through.
type View struct {
	Pledge   *Pledge   `json:"pledge"`
	Handover *Handover `json:"handover,omitempty"`
}

// Reader answers questions about pledges. Reads only -- nothing here takes a
// lock or moves money, so it runs on the pool rather than in a transaction.
type Reader struct {
	Pool ledger.Querier
}

const pledgeColumns = `
	p.id, p.ref, p.trader_id, p.currency, p.declared_minor,
	COALESCE(p.counted_minor, 0), p.state, p.lat, p.lng,
	COALESCE(p.risk_score, 0), COALESCE(p.refused_reason, ''),
	p.created_at, p.expires_at, p.settled_at`

func scanPledge(row pgx.Row) (*Pledge, error) {
	var (
		p                 Pledge
		currency          string
		declared, counted int64
	)
	err := row.Scan(&p.ID, &p.Ref, &p.TraderID, &currency, &declared, &counted,
		&p.State, &p.Lat, &p.Lng, &p.RiskScore, &p.RefusedReason,
		&p.CreatedAt, &p.ExpiresAt, &p.SettledAt)
	if err != nil {
		return nil, err
	}
	p.Declared = money.New(declared, money.Currency(currency))
	p.Counted = money.New(counted, money.Currency(currency))
	return &p, nil
}

// Get returns one pledge belonging to this trader, and its live handover.
//
// Scoped by trader_id in the WHERE clause rather than checked after loading:
// a query that cannot return somebody else's row cannot leak one through a
// forgotten comparison.
func (r *Reader) Get(ctx context.Context, id, traderID uuid.UUID) (*View, error) {
	pledge, err := scanPledge(r.Pool.QueryRow(ctx,
		`SELECT `+pledgeColumns+` FROM cash_pledges p
		  WHERE p.id = $1 AND p.trader_id = $2`, id, traderID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPledgeUnknown
	}
	if err != nil {
		return nil, fmt.Errorf("cash: read pledge: %w", err)
	}

	handover, err := r.liveHandover(ctx, id)
	if err != nil {
		return nil, err
	}
	return &View{Pledge: pledge, Handover: handover}, nil
}

// List returns this trader's pledges, most recent first.
func (r *Reader) List(ctx context.Context, traderID uuid.UUID, limit int) ([]*Pledge, error) {
	if limit <= 0 || limit > 100 {
		limit = 25
	}
	rows, err := r.Pool.Query(ctx,
		`SELECT `+pledgeColumns+` FROM cash_pledges p
		  WHERE p.trader_id = $1
		  ORDER BY p.created_at DESC
		  LIMIT $2`, traderID, limit)
	if err != nil {
		return nil, fmt.Errorf("cash: list pledges: %w", err)
	}
	defer rows.Close()

	out := make([]*Pledge, 0, limit)
	for rows.Next() {
		p, err := scanPledge(rows)
		if err != nil {
			return nil, fmt.Errorf("cash: list pledges: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// liveHandover returns the handover a pledge is currently waiting on.
//
// There is at most one, enforced by cash_handovers_live. A settled pledge has
// none, and that is not an error: the meeting is over.
func (r *Reader) liveHandover(ctx context.Context, pledgeID uuid.UUID) (*Handover, error) {
	var (
		h        Handover
		currency string
		amount   int64
	)
	err := r.Pool.QueryRow(ctx, `
		SELECT id, pledge_id, agent_id, currency, amount_minor, code,
		       distance_m, state, expires_at
		  FROM cash_handovers
		 WHERE pledge_id = $1
		   AND state IN ('proposed','trader_confirmed','agent_confirmed')`, pledgeID).
		Scan(&h.ID, &h.PledgeID, &h.AgentID, &currency, &amount, &h.Code,
			&h.DistanceM, &h.State, &h.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("cash: read handover: %w", err)
	}
	h.Amount = money.New(amount, money.Currency(currency))
	return &h, nil
}
