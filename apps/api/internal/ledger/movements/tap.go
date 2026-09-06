package movements

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/money"
)

// Tap is a card payment at a merchant: the whole of what a tap does to the
// books, and the only thing that decides one happened.
//
// The cardholder's spendable balance falls, the merchant is owed, and the
// platform takes its fee. Note where the money does NOT go: not to the
// merchant's bank, and not onto a chain. Those are settlement, they happen on
// their own clock, and they read this ledger rather than deciding it.
//
// That separation is the point. The predecessor submitted a chain transaction
// inside the HTTP request, so a customer stood at a counter waiting on a
// block, and a chain failure happened after the nonce had been burned and the
// order row created. Worse, when the chain call could not be made at all it
// fabricated a transaction hash and returned "settled" -- a receipt for a
// payment that never moved.
//
// It takes a pgx.Tx rather than a Querier so that the requirement is enforced
// by the compiler instead of by a comment: the cardholder's balance check, the
// nonce consumption and these entries have to commit or roll back together.
// Use InTx.
func Tap(
	ctx context.Context,
	tx pgx.Tx,
	cardholder, merchant uuid.UUID,
	amount money.Amount,
	fee money.Amount,
	tapID uuid.UUID,
) (uuid.UUID, error) {
	if !amount.IsPositive() {
		return uuid.Nil, fmt.Errorf("movements: a tap must be for a positive amount, got %s", amount)
	}
	if !amount.SameCurrency(fee) {
		return uuid.Nil, fmt.Errorf("movements: fee %s is not in the tap currency %s", fee, amount.Currency())
	}
	if fee.IsNegative() {
		return uuid.Nil, fmt.Errorf("movements: a negative fee (%s) would pay the merchant more than the cardholder spent", fee)
	}
	net, err := amount.Sub(fee)
	if err != nil {
		return uuid.Nil, err
	}
	if !net.IsPositive() {
		return uuid.Nil, fmt.Errorf("movements: a fee of %s leaves the merchant %s", fee, net)
	}

	c := amount.Currency()
	r := newResolver(ctx, tx)

	// The spending account is resolved and locked FIRST, before any other
	// account is touched. Every movement takes exactly one lock and takes it
	// first, so two movements can never hold one lock each and wait on the
	// other's -- there is no ordering to get wrong because there is only ever
	// one. Resolving the merchant and revenue accounts afterwards is a read on
	// the common path and takes no lock at all.
	from := r.account(ledger.User(cardholder), ledger.KindAvailable, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}
	if err := ensureFunds(ctx, tx, from, amount); err != nil {
		return uuid.Nil, err
	}

	owed := r.account(ledger.Merchant(merchant), ledger.KindMerchantPayable, c)
	revenue := r.account(ledger.System(), ledger.KindRevenue, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}

	entries := []ledger.Entry{
		{AccountID: from, Amount: amount.Neg(), Reason: "tap.debit"},
		{AccountID: owed, Amount: net, Reason: "tap.merchant_owed"},
	}
	if fee.IsPositive() {
		entries = append(entries, ledger.Entry{AccountID: revenue, Amount: fee, Reason: "tap.fee"})
	}

	// The tap id is the idempotency key. A merchant app that retries a debit
	// after a timeout -- which is exactly what it does, because it cannot tell
	// a lost response from a declined one -- charges the cardholder once.
	return ledger.Post(ctx, tx, ledger.Ref{
		Type:    "tap",
		ID:      &tapID,
		IdemKey: "tap:" + tapID.String(),
	}, entries)
}

// TapReversal returns a tap in full: the cardholder is made whole and the
// merchant's claim is withdrawn, including the fee.
//
// This is a new transaction rather than a deletion. The original tap happened
// and stays in the record; what changes is that a second, opposite movement
// follows it. A ledger that can erase entries cannot be audited.
func TapReversal(
	ctx context.Context,
	q ledger.Querier,
	cardholder, merchant uuid.UUID,
	amount money.Amount,
	fee money.Amount,
	tapID uuid.UUID,
	reason string,
) (uuid.UUID, error) {
	if reason == "" {
		return uuid.Nil, fmt.Errorf("movements: a reversal must say why")
	}
	net, err := amount.Sub(fee)
	if err != nil {
		return uuid.Nil, err
	}

	c := amount.Currency()
	r := newResolver(ctx, q)
	to := r.account(ledger.User(cardholder), ledger.KindAvailable, c)
	owed := r.account(ledger.Merchant(merchant), ledger.KindMerchantPayable, c)
	revenue := r.account(ledger.System(), ledger.KindRevenue, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}

	entries := []ledger.Entry{
		{AccountID: owed, Amount: net.Neg(), Reason: "tap.reversal.merchant_claim_withdrawn"},
		{AccountID: to, Amount: amount, Reason: "tap.reversal.refund:" + reason},
	}
	if fee.IsPositive() {
		// The fee goes back too. Keeping it on a payment that did not stand
		// would mean charging for a service not rendered.
		entries = append(entries, ledger.Entry{
			AccountID: revenue, Amount: fee.Neg(), Reason: "tap.reversal.fee_returned"})
	}

	return ledger.Post(ctx, q, ledger.Ref{
		Type:    "tap_reversal",
		ID:      &tapID,
		IdemKey: "tap_reversal:" + tapID.String(),
	}, entries)
}
