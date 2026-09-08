package v1

import (
	"testing"

	"github.com/usezoracle/tapp/api/internal/money"
)

// The rail reports naira as a decimal string. Getting this conversion wrong is
// not a rendering bug -- it is the amount that gets posted to somebody's
// ledger, off by a factor of a hundred in whichever direction.
func TestNairaFromRail(t *testing.T) {
	for _, tc := range []struct {
		in    string
		minor int64
	}{
		{"1000", 100_000},
		{"1000.00", 100_000},
		{"1000.5", 100_050},
		{"0.01", 1},
		{" 2500.75 ", 250_075},
	} {
		got, err := nairaFromRail(tc.in)
		if err != nil {
			t.Fatalf("%q: %v", tc.in, err)
		}
		if got.Minor() != tc.minor {
			t.Errorf("%q = %d kobo, want %d", tc.in, got.Minor(), tc.minor)
		}
		if got.Currency() != money.NGN {
			t.Errorf("%q is %s, want NGN", tc.in, got.Currency())
		}
	}
}

// Refused rather than rounded. Rounding would mean this system deciding,
// silently, that somebody's money is a different amount than their bank said.
func TestNairaFromRailRejectsUnpostable(t *testing.T) {
	for _, in := range []string{"", "abc", "0", "-100", "1.005"} {
		if got, err := nairaFromRail(in); err == nil {
			t.Errorf("%q was accepted as %s", in, got)
		}
	}
}
