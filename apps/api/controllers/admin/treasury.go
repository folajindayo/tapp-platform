package admin

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"

	"github.com/usezoracle/tapp/api/config"
	"github.com/usezoracle/tapp/api/ent/paymentorder"
	"github.com/usezoracle/tapp/api/services"
	"github.com/usezoracle/tapp/api/services/baas/fintava"
	"github.com/usezoracle/tapp/api/storage"
	u "github.com/usezoracle/tapp/api/utils"
)

// TreasuryController gives operators a single consolidated view of where value
// sits: the Base aggregator wallet, the BaaS provider NGN float + LP
// sub-accounts, and a DB-side financial summary. Read-only (money movement
// lives under /funding/transfer).
type TreasuryController struct{}

// NewTreasuryController constructs the controller.
func NewTreasuryController() *TreasuryController { return &TreasuryController{} }

// GetOverview returns wallet balances + a financial summary.
//
//	GET /v1/admin/treasury/overview
func (c *TreasuryController) GetOverview(ctx *gin.Context) {
	conf := config.OrderConfig()

	wallets := gin.H{
		"base_aggregator": baseAggregatorBalances(ctx, conf),
		"safehaven":       baasBalances(ctx),
	}

	// DB-side value summary (token units, by order status group).
	settled := sumOrders(ctx, paymentorder.StatusSettled)
	refunded := sumOrders(ctx, paymentorder.StatusRefunded)
	inflight := sumOrders(ctx, paymentorder.StatusInitiated).Add(sumOrders(ctx, paymentorder.StatusPending))

	u.APIResponse(ctx, http.StatusOK, "success", "ok", gin.H{
		"wallets": wallets,
		"summary": gin.H{
			"settled_volume":  settled.String(),
			"refunded_total":  refunded.String(),
			"in_flight_value": inflight.String(),
		},
	})
}

// sumOrders sums payment-order amounts for a status (token units).
func sumOrders(ctx *gin.Context, status paymentorder.Status) decimal.Decimal {
	total := decimal.Zero
	rows, err := storage.Client.PaymentOrder.Query().Where(paymentorder.StatusEQ(status)).All(ctx)
	if err != nil {
		return total
	}
	for _, o := range rows {
		total = total.Add(o.Amount)
	}
	return total
}

// -----------------------------------------------------------------------------
// Platform float account (Route C) — the Fintava merchant wallet
// -----------------------------------------------------------------------------

// GetFloatAccount returns the platform's float virtual account (the
// Route C reload destination) plus the live NGN balance.
//
//	GET /v1/admin/treasury/float-account
func (c *TreasuryController) GetFloatAccount(ctx *gin.Context) {
	rail := services.CurrentFloatRail()
	switch rail {
	case "fintava":
		bc := config.BaaSConfig()
		if bc.FintavaAPIKey == "" {
			u.APIResponse(ctx, http.StatusServiceUnavailable, "error", "Fintava not configured", nil)
			return
		}
		fc := fintava.New(bc.FintavaAPIKey, bc.FintavaWebhookSecret, bc.FintavaBaseURL)
		mw, err := fc.MerchantBalance(ctx)
		if err != nil {
			u.APIResponse(ctx, http.StatusBadGateway, "error",
				"Could not read the Fintava merchant wallet", gin.H{"detail": err.Error()})
			return
		}
		// The Fintava merchant wallet IS the float — no provisioning
		// step; loading it = a bank transfer to its own NUBAN.
		u.APIResponse(ctx, http.StatusOK, "success", "ok", gin.H{
			"rail":                      "fintava",
			"provisioned":               mw.AccountNumber != "",
			"account_number":            mw.AccountNumber,
			"account_name":              mw.AccountName,
			"bank_name":                 "Fintava merchant wallet",
			"status":                    "active",
			"float_balance":             mw.Available().String(),
			"pending_balance":           mw.Booked().Sub(mw.Available()).String(),
			"fintava_float_institution": services.FintavaFloatInstitution(),
		})
		return
	default:
		// Only Fintava remains. A float rail we do not recognise is a
		// configuration mistake, not a state to render half of.
		u.APIResponse(ctx, http.StatusServiceUnavailable, "error",
			"Float rail "+rail+" is not available", nil)
	}
}
