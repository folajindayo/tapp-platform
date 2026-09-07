package auth

import (
	"errors"
	"testing"

	"github.com/usezoracle/tapp/api/internal/money"
)

// The cardholder's side of the protocol.
func cardholderAnswers(k []byte, pin string, nonce []byte) (anchor, response []byte) {
	a := Anchor(k, pin)
	return a, Respond(a, nonce)
}

func TestTheRightPINVerifiesAndTheWrongOneDoesNot(t *testing.T) {
	k := []byte("a-32-byte-secret-that-lives-on-c")
	nonce := make([]byte, NonceLen)
	for i := range nonce {
		nonce[i] = byte(i)
	}

	anchor, response := cardholderAnswers(k, "1234", nonce)
	if err := VerifyPIN(anchor, nonce, response); err != nil {
		t.Fatalf("the correct PIN was refused: %v", err)
	}

	_, wrong := cardholderAnswers(k, "4321", nonce)
	if err := VerifyPIN(anchor, nonce, wrong); !errors.Is(err, ErrWrongPIN) {
		t.Fatalf("a wrong PIN returned %v, want ErrWrongPIN", err)
	}
}

// A response is bound to one nonce. Capturing it off the wire buys nothing,
// because the next debit challenges with a different one.
func TestAResponseIsBoundToItsNonce(t *testing.T) {
	k := []byte("a-32-byte-secret-that-lives-on-c")
	first := make([]byte, NonceLen)
	second := make([]byte, NonceLen)
	for i := range second {
		second[i] = 0xAB
	}

	anchor, response := cardholderAnswers(k, "1234", first)
	if err := VerifyPIN(anchor, second, response); !errors.Is(err, ErrWrongPIN) {
		t.Fatal("a response captured for one nonce verified against another")
	}
}

// A card that never finished linking has no anchor. Saying so distinctly is
// the difference between a cardholder retrying a PIN forever and being told to
// re-link.
func TestACardWithNoAnchorReportsNoPIN(t *testing.T) {
	nonce := make([]byte, NonceLen)
	if err := VerifyPIN(nil, nonce, make([]byte, AnchorLen)); !errors.Is(err, ErrNoPIN) {
		t.Fatalf("got %v, want ErrNoPIN", err)
	}
}

func TestTiersFollowTheAmount(t *testing.T) {
	l := Limits{
		PerTap: money.Naira(2_000),
		StepUp: money.Naira(15_000),
		Daily:  money.Naira(40_000),
	}

	for _, tc := range []struct {
		amount money.Amount
		want   Tier
	}{
		{money.Naira(500), TierNone},
		{money.New(199_999, money.NGN), TierNone}, // ₦1,999.99
		{money.Naira(2_000), TierPIN},             // exactly at the threshold
		{money.Naira(14_999), TierPIN},
		{money.Naira(15_000), TierStepUp}, // exactly at the threshold
		{money.Naira(100_000), TierStepUp},
	} {
		got, err := l.TierFor(tc.amount)
		if err != nil {
			t.Fatalf("TierFor(%s): %v", tc.amount, err)
		}
		if got != tc.want {
			t.Errorf("TierFor(%s) = %q, want %q", tc.amount, got, tc.want)
		}
	}
}

// No defaults. A card that never completed linking has no agreed limits, and
// the predecessor silently gave it a ₦40,000 daily allowance from a package
// constant.
func TestACardWithNoLimitsCannotTransact(t *testing.T) {
	for name, l := range map[string]Limits{
		"nothing set":  {},
		"only per-tap": {PerTap: money.Naira(2_000)},
		"per-tap above step-up": {
			PerTap: money.Naira(20_000), StepUp: money.Naira(15_000), Daily: money.Naira(40_000)},
		"step-up above daily": {
			PerTap: money.Naira(2_000), StepUp: money.Naira(50_000), Daily: money.Naira(40_000)},
		"mixed currencies": {
			PerTap: money.Naira(2_000), StepUp: money.Dollars(15), Daily: money.Naira(40_000)},
	} {
		t.Run(name, func(t *testing.T) {
			if err := l.Valid(); err == nil {
				t.Fatalf("%s was accepted as a coherent set of limits", name)
			}
			if _, err := l.TierFor(money.Naira(100)); err == nil {
				t.Fatalf("%s produced a tier", name)
			}
		})
	}
}

func TestAnAmountInTheWrongCurrencyIsRefused(t *testing.T) {
	l := Limits{PerTap: money.Naira(2_000), StepUp: money.Naira(15_000), Daily: money.Naira(40_000)}
	if _, err := l.TierFor(money.Dollars(1)); err == nil {
		t.Fatal("a dollar amount was checked against naira limits")
	}
}
