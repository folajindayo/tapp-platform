package v1

import (
	"context"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/shopspring/decimal"
	"github.com/spf13/viper"

	"github.com/usezoracle/tapp/api/config"
	"github.com/usezoracle/tapp/api/internal/chain/cdp"
	"github.com/usezoracle/tapp/api/internal/chain/offramp"
	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/internal/rates"
	paycrest "github.com/usezoracle/tapp/api/services/settlement"
	"github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/utils/logger"
)

var (
	settlerOnce sync.Once
	settler     *offramp.Settler
)

// SharedSettler builds the tap settler, or returns nil when this deployment
// cannot sell.
//
// Nil is a working state, not a broken one: taps still charge, and their
// settlement rows accumulate until a gateway is configured and a later tick
// drains them. What must never happen is a tap failing because the chain is
// unreachable -- the cardholder is at a till and their money has already
// moved.
func SharedSettler() *offramp.Settler {
	settlerOnce.Do(func() {
		gateway := viper.GetString("BASE_GATEWAY_CONTRACT")
		if gateway == "" {
			logger.Infof("offramp: no BASE_GATEWAY_CONTRACT -- taps will charge and " +
				"queue for settlement, but nothing will be sold")
			return
		}

		cdpCfg := config.CDPConfig()
		if !cdpCfg.Enabled() {
			logger.Errorf("offramp: a gateway is configured but CDP is not, so no " +
				"cardholder account can sign an order")
			return
		}
		chainID := config.OrderConfig().BaseChainID
		signer, err := cdp.New(cdp.Config{
			APIKeyID: cdpCfg.APIKeyID, APIKeySecret: cdpCfg.APIKeySecret,
			WalletSecret: cdpCfg.WalletSecret, PaymasterURL: cdpCfg.PaymasterURL,
			BaseURL: cdpCfg.BaseURL,
		}, chainID)
		if err != nil {
			logger.Errorf("offramp: cdp: %v", err)
			return
		}

		keys := paycrest.New(
			config.OrderConfig().SettlementAPIURL+"/v1",
			time.Duration(config.OrderConfig().SettlementPubkeyTTLSeconds)*time.Second,
		)

		settler = &offramp.Settler{
			Pool: storage.Pool,
			Orders: &offramp.Client{
				Sender:  signer,
				Keys:    keys,
				Gateway: common.HexToAddress(gateway),
				USDC:    common.HexToAddress(viper.GetString("BASE_USDC_CONTRACT")),
				// No on-chain sender fee.
				//
				// The platform's margin is already taken at the till, booked
				// to revenue in fiat when the tap posts. Charging it again
				// here would take the same cut twice -- once in the ledger and
				// once out of the tokens -- and the second one would come out
				// of what the merchant receives.
				//
				// A deployment that would rather earn on chain sets a
				// recipient and drops the card fee, but it must be one or the
				// other.
				SenderFeeBPS: 0,
				FeeRecipient: common.HexToAddress(viper.GetString("BASE_FEE_RECIPIENT")),
			},
		}
		logger.Infof("offramp: card taps settle through gateway %s on chain %d, "+
			"sold from each cardholder's own account", gateway, chainID)
	})
	return settler
}

// RecordTapSettlement adapts the settler to what tap.Service calls.
//
// The conversion from what the merchant is owed to what the cardholder must
// sell happens here, at the wiring layer, because it is the one place that
// knows both the card and the chain. The tap package does not learn what a
// token is, and the offramp package does not learn what a card is.
func RecordTapSettlement(s *offramp.Settler) func(
	context.Context, pgx.Tx, uuid.UUID, uuid.UUID, money.Amount,
) error {
	if s == nil {
		return nil
	}
	return func(
		ctx context.Context, tx pgx.Tx, tapID, cardholder uuid.UUID, amount money.Amount,
	) error {
		address, _, ok, err := Rail().Addresses.Current(ctx, tx, cardholder)
		if err != nil {
			return err
		}
		if !ok {
			// No deposit address means no USDC to sell. The tap has already
			// charged their ledger balance, so this is a genuine
			// inconsistency worth failing the tap over rather than charging
			// somebody with nothing to settle from.
			return errNoDepositAddress
		}

		sell, err := sellFor(ctx, amount)
		if err != nil {
			return err
		}
		return s.Record(ctx, tx, tapID, address, sell)
	}
}

// sellFor is how much USDC covers what the merchant is owed.
//
// Priced through the same quoter the tap itself used, so the amount sold and
// the amount charged were struck against one rate. The MID is used rather than
// a fresh quote: the spread was already taken when the cardholder's balance
// was converted, and taking it twice would charge them for one exchange at two
// prices.
func sellFor(ctx context.Context, owed money.Amount) (int64, error) {
	q := SharedQuoter()
	if q == nil {
		return 0, errNoRate
	}
	pair := rates.Pair{Base: money.USD, Quote: owed.Currency()}
	market, err := q.Engine.Market(ctx, pair)
	if err != nil {
		return 0, err
	}
	if market.Mid.Sign() <= 0 {
		return 0, errNoRate
	}

	// Whole fiat units, divided by the price of one token, scaled into USDC's
	// six decimals. Rounded UP: a sale that rounds down leaves the order
	// short of what the merchant is owed, and the provider fills what the
	// order says.
	fiat := decimal.NewFromInt(owed.Minor()).Div(decimal.NewFromInt(owed.Currency().Scale()))
	tokens := fiat.Div(market.Mid)
	micro := tokens.Mul(decimal.New(1, 6)).Ceil()
	if micro.Sign() <= 0 || !micro.BigInt().IsInt64() {
		return 0, errNoRate
	}
	return micro.BigInt().Int64(), nil
}

var (
	errNoDepositAddress = &settlementError{"the cardholder has no deposit address to settle from"}
	errNoRate           = &settlementError{"no rate to price the settlement"}
)

type settlementError struct{ msg string }

func (e *settlementError) Error() string { return "offramp: " + e.msg }
