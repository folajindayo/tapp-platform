package admin

import (
	"context"
	"math/big"
	"net/http"

	"github.com/ethereum/go-ethereum/common"
	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"

	"github.com/usezoracle/tapp/api/config"
	"github.com/usezoracle/tapp/api/services/baas"
	"github.com/usezoracle/tapp/api/services/evm"
	u "github.com/usezoracle/tapp/api/utils"
)

// FundingController exposes the operator funding dashboard: balances of every
// wallet/account the platform funds (the Base aggregator and the BaaS provider
// float + LP sub-accounts). Each source is read independently and reports its
// own failure, so one outage does not blank the whole view -- and, importantly,
// an unreadable balance is never rendered as zero. Read-only.
type FundingController struct{}

// NewFundingController constructs the controller.
func NewFundingController() *FundingController { return &FundingController{} }

// GetBalances returns all funding balances in one view.
//
//	GET /v1/admin/funding/balances
func (c *FundingController) GetBalances(ctx *gin.Context) {
	conf := config.OrderConfig()

	u.APIResponse(ctx, http.StatusOK, "success", "ok", gin.H{
		"base_aggregator": baseAggregatorBalances(ctx, conf),
		"safehaven":       baasBalances(ctx),
	})
}

// baseAggregatorBalances reads native ETH + USDC for the Base hot wallet.
func baseAggregatorBalances(ctx context.Context, conf *config.OrderConfiguration) gin.H {
	if conf.BaseSignerKey == "" || conf.BaseAggregatorAddress == "" {
		return gin.H{"available": false, "reason": "base aggregator not configured"}
	}
	client, err := evm.NewClient(ctx, evm.ChainConfig{
		Name:         "base",
		ChainID:      conf.BaseChainID,
		RPCURL:       conf.BaseRpcURL,
		GatewayAddr:  common.HexToAddress(conf.BaseGatewayContract),
		USDCAddr:     common.HexToAddress(conf.BaseUSDCContract),
		USDCDecimals: uint8(conf.BaseUSDCDecimals),
		SignerHex:    conf.BaseSignerKey,
	})
	if err != nil {
		return gin.H{"available": false, "reason": err.Error()}
	}

	out := gin.H{"available": true, "address": conf.BaseAggregatorAddress, "chain_id": conf.BaseChainID}

	if wei, err := client.BalanceNative(ctx); err == nil {
		out["eth"] = formatUnits(wei, 18)
		// Flag low native gas against the configured ops-alert threshold.
		if thr, ok := new(big.Int).SetString(conf.BaseNativeLowThresholdWei, 10); ok && wei.Cmp(thr) < 0 {
			out["low_eth"] = true
		}
	} else {
		out["eth_error"] = err.Error()
	}

	if usdc, err := client.USDC().BalanceOf(ctx, common.HexToAddress(conf.BaseAggregatorAddress)); err == nil {
		out["usdc"] = formatUnits(usdc, conf.BaseUSDCDecimals)
	} else {
		out["usdc_error"] = err.Error()
	}
	return out
}

// baasBalances lists the main float + LP sub-accounts (NGN) via the BaaS rail.
func baasBalances(ctx context.Context) gin.H {
	client := baas.Default()
	if client == nil {
		return gin.H{"available": false, "reason": "baas rail not configured"}
	}

	out := gin.H{"available": true, "provider": client.Name()}

	mainTotal := decimal.Zero
	if mains, err := client.ListAccounts(ctx, false); err == nil {
		accs := make([]gin.H, 0, len(mains))
		for _, a := range mains {
			mainTotal = mainTotal.Add(a.Balance)
			accs = append(accs, gin.H{"account": a.AccountNumber, "name": a.AccountName, "balance": a.Balance.String(), "status": a.Status})
		}
		out["main_accounts"] = accs
		out["main_total_ngn"] = mainTotal.String()
	} else {
		out["main_error"] = err.Error()
	}

	subTotal := decimal.Zero
	if subs, err := client.ListAccounts(ctx, true); err == nil {
		accs := make([]gin.H, 0, len(subs))
		for _, a := range subs {
			subTotal = subTotal.Add(a.Balance)
			accs = append(accs, gin.H{"account": a.AccountNumber, "name": a.AccountName, "balance": a.Balance.String(), "status": a.Status})
		}
		out["lp_subaccounts"] = accs
		out["lp_total_ngn"] = subTotal.String()
		out["lp_count"] = len(subs)
	} else {
		out["lp_error"] = err.Error()
	}
	return out
}

// formatUnits renders a base-unit integer as a human decimal string.
func formatUnits(amount *big.Int, decimals int) string {
	if amount == nil {
		return "0"
	}
	return decimal.NewFromBigInt(amount, int32(-decimals)).String()
}
