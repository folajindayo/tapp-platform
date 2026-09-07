package base

import (
	"context"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// MinSweepMicro is the smallest balance worth moving.
//
// A sweep costs gas. Below this the transfer costs more than it recovers, so
// the funds are left to accumulate rather than burned moving them. One dollar.
const MinSweepMicro = 1_000_000

// Sweeper moves credited deposits from derived addresses into the treasury.
//
// Pooling is the point: one key protects everything, rather than one key per
// account. Until a deposit is swept it sits at an address whose key must be
// re-derived to touch, which is fine but scattered -- and a withdrawal cannot
// be paid from money spread across a thousand addresses.
type Sweeper struct {
	Pool    *pgxpool.Pool
	Chain   *Chain
	Deriver *Deriver
}

// Sweep moves every credited deposit that has not been moved yet.
//
// It sweeps the address's WHOLE balance rather than the deposit amount. An
// address may have received several deposits, or dust from somewhere; moving
// the balance leaves nothing behind and means a later sweep has nothing to do,
// whereas moving exact amounts would leave a long tail of remainders that each
// cost gas to collect.
func (s *Sweeper) Sweep(ctx context.Context) (swept int, err error) {
	if !s.Chain.CanSend() {
		// No treasury to sweep into. Not an error: a read-only deployment
		// still credits deposits correctly, it just leaves them where they
		// landed.
		return 0, nil
	}

	rows, err := s.Pool.Query(ctx, `
		SELECT DISTINCT d.id, d.user_id, a.index, a.address
		  FROM base_deposits d
		  JOIN base_deposit_addresses a ON a.user_id = d.user_id
		 WHERE d.state = 'credited'
		 LIMIT 50`)
	if err != nil {
		return 0, fmt.Errorf("base: find deposits to sweep: %w", err)
	}

	type pending struct {
		depositID uuid.UUID
		userID    uuid.UUID
		index     int64
		address   string
	}
	var due []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.depositID, &p.userID, &p.index, &p.address); err != nil {
			rows.Close()
			return 0, err
		}
		due = append(due, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}

	for _, p := range due {
		if err := s.sweepOne(ctx, p.depositID, uint32(p.index), p.address); err != nil {
			slog.Error("base: sweep failed", "deposit", p.depositID, "err", err)
			continue
		}
		swept++
	}
	return swept, nil
}

func (s *Sweeper) sweepOne(ctx context.Context, depositID uuid.UUID, index uint32, address string) error {
	derived, err := s.Deriver.Address(index)
	if err != nil {
		return err
	}
	// The stored address must be what the seed derives. If it is not, the seed
	// has changed: the key would not control the address, the send would fail,
	// and recording the attempt as a sweep would lose the deposit from view.
	if !strings.EqualFold(address, derived.Hex()) {
		return fmt.Errorf("%w: index %d is stored as %s but derives %s",
			ErrAddressMismatch, index, address, derived.Hex())
	}

	balance, err := s.Chain.USDCBalance(ctx, derived)
	if err != nil {
		return err
	}
	if balance.Cmp(big.NewInt(MinSweepMicro)) < 0 {
		// Not worth the gas. Marked swept so it is not retried every pass;
		// the funds stay at the address and are picked up by a later, larger
		// sweep of the same address.
		_, err := s.Pool.Exec(ctx, `
			UPDATE base_deposits SET state = 'swept', swept_at = now(),
			       last_error = 'below the sweep threshold; funds remain at the deposit address'
			 WHERE id = $1 AND state = 'credited'`, depositID)
		return err
	}

	key, err := s.Deriver.PrivateKey(index)
	if err != nil {
		return err
	}

	txHash, err := s.Chain.SendUSDC(ctx, key, s.Chain.Treasury, balance)
	if err != nil {
		// Recorded, not marked failed: a sweep that could not be submitted is
		// retried, because the money is still at an address we control and
		// nothing about the deposit's credit is in doubt.
		_, e := s.Pool.Exec(ctx,
			`UPDATE base_deposits SET last_error = $2 WHERE id = $1`, depositID, err.Error())
		if e != nil {
			return e
		}
		return err
	}

	_, err = s.Pool.Exec(ctx, `
		UPDATE base_deposits SET state = 'swept', sweep_tx_hash = $2, swept_at = now(),
		       last_error = NULL
		 WHERE id = $1 AND state = 'credited'`, depositID, txHash)
	return err
}

// Run sweeps on a timer.
func (s *Sweeper) Run(ctx context.Context, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			swept, err := s.Sweep(ctx)
			if err != nil {
				slog.Error("base: sweep tick failed", "err", err)
				continue
			}
			if swept > 0 {
				slog.Info("base: swept deposits into treasury", "count", swept)
			}
		}
	}
}
