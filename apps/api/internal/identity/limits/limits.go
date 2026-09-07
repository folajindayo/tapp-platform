// Package limits answers one question, in one place: may this person move this
// much right now.
//
// One policy, consulted by the card tap, the payout path, the cash pledge and
// the conversion. The predecessor had three separate constant blocks -- one in
// the card handler, one on the card row, one in the BaaS adapter -- which is
// how a card ends up with a daily limit its holder's identity does not support.
//
// Limits ladder with verification because the alternative is choosing between
// losing most of the market and being negligent. A trader will not photograph
// a passport to accept ₦2,000, and nobody should move ₦2,000,000 on an email
// address alone.
package limits

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/identity/kyc"
	"github.com/usezoracle/tapp/api/internal/money"
)

// Limits are the ceilings for one tier, in one currency.
type Limits struct {
	// PerTransaction caps a single movement.
	PerTransaction money.Amount
	// Daily and Monthly cap the running totals.
	Daily   money.Amount
	Monthly money.Amount
	// MaxBalance caps what may be held at rest. A verification ladder that
	// bounds flow but not stock lets somebody accumulate without ever being
	// identified.
	MaxBalance money.Amount
}

// Policy maps a tier to its limits.
type Policy struct {
	byTier map[kyc.Tier]Limits
}

// NGNPolicy is the naira ladder.
//
// The figures are deliberately here, named, in one function, rather than
// scattered as constants at their point of use -- so that the shape of the
// ladder can be read and argued with rather than reverse-engineered.
func NGNPolicy() *Policy {
	return &Policy{byTier: map[kyc.Tier]Limits{
		// Email only. Enough to receive a payment and buy lunch; not enough to
		// be worth stealing an account for.
		kyc.TierNone: {
			PerTransaction: money.Naira(5_000),
			Daily:          money.Naira(20_000),
			Monthly:        money.Naira(50_000),
			MaxBalance:     money.Naira(50_000),
		},
		// BVN. The workhorse: cheap, strong, and what most people will stop at.
		kyc.TierBVN: {
			PerTransaction: money.Naira(50_000),
			Daily:          money.Naira(200_000),
			Monthly:        money.Naira(1_000_000),
			MaxBalance:     money.Naira(500_000),
		},
		// BVN plus a matched selfie. Proves the person presenting the BVN owns
		// it, which BVN alone does not.
		kyc.TierSelfie: {
			PerTransaction: money.Naira(500_000),
			Daily:          money.Naira(2_000_000),
			Monthly:        money.Naira(10_000_000),
			MaxBalance:     money.Naira(5_000_000),
		},
		// Full documentation.
		kyc.TierDocument: {
			PerTransaction: money.Naira(5_000_000),
			Daily:          money.Naira(20_000_000),
			Monthly:        money.Naira(100_000_000),
			MaxBalance:     money.Naira(50_000_000),
		},
	}}
}

// For returns the limits for a tier.
//
// An unknown tier gets the LOWEST limits, not an error and not the highest. A
// tier this code does not recognise is one added by a future migration, and
// the safe reading of "I do not know how well verified this person is" is "not
// at all".
func (p *Policy) For(t kyc.Tier) Limits {
	if l, ok := p.byTier[t]; ok {
		return l
	}
	return p.byTier[kyc.TierNone]
}

// Verdict is the answer to "may this go through".
type Verdict struct {
	Allowed bool
	// Reason explains a refusal in terms the person can act on -- which limit,
	// and what would lift it.
	Reason string
	// RequiredTier is the verification that would allow this amount, when one
	// would.
	RequiredTier kyc.Tier
	// SpentToday and SpentThisMonth are returned so a client can show somebody
	// where they stand before they hit the ceiling.
	SpentToday     money.Amount
	SpentThisMonth money.Amount
}

// Checker applies the policy against what somebody has actually moved.
type Checker struct {
	Pool   *pgxpool.Pool
	Policy *Policy
	Now    func() time.Time
}

func (c *Checker) now() time.Time {
	if c.Now != nil {
		return c.Now()
	}
	return time.Now()
}

