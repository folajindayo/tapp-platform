// Watching what on-chain work costs, and whether we can still pay for it.

package tasks

import (
	"context"
	"errors"
	"time"

	apiv1 "github.com/usezoracle/tapp/api/internal/api/v1"
	"github.com/usezoracle/tapp/api/internal/chain/gas"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// WatchGasBalance checks that the wallet paying for on-chain work still can.
//
// This is a restoration, not a new job: the Base gas-balance alert was removed
// alongside the chain it originally served. Without it, running out of gas
// surfaces as sweeps and withdrawals quietly failing, with nothing saying why.
//
// It only reports. Automatic top-ups need a funded source and a rate limit --
// gas.Wallet has the guard, but choosing to move real money on a timer is an
// operator's decision, not a default.
func WatchGasBalance() {
	rail := apiv1.Rail()
	if rail == nil || rail.GasWallet == nil {
		return // no chain configured; nothing spends gas
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	status, err := rail.GasWallet.Check(ctx)
	if errors.Is(err, gas.ErrNoWallet) {
		return // nothing configured to pay for anything
	}
	if err != nil {
		logger.Errorf("gas: balance check failed: %v", err)
		return
	}
	if status.Healthy {
		return // Check() already logs loudly when it is not
	}
}

// PostGasCosts prices recorded gas into the ledger.
//
// Costs are recorded in wei the moment a transaction is mined, which needs no
// price. Turning them into ledger entries needs an ETH price, and there is no
// source for one yet -- so this drains a backlog rather than doing nothing:
// configure a price source and the whole history posts on the next pass.
func PostGasCosts() {
	rail := apiv1.Rail()
	if rail == nil || rail.Gas == nil {
		return
	}
	poster := apiv1.GasPoster()
	if poster == nil {
		return // no ETH price source; costs stay recorded and unposted
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	posted, err := poster.PostPending(ctx, 200)
	switch {
	case errors.Is(err, gas.ErrNoETHPrice):
		return // expected while unpriced; the wei figures are already exact
	case err != nil:
		logger.Errorf("gas: posting costs to the ledger: %v", err)
	case posted > 0:
		logger.Infof("gas: posted %d recorded costs to the ledger", posted)
	}
}
