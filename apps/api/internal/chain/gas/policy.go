package gas

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/money"
)

// Policy caps how much sponsored gas one party may consume in a window.
//
// The cap lives in Postgres and is claimed with a conditional UPDATE, not
// checked in memory. That is the entire design decision, and it is worth being
// explicit about why: a cap held in a process map is enforced once per
// replica. Ten instances enforce ten times the limit, and a restart returns
// everybody to zero spend. Neither failure is visible from the outside --
// the limit reads as a control and behaves as a suggestion.
//
// Here the database refuses the overspend. Concurrent claims serialise on the
// row, so the cap holds no matter how many instances are running.
type Policy struct {
	Pool *pgxpool.Pool

	// Cap is the most one party may consume per window.
	Cap money.Amount
	// Window is how long a cap lasts before it rolls over.
	Window time.Duration
	// SingleCap bounds any one sponsorship, independent of the window. A cap
	// that only limits the total still lets one transaction consume all of it.
	SingleCap money.Amount
}

// ErrOverCap means this sponsorship would exceed the party's allowance.
var ErrOverCap = errors.New("gas: sponsorship would exceed the allowance")

// ErrOverSingleCap means one transaction asked for more than any single
// sponsorship may cost.
var ErrOverSingleCap = errors.New("gas: sponsorship exceeds the single-transaction cap")

// Allowance is what a party has left.
type Allowance struct {
	Cap       money.Amount `json:"cap"`
	Spent     money.Amount `json:"spent"`
	Remaining money.Amount `json:"remaining"`
}

// Claim reserves cost against the party's allowance, or refuses.
//
// The claim and the check are one statement. Reading the balance and then
// writing it is the classic way a limit is bypassed under concurrency: two
// requests both read "within the cap" and both proceed.
func (p *Policy) Claim(ctx context.Context, owner uuid.UUID, cost money.Amount) error {
	if !cost.IsPositive() {
		return fmt.Errorf("gas: a sponsorship must cost something")
	}
	if cost.Currency() != p.Cap.Currency() {
		return fmt.Errorf("gas: cost is %s but the cap is %s",
			cost.Currency(), p.Cap.Currency())
	}
	if p.SingleCap.IsPositive() && cost.Minor() > p.SingleCap.Minor() {
		return fmt.Errorf("%w: %s > %s", ErrOverSingleCap, cost, p.SingleCap)
	}

	cutoff := time.Now().Add(-p.Window)

	// One statement: insert the row if it is missing, roll the window if it
	// has expired, and add the cost only when the result still fits the cap.
	// No row updated means the cap was reached.
	tag, err := p.Pool.Exec(ctx, `
		INSERT INTO gas_sponsorship_limits (owner_id, window_start, spent_minor, currency)
		VALUES ($1, now(), $2, $3::currency)
		ON CONFLICT (owner_id) DO UPDATE
		   SET window_start = CASE WHEN gas_sponsorship_limits.window_start < $4
		                           THEN now() ELSE gas_sponsorship_limits.window_start END,
		       spent_minor  = CASE WHEN gas_sponsorship_limits.window_start < $4
		                           THEN $2 ELSE gas_sponsorship_limits.spent_minor + $2 END
		 WHERE (CASE WHEN gas_sponsorship_limits.window_start < $4
		             THEN $2 ELSE gas_sponsorship_limits.spent_minor + $2 END) <= $5`,
		owner, cost.Minor(), string(cost.Currency()), cutoff, p.Cap.Minor())
	if err != nil {
		return fmt.Errorf("gas: claim allowance: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrOverCap
	}
	return nil
}

// Release returns a claim that did not end up being spent.
//
// A sponsorship is claimed before the transaction is submitted, because the
// alternative is discovering the party was over their cap after the money is
// gone. When the submission fails, the claim has to come back or the party is
// charged for work that never happened.
func (p *Policy) Release(ctx context.Context, owner uuid.UUID, cost money.Amount) error {
	_, err := p.Pool.Exec(ctx, `
		UPDATE gas_sponsorship_limits
		   SET spent_minor = GREATEST(0, spent_minor - $2)
		 WHERE owner_id = $1`, owner, cost.Minor())
	if err != nil {
		return fmt.Errorf("gas: release allowance: %w", err)
	}
	return nil
}

// Remaining reports a party's allowance without changing it.
func (p *Policy) Remaining(ctx context.Context, owner uuid.UUID) (*Allowance, error) {
	var spent int64
	err := p.Pool.QueryRow(ctx, `
		SELECT CASE WHEN window_start < $2 THEN 0 ELSE spent_minor END
		  FROM gas_sponsorship_limits WHERE owner_id = $1`,
		owner, time.Now().Add(-p.Window)).Scan(&spent)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("gas: read allowance: %w", err)
	}

	c := p.Cap.Currency()
	remaining := p.Cap.Minor() - spent
	if remaining < 0 {
		remaining = 0
	}
	return &Allowance{
		Cap:       p.Cap,
		Spent:     money.New(spent, c),
		Remaining: money.New(remaining, c),
	}, nil
}
