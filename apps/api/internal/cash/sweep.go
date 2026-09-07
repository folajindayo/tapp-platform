package cash

import (
	"context"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/usezoracle/tapp/api/internal/ledger/movements"
	"github.com/usezoracle/tapp/api/internal/money"
)

// Sweep closes out everything that has run out of time.
//
// This is what makes an abandoned meeting cost nobody anything, and it is not
// a tidy-up job: without it an agent's float stays locked against a trader who
// never came, and that agent cannot serve anybody else. Every minute of delay
// is float withdrawn from the market.
//
// It is idempotent and safe to run concurrently. Each handover is claimed by
// the statement that changes its state, so two sweepers racing settle on one
// winner per row rather than releasing the same float twice.
func (s *Service) Sweep(ctx context.Context) (released int, err error) {
	rows, err := s.Pool.Query(ctx, `
		SELECT id, pledge_id, agent_id, currency, amount_minor
		  FROM cash_handovers
		 WHERE state IN ('proposed', 'trader_confirmed', 'agent_confirmed')
		   AND expires_at < now()
		 LIMIT 200`)
	if err != nil {
		return 0, err
	}

	type expired struct {
		id, pledgeID, agentID uuid.UUID
		amount                money.Amount
	}
	var due []expired
	for rows.Next() {
		var e expired
		var currency string
		var minor int64
		if err := rows.Scan(&e.id, &e.pledgeID, &e.agentID, &currency, &minor); err != nil {
			rows.Close()
			return released, err
		}
		e.amount = money.New(minor, money.Currency(currency))
		due = append(due, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return released, err
	}

	for _, e := range due {
		err := movements.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
			// Claim it. A concurrent sweeper, or a confirmation that landed a
			// moment ago, will have moved the state and this matches nothing.
			tag, err := tx.Exec(ctx, `
				UPDATE cash_handovers SET state = 'expired'
				 WHERE id = $1 AND state IN ('proposed', 'trader_confirmed', 'agent_confirmed')`,
				e.id)
			if err != nil {
				return err
			}
			if tag.RowsAffected() == 0 {
				return nil
			}

			if _, err := movements.ReleaseAgentFloat(ctx, tx, e.agentID, e.amount,
				e.id.String(), "expired"); err != nil {
				return err
			}

			// The pledge goes back to open rather than expiring with it. The
			// trader still has their notes and the photograph is still valid;
			// making them start again because an agent did not show would
			// punish them for somebody else's absence.
			if _, err := tx.Exec(ctx, `
				UPDATE cash_pledges
				   SET state = CASE WHEN expires_at < now() THEN 'expired'::pledge_state
				                    ELSE 'open'::pledge_state END,
				       updated_at = now()
				 WHERE id = $1 AND state IN ('matched', 'handed_over')`, e.pledgeID); err != nil {
				return err
			}
			released++
			return nil
		})
		if err != nil {
			slog.Error("cash: could not release an expired handover",
				"handover", e.id, "agent", e.agentID, "err", err)
			continue
		}
	}

	// Pledges that ran out with no handover at all.
	if _, err := s.Pool.Exec(ctx, `
		UPDATE cash_pledges SET state = 'expired', updated_at = now()
		 WHERE state IN ('screening', 'open') AND expires_at < now()`); err != nil {
		return released, err
	}

	// Free the notes of everything that closed, so the cash can be pledged
	// again. A trader whose pledge expired still has the notes in their hand.
	if _, err := s.Pool.Exec(ctx, `
		UPDATE pledged_notes n SET released = true
		  FROM cash_pledges p
		 WHERE n.pledge_id = p.id AND NOT n.released
		   AND p.state IN ('expired', 'refused', 'settled')`); err != nil {
		return released, err
	}

	return released, nil
}

// RunSweeper sweeps on a timer until the context ends.
func (s *Service) RunSweeper(ctx context.Context, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			released, err := s.Sweep(ctx)
			if err != nil {
				slog.Error("cash: sweep failed", "err", err)
				continue
			}
			if released > 0 {
				slog.Info("cash: released expired handovers", "count", released)
			}
		}
	}
}
