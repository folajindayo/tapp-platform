package base

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/ledger/movements"
	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/internal/rates"
)

// USDCDecimals is what USDC uses on chain. The ledger's USD minor unit is
// cents, so a conversion happens once, at credit time, and nowhere else.
const USDCDecimals = 6

// Confirmations before a deposit is credited.
//
// Base is an L2 with fast blocks and a sequencer that can reorg. Crediting on
// the first sighting would mean crediting deposits that later never happened,
// and the money would already have been spent by then.
const DefaultConfirmations = 12

// Transfer is one observed USDC movement into a deposit address.
type Transfer struct {
	TxHash      string
	LogIndex    uint64
	From        string
	To          string
	AmountMicro int64
	BlockNumber uint64
}

// Quoter prices a conversion. Satisfied by rates.Quoter.
//
// An interface here rather than the concrete type because this package has no
// business knowing how a price is sourced or stored -- only that a deposit can
// be priced into the currency the ledger spends.
type Quoter interface {
	Offer(ctx context.Context, sell money.Amount, buy money.Currency) (*rates.Quote, error)
	Redeem(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*rates.Quote, error)
}

// Deposits records observed transfers and credits confirmed ones.
type Deposits struct {
	Pool          *pgxpool.Pool
	Addresses     *Addresses
	Confirmations uint64

	// Quoter converts a deposit into CreditCurrency as it is credited.
	//
	// USDC arrives as dollars, and everything downstream of the ledger spends
	// naira: the card, its limit ladder, the payout rail. A dollar balance is
	// therefore a balance no card can reach -- money the user owns and cannot
	// spend, with nothing on screen to say why. Converting on the way in is
	// what makes a deposit usable by the thing it was deposited for.
	//
	// Nil disables conversion and credits the deposit in its own currency.
	// That is the honest behaviour for a deployment with no rate source: it
	// is visibly incomplete rather than quietly holding funds hostage.
	Quoter Quoter

	// CreditCurrency is what balances are held in. Zero means USD, which is
	// what USDC already is, so conversion is skipped.
	CreditCurrency money.Currency
}

func (d *Deposits) confirmations() uint64 {
	if d.Confirmations == 0 {
		return DefaultConfirmations
	}
	return d.Confirmations
}

// Record notes a transfer that has been seen on chain.
//
// Idempotent on (tx_hash, log_index), which is the chain's own identity for
// the event. That is what makes a restarted watcher safe: re-scanning blocks
// it already processed finds the rows and does nothing, rather than crediting
// somebody twice for one payment.
func (d *Deposits) Record(ctx context.Context, t Transfer) error {
	user, _, err := d.Addresses.Owner(ctx, t.To)
	if errors.Is(err, pgx.ErrNoRows) {
		// Not one of ours. Somebody else's transfer in a block we scanned.
		return nil
	}
	if err != nil {
		return err
	}
	if t.AmountMicro <= 0 {
		return nil
	}

	_, err = d.Pool.Exec(ctx, `
		INSERT INTO base_deposits
			(user_id, tx_hash, log_index, from_address, to_address, amount_micro, block_number)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (tx_hash, log_index) DO NOTHING`,
		user, strings.ToLower(t.TxHash), t.LogIndex,
		strings.ToLower(t.From), strings.ToLower(t.To), t.AmountMicro, t.BlockNumber)
	if err != nil {
		return fmt.Errorf("base: record deposit: %w", err)
	}
	return nil
}

