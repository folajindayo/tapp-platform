package movements

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/money"
)

// LockAgentFloat reserves an agent's capital against a proposed handover.
//
// Locked when the meeting is offered, not when it settles. That is what makes
// the offer real: an agent told somebody is walking over with fifty thousand
// naira has committed to having fifty thousand naira, and a trader who makes
// that walk should not arrive to find it spent on somebody else.
//
// The float moves into escrow rather than out of the system. Nothing has
// happened yet -- the notes are still in the trader's hand -- and the money
// must be returnable in full if nobody comes.
func LockAgentFloat(
	ctx context.Context,
	tx pgx.Tx,
	agent uuid.UUID,
	amount money.Amount,
	handoverID string,
) (uuid.UUID, error) {
	if !amount.IsPositive() {
		return uuid.Nil, fmt.Errorf("movements: a lock must be positive, got %s", amount)
	}

	c := amount.Currency()
	r := newResolver(ctx, tx)

	// Float first, then its lock, then everything else. See Tap.
	float := r.account(ledger.Agent(agent), ledger.KindAgentFloat, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}
	if err := ensureFunds(ctx, tx, float, amount); err != nil {
		return uuid.Nil, err
	}

	escrow := r.account(ledger.Agent(agent), ledger.KindEscrow, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}

	return ledger.Post(ctx, tx, ledger.Ref{
		Type:    "handover_lock",
		IdemKey: "handover_lock:" + handoverID,
	}, []ledger.Entry{
		{AccountID: float, Amount: amount.Neg(), Reason: "handover.locked"},
		{AccountID: escrow, Amount: amount, Reason: "handover.escrowed"},
	})
}

// ReleaseAgentFloat returns locked capital when a handover does not happen.
//
// This is what makes an abandoned meeting cost nobody anything. The trader
// still has their notes; the agent gets their float back; the platform is
// exactly where it started.
func ReleaseAgentFloat(
	ctx context.Context,
	tx pgx.Tx,
	agent uuid.UUID,
	amount money.Amount,
	handoverID, reason string,
) (uuid.UUID, error) {
	if reason == "" {
		return uuid.Nil, fmt.Errorf("movements: a release must say why")
	}

	c := amount.Currency()
	r := newResolver(ctx, tx)

	escrow := r.account(ledger.Agent(agent), ledger.KindEscrow, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}
	if err := ensureFunds(ctx, tx, escrow, amount); err != nil {
		return uuid.Nil, err
	}

	float := r.account(ledger.Agent(agent), ledger.KindAgentFloat, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}

	return ledger.Post(ctx, tx, ledger.Ref{
		Type:    "handover_release",
		IdemKey: "handover_release:" + handoverID,
	}, []ledger.Entry{
		{AccountID: escrow, Amount: amount.Neg(), Reason: "handover.released:" + reason},
		{AccountID: float, Amount: amount, Reason: "handover.float_restored"},
	})
}

// SettleHandover completes a cash pledge: the agent has physically taken the
// notes, so their escrowed capital becomes the trader's balance.
//
// This is the moment value moves, and it is driven by two people confirming
// they met -- not by a photograph, and not by anything either of them could do
// alone. The agent now holds the cash; the platform's capital sits with the
// trader instead.
func SettleHandover(
	ctx context.Context,
	tx pgx.Tx,
	agent, trader uuid.UUID,
	amount money.Amount,
	handoverID string,
) (uuid.UUID, error) {
	if !amount.IsPositive() {
		return uuid.Nil, fmt.Errorf("movements: a settlement must be positive, got %s", amount)
	}

	c := amount.Currency()
	r := newResolver(ctx, tx)

	escrow := r.account(ledger.Agent(agent), ledger.KindEscrow, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}
	if err := ensureFunds(ctx, tx, escrow, amount); err != nil {
		return uuid.Nil, err
	}

	available := r.account(ledger.User(trader), ledger.KindAvailable, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}

	// No fee. The trader handed over the full face value of their notes and
	// cannot make change; taking a cut here would mean giving them back less
	// than they gave, which is not what anybody agreed to. The platform earns
	// on what the balance is later used for.
	return ledger.Post(ctx, tx, ledger.Ref{
		Type:    "handover_settle",
		IdemKey: "handover_settle:" + handoverID,
	}, []ledger.Entry{
		{AccountID: escrow, Amount: amount.Neg(), Reason: "handover.settled"},
		{AccountID: available, Amount: amount, Reason: "handover.credited_trader"},
	})
}
