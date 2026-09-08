// What on-chain work is costing, and whether the wallet that pays for it is
// healthy.
//
//	GET /v1/admin/gas   operator view: balance, floor, spend, unposted backlog

package v1

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"

	"github.com/usezoracle/tapp/api/internal/chain/gas"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// GasHandler reports the health of the gas subsystem.
type GasHandler struct{}

type gasStatusResponse struct {
	Wallet   any    `json:"wallet"`
	Spend    any    `json:"spend"`
	Unposted int    `json:"unposted"`
	Note     string `json:"note,omitempty"`
}

// Status answers the two questions an operator actually has: can we still pay
// for on-chain work, and what has it cost.
func (h *GasHandler) Status(ctx *gin.Context) {
	r := Rail()
	if r == nil || r.Gas == nil {
		u.APIResponse(ctx, http.StatusServiceUnavailable, "error",
			"The chain rail is not configured, so nothing is spending gas.", nil)
		return
	}

	wallet, err := r.GasWallet.Check(ctx.Request.Context())
	if errors.Is(err, gas.ErrNoWallet) {
		// Say so rather than reporting the zero address. Nothing can be paid
		// for, which is a different state from a wallet that is merely low.
		u.APIResponse(ctx, http.StatusOK, "success", "Gas status", gasStatusResponse{
			Note: "No gas wallet is configured (BASE_TREASURY_KEY is unset), " +
				"so no on-chain work can be paid for.",
		})
		return
	}
	if err != nil {
		logger.Errorf("gas: status: %v", err)
		u.APIResponse(ctx, http.StatusBadGateway, "error",
			"Could not read the gas wallet balance", nil)
		return
	}

	spend, err := gasSpendSummary(ctx.Request.Context())
	if err != nil {
		logger.Errorf("gas: spend summary: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Could not read gas spend", nil)
		return
	}

	unposted, err := r.Gas.Unposted(ctx.Request.Context(), 1000)
	if err != nil {
		logger.Errorf("gas: unposted: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Could not read unposted gas costs", nil)
		return
	}

	out := gasStatusResponse{Wallet: wallet, Spend: spend, Unposted: len(unposted)}
	if len(unposted) > 0 {
		// Said plainly so a backlog is not mistaken for a fault. The wei
		// figures are exact and lose nothing by waiting for a price.
		out.Note = "Costs are recorded exactly in wei. They are posted to the " +
			"ledger once an ETH price source is configured."
	}
	u.APIResponse(ctx, http.StatusOK, "success", "Gas status", out)
}
