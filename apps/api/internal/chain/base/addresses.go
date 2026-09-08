package base

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"strings"

	"github.com/ethereum/go-ethereum/common"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Addresses allocates and looks up per-user deposit addresses.
type Addresses struct {
	Pool    *pgxpool.Pool
	Deriver *Deriver

	// SmartAccounts, when set, makes every NEW address a CDP Smart Account
	// instead of a derived EOA. Addresses already issued keep their provider:
	// people have them saved as payees and they may hold funds.
	SmartAccounts SmartAccounts
}

// SmartAccount is a deposit address whose key lives with CDP, not here.
type SmartAccount struct {
	Address string
	Owner   string
	Name    string
}

// SmartAccounts is what the CDP integration provides. An interface so this
// package does not import it: base is the thing being extended, and the
// extension depends on it, not the other way round.
type SmartAccounts interface {
	EnsureSmartAccount(ctx context.Context, user uuid.UUID) (SmartAccount, error)
	SweepSmartAccount(ctx context.Context, account string, usdc, to common.Address,
		amount *big.Int, idem string) (txHash string, err error)
}

// Providers name the mechanism that produced an address, and therefore how
// it is swept. These mirror the CHECK constraint on the table.
const (
	ProviderDerived = "derived"
	ProviderCDP     = "cdp"
)

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
	if address, ok, err := a.existing(ctx, a.Pool, user); err != nil || ok {
		return address, err
	}

	if a.SmartAccounts != nil {
		return a.allocateSmartAccount(ctx, user)
	}
	return a.allocateDerived(ctx, user)
}

// existing returns the user's address if one has been issued, verified for
// derived rows. Smart accounts are not re-derived -- there is nothing here to
// derive them from -- so their stored address is the truth.
func (a *Addresses) existing(ctx context.Context, q interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}, user uuid.UUID) (string, bool, error) {
	var address, provider string
	var index *int64
	err := q.QueryRow(ctx,
		`SELECT address, provider, index FROM base_deposit_addresses WHERE user_id = $1`, user).
		Scan(&address, &provider, &index)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, fmt.Errorf("base: read deposit address: %w", err)
	}
	if provider == ProviderDerived {
		if index == nil {
			return "", false, fmt.Errorf("base: derived address %s has no index", address)
		}
		verified, err := a.verify(address, uint32(*index))
		return verified, err == nil, err
	}
	return address, true, nil
}

// allocateSmartAccount asks CDP for the account, then records it.
//
// The CDP call is made OUTSIDE the database transaction. It is a network
// round trip that may take seconds, and holding a row lock across it would
// serialise every first-time deposit behind the slowest one. Two requests
// racing here both reach CDP, which is safe -- EnsureSmartAccount is
// idempotent by name -- and the second INSERT loses on the primary key and
// re-reads the winner.
func (a *Addresses) allocateSmartAccount(ctx context.Context, user uuid.UUID) (string, error) {
	acct, err := a.SmartAccounts.EnsureSmartAccount(ctx, user)
	if err != nil {
		return "", err
	}
	if !common.IsHexAddress(acct.Address) || !common.IsHexAddress(acct.Owner) || acct.Name == "" {
		return "", fmt.Errorf("base: CDP returned an incomplete smart account for %s", user)
	}

	_, err = a.Pool.Exec(ctx, `
		INSERT INTO base_deposit_addresses (user_id, provider, address, owner_address, account_name)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id) DO NOTHING`,
		user, ProviderCDP, strings.ToLower(acct.Address), strings.ToLower(acct.Owner), acct.Name)
	if err != nil {
		return "", fmt.Errorf("base: record smart account: %w", err)
	}

	address, ok, err := a.existing(ctx, a.Pool, user)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", fmt.Errorf("base: smart account for %s was not recorded", user)
	}
	return address, nil
}

// allocateDerived is the original scheme: the next BIP-32 index, under lock.
func (a *Addresses) allocateDerived(ctx context.Context, user uuid.UUID) (string, error) {
	var address string
	var index int64

	tx, err := a.Pool.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)

	// Another request may have allocated one between the read above and this
	// transaction.
	if address, ok, err := a.existing(ctx, tx, user); err != nil || ok {
		return address, err
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
		`INSERT INTO base_deposit_addresses (user_id, provider, index, address) VALUES ($1, $2, $3, $4)`,
		user, ProviderDerived, index, address); err != nil {
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
	var index *int64
	err := a.Pool.QueryRow(ctx,
		`SELECT user_id, index FROM base_deposit_addresses WHERE address = $1`,
		strings.ToLower(address)).Scan(&user, &index)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, 0, pgx.ErrNoRows
	}
	if err != nil {
		return uuid.Nil, 0, fmt.Errorf("base: find address owner: %w", err)
	}
	if index == nil {
		return user, 0, nil // a smart account; it has no index
	}
	return user, uint32(*index), nil
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
