// Package gas is what on-chain work costs this platform, and what keeps the
// wallet that pays for it funded.
//
// Every transaction the platform submits costs ETH. Nothing recorded that, and
// nothing watched the balance it came out of, so the first symptom of running
// dry would have been sweeps and withdrawals silently failing.
//
// Two numbers, deliberately separate:
//
//   - The EXACT cost, in wei, read from the receipt. gas_used x
//     effective_gas_price is what the chain charged. It needs no price feed,
//     and it is the same number in a year.
//   - The LEDGER cost, in USD, which needs an ETH price. There is no ETH price
//     source configured today, so costs are recorded exactly and posted when
//     one exists. Converting at a guessed rate to make the books look complete
//     would write a number nothing can reproduce.
package gas

import (
	"context"
	"errors"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/utils/logger"
)

// Receipts is the part of an eth client this package needs. Narrow on purpose:
// a package that can only read receipts cannot accidentally send anything.
type Receipts interface {
	TransactionReceipt(ctx context.Context, txHash common.Hash) (*types.Receipt, error)
}

// Recorder writes what a transaction cost.
type Recorder struct {
	Pool    *pgxpool.Pool
	Client  Receipts
	ChainID int64
}

// Spend is one transaction's cost, as the chain reported it.
type Spend struct {
	ID       uuid.UUID
	TxHash   string
	GasUsed  uint64
	GasPrice *big.Int
	CostWei  *big.Int
	// Succeeded is whether the transaction the gas paid for actually did what
	// it was for. Gas is charged either way, and a reverted transaction we paid
	// for is precisely the thing worth being able to count.
	Succeeded bool
}

// ErrNotMined means the receipt is not available yet. Not a failure: the cost
// is unknowable until the transaction is in a block, and guessing it would
// record a number the chain never charged.
var ErrNotMined = errors.New("gas: transaction is not mined yet")

// Record reads the receipt and stores the exact cost.
//
// Idempotent on (chain_id, tx_hash): a receipt read twice -- by a retry, a
// worker restart, a reconciliation pass -- must not bill the platform twice.
// The second call returns the row the first one wrote.
func (r *Recorder) Record(
	ctx context.Context, refType string, refID *uuid.UUID, txHash string,
) (*Spend, error) {
	if refType == "" {
		return nil, fmt.Errorf("gas: a spend needs to say what it paid for")
	}
	if txHash == "" {
		return nil, fmt.Errorf("gas: a spend needs a transaction hash")
	}

	if existing, err := r.find(ctx, txHash); err == nil {
		return existing, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}

	receipt, err := r.Client.TransactionReceipt(ctx, common.HexToHash(txHash))
	if err != nil {
		return nil, fmt.Errorf("%w: %s", ErrNotMined, txHash)
	}
	if receipt.EffectiveGasPrice == nil || receipt.EffectiveGasPrice.Sign() <= 0 {
		// Nothing sensible can be recorded without a price, and recording zero
		// would understate the platform's costs forever.
		return nil, fmt.Errorf("gas: receipt for %s has no effective gas price", txHash)
	}

	cost := new(big.Int).Mul(new(big.Int).SetUint64(receipt.GasUsed), receipt.EffectiveGasPrice)
	spend := &Spend{
		TxHash:    txHash,
		GasUsed:   receipt.GasUsed,
		GasPrice:  receipt.EffectiveGasPrice,
		CostWei:   cost,
		Succeeded: receipt.Status == types.ReceiptStatusSuccessful,
	}

	err = r.Pool.QueryRow(ctx, `
		INSERT INTO gas_transactions
			(ref_type, ref_id, tx_hash, chain_id, gas_used, effective_gas_price,
			 cost_wei, succeeded)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (chain_id, tx_hash) DO UPDATE SET tx_hash = EXCLUDED.tx_hash
		RETURNING id`,
		refType, refID, txHash, r.ChainID,
		int64(receipt.GasUsed), receipt.EffectiveGasPrice.String(),
		cost.String(), spend.Succeeded,
	).Scan(&spend.ID)
	if err != nil {
		return nil, fmt.Errorf("gas: record spend for %s: %w", txHash, err)
	}

	if !spend.Succeeded {
		// Worth saying out loud. Paying for a transaction that reverted means
		// something upstream built a call the chain refused, and the cost is
		// real whether or not anybody notices the revert.
		logger.Errorf("gas: paid %s wei for REVERTED %s (%s)", cost, txHash, refType)
	}
	return spend, nil
}

func (r *Recorder) find(ctx context.Context, txHash string) (*Spend, error) {
	var (
		s       Spend
		price   string
		cost    string
		gasUsed int64
	)
	err := r.Pool.QueryRow(ctx, `
		SELECT id, tx_hash, gas_used, effective_gas_price::text, cost_wei::text, succeeded
		  FROM gas_transactions WHERE chain_id = $1 AND tx_hash = $2`,
		r.ChainID, txHash,
	).Scan(&s.ID, &s.TxHash, &gasUsed, &price, &cost, &s.Succeeded)
	if err != nil {
		return nil, err
	}
	s.GasUsed = uint64(gasUsed)
	s.GasPrice, _ = new(big.Int).SetString(price, 10)
	s.CostWei, _ = new(big.Int).SetString(cost, 10)
	return &s, nil
}

// Unposted returns spends recorded exactly but not yet priced into the ledger.
//
// They accumulate while no ETH price source is configured, and are posted in
// one pass when one appears. Nothing is lost by waiting: the wei figure is
// exact and the rate is applied to it later.
func (r *Recorder) Unposted(ctx context.Context, limit int) ([]Spend, error) {
	rows, err := r.Pool.Query(ctx, `
		SELECT id, tx_hash, gas_used, effective_gas_price::text, cost_wei::text, succeeded
		  FROM gas_transactions
		 WHERE ledger_tx_id IS NULL AND chain_id = $1
		 ORDER BY created_at
		 LIMIT $2`, r.ChainID, limit)
	if err != nil {
		return nil, fmt.Errorf("gas: read unposted spends: %w", err)
	}
	defer rows.Close()

	var out []Spend
	for rows.Next() {
		var (
			s       Spend
			price   string
			cost    string
			gasUsed int64
		)
		if err := rows.Scan(&s.ID, &s.TxHash, &gasUsed, &price, &cost, &s.Succeeded); err != nil {
			return nil, err
		}
		s.GasUsed = uint64(gasUsed)
		s.GasPrice, _ = new(big.Int).SetString(price, 10)
		s.CostWei, _ = new(big.Int).SetString(cost, 10)
		out = append(out, s)
	}
	return out, rows.Err()
}
