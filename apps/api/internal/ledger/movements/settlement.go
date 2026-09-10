package movements

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

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
	tx pgx.Tx,
	merchant uuid.UUID,
	amount money.Amount,
	payoutID uuid.UUID,
) (uuid.UUID, error) {
	if !amount.IsPositive() {
		return uuid.Nil, fmt.Errorf("movements: a merchant payout must be positive, got %s", amount)
	}

	c := amount.Currency()
	r := newResolver(ctx, tx)

	// A merchant cannot be paid out more than they are owed. Spending account
	// first, then its lock, then everything else. See Tap.
	owed := r.account(ledger.Merchant(merchant), ledger.KindMerchantPayable, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}
	if err := ensureFunds(ctx, tx, owed, amount); err != nil {
		return uuid.Nil, err
	}

	payable := r.account(ledger.System(), ledger.KindPayable, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}

	return ledger.Post(ctx, tx, ledger.Ref{
		Type:    "merchant_payout",
		ID:      &payoutID,
		IdemKey: "merchant_payout:" + payoutID.String(),
	}, []ledger.Entry{
		{AccountID: owed, Amount: amount.Neg(), Reason: "merchant_payout.claim_settled"},
		{AccountID: payable, Amount: amount, Reason: "merchant_payout.owed_to_bank"},
	})
}

// MerchantPayoutReturned puts a failed payout back to what the merchant is
// owed.
//
// They earned it and we could not deliver it, so it returns to
// merchant_payable rather than staying in `payable` or vanishing. Leaving it
// in payable would be the platform quietly holding money it neither earned nor
// delivered, and it would go on looking like an outstanding obligation nobody
// was acting on.
// MerchantSettledOnChain discharges what a merchant is owed when the payment
// has been sold to a settlement gateway instead of paid from here.
//
// The claim does not move to `payable`, because the platform is not the one
// paying: a liquidity provider is, out of the cardholder's own tokens. Holding
// it in payable would say we owe money we have no way to send, and leaving it
// in merchant_payable would say we still owe it after somebody else has paid.
// It leaves the books entirely, which is what actually happened.
func MerchantSettledOnChain(
	ctx context.Context,
	tx pgx.Tx,
	merchant uuid.UUID,
	amount money.Amount,
	tapID uuid.UUID,
) (uuid.UUID, error) {
	if !amount.IsPositive() {
		return uuid.Nil, fmt.Errorf("movements: a settlement must be positive, got %s", amount)
	}

	c := amount.Currency()
	r := newResolver(ctx, tx)

	// A merchant cannot be discharged of more than they are owed. Spending
	// account first, then its lock, then everything else. See Tap.
	owed := r.account(ledger.Merchant(merchant), ledger.KindMerchantPayable, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}
	if err := ensureFunds(ctx, tx, owed, amount); err != nil {
		return uuid.Nil, err
	}

	external := r.account(ledger.System(), ledger.KindExternal, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}

	return ledger.Post(ctx, tx, ledger.Ref{
		Type:    "merchant_settled_onchain",
		ID:      &tapID,
		IdemKey: "merchant_settled_onchain:" + tapID.String(),
	}, []ledger.Entry{
		{AccountID: owed, Amount: amount.Neg(), Reason: "merchant.settled_onchain"},
		{AccountID: external, Amount: amount, Reason: "merchant.paid_by_provider"},
	})
}

func MerchantPayoutReturned(
	ctx context.Context,
	tx pgx.Tx,
	merchant uuid.UUID,
	amount money.Amount,
	payoutID uuid.UUID,
	reason string,
) (uuid.UUID, error) {
	if reason == "" {
		return uuid.Nil, fmt.Errorf("movements: a returned payout must say why")
	}

	c := amount.Currency()
	r := newResolver(ctx, tx)

	payable := r.account(ledger.System(), ledger.KindPayable, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}
	if err := ensureFunds(ctx, tx, payable, amount); err != nil {
		return uuid.Nil, err
	}

	owed := r.account(ledger.Merchant(merchant), ledger.KindMerchantPayable, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}

	return ledger.Post(ctx, tx, ledger.Ref{
		Type:    "merchant_payout_returned",
		ID:      &payoutID,
		IdemKey: "merchant_payout_returned:" + payoutID.String(),
	}, []ledger.Entry{
		{AccountID: payable, Amount: amount.Neg(), Reason: "merchant_payout.returned:" + reason},
		{AccountID: owed, Amount: amount, Reason: "merchant_payout.still_owed"},
	})
}
