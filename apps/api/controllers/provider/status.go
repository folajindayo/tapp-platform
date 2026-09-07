// What a provider sees about themselves: the rate they are quoted, their
// volume, their balance and their node.
//
//	GET /v1/provider/rates/:token/:fiat
//	GET /v1/provider/stats
//	GET /v1/provider/balance
//	GET /v1/provider/node-info

package provider

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	fastshot "github.com/opus-domini/fast-shot"
	"github.com/shopspring/decimal"
	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/ent/fiatcurrency"
	"github.com/usezoracle/tapp/api/ent/lockpaymentorder"
	"github.com/usezoracle/tapp/api/ent/providerprofile"
	"github.com/usezoracle/tapp/api/ent/token"
	"github.com/usezoracle/tapp/api/services/baas"
	"github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/types"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

func (ctrl *ProviderController) GetMarketRate(ctx *gin.Context) {
	// Parse path parameters
	tokenExists, err := storage.Client.Token.
		Query().
		Where(
			token.SymbolEQ(strings.ToUpper(ctx.Param("token"))),
			token.IsEnabledEQ(true),
		).
		Exist(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to get market rate", nil)
		return
	}

	if !tokenExists {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Token is not supported", nil)
		return
	}
	// TODO: use token to get the token rate for that currency based on the USD/Token Ratio USD/USDC can be 1.005 and USD/USD can be 0.9995

	currency, err := storage.Client.FiatCurrency.
		Query().
		Where(
			fiatcurrency.IsEnabledEQ(true),
			fiatcurrency.CodeEQ(strings.ToUpper(ctx.Param("fiat"))),
		).
		Only(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Fiat currency is not supported", nil)
		return
	}

	deviation := currency.MarketRate.Mul(orderConf.PercentDeviationFromMarketRate.Div(decimal.NewFromInt(100)))

	u.APIResponse(ctx, http.StatusOK, "success", "Rate fetched successfully", &types.MarketRateResponse{
		MarketRate:  currency.MarketRate,
		MinimumRate: currency.MarketRate.Sub(deviation),
		MaximumRate: currency.MarketRate.Add(deviation),
	})
}

// Stats controller fetches provider stats
func (ctrl *ProviderController) Stats(ctx *gin.Context) {
	// Get provider profile from the context
	providerCtx, ok := ctx.Get("provider")
	if !ok {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Invalid API key or token", nil)
		return
	}
	provider := providerCtx.(*ent.ProviderProfile)

	// Fetch provider stats
	query := storage.Client.LockPaymentOrder.
		Query().
		Where(lockpaymentorder.HasProviderWith(providerprofile.IDEQ(provider.ID)), lockpaymentorder.StatusEQ(lockpaymentorder.StatusSettled))

	var v []struct {
		Sum decimal.Decimal
	}

	err := query.
		Aggregate(
			ent.Sum(lockpaymentorder.FieldAmount),
		).
		Scan(ctx, &v)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch provider stats", nil)
		return
	}

	settledOrders, err := query.
		All(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch provider stats", nil)
		return
	}

	var totalFiatVolume decimal.Decimal
	for _, order := range settledOrders {
		totalFiatVolume = totalFiatVolume.Add(order.Amount.Mul(order.Rate).RoundBank(0))
	}

	count, err := storage.Client.LockPaymentOrder.
		Query().
		Where(lockpaymentorder.HasProviderWith(providerprofile.IDEQ(provider.ID))).
		Count(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch provider stats", nil)
		return
	}

	// Per-status breakdown across all of the provider's orders.
	statusBreakdown := map[string]int{}
	for _, st := range []lockpaymentorder.Status{
		lockpaymentorder.StatusPending, lockpaymentorder.StatusProcessing,
		lockpaymentorder.StatusFulfilled, lockpaymentorder.StatusValidated,
		lockpaymentorder.StatusSettled, lockpaymentorder.StatusCancelled,
		lockpaymentorder.StatusRefunded,
	} {
		c, err := storage.Client.LockPaymentOrder.Query().
			Where(
				lockpaymentorder.HasProviderWith(providerprofile.IDEQ(provider.ID)),
				lockpaymentorder.StatusEQ(st),
			).Count(ctx)
		if err != nil {
			logger.Errorf("error: %v", err)
			u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch provider stats", nil)
			return
		}
		statusBreakdown[string(st)] = c
	}

	// Fiat payout breakdown across settled orders — surfaces payouts needing attention.
	payoutBreakdown := map[string]int{}
	for _, ps := range []lockpaymentorder.FiatPayoutStatus{
		lockpaymentorder.FiatPayoutStatusNone, lockpaymentorder.FiatPayoutStatusPending,
		lockpaymentorder.FiatPayoutStatusSuccess, lockpaymentorder.FiatPayoutStatusFailed,
	} {
		c, err := storage.Client.LockPaymentOrder.Query().
			Where(
				lockpaymentorder.HasProviderWith(providerprofile.IDEQ(provider.ID)),
				lockpaymentorder.FiatPayoutStatusEQ(ps),
			).Count(ctx)
		if err != nil {
			logger.Errorf("error: %v", err)
			u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch provider stats", nil)
			return
		}
		payoutBreakdown[string(ps)] = c
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Provider stats fetched successfully", &types.ProviderStatsResponse{
		TotalOrders:         count,
		TotalFiatVolume:     totalFiatVolume,
		TotalCryptoVolume:   v[0].Sum,
		StatusBreakdown:     statusBreakdown,
		FiatPayoutBreakdown: payoutBreakdown,
	})
}

