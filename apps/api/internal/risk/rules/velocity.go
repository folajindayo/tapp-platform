// Package rules holds the behavioural checks: what this person has been doing
// lately, rather than what is in the photograph they just sent.
//
// These read the ledger and the risk history, so they see patterns no single
// image can show -- the same device driving six accounts, an account a few
// minutes old moving a large amount, two actions from places too far apart to
// have travelled between.
package rules

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/risk"
)

// Velocity notices somebody doing the same thing unusually often.
//
// A burst is not fraud. Market traders take many payments in an hour, and a
// threshold set for a quiet user will fire on a busy one all day. So the
// signals here are weighted low on their own and are meant to combine with
// something else -- an account that is both new and fast is a different
// proposition from one that is merely fast.
type Velocity struct {
	Pool *pgxpool.Pool

	// Window is how far back to look.
	Window time.Duration
	// Actions is how many in that window starts being unusual.
	Actions int
	// Recipients is how many distinct counterparties in that window starts
	// being unusual. Spreading value across many destinations quickly is the
	// shape of moving stolen funds, and it looks different from ordinary
	// trading, which sees the same faces.
	Recipients int
}

func (v *Velocity) Name() string { return "velocity" }

// Defaults sized for a market trader's ordinary day rather than a quiet
// consumer's, so the common case does not generate noise.
func NewVelocity(pool *pgxpool.Pool) *Velocity {
	return &Velocity{Pool: pool, Window: time.Hour, Actions: 25, Recipients: 12}
}

func (v *Velocity) Inspect(ctx context.Context, s risk.Subject) ([]risk.Signal, error) {
	if v.Pool == nil {
		return nil, fmt.Errorf("rules: velocity has no database")
	}
	since := s.At.Add(-v.Window)

	var actions, recipients int
	err := v.Pool.QueryRow(ctx, `
		SELECT COUNT(*), COUNT(DISTINCT t.merchant_id)
		  FROM card_taps t
		 WHERE t.cardholder_id = $1 AND t.created_at >= $2`,
		s.UserID, since).Scan(&actions, &recipients)
	if err != nil {
		return nil, fmt.Errorf("rules: velocity: %w", err)
	}

	var out []risk.Signal
	if actions >= v.Actions {
		out = append(out, risk.Signal{
			Name:     "velocity.many_actions",
			Detail:   fmt.Sprintf("%d payments in the last %s.", actions, v.Window),
			Severity: risk.Low,
		})
	}
	if recipients >= v.Recipients {
		out = append(out, risk.Signal{
			Name:     "velocity.many_recipients",
			Detail:   fmt.Sprintf("%d different merchants in the last %s.", recipients, v.Window),
			Severity: risk.Medium,
		})
	}
	out = append(out, risk.Signal{
		Name:     "velocity.observed",
		Detail:   fmt.Sprintf("%d payments to %d merchants in the last %s", actions, recipients, v.Window),
		Severity: risk.Info,
	})
	return out, nil
}
