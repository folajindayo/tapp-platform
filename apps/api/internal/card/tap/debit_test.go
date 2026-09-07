package tap

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/usezoracle/tapp/api/internal/card/auth"
	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/money"
)

// challenge asks for a tier and nonce the way a merchant app does.
func (f *fixture) challenge(t *testing.T, amount money.Amount) *Challenge {
	t.Helper()
	ch, err := f.Svc.Challenge(context.Background(), ChallengeRequest{
		CardUIDHash: f.UIDHash, MerchantID: f.Merchant, Amount: amount,
	})
	if err != nil {
		t.Fatalf("Challenge(%s): %v", amount, err)
	}
	return ch
}

// pay runs a full challenge-then-debit, answering the PIN when asked.
func (f *fixture) pay(t *testing.T, amount money.Amount) (*Receipt, error) {
	t.Helper()
	ch := f.challenge(t, amount)

	req := Request{
		CardUIDHash: f.UIDHash, PresentedToken: f.Token, Nonce: ch.Nonce,
		MerchantID: f.Merchant, Amount: amount,
	}
	if ch.Tier == auth.TierPIN {
		req.PINResponse = auth.Respond(f.Anchor, ch.Nonce)
	}
	return f.Svc.Debit(context.Background(), req)
}

func (f *fixture) balance(t *testing.T) money.Amount {
	t.Helper()
	b, err := ledger.Balance(context.Background(), f.Pool,
		ledger.User(f.Cardholder), ledger.KindAvailable, money.NGN)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	return b
}

func TestATapChargesTheCardholderAndCreditsTheMerchant(t *testing.T) {
	f := newFixture(t, money.Naira(10_000))

	receipt, err := f.pay(t, money.Naira(1_500))
	if err != nil {
		t.Fatalf("Debit: %v", err)
	}
	if receipt.Tier != auth.TierNone {
		t.Errorf("₦1,500 required tier %q, want none (per-tap threshold is ₦2,000)", receipt.Tier)
	}

	// ₦1,500 less 0.5% = ₦7.50 fee
	if receipt.Fee.Minor() != 750 {
		t.Errorf("fee = %s, want ₦7.50", receipt.Fee)
	}
	if got := f.balance(t); got.Minor() != 850_000 {
		t.Errorf("cardholder = %s, want ₦8,500.00", got)
	}
	owed, _ := ledger.Balance(context.Background(), f.Pool,
		ledger.Merchant(f.Merchant), ledger.KindMerchantPayable, money.NGN)
	if owed.Minor() != 149_250 {
		t.Errorf("merchant owed %s, want ₦1,492.50", owed)
	}
	if receipt.RemainingDaily.Minor() != 3_850_000 {
		t.Errorf("remaining daily = %s, want ₦38,500.00", receipt.RemainingDaily)
	}
}

// A challenge is single-use. Presenting the same nonce twice -- which is what
// a captured response looks like -- must fail on the second attempt whatever
// else is true.
func TestAChallengeCannotBeUsedTwice(t *testing.T) {
	f := newFixture(t, money.Naira(10_000))
	amount := money.Naira(1_000)
	ch := f.challenge(t, amount)

	req := Request{
		CardUIDHash: f.UIDHash, PresentedToken: f.Token, Nonce: ch.Nonce,
		MerchantID: f.Merchant, Amount: amount,
	}
	if _, err := f.Svc.Debit(context.Background(), req); err != nil {
		t.Fatalf("first debit: %v", err)
	}
	if _, err := f.Svc.Debit(context.Background(), req); !errors.Is(err, ErrNonceInvalid) {
		t.Fatalf("replay returned %v, want ErrNonceInvalid", err)
	}

	if got := f.balance(t); got.Minor() != 900_000 {
		t.Errorf("cardholder = %s, want ₦9,000.00 -- charged twice", got)
	}
}

