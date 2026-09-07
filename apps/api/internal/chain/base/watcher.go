package base

import (
	"context"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/core/types"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/jackc/pgx/v5/pgxpool"
)

// transferTopic is keccak256("Transfer(address,address,uint256)"), the first
// topic of every ERC-20 transfer log.
var transferTopic = common.HexToHash(
	"0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")

// MaxBlockSpan bounds one query.
//
// Providers cap how many blocks a log filter may cover and answer with an
// error rather than a partial result, so a watcher that has been down for a
// day has to catch up in steps. Without this it would ask for a hundred
// thousand blocks, be refused, and never make progress.
const MaxBlockSpan = 2_000

// Watcher reads USDC transfers into deposit addresses.
type Watcher struct {
	Pool     *pgxpool.Pool
	Client   *ethclient.Client
	USDC     common.Address
	Deposits *Deposits

	// StartBlock is where to begin when there is no recorded position. Zero
	// would mean scanning from genesis, which no provider will serve.
	StartBlock uint64
}

// Poll reads any new blocks and records the transfers it finds.
//
// Two phases, deliberately separate: observing a transfer and crediting it are
// different decisions, and a transfer is only credited once it has enough
// blocks on top of it. Base is an L2 that can reorg, and a credited deposit
// that later never happened is money already spent.
func (w *Watcher) Poll(ctx context.Context) (found, credited int, err error) {
	head, err := w.Client.BlockNumber(ctx)
	if err != nil {
		return 0, 0, fmt.Errorf("base: read head: %w", err)
	}

	from, err := w.position(ctx)
	if err != nil {
		return 0, 0, err
	}
	if from == 0 {
		from = w.StartBlock
	}
	if from > head {
		// Ahead of the chain. Either the provider is serving a stale head or
		// this position came from a different network; neither is something to
		// scan through.
		return 0, 0, nil
	}

	to := head
	if to-from > MaxBlockSpan {
		to = from + MaxBlockSpan
	}

	logs, err := w.Client.FilterLogs(ctx, ethereum.FilterQuery{
		FromBlock: new(big.Int).SetUint64(from),
		ToBlock:   new(big.Int).SetUint64(to),
		Addresses: []common.Address{w.USDC},
		Topics:    [][]common.Hash{{transferTopic}},
	})
	if err != nil {
		return 0, 0, fmt.Errorf("base: read logs %d-%d: %w", from, to, err)
	}

	for _, entry := range logs {
		transfer, ok := decodeTransfer(entry)
		if !ok {
			continue
		}
		if err := w.Deposits.Record(ctx, transfer); err != nil {
			// Stop rather than skip. Advancing the position past a transfer
			// that failed to record would lose it permanently.
			return found, 0, err
		}
		found++
	}

	// The position advances only after every log in the range is recorded.
	if err := w.advance(ctx, to+1); err != nil {
		return found, 0, err
	}

	credited, err = w.Deposits.CreditConfirmed(ctx, head)
	return found, credited, err
}

// decodeTransfer reads an ERC-20 Transfer log.
//
// Amounts beyond int64 are skipped rather than truncated. A USDC transfer of
// more than ninety trillion dollars is not a deposit, and silently wrapping it
// into a small positive number would be the worst possible handling.
func decodeTransfer(entry types.Log) (Transfer, bool) {
	if len(entry.Topics) != 3 || len(entry.Data) < 32 {
		return Transfer{}, false
	}
	amount := new(big.Int).SetBytes(entry.Data[:32])
	if !amount.IsInt64() || amount.Sign() <= 0 {
		return Transfer{}, false
	}

	return Transfer{
		TxHash:      strings.ToLower(entry.TxHash.Hex()),
		LogIndex:    uint64(entry.Index),
		From:        strings.ToLower(common.BytesToAddress(entry.Topics[1].Bytes()).Hex()),
		To:          strings.ToLower(common.BytesToAddress(entry.Topics[2].Bytes()).Hex()),
		AmountMicro: amount.Int64(),
		BlockNumber: entry.BlockNumber,
	}, true
}

func (w *Watcher) position(ctx context.Context) (uint64, error) {
	var last int64
	if err := w.Pool.QueryRow(ctx,
		`SELECT last_block FROM base_watcher_state WHERE id = true`).Scan(&last); err != nil {
		return 0, fmt.Errorf("base: read watcher position: %w", err)
	}
	return uint64(last), nil
}

func (w *Watcher) advance(ctx context.Context, to uint64) error {
	_, err := w.Pool.Exec(ctx,
		`UPDATE base_watcher_state SET last_block = $1, updated_at = now() WHERE id = true`, to)
	if err != nil {
		return fmt.Errorf("base: advance watcher position: %w", err)
	}
	return nil
}

// Run polls until the context ends.
func (w *Watcher) Run(ctx context.Context, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			found, credited, err := w.Poll(ctx)
			if err != nil {
				slog.Error("base: poll failed", "err", err)
				continue
			}
			if found > 0 || credited > 0 {
				slog.Info("base: deposits", "seen", found, "credited", credited)
			}
		}
	}
}
