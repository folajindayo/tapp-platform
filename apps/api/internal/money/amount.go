package money

import (
	"errors"
	"fmt"
)

// Amount is a monetary value: a signed count of minor units, plus the currency
// those units belong to.
//
// The currency travels with the number deliberately. The predecessor of this
// type was a bare int64 of kobo, which worked while there was one currency and
// stops working the moment there are two -- adding dollars to naira is a
// compile error here, and was a plausible line of code before.
type Amount struct {
	minor    int64
	currency Currency
}

// ErrCurrencyMismatch is returned by any operation on two different
// currencies. It is a distinct error because callers routinely want to report
// it differently from an arithmetic failure: it is a programming mistake, not
// a runtime condition.
var ErrCurrencyMismatch = errors.New("money: currency mismatch")

// New builds an amount from minor units.
func New(minor int64, c Currency) Amount { return Amount{minor: minor, currency: c} }

// Naira and Dollars are conveniences for literals in tests and configuration,
// where writing 500_000 for ₦5,000 invites transcription errors.
func Naira(major int64) Amount   { return New(major*NGN.Scale(), NGN) }
func Dollars(major int64) Amount { return New(major*USD.Scale(), USD) }

// Zero is the additive identity in a currency. Note that a zero amount still
// carries its currency, so Zero(NGN) and Zero(USD) are not interchangeable.
func Zero(c Currency) Amount { return Amount{currency: c} }

func (a Amount) Minor() int64       { return a.minor }
func (a Amount) Currency() Currency { return a.currency }
func (a Amount) IsZero() bool       { return a.minor == 0 }
func (a Amount) IsPositive() bool   { return a.minor > 0 }
func (a Amount) IsNegative() bool   { return a.minor < 0 }

// Neg returns the amount with its sign flipped -- the other leg of a movement.
func (a Amount) Neg() Amount { return Amount{minor: -a.minor, currency: a.currency} }

// Abs returns the magnitude.
func (a Amount) Abs() Amount {
	if a.minor < 0 {
		return a.Neg()
	}
	return a
}

// Add sums two amounts of the same currency. It returns an error rather than
// panicking or silently coercing, because the mismatch is worth surfacing at
// the call site that made it.
func (a Amount) Add(b Amount) (Amount, error) {
	if a.currency != b.currency {
		return Amount{}, fmt.Errorf("%w: %s + %s", ErrCurrencyMismatch, a.currency, b.currency)
	}
	sum := a.minor + b.minor
	// Overflow cannot be allowed to wrap into a plausible-looking balance.
	if (a.minor > 0 && b.minor > 0 && sum < 0) || (a.minor < 0 && b.minor < 0 && sum > 0) {
		return Amount{}, fmt.Errorf("money: overflow adding %s and %s", a, b)
	}
	return Amount{minor: sum, currency: a.currency}, nil
}

// Sub subtracts b from a.
func (a Amount) Sub(b Amount) (Amount, error) { return a.Add(b.Neg()) }

// SameCurrency reports whether two amounts can be combined.
func (a Amount) SameCurrency(b Amount) bool { return a.currency == b.currency }

// Cmp orders two amounts of the same currency: -1, 0 or 1. It returns an error
// on a mismatch rather than an arbitrary ordering, because "is this balance
// enough" must never be answered by comparing dollars to naira.
func (a Amount) Cmp(b Amount) (int, error) {
	if a.currency != b.currency {
		return 0, fmt.Errorf("%w: %s vs %s", ErrCurrencyMismatch, a.currency, b.currency)
	}
	switch {
	case a.minor < b.minor:
		return -1, nil
	case a.minor > b.minor:
		return 1, nil
	default:
		return 0, nil
	}
}

// String renders the amount the way a user expects to read it: ₦20,000.00,
// -$12.50.
func (a Amount) String() string {
	scale := a.currency.Scale()
	minor := a.minor
	sign := ""
	if minor < 0 {
		sign = "-"
		minor = -minor
	}
	major := minor / scale
	frac := minor % scale
	if a.currency.Exponent() == 0 {
		return fmt.Sprintf("%s%s%s", sign, a.currency.Symbol(), group(fmt.Sprintf("%d", major)))
	}
	return fmt.Sprintf("%s%s%s.%0*d",
		sign, a.currency.Symbol(), group(fmt.Sprintf("%d", major)), a.currency.Exponent(), frac)
}

// FeeFor computes a fee in basis points of an amount.
//
// The fee always comes out of the transferred amount, never in addition to it.
// For a cash pledge that is a physical constraint -- the sender is handing over
// whole banknotes and cannot make change -- and keeping the same rule for card
// and bank movements means one definition of "amount" everywhere.
//
// Integer division truncates, so the fee rounds in the payer's favour. That is
// the correct direction: rounding the other way lets the platform collect a
// kobo it did not earn, on every transaction, forever.
func FeeFor(amount Amount, bps int) Amount {
	if amount.minor <= 0 || bps <= 0 {
		return Zero(amount.currency)
	}
	fee := amount.minor * int64(bps) / 10_000
	if fee >= amount.minor {
		// A fee can never consume the whole amount: the recipient would get
		// nothing and the movement would be pointless.
		fee = amount.minor - 1
	}
	return Amount{minor: fee, currency: amount.currency}
}