// The tier is fixed when the challenge is issued. Without that, a merchant
// could ask what ₦500 needs, be told nothing, and then charge ₦50,000 against
// the same unauthenticated challenge.
func TestAMerchantCannotChargeMoreThanItAskedFor(t *testing.T) {
	f := newFixture(t, money.Naira(100_000))
	ch := f.challenge(t, money.Naira(500))
	if ch.Tier != auth.TierNone {
		t.Fatalf("setup: ₦500 gave tier %q", ch.Tier)
	}

	_, err := f.Svc.Debit(context.Background(), Request{
		CardUIDHash: f.UIDHash, PresentedToken: f.Token, Nonce: ch.Nonce,
		MerchantID: f.Merchant, Amount: money.Naira(50_000),
	})
	if !errors.Is(err, ErrAmountChanged) {
		t.Fatalf("charging ₦50,000 against a ₦500 challenge returned %v, want ErrAmountChanged", err)
	}
	if got := f.balance(t); got.Minor() != 10_000_000 {
		t.Errorf("cardholder = %s, want ₦100,000.00 untouched", got)
	}
}

// A challenge issued to one merchant cannot be spent at another, so a response
// captured at a compromised terminal cannot be carried elsewhere.
func TestAChallengeIsBoundToItsMerchant(t *testing.T) {
	f := newFixture(t, money.Naira(10_000))
	other := newFixture(t, money.Naira(0))
	amount := money.Naira(1_000)
	ch := f.challenge(t, amount)

	_, err := f.Svc.Debit(context.Background(), Request{
		CardUIDHash: f.UIDHash, PresentedToken: f.Token, Nonce: ch.Nonce,
		MerchantID: other.Merchant, Amount: amount,
	})
	if !errors.Is(err, ErrNonceInvalid) {
		t.Fatalf("a challenge was spent at a different merchant: %v", err)
	}
}

func TestAPINIsRequiredAboveTheThreshold(t *testing.T) {
	f := newFixture(t, money.Naira(50_000))
	amount := money.Naira(5_000)
	ch := f.challenge(t, amount)
	if ch.Tier != auth.TierPIN {
		t.Fatalf("₦5,000 gave tier %q, want pin", ch.Tier)
	}

	// No PIN offered.
	_, err := f.Svc.Debit(context.Background(), Request{
		CardUIDHash: f.UIDHash, PresentedToken: f.Token, Nonce: ch.Nonce,
		MerchantID: f.Merchant, Amount: amount,
	})
	if !errors.Is(err, auth.ErrWrongPIN) {
		t.Fatalf("a PIN-tier tap with no PIN returned %v", err)
	}

	// With the right one.
	receipt, err := f.pay(t, amount)
	if err != nil {
		t.Fatalf("Debit with the correct PIN: %v", err)
	}
	if receipt.Tier != auth.TierPIN {
		t.Errorf("recorded tier %q, want pin", receipt.Tier)
	}
}

