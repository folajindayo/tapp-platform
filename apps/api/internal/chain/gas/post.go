package gas

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	"github.com/google/uuid"
	"github.com/shopspring/decimal"

	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/ledger/movements"
	"github.com/usezoracle/tapp/api/internal/money"
)

// weiPerETH is 1e18. Named rather than inlined because a wrong exponent here
// misprices every gas cost by three orders of magnitude and reads as a typo.
var weiPerETH = decimal.New(1, 18)

// ETHPricer answers what one ETH is worth. Separate from the rates engine's
// interface so this package does not depend on how the price is sourced --
// and so the absence of a source is a nil, not a special case.
type ETHPricer interface {
	// ETHPrice returns the price of one ETH in the given currency.
	ETHPrice(ctx context.Context, c money.Currency) (decimal.Decimal, error)
}

// ErrNoETHPrice means gas cannot be priced into the ledger yet.
//
// Not an error condition to alarm on. The exact wei cost is already recorded
// and loses nothing by waiting; posting at an invented rate would put a figure
// in the books that nothing can reproduce, which is worse than a gap.
var ErrNoETHPrice = errors.New("gas: no ETH price source, costs recorded but not posted")

// Poster turns recorded spends into ledger movements.
type Poster struct {
	Recorder *Recorder
	Pricer   ETHPricer
	// Currency the ledger cost is denominated in.
	Currency money.Currency
}

// PostPending prices every unposted spend and books it.
//
// Returns the number posted. A spend that cannot be priced is left alone and
// retried on the next pass, so enabling a price source later backfills the
// whole history rather than starting from that moment.
func (p *Poster) PostPending(ctx context.Context, limit int) (int, error) {
	if p.Pricer == nil {
		return 0, ErrNoETHPrice
	}
	pending, err := p.Recorder.Unposted(ctx, limit)
	if err != nil {
		return 0, err
	}
	if len(pending) == 0 {
		return 0, nil
	}

	rate, err := p.Pricer.ETHPrice(ctx, p.Currency)
	if err != nil {
		return 0, fmt.Errorf("%w: %v", ErrNoETHPrice, err)
	}
	if rate.Sign() <= 0 {
		return 0, fmt.Errorf("%w: price is %s", ErrNoETHPrice, rate)
	}

	posted := 0
	for _, spend := range pending {
		if err := p.postOne(ctx, spend, rate); err != nil {
			// One unpostable spend must not stop the rest: it stays unposted
			// and is retried, which is the same state it was already in.
			return posted, err
		}
		posted++
	}
	return posted, nil
}

func (p *Poster) postOne(ctx context.Context, spend Spend, rate decimal.Decimal) error {
	cost := weiToMinor(spend.CostWei, rate, p.Currency)
	if cost.IsZero() {
		// Below one minor unit. Marked as priced at zero rather than retried
		// forever: the cost is real but unrepresentable, and a row that can
		// never be posted would be reconsidered on every pass.
		_, err := p.Recorder.Pool.Exec(ctx, `
			UPDATE gas_transactions
			   SET cost_usd_minor = 0, eth_usd_rate = $2,
			       ledger_tx_id = '00000000-0000-0000-0000-000000000000'
			 WHERE id = $1`, spend.ID, rate.String())
		return err
	}

	tx, err := p.Recorder.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	ledgerTx, err := movements.GasSpent(ctx, tx, cost, p.Recorder.ChainID, spend.TxHash)
	switch {
	case errors.Is(err, ledger.ErrDuplicate):
		// Already booked under this transaction hash. Reconcile the row to
		// match rather than posting a second time.
		ledgerTx = uuid.Nil
	case err != nil:
		return fmt.Errorf("gas: book spend %s: %w", spend.TxHash, err)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE gas_transactions
		   SET ledger_tx_id = $2, cost_usd_minor = $3, eth_usd_rate = $4
		 WHERE id = $1`,
		spend.ID, ledgerTx, cost.Minor(), rate.String()); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// weiToMinor converts a wei cost into ledger minor units at the given rate.
//
// Decimal throughout, never float: gas costs are small and a float's error is
// largest exactly where the value is smallest. Truncation rather than
// rounding, so the platform never books a cost larger than the chain charged.
func weiToMinor(wei *big.Int, ratePerETH decimal.Decimal, c money.Currency) money.Amount {
	if wei == nil || wei.Sign() <= 0 {
		return money.Zero(c)
	}
	eth := decimal.NewFromBigInt(wei, 0).Div(weiPerETH)
	major := eth.Mul(ratePerETH)
	minor := major.Mul(decimal.NewFromInt(c.Scale())).Truncate(0)
	return money.New(minor.IntPart(), c)
}
