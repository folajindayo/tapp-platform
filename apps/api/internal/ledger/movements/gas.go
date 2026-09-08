package movements

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/money"
)

// GasSpent books what an on-chain transaction cost the platform.
//
// Gas is a real operating cost paid in ETH to people outside this system, so
// it is a movement like any other rather than a number recorded beside the
// books:
//
//	revenue  -cost   gas.spent
//	external +cost   gas.paid_to_network
//
// Revenue falls by what the chain charged, and `external` -- the mirror of
// everything held inside -- rises by the same, because the value genuinely
// left. The two sum to zero, so an error here cannot commit.
//
// This is the difference between an accounting ledger and a profit column. The
// margin on sponsored work is not a field somebody computed; it is the
// distance between two account balances the database keeps consistent, and
// `ledger.Audit` already reports whether that holds across the whole system.
//
// reference identifies the transaction on chain. It is the idempotency key,
// because a receipt can be read more than once -- a worker restart, a
// reconciliation pass -- and paying for the same gas twice in the books is a
// loss the platform never actually took.
func GasSpent(
	ctx context.Context,
	q ledger.Querier,
	cost money.Amount,
	chainID int64,
	txHash string,
) (uuid.UUID, error) {
	if !cost.IsPositive() {
		return uuid.Nil, fmt.Errorf("movements: gas cost must be positive, got %s", cost)
	}
	if txHash == "" {
		return uuid.Nil, fmt.Errorf("movements: gas needs a transaction hash to be idempotent")
	}

	c := cost.Currency()
	r := newResolver(ctx, q)
	revenue := r.account(ledger.System(), ledger.KindRevenue, c)
	external := r.account(ledger.System(), ledger.KindExternal, c)
	if r.err != nil {
		return uuid.Nil, r.err
	}

	return ledger.Post(ctx, q, ledger.Ref{
		Type:    "gas",
		IdemKey: fmt.Sprintf("gas:%d:%s", chainID, txHash),
	}, []ledger.Entry{
		{AccountID: revenue, Amount: cost.Neg(), Reason: "gas.spent"},
		{AccountID: external, Amount: cost, Reason: "gas.paid_to_network"},
	})
}