// Five wrong PINs lock the card, and the lock expires. The predecessor set
// locked_until and never compared it, so a card locked this way stayed locked
// forever and its holder had to contact support.
func TestWrongPINsLockTheCardAndTheLockExpires(t *testing.T) {
	f := newFixture(t, money.Naira(50_000))
	amount := money.Naira(5_000)
	wrongAnchor := auth.Anchor([]byte("32-bytes-of-secret-living-on-crd"), "0000")

	for attempt := 1; attempt <= PINAttempts; attempt++ {
		ch := f.challenge(t, amount)
		_, err := f.Svc.Debit(context.Background(), Request{
			CardUIDHash: f.UIDHash, PresentedToken: f.Token, Nonce: ch.Nonce,
			MerchantID: f.Merchant, Amount: amount,
			PINResponse: auth.Respond(wrongAnchor, ch.Nonce),
		})
		if !errors.Is(err, auth.ErrWrongPIN) {
			t.Fatalf("attempt %d returned %v, want ErrWrongPIN", attempt, err)
		}
	}

	status, attempts, _, lockedUntil := f.cardStatus(t)
	if status != StatusLocked {
		t.Errorf("card status = %q after %d wrong PINs, want locked", status, PINAttempts)
	}
	if attempts != 0 {
		t.Errorf("attempts remaining = %d, want 0", attempts)
	}
	if lockedUntil == nil {
		t.Fatal("card was locked with no expiry -- it can never recover")
	}

	// While locked, nothing works.
	if _, err := f.Svc.Challenge(context.Background(), ChallengeRequest{
		CardUIDHash: f.UIDHash, MerchantID: f.Merchant, Amount: money.Naira(100),
	}); !errors.Is(err, ErrCardUnavailable) {
		t.Fatalf("a locked card issued a challenge: %v", err)
	}

	// Once the window passes, it works again without anyone intervening.
	f.Svc.Now = func() time.Time { return lockedUntil.Add(time.Minute) }
	if _, err := f.Svc.Challenge(context.Background(), ChallengeRequest{
		CardUIDHash: f.UIDHash, MerchantID: f.Merchant, Amount: money.Naira(100),
	}); err != nil {
		t.Fatalf("the lock did not expire: %v", err)
	}
}

// A correct PIN restores the allowance, so four mistakes spread over a year do
// not lock a card on the fifth.
func TestACorrectPINRestoresTheAllowance(t *testing.T) {
	f := newFixture(t, money.Naira(50_000))
	amount := money.Naira(5_000)
	wrongAnchor := auth.Anchor([]byte("32-bytes-of-secret-living-on-crd"), "0000")

	ch := f.challenge(t, amount)
	_, _ = f.Svc.Debit(context.Background(), Request{
		CardUIDHash: f.UIDHash, PresentedToken: f.Token, Nonce: ch.Nonce,
		MerchantID: f.Merchant, Amount: amount,
		PINResponse: auth.Respond(wrongAnchor, ch.Nonce),
	})
	if _, attempts, _, _ := f.cardStatus(t); attempts != PINAttempts-1 {
		t.Fatalf("attempts = %d after one failure, want %d", attempts, PINAttempts-1)
	}

	if _, err := f.pay(t, amount); err != nil {
		t.Fatalf("correct PIN: %v", err)
	}
	if _, attempts, _, _ := f.cardStatus(t); attempts != PINAttempts {
		t.Errorf("attempts = %d after a correct PIN, want the full %d back", attempts, PINAttempts)
	}
}

func TestALargeAmountNeedsCardholderApproval(t *testing.T) {
	f := newFixture(t, money.Naira(100_000))
	amount := money.Naira(20_000)
	ch := f.challenge(t, amount)
	if ch.Tier != auth.TierStepUp {
		t.Fatalf("₦20,000 gave tier %q, want step_up", ch.Tier)
	}
	if ch.StepUpRef == "" {
		t.Fatal("a step-up challenge carried no reference for the cardholder to approve")
	}

	req := Request{
		CardUIDHash: f.UIDHash, PresentedToken: f.Token, Nonce: ch.Nonce,
		MerchantID: f.Merchant, Amount: amount, StepUpRef: ch.StepUpRef,
	}
	if _, err := f.Svc.Debit(context.Background(), req); !errors.Is(err, ErrStepUpRequired) {
		t.Fatalf("an unapproved step-up returned %v, want ErrStepUpRequired", err)
	}

	// A step-up awaiting approval rolls back, so the challenge is still
	// usable once the cardholder approves it -- the merchant does not have to
	// start over every time it polls.
	if _, err := f.Pool.Exec(context.Background(),
		`UPDATE card_server_nonces SET step_up_granted_at = now() WHERE id = $1`,
		ch.ID); err != nil {
		t.Fatalf("grant approval: %v", err)
	}
	if _, err := f.Svc.Debit(context.Background(), req); err != nil {
		t.Fatalf("an approved step-up was refused: %v", err)
	}
}
