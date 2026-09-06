package movements

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/money"
)

// Settled records value actually reaching its destination in the outside
// world: a bank confirming a credit, or a chain transaction reaching finality.
//
// This is the only movement that discharges `payable`, and it must be driven
// by the provider CONFIRMING the credit -- never by our own request having
// been accepted. A request that was accepted and then failed leaves money
// owed; a request that timed out may or may not have moved money. Neither is
// a settlement, and treating them as one is how a ledger comes to claim it has
// paid somebody it has not.
func Settled(
	ctx context.Context,
	q ledger.Querier,
	amount money.Amount,
	providerRef string,
) (uuid.UUID, error) {
	if !amount.IsPositive() {
		return uuid.Nil, fmt.Errorf("movements: a settlement must be positive, got %s", amount)
	}
	if providerRef == "" {
		return uuid.Nil, fmt.Errorf("movements: a settlement needs the provider's reference")
	}

	c := amount.Currency()
	r := newResolver(ctx, q)
	payable := r.account(ledger.System(), ledger.KindPayable, c)
	external := r.account(ledger.System(), ledger.KindExternal, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}

	return ledger.Post(ctx, q, ledger.Ref{
		Type:    "settlement",
		IdemKey: "settlement:" + providerRef,
	}, []ledger.Entry{
		{AccountID: payable, Amount: amount.Neg(), Reason: "settlement.delivered"},
		{AccountID: external, Amount: amount, Reason: "settlement.left_the_system"},
	})
}

// Returned handles value the destination would not accept -- a wrong account
// number, a closed account, a rejected transfer.
//
// It goes back to the party who is now holding nothing, so they can correct
// the details and send it again or withdraw it. It does not vanish, and it does
// not stay in payable pretending to still be on its way. Anything else quietly
// keeps money the platform did not earn.
func Returned(
	ctx context.Context,
	q ledger.Querier,
	user uuid.UUID,
	amount money.Amount,
	withdrawalID uuid.UUID,
	reason string,
) (uuid.UUID, error) {
	if reason == "" {
		return uuid.Nil, fmt.Errorf("movements: a return must say why the destination refused it")
	}

	c := amount.Currency()
	r := newResolver(ctx, q)
	payable := r.account(ledger.System(), ledger.KindPayable, c)
	to := r.account(ledger.User(user), ledger.KindAvailable, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}

	return ledger.Post(ctx, q, ledger.Ref{
		Type:    "withdrawal_returned",
		ID:      &withdrawalID,
		IdemKey: "withdrawal_returned:" + withdrawalID.String(),
	}, []ledger.Entry{
		{AccountID: payable, Amount: amount.Neg(), Reason: "settlement.returned:" + reason},
		{AccountID: to, Amount: amount, Reason: "settlement.refunded_sender"},
	})
}

// MerchantSettled moves a merchant's earnings from what they are owed into the
// queue of things leaving the system, when a payout to their bank is raised.
func MerchantSettled(
	ctx context.Context,
	q ledger.Querier,
	merchant uuid.UUID,
	amount money.Amount,
	payoutID uuid.UUID,
) (uuid.UUID, error) {
	if !amount.IsPositive() {
		return uuid.Nil, fmt.Errorf("movements: a merchant payout must be positive, got %s", amount)
	}

	c := amount.Currency()
	r := newResolver(ctx, q)
	owed := r.account(ledger.Merchant(merchant), ledger.KindMerchantPayable, c)
	payable := r.account(ledger.System(), ledger.KindPayable, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}

	return ledger.Post(ctx, q, ledger.Ref{
		Type:    "merchant_payout",
		ID:      &payoutID,
		IdemKey: "merchant_payout:" + payoutID.String(),
	}, []ledger.Entry{
		{AccountID: owed, Amount: amount.Neg(), Reason: "merchant_payout.claim_settled"},
		{AccountID: payable, Amount: amount, Reason: "merchant_payout.owed_to_bank"},
	})
}
