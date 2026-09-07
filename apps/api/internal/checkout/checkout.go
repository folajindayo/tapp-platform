// Package checkout is a merchant asking for money and a payer approving it.
//
// The phone-to-phone half of the product: the merchant broadcasts a request
// over NFC or shows a QR, the payer opens it and pays from their balance. The
// same ledger movement as a card tap, differently initiated -- a card is
// present and authenticates itself, whereas here the payer is holding their
// own phone and authenticates as themselves, which is the stronger of the two.
package checkout

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/ledger/movements"
	"github.com/usezoracle/tapp/api/internal/money"
)

// TTL is how long a request stays payable.
//
// Short: it is displayed on a screen at a counter while somebody waits. A
// request that outlives the queue it was created for is one a customer can pay
// by accident tomorrow.
const TTL = 10 * time.Minute

// State is where a request has got to.
type State string

const (
	Open      State = "open"
	Paid      State = "paid"
	Expired   State = "expired"
	Cancelled State = "cancelled"
)

var (
	// ErrNotFound means no such checkout.
	ErrNotFound = errors.New("checkout: no such payment request")
	// ErrNotOpen means it has already been paid, expired or withdrawn.
	ErrNotOpen = errors.New("checkout: this payment request is no longer open")
	// ErrOwnCheckout means somebody tried to pay their own request.
	ErrOwnCheckout = errors.New("checkout: you cannot pay your own request")
)

// Checkout is one payment request.
type Checkout struct {
	ID         uuid.UUID `json:"id"`
	MerchantID uuid.UUID `json:"-"`

	Amount money.Amount `json:"-"`
	Fee    money.Amount `json:"-"`

	Narration string `json:"narration,omitempty"`
	State     State  `json:"state"`

	PayerID   *uuid.UUID `json:"-"`
	ExpiresAt time.Time  `json:"expiresAt"`
	PaidAt    *time.Time `json:"paidAt,omitempty"`
}

// FeePolicy decides the platform's cut.
type FeePolicy interface {
	FeeFor(amount money.Amount) money.Amount
}

// Service creates and settles payment requests.
type Service struct {
	Pool *pgxpool.Pool
	Fee  FeePolicy
	Now  func() time.Time
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

// Open creates a payment request.
//
// idemKey is the merchant app's own key. It broadcasts a request, the response
// is lost, it retries -- and the same key must return the same request rather
// than opening a second one, or the customer sees two charges to approve.
func (s *Service) Open(
	ctx context.Context, merchant uuid.UUID, amount money.Amount, narration, idemKey string,
) (*Checkout, error) {
	if !amount.IsPositive() {
		return nil, fmt.Errorf("checkout: an amount must be positive, got %s", amount)
	}

	if idemKey != "" {
		if existing, err := s.byIdemKey(ctx, merchant, idemKey); err != nil {
			return nil, err
		} else if existing != nil {
			return existing, nil
		}
	}

	c := &Checkout{
		ID: uuid.New(), MerchantID: merchant, Amount: amount,
		Fee: s.Fee.FeeFor(amount), Narration: narration,
		State: Open, ExpiresAt: s.now().Add(TTL),
	}

	err := s.Pool.QueryRow(ctx, `
		INSERT INTO checkouts
			(id, merchant_id, currency, amount_minor, fee_minor, narration, idem_key, expires_at)
		VALUES ($1, $2, $3::currency, $4, $5, $6, $7, $8)
		ON CONFLICT (merchant_id, idem_key) WHERE idem_key IS NOT NULL
		DO UPDATE SET merchant_id = EXCLUDED.merchant_id
		RETURNING id, state, expires_at`,
		c.ID, merchant, string(amount.Currency()), amount.Minor(), c.Fee.Minor(),
		nullIfEmpty(narration), nullIfEmpty(idemKey), c.ExpiresAt).
		Scan(&c.ID, &c.State, &c.ExpiresAt)
	if err != nil {
		return nil, fmt.Errorf("checkout: open: %w", err)
	}
	return c, nil
}

// Get reads a request, for the payer's screen.
func (s *Service) Get(ctx context.Context, id uuid.UUID) (*Checkout, error) {
	return s.load(ctx, s.Pool, id)
}

// Pay moves the money.
//
// The state change and the ledger entries commit together, and the request is
// claimed by the UPDATE, so two payers racing to settle one request cannot
// both be charged.
func (s *Service) Pay(ctx context.Context, id, payer uuid.UUID) (*Checkout, error) {
	var out *Checkout

	err := movements.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		c, err := s.load(ctx, tx, id)
		if err != nil {
			return err
		}
		if c.State != Open {
			return fmt.Errorf("%w: it is %s", ErrNotOpen, c.State)
		}
		if s.now().After(c.ExpiresAt) {
			return fmt.Errorf("%w: it expired", ErrNotOpen)
		}
		if c.MerchantID == payer {
			return ErrOwnCheckout
		}

		ledgerTx, err := movements.Tap(ctx, tx, payer, c.MerchantID, c.Amount, c.Fee, c.ID)
		if err != nil {
			return err
		}

		tag, err := tx.Exec(ctx, `
			UPDATE checkouts
			   SET state = 'paid', payer_id = $2, ledger_tx_id = $3, paid_at = now()
			 WHERE id = $1 AND state = 'open'`, c.ID, payer, ledgerTx)
		if err != nil {
			return fmt.Errorf("checkout: mark paid: %w", err)
		}
		if tag.RowsAffected() == 0 {
			// Somebody else claimed it between the read and here.
			return ErrNotOpen
		}

		c.State = Paid
		c.PayerID = &payer
		out = c
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Cancel withdraws an unpaid request.
func (s *Service) Cancel(ctx context.Context, id, merchant uuid.UUID) error {
	tag, err := s.Pool.Exec(ctx, `
		UPDATE checkouts SET state = 'cancelled'
		 WHERE id = $1 AND merchant_id = $2 AND state = 'open'`, id, merchant)
	if err != nil {
		return fmt.Errorf("checkout: cancel: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotOpen
	}
	return nil
}

// Expire closes requests nobody paid.
func (s *Service) Expire(ctx context.Context) (int, error) {
	tag, err := s.Pool.Exec(ctx,
		`UPDATE checkouts SET state = 'expired' WHERE state = 'open' AND expires_at < now()`)
	if err != nil {
		return 0, fmt.Errorf("checkout: expire: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

type querier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func (s *Service) load(ctx context.Context, q querier, id uuid.UUID) (*Checkout, error) {
	var (
		c         Checkout
		currency  string
		amount    int64
		fee       int64
		narration *string
	)
	err := q.QueryRow(ctx, `
		SELECT id, merchant_id, currency, amount_minor, fee_minor, narration,
		       state, payer_id, expires_at, paid_at
		  FROM checkouts WHERE id = $1`, id).
		Scan(&c.ID, &c.MerchantID, &currency, &amount, &fee, &narration,
			&c.State, &c.PayerID, &c.ExpiresAt, &c.PaidAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("checkout: load: %w", err)
	}

	c.Amount = money.New(amount, money.Currency(currency))
	c.Fee = money.New(fee, money.Currency(currency))
	if narration != nil {
		c.Narration = *narration
	}
	return &c, nil
}

func (s *Service) byIdemKey(ctx context.Context, merchant uuid.UUID, key string) (*Checkout, error) {
	var id uuid.UUID
	err := s.Pool.QueryRow(ctx,
		`SELECT id FROM checkouts WHERE merchant_id = $1 AND idem_key = $2`, merchant, key).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("checkout: look up by key: %w", err)
	}
	return s.load(ctx, s.Pool, id)
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
