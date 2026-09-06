// Package ledger is the only place in this system where money moves.
//
// Every movement is a set of signed entries sharing a transaction id, and every
// set must sum to exactly zero within each currency. The database enforces that
// with a deferred constraint trigger, so an unbalanced write cannot be
// committed even by a bug -- this package refuses to issue one so that the
// caller gets a clear error instead of a failure at commit time, but the
// trigger is the guarantee.
//
// The currency dimension is what makes an FX conversion expressible. A
// conversion is ONE transaction with two currency legs, each summing to zero
// on its own; a transaction that balanced only in total would let dollars be
// created by destroying naira.
//
// Sign convention:
//
//	user available     positive = spendable balance
//	user escrow        positive = locked, pending a physical handover
//	user obligation    NEGATIVE = the user owes the platform
//	agent_float        positive = capital an agent can hand out as cash
//	merchant_payable   positive = earned, not yet paid to their bank
//	treasury           positive = platform capital available to settle
//	revenue            positive = fees earned
//	payable            positive = owed outside, not yet delivered
package ledger

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/money"
)

// Querier is satisfied by both *pgxpool.Pool and pgx.Tx, so an operation can
// either stand alone or join a caller's transaction. Which one matters: a tap
// must post its entries inside the same transaction that consumed the nonce
// and checked the limit, or the check and the movement can disagree.
type Querier interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

// ErrDuplicate means an entry carrying an idempotency reference has already
// been posted. It is not a failure: it is the mechanism working. A retried
// webhook, a replayed payout confirmation and a reconciliation run twice all
// land here, and all of them should be treated as "already done".
var ErrDuplicate = errors.New("ledger: this movement has already been posted")

// Entry is one leg of a transaction.
type Entry struct {
	AccountID uuid.UUID
	Amount    money.Amount
	// Reason names what this leg was for, in a stable vocabulary such as
	// "tap.debit" or "fx.spread". It is read by the audit view and by humans
	// reconciling, and is never parsed for control flow.
	Reason string
}

// Ref ties a transaction to what caused it in the outside world.
type Ref struct {
	Type string
	ID   *uuid.UUID

	// IdemKey, when set, makes the whole movement happen at most once.
	// Presenting the same key again returns ErrDuplicate rather than posting a
	// second time, which is what makes a retried webhook, a replayed payout
	// confirmation, or a reconciliation run twice safe.
	//
	// It belongs to the transaction rather than to a leg: a two-leg payout
	// needs one key, not two, and "has this movement happened" should not be
	// answerable only by convention about which leg to look at.
	IdemKey string
}

// Post writes a balanced set of entries and returns the transaction id.
//
// It refuses to issue the write at all if the entries do not sum to zero per
// currency, so the caller gets an error naming the imbalance rather than a
// deferred trigger failure at commit time with no context about which leg was
// wrong.
//
// The entries of one transaction must land inside a single database
// transaction, or the deferred trigger fires after the first row and rejects
// it. Given a bare pool, Post therefore opens its own; given a pgx.Tx it joins
// the caller's.
func Post(ctx context.Context, q Querier, ref Ref, entries []Entry) (uuid.UUID, error) {
	if err := check(entries); err != nil {
		return uuid.Nil, err
	}

	if pool, isPool := q.(*pgxpool.Pool); isPool {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return uuid.Nil, err
		}
		defer tx.Rollback(ctx)

		txID, err := insert(ctx, tx, ref, entries)
		if err != nil {
			return uuid.Nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return uuid.Nil, translate(fmt.Errorf("ledger: commit: %w", err))
		}
		return txID, nil
	}

	return insert(ctx, q, ref, entries)
}

// check enforces, before touching the database, that this is a movement at all
// and that it balances in every currency it touches.
func check(entries []Entry) error {
	if len(entries) < 2 {
		return fmt.Errorf("ledger: a transaction needs at least two entries, got %d", len(entries))
	}

	sums := make(map[money.Currency]int64, 2)
	for _, e := range entries {
		c := e.Amount.Currency()
		if err := c.Valid(); err != nil {
			return fmt.Errorf("ledger: entry %q: %w", e.Reason, err)
		}
		if e.Amount.IsZero() {
			return fmt.Errorf("ledger: zero-amount entry (%s) is not a movement", e.Reason)
		}
		if e.Reason == "" {
			return errors.New("ledger: every entry needs a reason")
		}
		sums[c] += e.Amount.Minor()
	}

	for c, sum := range sums {
		if sum != 0 {
			return fmt.Errorf(
				"ledger: unbalanced transaction: %s entries sum to %d minor units, must be 0", c, sum)
		}
	}
	return nil
}

func insert(ctx context.Context, q Querier, ref Ref, entries []Entry) (uuid.UUID, error) {
	txID := uuid.New()

	if _, err := q.Exec(ctx, `
		INSERT INTO ledger_transactions (id, ref_type, ref_id, idem_key)
		VALUES ($1, $2, $3, $4)`,
		txID, nullable(ref.Type), ref.ID, nullable(ref.IdemKey)); err != nil {
		return uuid.Nil, translate(fmt.Errorf("ledger: open transaction: %w", err))
	}

	for _, e := range entries {
		_, err := q.Exec(ctx, `
			INSERT INTO ledger_entries (tx_id, account_id, currency, amount_minor, reason)
			VALUES ($1, $2, $3::currency, $4, $5)`,
			txID, e.AccountID, string(e.Amount.Currency()), e.Amount.Minor(), e.Reason)
		if err != nil {
			return uuid.Nil, translate(fmt.Errorf("ledger: post %q: %w", e.Reason, err))
		}
	}
	return txID, nil
}

// translate turns the unique-index violation on an idempotent reason into
// ErrDuplicate, so callers can tell "already done" from "went wrong" without
// matching on driver error strings themselves.
func translate(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		if pgErr.Code == "23505" && strings.Contains(pgErr.ConstraintName, "idem_key") {
			return fmt.Errorf("%w: %s", ErrDuplicate, pgErr.Detail)
		}
	}
	return err
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
