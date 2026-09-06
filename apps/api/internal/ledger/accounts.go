package ledger

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/usezoracle/tapp/api/internal/money"
)

// Account kinds. These mirror the account_kind enum; the SQL is the source of
// truth and these constants exist so a typo is a compile error rather than a
// runtime one.
const (
	// Party accounts.
	KindAvailable  = "available"  // spendable
	KindEscrow     = "escrow"     // locked pending a physical handover
	KindObligation = "obligation" // negative: the party owes the platform

	KindAgentFloat      = "agent_float"      // capital an agent hands out as cash
	KindMerchantPayable = "merchant_payable" // earned, not yet in their bank

	// System accounts.
	KindTreasury    = "treasury"     // platform capital available to settle with
	KindFXPosition  = "fx_position"  // exposure between two currencies
	KindRevenue     = "revenue"      // fees earned
	KindLossReserve = "loss_reserve" // losses absorbed
	KindPayable     = "payable"      // owed outside, not yet delivered
	KindExternal    = "external"     // the world outside this system
)

// Owner kinds.
const (
	OwnerUser     = "user"
	OwnerAgent    = "agent"
	OwnerMerchant = "merchant"
	OwnerSystem   = "system"
)

// Owner identifies whose account this is. A system account has no id.
type Owner struct {
	Kind string
	ID   *uuid.UUID
}

// User, Agent and Merchant name a party; System names the platform itself.
func User(id uuid.UUID) Owner     { return Owner{Kind: OwnerUser, ID: &id} }
func Agent(id uuid.UUID) Owner    { return Owner{Kind: OwnerAgent, ID: &id} }
func Merchant(id uuid.UUID) Owner { return Owner{Kind: OwnerMerchant, ID: &id} }
func System() Owner               { return Owner{Kind: OwnerSystem} }

// AccountFor resolves an account, creating it on first use.
//
// Accounts are created lazily and never deleted. A party who has never
// transacted has no rows, and one who has cannot lose them -- an account with
// entries is a permanent record even after the party is gone, which is why
// owner_id is not a foreign key that could cascade.
func AccountFor(ctx context.Context, q Querier, owner Owner, kind string, c money.Currency) (uuid.UUID, error) {
	if err := c.Valid(); err != nil {
		return uuid.Nil, err
	}

	// Read before writing, and this is not a micro-optimisation.
	//
	// The obvious implementation is a single INSERT ... ON CONFLICT DO UPDATE,
	// which always returns the row. But DO UPDATE is a write, so it takes an
	// exclusive row lock held to the end of the transaction -- on EVERY
	// account the movement touches, including the shared system accounts. That
	// means every tap on the platform would queue behind every other tap on
	// the single `revenue` row, serialising the entire system through it.
	//
	// It also creates locks in whatever order each movement happens to resolve
	// its accounts, which is how concurrent movements deadlock against each
	// other. Locking is the job of movements.ensureFunds, which takes exactly
	// one lock on the account actually being spent.
	var id uuid.UUID
	err := q.QueryRow(ctx, `
		SELECT id FROM ledger_accounts
		 WHERE owner_id IS NOT DISTINCT FROM $1
		   AND kind = $2::account_kind
		   AND currency = $3::currency`,
		owner.ID, kind, string(c)).Scan(&id)
	if err == nil {
		return id, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, fmt.Errorf("ledger: resolve %s/%s %s account: %w", owner.Kind, kind, c, err)
	}

	// First use of this account. ON CONFLICT covers the race where another
	// transaction created it between the read and this insert.
	err = q.QueryRow(ctx, `
		INSERT INTO ledger_accounts (owner_id, owner_kind, kind, currency)
		VALUES ($1, $2::owner_kind, $3::account_kind, $4::currency)
		ON CONFLICT (owner_id, kind, currency) DO UPDATE SET kind = EXCLUDED.kind
		RETURNING id`,
		owner.ID, owner.Kind, kind, string(c)).Scan(&id)
	if err != nil {
		return uuid.Nil, fmt.Errorf("ledger: create %s/%s %s account: %w", owner.Kind, kind, c, err)
	}
	return id, nil
}

// Balance returns what one account currently holds.
//
// Read from the entries through the ledger_balances view, never from a stored
// total. A cached balance is a second source of truth and will eventually
// disagree with the entries that produced it; this one cannot.
func Balance(ctx context.Context, q Querier, owner Owner, kind string, c money.Currency) (money.Amount, error) {
	var minor int64
	err := q.QueryRow(ctx, `
		SELECT COALESCE(SUM(e.amount_minor), 0)
		  FROM ledger_accounts a
		  LEFT JOIN ledger_entries e ON e.account_id = a.id
		 WHERE a.owner_id IS NOT DISTINCT FROM $1
		   AND a.kind = $2::account_kind
		   AND a.currency = $3::currency`,
		owner.ID, kind, string(c)).Scan(&minor)
	if err != nil {
		return money.Zero(c), fmt.Errorf("ledger: balance of %s/%s %s: %w", owner.Kind, kind, c, err)
	}
	return money.New(minor, c), nil
}

// BalanceOf returns the balance of an account by id, for callers that already
// resolved it and are inside a transaction that must not re-resolve.
func BalanceOf(ctx context.Context, q Querier, accountID uuid.UUID, c money.Currency) (money.Amount, error) {
	var minor int64
	err := q.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0) FROM ledger_entries WHERE account_id = $1`,
		accountID).Scan(&minor)
	if err != nil {
		return money.Zero(c), fmt.Errorf("ledger: balance of account %s: %w", accountID, err)
	}
	return money.New(minor, c), nil
}
