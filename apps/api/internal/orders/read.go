package orders

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/usezoracle/tapp/api/internal/money"
)

// Get reads one order.
func (s *Service) Get(ctx context.Context, id, sender uuid.UUID) (*Order, error) {
	var (
		o                      Order
		soldCur, payoutCur     string
		soldMinor, payoutMinor int64
		narration, failure     *string
	)
	err := s.Pool.QueryRow(ctx, `
		SELECT id, sender_id, sold_currency, sold_minor, payout_currency, payout_minor,
		       quote_id, bank_code, account_number, account_name, narration,
		       state, payout_id, failure, created_at, settled_at
		  FROM orders WHERE id = $1 AND sender_id = $2`, id, sender).
		Scan(&o.ID, &o.SenderID, &soldCur, &soldMinor, &payoutCur, &payoutMinor,
			&o.QuoteID, &o.BankCode, &o.AccountNumber, &o.AccountName, &narration,
			&o.State, &o.PayoutID, &failure, &o.CreatedAt, &o.SettledAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("orders: read: %w", err)
	}

	o.Sold = money.New(soldMinor, money.Currency(soldCur))
	o.Payout = money.New(payoutMinor, money.Currency(payoutCur))
	if narration != nil {
		o.Narration = *narration
	}
	if failure != nil {
		o.Failure = *failure
	}
	return &o, nil
}

// List returns a sender's orders, newest first.
func (s *Service) List(ctx context.Context, sender uuid.UUID, limit int) ([]Order, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	rows, err := s.Pool.Query(ctx, `
		SELECT id, sold_currency, sold_minor, payout_currency, payout_minor,
		       bank_code, account_number, account_name, state, created_at, settled_at
		  FROM orders WHERE sender_id = $1 ORDER BY created_at DESC LIMIT $2`,
		sender, limit)
	if err != nil {
		return nil, fmt.Errorf("orders: list: %w", err)
	}
	defer rows.Close()

	var out []Order
	for rows.Next() {
		var (
			o                      Order
			soldCur, payoutCur     string
			soldMinor, payoutMinor int64
		)
		if err := rows.Scan(&o.ID, &soldCur, &soldMinor, &payoutCur, &payoutMinor,
			&o.BankCode, &o.AccountNumber, &o.AccountName, &o.State,
			&o.CreatedAt, &o.SettledAt); err != nil {
			return nil, err
		}
		o.SenderID = sender
		o.Sold = money.New(soldMinor, money.Currency(soldCur))
		o.Payout = money.New(payoutMinor, money.Currency(payoutCur))
		out = append(out, o)
	}
	return out, rows.Err()
}

// Sync brings an order's state in line with its payout.
//
// The payout is the authority: it is what actually talks to the bank. An order
// that tracked its own state independently would eventually disagree with the
// thing doing the work, and the disagreement would be invisible until somebody
// asked why a settled order had never been paid.
func (s *Service) Sync(ctx context.Context) (int, error) {
	tag, err := s.Pool.Exec(ctx, `
		UPDATE orders o
		   SET state = CASE p.state
		                 WHEN 'confirmed' THEN 'settled'::order_state
		                 WHEN 'failed'    THEN 'refunded'::order_state
		                 ELSE o.state
		               END,
		       failure = CASE WHEN p.state = 'failed' THEN p.last_error ELSE o.failure END,
		       settled_at = CASE WHEN p.state = 'confirmed' THEN p.settled_at ELSE o.settled_at END,
		       updated_at = now()
		  FROM payouts p
		 WHERE o.payout_id = p.id
		   AND o.state = 'paying'
		   AND p.state IN ('confirmed', 'failed')`)
	if err != nil {
		return 0, fmt.Errorf("orders: sync: %w", err)
	}
	return int(tag.RowsAffected()), nil
}

func (s *Service) byIdemKey(ctx context.Context, sender uuid.UUID, key string) (*Order, error) {
	var id uuid.UUID
	err := s.Pool.QueryRow(ctx,
		`SELECT id FROM orders WHERE sender_id = $1 AND idem_key = $2`, sender, key).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("orders: look up by key: %w", err)
	}
	return s.Get(ctx, id, sender)
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