// GetBalance returns the LP's delegated Naira float (from the BaaS rail) and
// USDC settlement positions — the operational heart of the LP dashboard. The
// Naira side degrades gracefully: if the rail is unconfigured or the account
// id isn't set yet, it returns available=false with a reason rather than failing.
func (ctrl *ProviderController) GetBalance(ctx *gin.Context) {
	providerCtx, ok := ctx.Get("provider")
	if !ok {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Invalid API key or token", nil)
		return
	}
	providerID := providerCtx.(*ent.ProviderProfile).ID

	// Reload with order tokens (settlement wallets) — the context profile may
	// not have edges loaded.
	provider, err := storage.Client.ProviderProfile.
		Query().
		Where(providerprofile.IDEQ(providerID)).
		WithOrderTokens().
		Only(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch balance", nil)
		return
	}

	resp := types.ProviderBalanceResponse{}

	// Naira float from the BaaS rail.
	resp.Naira.AccountNumber = provider.SafehavenAccountNumber
	switch {
	case baas.Default() == nil:
		resp.Naira.Reason = "baas rail not configured"
	case provider.SafehavenAccountID == "":
		resp.Naira.Reason = "deposit account not provisioned"
	default:
		if acct, err := baas.Default().GetAccount(ctx, provider.SafehavenAccountID); err == nil {
			resp.Naira.Available = true
			resp.Naira.AccountNumber = acct.AccountNumber
			resp.Naira.AccountName = acct.AccountName
			resp.Naira.Balance = acct.Balance
			resp.Naira.LedgerBalance = acct.LedgerBalance
			resp.Naira.Status = acct.Status
		} else {
			logger.Errorf("GetBalance %s: rail account: %v", provider.ID, err)
			resp.Naira.Reason = "rail account read failed"
		}
	}

	// USDC settlement positions: total settled + configured wallets.
	var settled []struct{ Sum decimal.Decimal }
	if err := storage.Client.LockPaymentOrder.Query().
		Where(
			lockpaymentorder.HasProviderWith(providerprofile.IDEQ(provider.ID)),
			lockpaymentorder.StatusEQ(lockpaymentorder.StatusSettled),
		).
		Aggregate(ent.Sum(lockpaymentorder.FieldAmount)).
		Scan(ctx, &settled); err == nil && len(settled) > 0 {
		resp.USDC.TotalSettled = settled[0].Sum
	}
	for _, t := range provider.Edges.OrderTokens {
		for _, a := range t.Addresses {
			resp.USDC.Wallets = append(resp.USDC.Wallets, types.SettlementWallet{
				Token:   t.Symbol,
				Network: a.Network,
				Address: a.Address,
			})
		}
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Balance fetched successfully", resp)
}

// NodeInfo controller fetches the provision node info
func (ctrl *ProviderController) NodeInfo(ctx *gin.Context) {
	// Get provider profile from the context
	providerCtx, ok := ctx.Get("provider")
	if !ok {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Invalid API key or token", nil)
		return
	}

	provider, err := storage.Client.ProviderProfile.
		Query().
		Where(providerprofile.IDEQ(providerCtx.(*ent.ProviderProfile).ID)).
		WithAPIKey().
		WithCurrency().
		Only(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch node info", nil)
		return
	}

	res, err := fastshot.NewClient(provider.HostIdentifier).
		Config().SetTimeout(30 * time.Second).
		Build().GET("/health").
		Send()
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusServiceUnavailable, "error", "Failed to fetch node info", nil)
		return
	}

	data, err := u.ParseJSONResponse(res.RawResponse)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusServiceUnavailable, "error", "Failed to fetch node info", nil)
		return
	}

	currency := data["data"].(map[string]interface{})["currency"].(string)
	if currency != provider.Edges.Currency.Code {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusServiceUnavailable, "error", "Failed to fetch node info", nil)
		return
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Node info fetched successfully", data)
}

// GetLockPaymentOrderByID controller fetches a payment order by ID
