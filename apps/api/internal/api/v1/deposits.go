package v1

import (
	"errors"
	"fmt"
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
	// Testnet says this address is on a test network, so the client can render
	// it as something you must not send real funds to. Derived from the chain
	// id rather than trusted from configuration prose.
	Testnet bool `json:"testnet"`
	// Warning is shown to the person, because sending the wrong asset or using
	// the wrong network is the most common way people lose money at this step
	// and it is not recoverable.
	Warning string `json:"warning"`
}

// networkName and depositWarning name the chain truthfully.
//
// Both networks were previously called "Base" and carried the same warning,
// which is how a Sepolia address came to be indistinguishable from a mainnet
// one on the screen whose entire job is telling somebody where to send money.
// Real USDC was sent to a testnet-configured address as a result. The chain id
// is the only thing that actually knows, so it is what decides.
func networkName(chainID int64) (name string, testnet bool) {
	switch chainID {
	case 8453:
		return "Base", false
	case 84532:
		return "Base Sepolia", true
	default:
		return fmt.Sprintf("chain %d", chainID), true
	}
}

func depositWarning(token, network string, testnet bool) string {
	if testnet {
		return "This is a " + network + " TEST address. Do not send real " + token +
			" here -- send it on a test network only. Real funds sent to this " +
			"address will not be credited."
	}
	return "Send " + token + " on the " + network +
		" network only. Anything else sent here cannot be recovered."
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

	network, testnet := networkName(h.ChainID)
	u.APIResponse(ctx, http.StatusOK, "success", "Deposit address", depositAddressResponse{
		Address: address,
		Network: network,
		ChainID: h.ChainID,
		Token:   h.Token,
		Testnet: testnet,
		Warning: depositWarning(h.Token, network, testnet),
	})
}
