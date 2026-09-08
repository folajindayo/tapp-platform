// Reading one order.

package provider

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/ent/lockpaymentorder"
	"github.com/usezoracle/tapp/api/ent/providerprofile"
	"github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/types"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// GetLockPaymentOrderByID controller fetches a payment order by ID
func (ctrl *ProviderController) GetLockPaymentOrderByID(ctx *gin.Context) {
	// Get order ID from the URL
	orderID := ctx.Param("id")

	// Convert order ID to UUID
	id, err := uuid.Parse(orderID)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"Invalid order ID", nil)
		return
	}

	// Get provider profile from the context
	providerCtx, ok := ctx.Get("provider")

	if !ok {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Invalid API key or token", nil)
		return
	}
	provider := providerCtx.(*ent.ProviderProfile)

	// Fetch payment order from the database
	lockPaymentOrder, err := storage.Client.LockPaymentOrder.
		Query().
		Where(
			lockpaymentorder.IDEQ(id),
			lockpaymentorder.HasProviderWith(providerprofile.IDEQ(provider.ID)),
		).
		WithToken(func(tq *ent.TokenQuery) {
			tq.WithNetwork()
		}).
		WithTransactions().
		Only(ctx)

	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusNotFound, "error",
			"Payment order not found", nil)
		return
	}
	var transactions []types.TransactionLog
	for _, transaction := range lockPaymentOrder.Edges.Transactions {
		transactions = append(transactions, types.TransactionLog{
			ID:        transaction.ID,
			GatewayId: transaction.GatewayID,
			Status:    transaction.Status,
			TxHash:    transaction.TxHash,
			CreatedAt: transaction.CreatedAt,
		})

	}

	u.APIResponse(ctx, http.StatusOK, "success", "The order has been successfully retrieved", &types.LockPaymentOrderResponse{
		ID:                lockPaymentOrder.ID,
		Token:             lockPaymentOrder.Edges.Token.Symbol,
		GatewayID:         lockPaymentOrder.GatewayID,
		Amount:            lockPaymentOrder.Amount,
		Rate:              lockPaymentOrder.Rate,
		Institution:       lockPaymentOrder.Institution,
		AccountIdentifier: lockPaymentOrder.AccountIdentifier,
		AccountName:       lockPaymentOrder.AccountName,
		TxHash:            lockPaymentOrder.TxHash,
		Status:            lockPaymentOrder.Status,
		Memo:              lockPaymentOrder.Memo,
		Network:           lockPaymentOrder.Edges.Token.Edges.Network.Identifier,
		UpdatedAt:         lockPaymentOrder.UpdatedAt,
		CreatedAt:         lockPaymentOrder.CreatedAt,
		Transactions:      transactions,
	})
}
