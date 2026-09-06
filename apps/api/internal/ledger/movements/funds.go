package movements

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/money"
)

// ErrInsufficientFunds means the account cannot cover the movement.
//
// It is a normal outcome, not a fault: a declined card is the system working.
// Callers should map it to a refusal the person can act on, never to a 500.
var ErrInsufficientFunds = errors.New("movements: insufficient funds")

// InTx runs fn inside a database transaction and commits it if fn succeeds.
//
// Every movement that spends money must go through here. The check that an
// account can cover a debit and the entries that perform it have to commit or
// roll back together; a check that commits separately from the movement it
// authorised is not a check, it is a suggestion.
func InTx(ctx context.Context, pool *pgxpool.Pool, fn func(pgx.Tx) error) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ensureFunds locks an account and verifies it can cover amount.
//
// The lock is the entire point. Reading a balance and then debiting it are two
// statements, and between them another request can read the same balance and
// reach the same happy conclusion -- so both succeed and the account goes
// negative. That is the classic double-spend, and it is not hypothetical here:
// the card debit this replaces held no transaction at all, so two taps of one
// card raced each other through the daily-limit check by design.
//
// Locking the ledger_accounts row rather than the card row matters. A user may
// hold more than one card, and a lock on the card serialises taps of that card
// while leaving two cards free to overdraw the same balance. The account is
// what is actually being spent, so the account is what is locked -- and every
// other spending path (a withdrawal, a conversion, a cash pledge) is
// serialised against a tap for free.
//
// THE INVARIANT, and it is load-bearing:
//
//	every spending movement takes exactly ONE lock, and takes it FIRST,
//	on the account it is spending from.
//
// One lock per transaction means two movements can never hold one lock each
// while waiting for the other's, so deadlock is impossible by construction
// rather than by careful ordering. Taking it first means no other account has
// been touched yet. Both halves matter: an earlier revision resolved all its
// accounts before locking, and because ledger.AccountFor wrote on every call
// it took exclusive locks in whatever order each movement happened to list
// them -- which deadlocked under concurrency the moment that incidental
// write-locking was removed.
//
// A movement that ever needs to debit two accounts must not simply add a
// second call here. It needs a deliberate, documented lock order, and a test
// that runs it against its own inverse.
func ensureFunds(ctx context.Context, tx pgx.Tx, accountID uuid.UUID, amount money.Amount) error {
	if !amount.IsPositive() {
		return fmt.Errorf("movements: nothing to fund, amount is %s", amount)
	}

	// Take the row lock first. Anything else on this account now waits here.
	var locked uuid.UUID
	if err := tx.QueryRow(ctx,
		`SELECT id FROM ledger_accounts WHERE id = $1 FOR UPDATE`, accountID).Scan(&locked); err != nil {
		return fmt.Errorf("movements: lock account %s: %w", accountID, err)
	}

	var minor int64
	if err := tx.QueryRow(ctx,
		`SELECT COALESCE(SUM(amount_minor), 0) FROM ledger_entries WHERE account_id = $1`,
		accountID).Scan(&minor); err != nil {
		return fmt.Errorf("movements: read balance of %s: %w", accountID, err)
	}

	available := money.New(minor, amount.Currency())
	cmp, err := available.Cmp(amount)
	if err != nil {
		return err
	}
	if cmp < 0 {
		// The message names both figures because the caller has to tell
		// somebody why their card was declined, and "insufficient funds" with
		// no numbers is the least useful decline message there is.
		return fmt.Errorf("%w: %s available, %s needed", ErrInsufficientFunds, available, amount)
	}
	return nil
}

// Spendable reports what an account can currently spend, without locking. For
// display only: a balance read outside a transaction is stale the instant it
// is returned, and must never be the basis of a decision to move money.
func Spendable(ctx context.Context, q ledger.Querier, user uuid.UUID, c money.Currency) (money.Amount, error) {
	return ledger.Balance(ctx, q, ledger.User(user), ledger.KindAvailable, c)
}