// Check reports whether a movement is within the person's limits.
//
// Spend is summed from the ledger, not from a counter. A counter has to be
// incremented by every path that moves money, and the first path that forgets
// creates a limit that silently does not apply.
func (c *Checker) Check(
	ctx context.Context, user uuid.UUID, tier kyc.Tier, amount money.Amount,
) (*Verdict, error) {
	if !amount.IsPositive() {
		return nil, fmt.Errorf("limits: nothing to check, amount is %s", amount)
	}
	l := c.Policy.For(tier)
	if !l.PerTransaction.SameCurrency(amount) {
		return nil, fmt.Errorf("limits: no policy for %s", amount.Currency())
	}

	now := c.now()
	spentToday, err := c.spentSince(ctx, user, amount.Currency(), startOfDay(now))
	if err != nil {
		return nil, err
	}
	spentMonth, err := c.spentSince(ctx, user, amount.Currency(), startOfMonth(now))
	if err != nil {
		return nil, err
	}

	v := &Verdict{Allowed: true, SpentToday: spentToday, SpentThisMonth: spentMonth}

	if over, _ := amount.Cmp(l.PerTransaction); over > 0 {
		v.Allowed = false
		v.Reason = fmt.Sprintf("Single payments are limited to %s.", l.PerTransaction)
		v.RequiredTier = c.tierFor(amount, func(x Limits) money.Amount { return x.PerTransaction })
		return v, nil
	}

	todayAfter, err := spentToday.Add(amount)
	if err != nil {
		return nil, err
	}
	if over, _ := todayAfter.Cmp(l.Daily); over > 0 {
		v.Allowed = false
		v.Reason = fmt.Sprintf("This would pass your daily limit of %s. You have moved %s today.",
			l.Daily, spentToday)
		v.RequiredTier = c.tierFor(todayAfter, func(x Limits) money.Amount { return x.Daily })
		return v, nil
	}

	monthAfter, err := spentMonth.Add(amount)
	if err != nil {
		return nil, err
	}
	if over, _ := monthAfter.Cmp(l.Monthly); over > 0 {
		v.Allowed = false
		v.Reason = fmt.Sprintf("This would pass your monthly limit of %s.", l.Monthly)
		v.RequiredTier = c.tierFor(monthAfter, func(x Limits) money.Amount { return x.Monthly })
		return v, nil
	}

	return v, nil
}

// tierFor finds the lowest tier whose limit would accommodate an amount, so a
// refusal can tell somebody what to do rather than only that they cannot.
func (c *Checker) tierFor(amount money.Amount, pick func(Limits) money.Amount) kyc.Tier {
	for _, t := range []kyc.Tier{kyc.TierBVN, kyc.TierSelfie, kyc.TierDocument} {
		if over, _ := amount.Cmp(pick(c.Policy.For(t))); over <= 0 {
			return t
		}
	}
	return kyc.TierDocument
}

// spentSince sums outbound movements from a user's spendable balance.
//
// Only debits count: receiving money is not spending it, and a limit that
// counted inbound value would stop somebody being paid.
func (c *Checker) spentSince(
	ctx context.Context, user uuid.UUID, cur money.Currency, since time.Time,
) (money.Amount, error) {
	var minor int64
	err := c.Pool.QueryRow(ctx, `
		SELECT COALESCE(-SUM(e.amount_minor), 0)
		  FROM ledger_entries e
		  JOIN ledger_accounts a ON a.id = e.account_id
		 WHERE a.owner_id = $1
		   AND a.owner_kind = 'user'
		   AND a.kind = 'available'
		   AND a.currency = $2::currency
		   AND e.amount_minor < 0
		   AND e.created_at >= $3`,
		user, string(cur), since).Scan(&minor)
	if err != nil {
		return money.Zero(cur), fmt.Errorf("limits: sum spend: %w", err)
	}
	return money.New(minor, cur), nil
}

func startOfDay(t time.Time) time.Time {
	y, m, d := t.Local().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, t.Local().Location())
}

func startOfMonth(t time.Time) time.Time {
	y, m, _ := t.Local().Date()
	return time.Date(y, m, 1, 0, 0, 0, 0, t.Local().Location())
}
