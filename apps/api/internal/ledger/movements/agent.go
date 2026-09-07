package movements

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/money"
)

// AllocateFloat moves platform capital into an agent's float, so they can hand
// out cash.
//
// It MOVES rather than mints, and that is the whole point. The treasury backs
// every claim in the books; float going up by exactly what the treasury goes
// down by keeps the total backed. Crediting an agent from `external` instead
// would draw on the outside world twice and leave two claims against the same
// money -- which looks identical in the agent's balance and is a hole in the
// platform's.
func AllocateFloat(
	ctx context.Context,
	tx pgx.Tx,
	agent uuid.UUID,
	amount money.Amount,
	reference string,
) (uuid.UUID, error) {
	if !amount.IsPositive() {
		return uuid.Nil, fmt.Errorf("movements: an allocation must be positive, got %s", amount)
	}
	if reference == "" {
		return uuid.Nil, fmt.Errorf("movements: an allocation needs a reference to be idempotent")
	}

	c := amount.Currency()
	r := newResolver(ctx, tx)

	// Treasury first, then its lock, then everything else. See Tap.
	treasury := r.account(ledger.System(), ledger.KindTreasury, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}
	if err := ensureFunds(ctx, tx, treasury, amount); err != nil {
		return uuid.Nil, err
	}

	float := r.account(ledger.Agent(agent), ledger.KindAgentFloat, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}

	return ledger.Post(ctx, tx, ledger.Ref{
		Type:    "agent_allocation",
		ID:      &agent,
		IdemKey: "agent_allocation:" + reference,
	}, []ledger.Entry{
		{AccountID: treasury, Amount: amount.Neg(), Reason: "agent.allocated_out"},
		{AccountID: float, Amount: amount, Reason: "agent.allocated"},
	})
}

// ReturnFloat sends unused capital back to the treasury.
func ReturnFloat(
	ctx context.Context,
	tx pgx.Tx,
	agent uuid.UUID,
	amount money.Amount,
	reference string,
) (uuid.UUID, error) {
	if !amount.IsPositive() {
		return uuid.Nil, fmt.Errorf("movements: a return must be positive, got %s", amount)
	}
	if reference == "" {
		return uuid.Nil, fmt.Errorf("movements: a return needs a reference to be idempotent")
	}

	c := amount.Currency()
	r := newResolver(ctx, tx)

	float := r.account(ledger.Agent(agent), ledger.KindAgentFloat, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}
	if err := ensureFunds(ctx, tx, float, amount); err != nil {
		return uuid.Nil, err
	}

	treasury := r.account(ledger.System(), ledger.KindTreasury, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}

	return ledger.Post(ctx, tx, ledger.Ref{
		Type:    "agent_return",
		ID:      &agent,
		IdemKey: "agent_return:" + reference,
	}, []ledger.Entry{
		{AccountID: float, Amount: amount.Neg(), Reason: "agent.returned"},
		{AccountID: treasury, Amount: amount, Reason: "agent.returned_in"},
	})
}

// FundTreasury brings platform capital in from outside.
func FundTreasury(
	ctx context.Context,
	q ledger.Querier,
	amount money.Amount,
	reference string,
) (uuid.UUID, error) {
	if !amount.IsPositive() {
		return uuid.Nil, fmt.Errorf("movements: funding must be positive, got %s", amount)
	}
	if reference == "" {
		return uuid.Nil, fmt.Errorf("movements: funding needs a reference to be idempotent")
	}

	c := amount.Currency()
	r := newResolver(ctx, q)
	treasury := r.account(ledger.System(), ledger.KindTreasury, c)
	external := r.account(ledger.System(), ledger.KindExternal, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}

	return ledger.Post(ctx, q, ledger.Ref{
		Type:    "treasury_funding",
		IdemKey: "treasury_funding:" + reference,
	}, []ledger.Entry{
		{AccountID: treasury, Amount: amount, Reason: "treasury.funded"},
		{AccountID: external, Amount: amount.Neg(), Reason: "treasury.capital_in"},
	})
}
