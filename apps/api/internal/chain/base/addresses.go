package base

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Addresses allocates and looks up per-user deposit addresses.
type Addresses struct {
	Pool    *pgxpool.Pool
	Deriver *Deriver
}

// ErrAddressMismatch means the stored address does not match what the seed
// derives for that index.
//
// This is the check that catches a changed seed. If it ever fires, deposits
// are being sent to addresses this deployment cannot sweep, and continuing
// would keep showing people an address whose funds are unreachable.
var ErrAddressMismatch = errors.New("base: stored address does not match the configured seed")

// For returns a user's deposit address, allocating one on first use.
//
// The index comes from a counter taken under a row lock rather than a
// sequence. A sequence skips numbers when a transaction rolls back, and a
// skipped index is an address that may already have been shown to somebody --
// after which a deposit could arrive at an address no row points to.
func (a *Addresses) For(ctx context.Context, user uuid.UUID) (string, error) {
	var address string
	var index int64

	err := a.Pool.QueryRow(ctx,
		`SELECT address, index FROM base_deposit_addresses WHERE user_id = $1`, user).
		Scan(&address, &index)
	if err == nil {
		return a.verify(address, uint32(index))
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("base: read deposit address: %w", err)
	}

	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	// Another request may have allocated one between the read above and this
	// transaction.
	err = tx.QueryRow(ctx,
		`SELECT address, index FROM base_deposit_addresses WHERE user_id = $1`, user).
		Scan(&address, &index)
	if err == nil {
		return a.verify(address, uint32(index))
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", fmt.Errorf("base: read deposit address: %w", err)
	}

	if err := tx.QueryRow(ctx,
		`UPDATE base_deposit_counter SET next_index = next_index + 1
		  WHERE id = true RETURNING next_index - 1`).Scan(&index); err != nil {
		return "", fmt.Errorf("base: allocate deposit index: %w", err)
	}

	derived, err := a.Deriver.Address(uint32(index))
	if err != nil {
		return "", err
	}
	address = strings.ToLower(derived.Hex())

	if _, err := tx.Exec(ctx,
		`INSERT INTO base_deposit_addresses (user_id, index, address) VALUES ($1, $2, $3)`,
		user, index, address); err != nil {
		return "", fmt.Errorf("base: record deposit address: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return "", err
	}
	return address, nil
}

// verify re-derives a stored address and refuses to hand out one the seed does
// not produce.
func (a *Addresses) verify(stored string, index uint32) (string, error) {
	derived, err := a.Deriver.Address(index)
	if err != nil {
		return "", err
	}
	if !strings.EqualFold(stored, derived.Hex()) {
		// The seed has changed. Every address in this table is now unsweepable
		// and showing another one would add to the pile.
		return "", fmt.Errorf("%w: index %d is stored as %s but derives %s",
			ErrAddressMismatch, index, stored, derived.Hex())
	}
	return stored, nil
}

// Owner finds which user an address belongs to.
func (a *Addresses) Owner(ctx context.Context, address string) (uuid.UUID, uint32, error) {
	var user uuid.UUID
	var index int64
	err := a.Pool.QueryRow(ctx,
		`SELECT user_id, index FROM base_deposit_addresses WHERE address = $1`,
		strings.ToLower(address)).Scan(&user, &index)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, 0, pgx.ErrNoRows
	}
	if err != nil {
		return uuid.Nil, 0, fmt.Errorf("base: find address owner: %w", err)
	}
	return user, uint32(index), nil
}

// All returns every allocated address, for the watcher's filter.
func (a *Addresses) All(ctx context.Context) (map[string]uuid.UUID, error) {
	rows, err := a.Pool.Query(ctx, `SELECT address, user_id FROM base_deposit_addresses`)
	if err != nil {
		return nil, fmt.Errorf("base: list deposit addresses: %w", err)
	}
	defer rows.Close()

	out := map[string]uuid.UUID{}
	for rows.Next() {
		var address string
		var user uuid.UUID
		if err := rows.Scan(&address, &user); err != nil {
			return nil, err
		}
		out[strings.ToLower(address)] = user
	}
	return out, rows.Err()
}
