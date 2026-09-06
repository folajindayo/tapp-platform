package movements

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/money"
)

// Conversion is a quoted exchange between two currencies, priced before it is
// executed.
//
// Sold and Bought are what the user gives up and receives. Spread is the
// platform's margin, denominated in the bought currency and taken out of what
// the user receives -- so Bought is already net, and Bought + Spread is the
// full value of Sold at the quoted rate.
//
// QuoteID ties the movement to the quote that priced it. A conversion executed
// without one is a conversion at whatever the rate happened to be at the
// instant the code ran, which is not a price anybody agreed to.
type Conversion struct {
	Sold    money.Amount
	Bought  money.Amount
	Spread  money.Amount
	QuoteID string
}

// Convert exchanges one currency for another in a single transaction with two
// balanced legs.
//
// This is what the currency dimension of the ledger exists for. Each leg sums
// to zero on its own:
//
//	USD:  user -1000            fx_position +1000              = 0
//	NGN:  fx_position -1540000  user +1532300  revenue +7700   = 0
//
// fx_position holds the platform's exposure between the two currencies, which
// is a real position that a treasury has to manage and that must therefore be
// visible in the books rather than implied. The spread is booked to revenue,
// replacing the constant buffer the card path used to apply inline with a
// comment apologising for it.
//
// Doing this as two separate transactions -- a withdrawal in one currency and
// a deposit in the other -- would mean a crash between them leaves the user's
// money simply gone, with nothing in the ledger relating the two halves.
func Convert(
	ctx context.Context,
	q ledger.Querier,
	user uuid.UUID,
	conv Conversion,
) (uuid.UUID, error) {
	if err := conv.valid(); err != nil {
		return uuid.Nil, err
	}

	sold, bought := conv.Sold.Currency(), conv.Bought.Currency()

	r := newResolver(ctx, q)
	userSold := r.account(ledger.User(user), ledger.KindAvailable, sold)
	userBought := r.account(ledger.User(user), ledger.KindAvailable, bought)
	posSold := r.account(ledger.System(), ledger.KindFXPosition, sold)
	posBought := r.account(ledger.System(), ledger.KindFXPosition, bought)
	revenue := r.account(ledger.System(), ledger.KindRevenue, bought)
	if r.err != nil {
		return uuid.Nil, r.err
	}

	// The bought leg must sum to zero: what leaves the position equals what
	// the user receives plus what the platform keeps.
	gross, err := conv.Bought.Add(conv.Spread)
	if err != nil {
		return uuid.Nil, err
	}

	entries := []ledger.Entry{
		// Sold leg.
		{AccountID: userSold, Amount: conv.Sold.Neg(), Reason: "fx.sold"},
		{AccountID: posSold, Amount: conv.Sold, Reason: "fx.position_in"},
		// Bought leg.
		{AccountID: posBought, Amount: gross.Neg(), Reason: "fx.position_out"},
		{AccountID: userBought, Amount: conv.Bought, Reason: "fx.bought"},
	}
	if conv.Spread.IsPositive() {
		entries = append(entries, ledger.Entry{
			AccountID: revenue, Amount: conv.Spread, Reason: "fx.spread"})
	}

	return ledger.Post(ctx, q, ledger.Ref{
		Type:    "fx",
		IdemKey: "fx:" + conv.QuoteID,
	}, entries)
}

func (c Conversion) valid() error {
	if !c.Sold.IsPositive() {
		return fmt.Errorf("movements: a conversion must sell a positive amount, got %s", c.Sold)
	}
	if !c.Bought.IsPositive() {
		return fmt.Errorf("movements: a conversion must buy a positive amount, got %s", c.Bought)
	}
	if c.Sold.Currency() == c.Bought.Currency() {
		return fmt.Errorf("movements: %s to %s is not a conversion",
			c.Sold.Currency(), c.Bought.Currency())
	}
	if !c.Spread.SameCurrency(c.Bought) {
		return fmt.Errorf("movements: spread %s is not in the bought currency %s",
			c.Spread, c.Bought.Currency())
	}
	if c.Spread.IsNegative() {
		return fmt.Errorf("movements: a negative spread (%s) pays the user more than the rate", c.Spread)
	}
	if c.QuoteID == "" {
		// Without this a conversion is priced at whatever the rate happened to
		// be when the code ran, which nobody agreed to and nobody can audit.
		return fmt.Errorf("movements: a conversion must reference the quote that priced it")
	}
	return nil
}
