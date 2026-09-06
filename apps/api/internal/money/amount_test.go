package money

import "testing"

func TestRendersTheWayAUserReadsIt(t *testing.T) {
	for _, tc := range []struct {
		in   Amount
		want string
	}{
		{Naira(20_000), "₦20,000.00"},
		{New(150, NGN), "₦1.50"},
		{New(-150, NGN), "-₦1.50"},
		{Zero(NGN), "₦0.00"},
		{New(1_234_567_89, NGN), "₦1,234,567.89"},
		{Dollars(10), "$10.00"},
		{New(-1250, USD), "-$12.50"},
	} {
		if got := tc.in.String(); got != tc.want {
			t.Errorf("String() = %q, want %q", got, tc.want)
		}
	}
}

// The whole reason Amount carries its currency: naira and dollars must not
// combine. Before this type it was an int64 either way, and the mistake was a
// plausible line of code rather than a compile-or-error boundary.
func TestCurrenciesDoNotMix(t *testing.T) {
	if _, err := Naira(100).Add(Dollars(1)); err == nil {
		t.Fatal("added dollars to naira")
	}
	if _, err := Naira(100).Sub(Dollars(1)); err == nil {
		t.Fatal("subtracted dollars from naira")
	}
	if _, err := Naira(100).Cmp(Dollars(1)); err == nil {
		t.Fatal("compared naira against dollars")
	}
	if Naira(100).SameCurrency(Dollars(1)) {
		t.Fatal("SameCurrency said naira and dollars match")
	}
}

// A zero amount still has a currency. Zero(NGN) and Zero(USD) balance
// different legs of a conversion and are not interchangeable.
func TestZeroKeepsItsCurrency(t *testing.T) {
	if Zero(NGN).Currency() != NGN {
		t.Fatal("Zero(NGN) lost its currency")
	}
	if _, err := Zero(NGN).Add(Zero(USD)); err == nil {
		t.Fatal("two zeros of different currencies combined")
	}
}

func TestAddDoesNotWrapOnOverflow(t *testing.T) {
	const maxInt64 = int64(^uint64(0) >> 1)
	if _, err := New(maxInt64, NGN).Add(New(1, NGN)); err == nil {
		t.Fatal("overflow wrapped into a positive balance")
	}
	if _, err := New(-maxInt64-1, NGN).Add(New(-1, NGN)); err == nil {
		t.Fatal("underflow wrapped")
	}
}

// The fee comes out of the amount and rounds toward the payer. Rounding the
// other way would collect a minor unit the platform did not earn on every
// single transaction.
func TestFeeComesOutOfTheAmountAndRoundsToThePayer(t *testing.T) {
	// 0.5% of ₦20,000 = ₦100
	if got := FeeFor(Naira(20_000), 50); got.Minor() != 100_00 {
		t.Errorf("fee = %s, want ₦100.00", got)
	}
	// 0.5% of ₦1.01 is 0.505 kobo, which truncates to 0 rather than 1.
	if got := FeeFor(New(101, NGN), 50); got.Minor() != 0 {
		t.Errorf("fee = %s, want zero (rounds to the payer)", got)
	}
	if got := FeeFor(Naira(100), 0); !got.IsZero() {
		t.Errorf("zero bps produced a fee of %s", got)
	}
	if got := FeeFor(Naira(-100), 50); !got.IsZero() {
		t.Errorf("negative amount produced a fee of %s", got)
	}
	// A fee may never consume the whole amount.
	got := FeeFor(New(10, NGN), 10_000)
	if got.Minor() != 9 {
		t.Errorf("fee = %s, want 9 minor units (amount less one)", got)
	}
	if got.Currency() != NGN {
		t.Errorf("fee lost its currency: %s", got.Currency())
	}
}

func TestUnsupportedCurrenciesAreRefusedNotDefaulted(t *testing.T) {
	if err := Currency("ZWL").Valid(); err == nil {
		t.Fatal("an unsupported currency was accepted")
	}
	if err := Currency("").Valid(); err == nil {
		t.Fatal("an empty currency was accepted")
	}
	for _, c := range SupportedCurrencies() {
		if err := c.Valid(); err != nil {
			t.Errorf("%s is listed as supported but rejected: %v", c, err)
		}
	}
}

func TestOnlyRealBanknotesCount(t *testing.T) {
	for _, d := range NairaDenominations {
		if !IsNairaDenomination(d) {
			t.Errorf("%s is a circulating note but was rejected", d)
		}
	}
	if IsNairaDenomination(Naira(300)) {
		t.Error("₦300 is not a banknote")
	}
	if IsNairaDenomination(Dollars(100)) {
		t.Error("a dollar amount passed the naira banknote check")
	}
}
