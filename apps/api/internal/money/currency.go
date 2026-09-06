// Package money represents monetary values as integer minor units.
//
// Every amount in this system is an int64 count of the currency's smallest
// unit -- kobo for naira, cents for dollars. Floating point never touches
// money, at rest or in transit. A float can represent neither 0.1 nor the
// result of accumulating a million of them, and a ledger that does not sum to
// exactly zero is not a ledger.
//
// Amounts are signed, because ledger entries are signed: the same type has to
// express both legs of a movement.
package money

import (
	"fmt"
	"strings"
)

// Currency is an ISO 4217 code. It is a distinct type so that a currency can
// never be passed where a bank code or a country is expected, and so that an
// amount cannot exist without one.
type Currency string

const (
	NGN Currency = "NGN"
	USD Currency = "USD"
)

// currencyInfo describes how a currency is written and subdivided.
type currencyInfo struct {
	symbol string
	// exponent is the number of decimal places: 2 means 100 minor units to
	// the major unit. Currencies with 0 or 3 exist; nothing here assumes 2.
	exponent int
}

var currencies = map[Currency]currencyInfo{
	NGN: {symbol: "₦", exponent: 2},
	USD: {symbol: "$", exponent: 2},
}

// Supported reports whether this system knows how to handle the currency.
// Unknown currencies are refused at the boundary rather than defaulted, so a
// typo cannot silently become naira.
func (c Currency) Supported() bool {
	_, ok := currencies[c]
	return ok
}

// Valid returns an error naming the problem, for use at API boundaries where
// the caller needs to be told what was wrong.
func (c Currency) Valid() error {
	if c == "" {
		return fmt.Errorf("money: no currency given")
	}
	if !c.Supported() {
		return fmt.Errorf("money: unsupported currency %q", string(c))
	}
	return nil
}

func (c Currency) String() string { return string(c) }

// Symbol returns the display symbol, or the code itself when unknown -- a
// rendering path must never panic on data that reached it.
func (c Currency) Symbol() string {
	if info, ok := currencies[c]; ok {
		return info.symbol
	}
	return string(c)
}

// Exponent is the number of decimal places in the currency.
func (c Currency) Exponent() int {
	if info, ok := currencies[c]; ok {
		return info.exponent
	}
	return 2
}

// Scale is how many minor units make one major unit: 100 for both NGN and USD.
func (c Currency) Scale() int64 {
	scale := int64(1)
	for i := 0; i < c.Exponent(); i++ {
		scale *= 10
	}
	return scale
}

// SupportedCurrencies lists what the system handles, for validation messages
// and for the /v1/currencies response.
func SupportedCurrencies() []Currency {
	return []Currency{NGN, USD}
}

// group inserts thousands separators into a run of digits.
func group(digits string) string {
	var b strings.Builder
	for i, r := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte(',')
		}
		b.WriteRune(r)
	}
	return b.String()
}
