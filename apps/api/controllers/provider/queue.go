// The provider queue: what has been assigned, and taking one on.
//
//	GET  /v1/provider/orders
//	POST /v1/provider/orders/:id/accept

package provider

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/ent/lockpaymentorder"
	"github.com/usezoracle/tapp/api/ent/providerprofile"
	"github.com/usezoracle/tapp/api/ent/transactionlog"
	"github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/types"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// GetLockPaymentOrders controller fetches all assigned orders
func (ctrl *ProviderController) GetLockPaymentOrders(ctx *gin.Context) {
	// get page and pageSize query params
	page, offset, pageSize := u.Paginate(ctx)

	// Set ordering
	ordering := ctx.Query("ordering")
	order := ent.Desc(lockpaymentorder.FieldCreatedAt)
	if ordering == "asc" {
		order = ent.Asc(lockpaymentorder.FieldCreatedAt)
	}

	// Get provider profile from the context
	providerCtx, ok := ctx.Get("provider")
	if !ok {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Invalid API key or token", nil)
		return
	}
	provider := providerCtx.(*ent.ProviderProfile)

	lockPaymentOrderQuery := storage.Client.LockPaymentOrder.Query()

	// Filter by status
	statusMap := map[string]lockpaymentorder.Status{
		"pending":    lockpaymentorder.StatusPending,
		"validated":  lockpaymentorder.StatusValidated,
		"fulfilled":  lockpaymentorder.StatusFulfilled,
		"cancelled":  lockpaymentorder.StatusCancelled,
		"processing": lockpaymentorder.StatusProcessing,
		"settled":    lockpaymentorder.StatusSettled,
	}

	statusQueryParam := ctx.Query("status")

	if status, ok := statusMap[statusQueryParam]; ok {
		lockPaymentOrderQuery = lockPaymentOrderQuery.Where(
			lockpaymentorder.HasProviderWith(providerprofile.IDEQ(provider.ID)),
			lockpaymentorder.StatusEQ(status),
		)
	} else {
		lockPaymentOrderQuery = lockPaymentOrderQuery.Where(
			lockpaymentorder.HasProviderWith(providerprofile.IDEQ(provider.ID)),
		)
	}

	count, err := lockPaymentOrderQuery.Count(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch orders", nil)
		return
	}

	// Fetch all orders assigned to the provider
	lockPaymentOrders, err := lockPaymentOrderQuery.
		Limit(pageSize).
		Offset(offset).
		Order(order).
		WithProvider().
		WithToken(
			func(query *ent.TokenQuery) {
				query.WithNetwork()
			},
		).
		All(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch orders", nil)
		return
	}

	var orders []types.LockPaymentOrderResponse
	for _, order := range lockPaymentOrders {
		orders = append(orders, types.LockPaymentOrderResponse{
			ID:                order.ID,
			Token:             order.Edges.Token.Symbol,
			GatewayID:         order.GatewayID,
			Amount:            order.Amount,
			Rate:              order.Rate,
			Institution:       order.Institution,
			AccountIdentifier: order.AccountIdentifier,
			AccountName:       order.AccountName,
			TxHash:            order.TxHash,
			Status:            order.Status,
			FiatPayoutStatus:  string(order.FiatPayoutStatus),
			FiatPayoutError:   order.FiatPayoutError,
			Memo:              order.Memo,
			Network:           order.Edges.Token.Edges.Network.Identifier,
			UpdatedAt:         order.UpdatedAt,
			CreatedAt:         order.CreatedAt,
		})
	}

	// return paginated orders
	u.APIResponse(ctx, http.StatusOK, "success", "Orders successfully retrieved", types.ProviderLockOrderList{
		Page:         page,
		PageSize:     pageSize,
		TotalRecords: count,
		Orders:       orders,
	})
}

// AcceptOrder controller accepts an order
func (ctrl *ProviderController) AcceptOrder(ctx *gin.Context) {
	// Get provider profile from the context
	providerCtx, ok := ctx.Get("provider")
	if !ok {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Invalid API key or token", nil)
		return
	}
	provider := providerCtx.(*ent.ProviderProfile)

	// Parse the Order ID string into a UUID
	orderID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		logger.Errorf("error parsing order ID: %v", err)
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid Order ID", nil)
		return
	}

	// Get Order request from Redis
	result, err := storage.RedisClient.HGetAll(ctx, fmt.Sprintf("order_request_%s", orderID)).Result()
	if err != nil {
		logger.Errorf("error getting order request from Redis: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to accept order request", nil)
		return
	}

	if result["providerId"] != provider.ID || len(result) == 0 {
		logger.Errorf("order request not found in Redis: %v", orderID)
		u.APIResponse(ctx, http.StatusNotFound, "error", "Order request not found or is expired", nil)
		return
	}

	// Delete order request from Redis
	_, err = storage.RedisClient.Del(ctx, fmt.Sprintf("order_request_%s", orderID)).Result()
	if err != nil {
		logger.Errorf("error deleting order request from Redis: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to accept order request", nil)
		return
	}

	tx, err := storage.Client.Tx(ctx)
	if err != nil {
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to update lock order status", nil)
		return
	}

	// Log transaction status
	var transactionLog *ent.TransactionLog
	_, err = tx.LockPaymentOrder.
		Query().
		Where(
			lockpaymentorder.IDEQ(orderID),
			lockpaymentorder.HasTransactionsWith(
				transactionlog.StatusEQ(transactionlog.StatusOrderProcessing),
			),
		).
		Only(ctx)
	if err != nil {
		if !ent.IsNotFound(err) {
			u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to update lock order status", nil)
			return
		} else {
			transactionLog, err = tx.TransactionLog.
				Create().
				SetStatus(transactionlog.StatusOrderProcessing).
				SetMetadata(
					map[string]interface{}{
						"ProviderId": provider.ID,
					}).
				Save(ctx)
			if err != nil {
				u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to update lock order status", nil)
				return
			}
		}
	}

	// Update lock order status to processing
	orderBuilder := tx.LockPaymentOrder.
		UpdateOneID(orderID).
		SetStatus(lockpaymentorder.StatusProcessing).
		SetProviderID(provider.ID)

	if transactionLog != nil {
		orderBuilder = orderBuilder.AddTransactions(transactionLog)
	}

	order, err := orderBuilder.Save(ctx)
	if err != nil {
		logger.Errorf("%s - error.AcceptOrder: %v", orderID, err)
		if ent.IsNotFound(err) {
			u.APIResponse(ctx, http.StatusNotFound, "error", "Order not found", nil)
		} else {
			u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to update lock order status", nil)
		}
		return
	}

	// Commit transaction
	if err := tx.Commit(); err != nil {
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to update lock order status", nil)
		return
	}

	u.APIResponse(ctx, http.StatusCreated, "success", "Order request accepted successfully", &types.AcceptOrderResponse{
		ID:                orderID,
		Amount:            order.Amount.Mul(order.Rate).RoundBank(0),
		Institution:       order.Institution,
		AccountIdentifier: order.AccountIdentifier,
		AccountName:       order.AccountName,
		Memo:              order.Memo,
	})
}

// DeclineOrder controller declines an order
