package v1

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/internal/chain/base"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// DepositHandler serves the USDC deposit address.
type DepositHandler struct {
	Addresses *base.Addresses
	ChainID   int64
	Token     string
	User      func(*gin.Context) (uuid.UUID, bool)
}

type depositAddressResponse struct {
	Address string `json:"address"`
	Network string `json:"network"`
	ChainID int64  `json:"chain_id"`
	Token   string `json:"token"`
	// Warning is shown to the person, because sending the wrong asset or using
	// the wrong network is the most common way people lose money at this step
	// and it is not recoverable.
	Warning string `json:"warning"`
}

// Address returns the caller's deposit address, allocating one on first use.
func (h *DepositHandler) Address(ctx *gin.Context) {
	user, ok := h.User(ctx)
	if !ok {
		return
	}

	address, err := h.Addresses.For(ctx.Request.Context(), user)
	if err != nil {
		if errors.Is(err, base.ErrAddressMismatch) {
			// The seed has changed. Handing out another address would add to a
			// pile of funds nobody can reach.
			logger.Errorf("base: %v", err)
			u.APIResponse(ctx, http.StatusServiceUnavailable, "error",
				"Deposits are temporarily unavailable.",
				map[string]any{"code": "deposits_unavailable"})
			return
		}
		logger.Errorf("base: deposit address: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Could not get a deposit address", nil)
		return
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Deposit address", depositAddressResponse{
		Address: address,
		Network: "Base",
		ChainID: h.ChainID,
		Token:   h.Token,
		Warning: "Send USDC on the Base network only. Anything else sent here cannot be recovered.",
	})
}