// CreditConfirmed posts every deposit that now has enough confirmations.
//
// The ledger entry and the state change commit together. A deposit marked
// credited without its entry would be money the person never received; an
// entry without the mark would be credited again on the next pass.
func (d *Deposits) CreditConfirmed(ctx context.Context, head uint64) (int, error) {
	minConfirmations := d.confirmations()
	if head < minConfirmations {
		return 0, nil
	}
	safeBlock := head - minConfirmations

	rows, err := d.Pool.Query(ctx, `
		SELECT id, user_id, amount_micro, tx_hash, log_index
		  FROM base_deposits
		 WHERE state = 'seen' AND block_number <= $1
		 LIMIT 200`, safeBlock)
	if err != nil {
		return 0, fmt.Errorf("base: find confirmed deposits: %w", err)
	}

	type pending struct {
		id     uuid.UUID
		user   uuid.UUID
		micro  int64
		txHash string
		logIdx int64
	}
	var due []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.user, &p.micro, &p.txHash, &p.logIdx); err != nil {
			rows.Close()
			return 0, err
		}
		due = append(due, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	credited := 0
	for _, p := range due {
		amount := usdFromMicro(p.micro)
		if !amount.IsPositive() {
			// Less than a cent. Recording it as credited with no entry would
			// be a lie; leaving it seen forever would retry it every pass.
			if _, err := d.Pool.Exec(ctx, `
				UPDATE base_deposits SET state = 'failed', last_error = $2 WHERE id = $1`,
				p.id, "amount is below one cent"); err != nil {
				return credited, err
			}
			continue
		}

		reference := fmt.Sprintf("%s:%d", p.txHash, p.logIdx)

		// Priced before the transaction opens, because Offer records the quote
		// and a quote is a row of its own -- taking it inside would hold the
		// deposit's locks across an outbound HTTP call to a rate source.
		var quote *rates.Quote
		if conv, err := d.quotable(ctx, amount); err != nil {
			// Leave the deposit `seen` and try again next pass. The money is
			// on chain and nothing is lost by waiting; crediting it in dollars
			// instead would hand somebody a balance their card cannot spend
			// and no later pass would ever correct it.
			slog.Warn("base: deposit not credited yet, no usable rate",
				"deposit", p.id, "amount", amount, "into", d.creditCurrency(), "err", err)
			continue
		} else {
			quote = conv
		}

		err := movements.InTx(ctx, d.Pool, func(tx pgx.Tx) error {
			ledgerTx, err := movements.Deposit(ctx, tx, p.user, amount, "base", reference)
			if err != nil {
				return err
			}
			if quote != nil {
				// Redeemed inside the transaction so one quote can price
				// exactly one conversion, and converted in the same one as
				// the deposit: a crash between them would leave a dollar
				// balance nothing spends.
				redeemed, err := d.Quoter.Redeem(ctx, tx, quote.ID)
				if err != nil {
					return fmt.Errorf("redeem quote: %w", err)
				}
				if _, err := movements.Convert(ctx, tx, p.user, movements.Conversion{
					Sold: redeemed.Sell, Bought: redeemed.Buy, Spread: redeemed.Fee,
					QuoteID: redeemed.ID.String(),
				}); err != nil {
					return fmt.Errorf("convert deposit: %w", err)
				}
			}
			_, err = tx.Exec(ctx, `
				UPDATE base_deposits
				   SET state = 'credited', ledger_tx_id = $2, credited_at = now()
				 WHERE id = $1 AND state = 'seen'`, p.id, ledgerTx)
			return err
		})
		if err != nil {
			return credited, fmt.Errorf("base: credit deposit %s: %w", p.id, err)
		}
		credited++
	}
	return credited, nil
}

// creditCurrency is what deposits are credited in. USD when unset, which is
// what USDC already is.
func (d *Deposits) creditCurrency() money.Currency {
	if d.CreditCurrency == "" {
		return money.USD
	}
	return d.CreditCurrency
}

// quotable prices the deposit into the credit currency, or returns nil when no
// conversion is needed.
//
// Nil means "credit as-is" and is not an error: the deposit currency already
// matching the credit currency is the ordinary case for a USD deployment, and
// a missing Quoter is a deployment that has deliberately not configured rates.
func (d *Deposits) quotable(ctx context.Context, amount money.Amount) (*rates.Quote, error) {
	into := d.creditCurrency()
	if into == amount.Currency() || d.Quoter == nil {
		return nil, nil
	}
	return d.Quoter.Offer(ctx, amount, into)
}

// usdFromMicro converts USDC's six decimals to the ledger's cents.
//
// Truncating rather than rounding, deliberately: rounding up would credit
// somebody a cent that never arrived, and across enough deposits that is money
// the platform has to find from somewhere.
func usdFromMicro(micro int64) money.Amount {
	const microPerCent = 10_000 // 1e6 / 1e2
	return money.New(micro/microPerCent, money.USD)
}
