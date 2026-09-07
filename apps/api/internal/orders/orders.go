// Package orders is the offramp: value in, fiat out to somebody's bank.
//
// It used to be a pipeline -- deposit to a one-time Sui address, bridge to
// Base, hand to an aggregator, wait for a liquidity provider. Every stage was
// somewhere to get stuck, and an order's true state lived across four tables
// and a bridge provider's API.
//
// It is now a composition of three things that already exist: a balance in the
// ledger, a price from a quote, and a delivery by the settlement worker. The
// order row records which three, and nothing else.
package orders

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
	"github.com/usezoracle/tapp/api/internal/rates"
	"github.com/usezoracle/tapp/api/internal/settlement"
)

// State is where an order has got to.
type State string

const (
	Pending    State = "pending"
	Converting State = "converting"
	Paying     State = "paying"
	Settled    State = "settled"
	Refunded   State = "refunded"
	Cancelled  State = "cancelled"
)

var (
	// ErrNotFound means no such order, or not this sender's.
	ErrNotFound = errors.New("orders: no such order")
	// ErrNotCancellable means it is past the point of being called off.
	ErrNotCancellable = errors.New("orders: this order can no longer be cancelled")
)

// Order is one offramp request.
type Order struct {
	ID       uuid.UUID `json:"id"`
	SenderID uuid.UUID `json:"-"`

	Sold   money.Amount `json:"-"`
	Payout money.Amount `json:"-"`

	QuoteID *uuid.UUID `json:"-"`

	BankCode      string `json:"bankCode"`
	AccountNumber string `json:"accountNumber"`
	AccountName   string `json:"accountName"`
	Narration     string `json:"narration,omitempty"`

	State    State      `json:"state"`
	PayoutID *uuid.UUID `json:"-"`
	Failure  string     `json:"failure,omitempty"`

	CreatedAt time.Time  `json:"createdAt"`
	SettledAt *time.Time `json:"settledAt,omitempty"`
}

// Request is an integrator asking to send fiat.
type Request struct {
	SenderID uuid.UUID

	// Sell is what the sender parts with, from their ledger balance.
	Sell money.Amount
	// PayoutCurrency is what the recipient receives. When it differs from
	// Sell's currency, QuoteID must price the conversion.
	PayoutCurrency money.Currency
	// QuoteID is the price the sender accepted. Required for a conversion:
	// without it the rate would be whatever it happened to be when the code
	// ran, which nobody agreed to.
	QuoteID *uuid.UUID

	BankCode      string
	AccountNumber string
	AccountName   string
	Narration     string
	IdemKey       string
}

// Valid checks a request before anything moves.
func (r Request) Valid() error {
	switch {
	case r.SenderID == uuid.Nil:
		return fmt.Errorf("orders: an order needs a sender")
	case !r.Sell.IsPositive():
		return fmt.Errorf("orders: an order must sell a positive amount, got %s", r.Sell)
	case r.BankCode == "" || r.AccountNumber == "":
		return fmt.Errorf("orders: an order needs a bank and an account number")
	case r.AccountName == "":
		return fmt.Errorf("orders: an order needs the name the bank returned for the account")
	}
	if err := r.PayoutCurrency.Valid(); err != nil {
		return err
	}
	if r.PayoutCurrency != r.Sell.Currency() && r.QuoteID == nil {
		return fmt.Errorf("orders: converting %s to %s needs a quote",
			r.Sell.Currency(), r.PayoutCurrency)
	}
	return nil
}

// Service creates and drives orders.
type Service struct {
	Pool       *pgxpool.Pool
	Quoter     *rates.Quoter
	Settlement *settlement.Worker
}

// Create takes the sender's money, converts it if needed, and raises a payout.
//
// All of it in one transaction. An order that debited the sender without
// raising a payout is money taken and not sent; one that raised a payout
// without debiting is money sent and not taken. Neither is recoverable by
// looking at the row afterwards, so neither is allowed to exist.
func (s *Service) Create(ctx context.Context, req Request) (*Order, error) {
	if err := req.Valid(); err != nil {
		return nil, err
	}

	if req.IdemKey != "" {
		if existing, err := s.byIdemKey(ctx, req.SenderID, req.IdemKey); err != nil {
			return nil, err
		} else if existing != nil {
			return existing, nil
		}
	}

	o := &Order{
		ID: uuid.New(), SenderID: req.SenderID, Sold: req.Sell,
		BankCode: req.BankCode, AccountNumber: req.AccountNumber,
		AccountName: req.AccountName, Narration: req.Narration,
		QuoteID: req.QuoteID, State: Paying, CreatedAt: time.Now(),
	}

	err := movements.InTx(ctx, s.Pool, func(tx pgx.Tx) error {
		payout := req.Sell

		// Convert first, when the recipient is paid in a different currency.
		// The quote is redeemed inside this transaction, so a price cannot be
		// consumed by an order that then fails to be raised.
		if req.PayoutCurrency != req.Sell.Currency() {
			quote, err := s.Quoter.Redeem(ctx, tx, *req.QuoteID)
			if err != nil {
				return err
			}
			if quote.Sell.Minor() != req.Sell.Minor() || quote.Sell.Currency() != req.Sell.Currency() {
				return fmt.Errorf("orders: the quote prices %s, not %s", quote.Sell, req.Sell)
			}
			if quote.Buy.Currency() != req.PayoutCurrency {
				return fmt.Errorf("orders: the quote buys %s, not %s",
					quote.Buy.Currency(), req.PayoutCurrency)
			}
			if _, err := movements.Convert(ctx, tx, req.SenderID, movements.Conversion{
				Sold: quote.Sell, Bought: quote.Buy, Spread: quote.Fee,
				QuoteID: quote.ID.String(),
			}); err != nil {
				return err
			}
			payout = quote.Buy
		}
		o.Payout = payout

		p, err := s.Settlement.OpenIn(ctx, tx, settlement.Request{
			Beneficiary:   settlement.Beneficiary{Kind: settlement.User, ID: req.SenderID},
			Amount:        payout,
			BankCode:      req.BankCode,
			AccountNumber: req.AccountNumber,
			AccountName:   req.AccountName,
			Narration:     req.Narration,
		})
		if err != nil {
			return err
		}
		o.PayoutID = &p.ID

		_, err = tx.Exec(ctx, `
			INSERT INTO orders
				(id, sender_id, sold_currency, sold_minor, payout_currency, payout_minor,
				 quote_id, bank_code, account_number, account_name, narration,
				 state, payout_id, idem_key)
			VALUES ($1, $2, $3::currency, $4, $5::currency, $6, $7, $8, $9, $10, $11,
			        'paying', $12, $13)`,
			o.ID, req.SenderID, string(req.Sell.Currency()), req.Sell.Minor(),
			string(payout.Currency()), payout.Minor(), req.QuoteID,
			req.BankCode, req.AccountNumber, req.AccountName, nullIfEmpty(req.Narration),
			p.ID, nullIfEmpty(req.IdemKey))
		return err
	})
	if err != nil {
		return nil, err
	}
	return o, nil
}
