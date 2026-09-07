// Package tap performs a card payment.
//
// One request, one database transaction, one outcome. Everything the decision
// depends on -- the nonce, the card's token, the PIN, the day's spend, the
// balance -- is read and written inside that transaction, so no check can
// commit separately from the movement it authorised.
//
// It reads the ent-owned card and nonce tables with raw SQL rather than
// through ent. ent's client and the ledger share one connection pool but not
// one transaction: an ent transaction and a pgx transaction against the same
// pool are two different transactions, and a tap whose nonce consumption could
// commit while its ledger entries rolled back would be a tap that charged
// nobody and could never be retried. ent still owns the schema; this one hot
// path talks to it directly because atomicity requires it.
package tap

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/usezoracle/tapp/api/internal/card/auth"
	"github.com/usezoracle/tapp/api/internal/card/token"
	"github.com/usezoracle/tapp/api/internal/money"
)

// Card status values, mirroring the ent enum.
const (
	StatusIssued  = "issued"
	StatusClaimed = "claimed"
	StatusLive    = "live"
	StatusRevoked = "revoked"
	StatusLocked  = "locked"
)

var (
	// ErrCardUnknown means no card carries this UID hash. Returned for an
	// unrecognised card and for a revoked one alike, so probing the endpoint
	// cannot enumerate which cards exist.
	ErrCardUnknown = errors.New("card not recognised")

	// ErrCardUnavailable means the card exists but cannot transact: revoked by
	// its holder, or locked after repeated failures.
	ErrCardUnavailable = errors.New("card is not available")

	// ErrNotLinked means the card has no cardholder. An issued-but-unclaimed
	// card is a piece of plastic with a URL on it.
	ErrNotLinked = errors.New("card is not linked to an account")
)

// card is the state a tap needs, read in one query.
type card struct {
	ID         uuid.UUID
	Status     string
	Cardholder *uuid.UUID

	Token token.State

	Anchor        []byte
	AttemptsLeft  int
	LockedUntil   *time.Time
	MismatchCount int

	Limits auth.Limits
}

// loadCard reads a card by the hash of its UID.
//
// It does not lock. The lock that matters is taken by the ledger movement, on
// the account being spent, and taking a second one here in a different order
// is how concurrent movements deadlock. Two taps of one card are already
// serialised by the account lock, because one card has one cardholder.
func loadCard(ctx context.Context, tx pgx.Tx, uidHash []byte, c money.Currency) (*card, error) {
	var (
		k               card
		dailyMinor      uint64
		perTapMinor     uint64
		stepUpMinor     uint64
		pendingIssuedAt *time.Time
	)

	err := tx.QueryRow(ctx, `
		SELECT id, status, user_tapp_cards,
		       current_token_ciphertext, pending_token_ciphertext, pending_token_issued_at,
		       linking_proof, pin_attempts_remaining, locked_until, token_mismatch_count,
		       daily_limit_subunit, per_tap_limit_subunit, step_up_threshold_subunit
		  FROM tapp_cards WHERE card_uid_hash = $1`, uidHash).
		Scan(&k.ID, &k.Status, &k.Cardholder,
			&k.Token.Current, &k.Token.Pending, &pendingIssuedAt,
			&k.Anchor, &k.AttemptsLeft, &k.LockedUntil, &k.MismatchCount,
			&dailyMinor, &perTapMinor, &stepUpMinor)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrCardUnknown
	}
	if err != nil {
		return nil, fmt.Errorf("tap: load card: %w", err)
	}

	k.Token.PendingIssuedAt = pendingIssuedAt
	k.Limits = auth.Limits{
		PerTap: money.New(int64(perTapMinor), c),
		StepUp: money.New(int64(stepUpMinor), c),
		Daily:  money.New(int64(dailyMinor), c),
	}
	return &k, nil
}

// usable reports whether this card may transact at all.
func (k *card) usable(now time.Time) error {
	switch k.Status {
	case StatusLive:
	case StatusLocked:
		// A lock expires. The predecessor set locked_until and then never
		// compared it, so a card locked by five mistyped PINs stayed locked
		// forever and its holder had to contact support.
		if k.LockedUntil != nil && now.After(*k.LockedUntil) {
			return nil
		}
		return ErrCardUnavailable
	case StatusRevoked:
		return ErrCardUnknown // deliberately indistinguishable from unknown
	default:
		return ErrNotLinked
	}
	if k.Cardholder == nil {
		return ErrNotLinked
	}
	return nil
}
