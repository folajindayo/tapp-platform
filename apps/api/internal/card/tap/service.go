package tap

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/card/auth"
	"github.com/usezoracle/tapp/api/internal/ledger/movements"
	"github.com/usezoracle/tapp/api/internal/money"
)

// Failed-PIN policy. Five attempts, then a day's lockout -- long enough to
// make guessing a four-digit PIN pointless, short enough that a cardholder who
// simply forgot theirs is not permanently cut off.
const (
	PINAttempts   = 5
	PINLockWindow = 24 * time.Hour

	// A card that repeatedly presents a token we do not recognise is either
	// cloned or badly out of sync. Either way it stops transacting until a
	// human looks.
	MismatchesBeforeLock = 3
)

var (
	// ErrStepUpRequired means the cardholder has not yet approved this amount
	// in their own app.
	ErrStepUpRequired = errors.New("cardholder approval required")

	// ErrDailyLimitReached means this tap would take the card past its daily
	// limit.
	ErrDailyLimitReached = errors.New("daily card limit reached")

	// ErrTokenStale means the card presented a token we do not hold. The
	// cardholder is told to re-sync; repeated occurrences lock the card.
	ErrTokenStale = errors.New("card must be re-synced")
)

// FeePolicy decides the platform's cut of a tap.
type FeePolicy interface {
	FeeFor(amount money.Amount) money.Amount
}

// BasisPointFee charges a flat rate in basis points.
type BasisPointFee int

func (b BasisPointFee) FeeFor(a money.Amount) money.Amount { return money.FeeFor(a, int(b)) }

// Service performs card payments.
type Service struct {
	Pool *pgxpool.Pool
	Fee  FeePolicy
	// Now is injectable so lockout and daily-window behaviour can be tested
	// without waiting a day. Nil means time.Now.
	Now func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// ChallengeRequest asks what a proposed amount will require.
type ChallengeRequest struct {
	CardUIDHash []byte
	MerchantID  uuid.UUID
	Amount      money.Amount
}

// Challenge resolves the authentication tier for an amount and issues a
// single-use nonce bound to it.
//
// The tier is decided HERE and stored on the nonce, not recomputed at debit
// time. That is what stops a merchant asking for a challenge on ₦500, being
// told no PIN is needed, and then presenting a debit for ₦50,000.
func (s *Service) Challenge(ctx context.Context, req ChallengeRequest) (*Challenge, error) {
	if !req.Amount.IsPositive() {
		return nil, fmt.Errorf("tap: an amount must be positive, got %s", req.Amount)
	}

	var ch *Challenge
	err := movements.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		now := s.now()
		k, err := loadCard(ctx, tx, req.CardUIDHash, req.Amount.Currency())
		if err != nil {
			return err
		}
		if err := k.usable(now); err != nil {
			return err
		}

		tier, err := k.Limits.TierFor(req.Amount)
		if err != nil {
			return err
		}

		nonce, err := newNonce()
		if err != nil {
			return err
		}
		expires := now.Add(NonceTTL)

		var id uuid.UUID
		err = tx.QueryRow(ctx, `
			INSERT INTO card_server_nonces
				(id, created_at, updated_at, nonce, tier, amount, currency, expires_at,
				 tapp_card_server_nonces, sender_profile_card_server_nonces)
			VALUES (gen_random_uuid(), now(), now(), $1, $2, $3, $4, $5, $6, $7)
			RETURNING id`,
			nonce, string(tier), formatMinor(req.Amount), string(req.Amount.Currency()),
			expires, k.ID, req.MerchantID).Scan(&id)
		if err != nil {
			return fmt.Errorf("tap: issue challenge: %w", err)
		}

		ch = &Challenge{
			ID: id, Nonce: nonce, Tier: tier,
			Amount: req.Amount, ExpiresAt: expires,
		}
		if tier == auth.TierStepUp {
			// The cardholder approves in their own app, which identifies the
			// pending approval by this reference.
			ch.StepUpRef = id.String()
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return ch, nil
}

// Request is a debit.
type Request struct {
	CardUIDHash    []byte
	PresentedToken []byte
	Nonce          []byte
	MerchantID     uuid.UUID
	Amount         money.Amount

	// PINResponse answers the challenge for a TierPIN tap.
	PINResponse []byte
	// StepUpRef is echoed back for a TierStepUp tap.
	StepUpRef string
}

// Receipt is what the merchant app needs after a successful debit.
type Receipt struct {
	TapID      uuid.UUID
	LedgerTxID uuid.UUID
	Amount     money.Amount
	Fee        money.Amount
	Tier       auth.Tier
	// NewToken must be written to the card. Until the write is acknowledged
	// the card's previous token also remains valid, so a failed write costs
	// nothing.
	NewToken       []byte
	RemainingDaily money.Amount
}
