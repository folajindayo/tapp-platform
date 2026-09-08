package gas

import (
	"context"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/utils/logger"
)

// Balances is the part of an eth client the wallet monitor needs.
type Balances interface {
	BalanceAt(ctx context.Context, account common.Address, block *big.Int) (*big.Int, error)
}

// Wallet watches the native balance that pays for everything on chain.
//
// One wallet, because tapp has one: the treasury signs sweeps and withdrawals
// and pays their gas. A separate "gas wallet" would reduce blast radius only
// if it held the gas for a DIFFERENT signer, and here the signer that needs
// gas is the one holding the funds. Splitting them would add a key to manage
// and protect nothing.
type Wallet struct {
	Pool    *pgxpool.Pool
	Client  Balances
	Address common.Address
	ChainID int64

	// LowWei is the balance below which the wallet is reported unhealthy.
	// Reported, not auto-topped-up: see Refill.
	LowWei *big.Int

	// MaxRefillsPerDay bounds automated top-ups. Replenishment with no rate
	// limit is a drain loop -- force spend, trigger refill, repeat -- and the
	// only thing that stops it otherwise is somebody reading the bill.
	MaxRefillsPerDay int
}

// ErrNoWallet means no gas wallet is configured.
//
// Its own error because the alternative is worse than useless: with no
// treasury key the address is the zero address, which holds every ETH ever
// burned. Reporting that as a healthy balance would say the platform can pay
// for on-chain work when it can pay for nothing at all.
var ErrNoWallet = errors.New("gas: no gas wallet configured")

// ErrRefillRateExceeded means the wallet has been topped up too many times in
// the window. Deliberately an error rather than a silent skip: a wallet
// hitting this is either being drained or is badly sized, and both need a
// person.
var ErrRefillRateExceeded = errors.New("gas: refill rate exceeded for this wallet")

// Status is what the wallet holds and whether that is enough.
type Status struct {
	Address      string   `json:"address"`
	ChainID      int64    `json:"chain_id"`
	BalanceWei   *big.Int `json:"-"`
	Balance      string   `json:"balance_wei"`
	LowWater     string   `json:"low_water_wei"`
	Healthy      bool     `json:"healthy"`
	RefillsToday int      `json:"refills_today"`
}

// Check reads the balance and reports whether it clears the low-water mark.
func (w *Wallet) Check(ctx context.Context) (*Status, error) {
	if w.Address == (common.Address{}) {
		return nil, ErrNoWallet
	}
	balance, err := w.Client.BalanceAt(ctx, w.Address, nil)
	if err != nil {
		return nil, fmt.Errorf("gas: read native balance of %s: %w", w.Address, err)
	}
	refills, err := w.refillsSince(ctx, time.Now().Add(-24*time.Hour))
	if err != nil {
		return nil, err
	}

	low := w.LowWei
	if low == nil {
		low = big.NewInt(0)
	}
	st := &Status{
		Address:      w.Address.Hex(),
		ChainID:      w.ChainID,
		BalanceWei:   balance,
		Balance:      balance.String(),
		LowWater:     low.String(),
		Healthy:      balance.Cmp(low) >= 0,
		RefillsToday: refills,
	}
	if !st.Healthy {
		// The failure this prevents is silent: with no gas, sweeps and
		// withdrawals stop working and nothing else says why.
		logger.Errorf("gas: %s holds %s wei, below the %s floor -- on-chain work will start failing",
			w.Address, balance, low)
	}
	return st, nil
}

// RecordRefill notes a top-up, refusing once the daily rate is used up.
//
// Recording is what makes the rate limit real: the guard counts rows, so a
// refill that is not written down is a refill that does not count against the
// next one.
func (w *Wallet) RecordRefill(
	ctx context.Context, amountWei *big.Int, txHash, reason string,
) error {
	if amountWei == nil || amountWei.Sign() <= 0 {
		return fmt.Errorf("gas: a refill must be a positive amount")
	}
	if reason == "" {
		return fmt.Errorf("gas: a refill needs a reason")
	}

	refills, err := w.refillsSince(ctx, time.Now().Add(-24*time.Hour))
	if err != nil {
		return err
	}
	if w.MaxRefillsPerDay > 0 && refills >= w.MaxRefillsPerDay {
		logger.Errorf("gas: refusing to refill %s -- %d refills in 24h, limit %d",
			w.Address, refills, w.MaxRefillsPerDay)
		return ErrRefillRateExceeded
	}

	_, err = w.Pool.Exec(ctx, `
		INSERT INTO gas_wallet_refills (wallet, chain_id, amount_wei, tx_hash, reason)
		VALUES ($1, $2, $3, $4, $5)`,
		w.Address.Hex(), w.ChainID, amountWei.String(), nullable(txHash), reason)
	if err != nil {
		return fmt.Errorf("gas: record refill: %w", err)
	}
	return nil
}

func (w *Wallet) refillsSince(ctx context.Context, since time.Time) (int, error) {
	var n int
	err := w.Pool.QueryRow(ctx, `
		SELECT count(*) FROM gas_wallet_refills
		 WHERE wallet = $1 AND chain_id = $2 AND created_at >= $3`,
		w.Address.Hex(), w.ChainID, since).Scan(&n)
	if err != nil {
		return 0, fmt.Errorf("gas: count refills: %w", err)
	}
	return n, nil
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
