package gas

import (
	"context"
	"errors"
	"math/big"
	"testing"

	"github.com/shopspring/decimal"

	"github.com/usezoracle/tapp/api/internal/money"
)

// A sweep on Base costs a fraction of a cent. The conversion has to survive
// that: this is exactly where a float's error is largest relative to the
// value, and where a wrong exponent hides.
func TestATypicalSweepCostsAFractionOfACent(t *testing.T) {
	// 60,000 gas at 0.01 gwei = 6e11 wei = 0.0000006 ETH.
	wei := new(big.Int).Mul(big.NewInt(60_000), big.NewInt(10_000_000))
	got := weiToMinor(wei, decimal.NewFromInt(4000), money.USD)

	// 0.0000006 ETH x $4000 = $0.0024 -> 0 cents, truncated.
	if got.Minor() != 0 {
		t.Fatalf("cost = %s (%d minor), want 0 -- sub-cent must not round up",
			got, got.Minor())
	}
}

func TestAnExpensiveTransactionIsPricedExactly(t *testing.T) {
	// 0.005 ETH at $4000 = $20.00 exactly.
	wei := new(big.Int).Mul(big.NewInt(5), new(big.Int).Exp(big.NewInt(10), big.NewInt(15), nil))
	got := weiToMinor(wei, decimal.NewFromInt(4000), money.USD)

	if got.Minor() != 2000 {
		t.Fatalf("cost = %s (%d minor), want 2000 ($20.00)", got, got.Minor())
	}
}

// Truncation, not rounding: the platform must never book a cost larger than
// the chain actually charged.
func TestCostIsNeverRoundedUp(t *testing.T) {
	// 0.00000499999 ETH x $4000 = $0.01999996 -> 1 cent, not 2.
	wei := big.NewInt(4_999_990_000_000)
	got := weiToMinor(wei, decimal.NewFromInt(4000), money.USD)
	if got.Minor() != 1 {
		t.Fatalf("cost = %d minor, want 1 -- rounding up overstates what we paid", got.Minor())
	}
}

func TestZeroAndNegativeCostsAreNotMovements(t *testing.T) {
	for _, wei := range []*big.Int{nil, big.NewInt(0), big.NewInt(-1)} {
		if got := weiToMinor(wei, decimal.NewFromInt(4000), money.USD); !got.IsZero() {
			t.Fatalf("wei %v priced as %s, want zero", wei, got)
		}
	}
}

// The exponent is the thing most likely to be wrong, and least likely to be
// noticed: a factor of 1e18 either way still looks like a plausible number.
func TestOneWholeETHPricesAtTheRate(t *testing.T) {
	oneETH := new(big.Int).Exp(big.NewInt(10), big.NewInt(18), nil)
	got := weiToMinor(oneETH, decimal.NewFromInt(4000), money.USD)
	if got.Minor() != 400_000 {
		t.Fatalf("1 ETH priced at %s (%d minor), want $4000.00", got, got.Minor())
	}
}

// The zero address holds every ETH ever burned. Reporting it as a healthy gas
// wallet would say the platform can pay for on-chain work when it has no
// wallet at all -- the exact opposite of the truth.
func TestAnUnconfiguredWalletIsNotAHealthyOne(t *testing.T) {
	w := &Wallet{} // no address: BASE_TREASURY_KEY unset
	if _, err := w.Check(context.Background()); !errors.Is(err, ErrNoWallet) {
		t.Fatalf("Check() on an unconfigured wallet = %v, want ErrNoWallet", err)
	}
}
