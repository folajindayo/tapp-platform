package v1

import (
	"context"
	"fmt"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/spf13/viper"

	"github.com/usezoracle/tapp/api/internal/chain/base"
	"github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// BaseRail is everything the USDC rail needs, assembled once.
type BaseRail struct {
	Addresses *base.Addresses
	Deposits  *base.Deposits
	Watcher   *base.Watcher
	ChainID   int64
}

// NewBaseRail builds the deposit rail from configuration.
//
// Returns nil when it is not configured, and the deposit routes are then not
// registered. A deposit address that cannot be watched is an address people
// send money to that nobody credits, which is worse than a missing feature by
// a wide margin.
//
// The seed is REQUIRED when the rail is on, with no default. A fixed fallback
// would put every deployment's deposits under one key -- the same failure as
// the per-user keys this replaces, just concentrated.
func NewBaseRail(ctx context.Context) (*BaseRail, error) {
	rpcURL := viper.GetString("BASE_RPC_URL")
	usdc := viper.GetString("BASE_USDC_CONTRACT")
	seedHex := viper.GetString("BASE_DEPOSIT_SEED")

	if rpcURL == "" || usdc == "" || seedHex == "" {
		logger.Infof("base: not configured (needs BASE_RPC_URL, BASE_USDC_CONTRACT, " +
			"BASE_DEPOSIT_SEED) -- USDC deposits are not available")
		return nil, nil
	}
	if !common.IsHexAddress(usdc) {
		return nil, fmt.Errorf("BASE_USDC_CONTRACT is not an address: %q", usdc)
	}

	seed, err := base.ParseSeed(seedHex)
	if err != nil {
		return nil, fmt.Errorf("BASE_DEPOSIT_SEED: %w", err)
	}
	deriver, err := base.NewDeriver(seed)
	if err != nil {
		return nil, err
	}

	client, err := ethclient.DialContext(ctx, rpcURL)
	if err != nil {
		return nil, fmt.Errorf("base: dial %s: %w", rpcURL, err)
	}

	addresses := &base.Addresses{Pool: storage.Pool, Deriver: deriver}
	deposits := &base.Deposits{
		Pool: storage.Pool, Addresses: addresses,
		Confirmations: uint64(viper.GetInt("BASE_CONFIRMATIONS")),
	}

	return &BaseRail{
		Addresses: addresses,
		Deposits:  deposits,
		ChainID:   viper.GetInt64("BASE_CHAIN_ID"),
		Watcher: &base.Watcher{
			Pool: storage.Pool, Client: client,
			USDC:       common.HexToAddress(usdc),
			Deposits:   deposits,
			StartBlock: uint64(viper.GetInt64("BASE_START_BLOCK")),
		},
	}, nil
}

// PollInterval is how often the chain is read.
func BasePollInterval() time.Duration {
	viper.SetDefault("BASE_POLL_INTERVAL_SECONDS", 15)
	seconds := viper.GetInt("BASE_POLL_INTERVAL_SECONDS")
	if seconds < 2 {
		seconds = 2
	}
	return time.Duration(seconds) * time.Second
}

// rail is the process-wide Base rail, built once at startup.
//
// A package-level value rather than a parameter threaded through the router,
// because the watcher and the HTTP handler must share one: two rails would
// mean two ethclients and, worse, two watchers advancing the same position
// past each other's work.
var rail *BaseRail

// SetRail records the rail built at startup.
func SetRail(r *BaseRail) { rail = r }

// Rail returns it, or nil when the rail is not configured.
func Rail() *BaseRail { return rail }
