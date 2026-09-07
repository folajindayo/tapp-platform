package auth

import (
	"fmt"

	"github.com/usezoracle/tapp/api/internal/money"
)

// Tier is how much proof a tap needs before it may proceed.
type Tier string

const (
	// TierNone: small enough that a prompt costs more than it protects. The
	// card being physically present is the whole authentication.
	TierNone Tier = "none"
	// TierPIN: the cardholder types a PIN into the merchant's device, which
	// answers a challenge without ever revealing the PIN to the server.
	TierPIN Tier = "pin"
	// TierStepUp: large enough to be worth a device the cardholder controls.
	// The merchant shows a code; the cardholder approves in their own app.
	TierStepUp Tier = "step_up"
)

func (t Tier) Valid() bool {
	switch t {
	case TierNone, TierPIN, TierStepUp:
		return true
	}
	return false
}

// Limits are the thresholds for one card, all in the card's currency.
//
// There are no defaults here. The predecessor fell back to package constants
// whenever a card's limits were zero, which meant a card that had never
// completed linking -- and therefore had no agreed limits at all -- silently
// acquired a ₦40,000 daily allowance. Limits are set at linking and a card
// without them cannot transact.
type Limits struct {
	PerTap money.Amount
	StepUp money.Amount
	Daily  money.Amount
}

// Valid reports whether these limits are coherent. An incoherent set is a
// linking bug, and enforcing the ordering here means the tap path can trust it.
func (l Limits) Valid() error {
	if !l.PerTap.IsPositive() || !l.StepUp.IsPositive() || !l.Daily.IsPositive() {
		return fmt.Errorf("auth: card limits are not set")
	}
	if !l.PerTap.SameCurrency(l.StepUp) || !l.PerTap.SameCurrency(l.Daily) {
		return fmt.Errorf("auth: card limits are in mixed currencies")
	}
	if cmp, err := l.PerTap.Cmp(l.StepUp); err != nil || cmp > 0 {
		return fmt.Errorf("auth: the PIN threshold (%s) is above the step-up threshold (%s)",
			l.PerTap, l.StepUp)
	}
	if cmp, err := l.StepUp.Cmp(l.Daily); err != nil || cmp > 0 {
		return fmt.Errorf("auth: the step-up threshold (%s) is above the daily limit (%s)",
			l.StepUp, l.Daily)
	}
	return nil
}

// TierFor decides what an amount requires.
//
// The boundaries are inclusive at the bottom: an amount exactly equal to the
// per-tap threshold requires a PIN. A limit somebody set to "₦2,000" means
// ₦2,000 is where the protection starts, not where it stops.
func (l Limits) TierFor(amount money.Amount) (Tier, error) {
	if err := l.Valid(); err != nil {
		return "", err
	}
	if !amount.SameCurrency(l.PerTap) {
		return "", fmt.Errorf("auth: %s cannot be checked against limits in %s",
			amount.Currency(), l.PerTap.Currency())
	}

	belowPerTap, err := amount.Cmp(l.PerTap)
	if err != nil {
		return "", err
	}
	if belowPerTap < 0 {
		return TierNone, nil
	}

	belowStepUp, err := amount.Cmp(l.StepUp)
	if err != nil {
		return "", err
	}
	if belowStepUp < 0 {
		return TierPIN, nil
	}
	return TierStepUp, nil
}
