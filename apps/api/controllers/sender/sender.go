package sender

import (
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/usezoracle/tapp/api/config"
	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/storage"

	"github.com/usezoracle/tapp/api/ent/institution"
	"github.com/usezoracle/tapp/api/ent/network"
	"github.com/usezoracle/tapp/api/ent/paymentorder"
	"github.com/usezoracle/tapp/api/ent/senderprofile"
	tokenEnt "github.com/usezoracle/tapp/api/ent/token"
	svc "github.com/usezoracle/tapp/api/services"
	"github.com/usezoracle/tapp/api/types"

	"github.com/shopspring/decimal"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"

	"github.com/gin-gonic/gin"
)

// SenderController is a controller type for sender endpoints
type SenderController struct {
	receiveAddressService *svc.ReceiveAddressService
}

// NewSenderController creates a new instance of SenderController
func NewSenderController() *SenderController {

	return &SenderController{
		receiveAddressService: svc.NewReceiveAddressService(),
	}
}

var serverConf = config.ServerConfig()
var orderConf = config.OrderConfig()

// Order creation moved to internal/orders.
//
// Both endpoints here created a one-time Sui receive address, waited for an
// on-chain deposit to it, bridged that to Base and handed the result to an
// aggregator to find a liquidity provider. Every stage was somewhere to get
// stuck, and an order's true state lived across four tables and a bridge
// provider's API.
//
// An order is now a composition of three things that already exist: a balance
// in the ledger, a price from a quote, and a delivery by the settlement
// worker. See internal/orders.

// GetPaymentOrderByID controller fetches a payment order by ID
func (ctrl *SenderController) GetPaymentOrderByID(ctx *gin.Context) {
	// Get order ID from the URL
	orderID := ctx.Param("id")
	isUUID := true

	// Convert order ID to UUID
	id, err := uuid.Parse(orderID)
	if err != nil {
		isUUID = false
	}

	// Get sender profile from the context
	senderCtx, ok := ctx.Get("sender")
	if !ok {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Invalid API key or token", nil)
		return
	}
	sender := senderCtx.(*ent.SenderProfile)

	// Fetch payment order from the database
	paymentOrderQuery := storage.Client.PaymentOrder.Query()

	if isUUID {
		paymentOrderQuery = paymentOrderQuery.Where(paymentorder.IDEQ(id))
	} else {
		paymentOrderQuery = paymentOrderQuery.Where(paymentorder.ReferenceEQ(orderID))
	}

	paymentOrder, err := paymentOrderQuery.
		Where(paymentorder.HasSenderProfileWith(senderprofile.IDEQ(sender.ID))).
		WithRecipient().
		WithToken(func(tq *ent.TokenQuery) {
			tq.WithNetwork()
		}).
		WithTransactions().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			u.APIResponse(ctx, http.StatusNotFound, "error",
				"Payment order not found", nil)
		} else {
			logger.Errorf("error: %v", err)
			u.APIResponse(ctx, http.StatusInternalServerError, "error",
				"Failed to fetch payment order", nil)
		}
		return
	}

	var transactions []types.TransactionLog
	for _, transaction := range paymentOrder.Edges.Transactions {
		transactions = append(transactions, types.TransactionLog{
			ID:        transaction.ID,
			GatewayId: transaction.GatewayID,
			Status:    transaction.Status,
			TxHash:    transaction.TxHash,
			CreatedAt: transaction.CreatedAt,
		})

	}

	institution, err := storage.Client.Institution.
		Query().
		Where(institution.CodeEQ(paymentOrder.Edges.Recipient.Institution)).
		WithFiatCurrency().
		Only(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch payment order", nil)
		return
	}

	u.APIResponse(ctx, http.StatusOK, "success", "The order has been successfully retrieved", &types.PaymentOrderResponse{
		ID:             paymentOrder.ID,
		Amount:         paymentOrder.Amount,
		AmountPaid:     paymentOrder.AmountPaid,
		AmountReturned: paymentOrder.AmountReturned,
		Token:          paymentOrder.Edges.Token.Symbol,
		SenderFee:      paymentOrder.SenderFee,
		TransactionFee: paymentOrder.NetworkFee.Add(paymentOrder.ProtocolFee),
		Rate:           paymentOrder.Rate,
		Network:        paymentOrder.Edges.Token.Edges.Network.Identifier,
		Recipient: types.PaymentOrderRecipient{
			Currency:          institution.Edges.FiatCurrency.Code,
			Institution:       institution.Name,
			AccountIdentifier: paymentOrder.Edges.Recipient.AccountIdentifier,
			AccountName:       paymentOrder.Edges.Recipient.AccountName,
			ProviderID:        paymentOrder.Edges.Recipient.ProviderID,
			Memo:              paymentOrder.Edges.Recipient.Memo,
		},
		Transactions:   transactions,
		FromAddress:    paymentOrder.FromAddress,
		ReturnAddress:  paymentOrder.ReturnAddress,
		ReceiveAddress: paymentOrder.ReceiveAddressText,
		FeeAddress:     paymentOrder.FeeAddress,
		Reference:      paymentOrder.Reference,
		GatewayID:      paymentOrder.GatewayID,
		CreatedAt:      paymentOrder.CreatedAt,
		UpdatedAt:      paymentOrder.UpdatedAt,
		TxHash:         paymentOrder.TxHash,
		Status:         paymentOrder.Status,
	})
}

// GetPaymentOrders controller fetches all payment orders
func (ctrl *SenderController) GetPaymentOrders(ctx *gin.Context) {
	// Get sender profile from the context
	senderCtx, ok := ctx.Get("sender")
	if !ok {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Invalid API key or token", nil)
		return
	}
	sender := senderCtx.(*ent.SenderProfile)

	// Get ordering query param
	ordering := ctx.Query("ordering")
	order := ent.Desc(paymentorder.FieldCreatedAt)
	if ordering == "asc" {
		order = ent.Asc(paymentorder.FieldCreatedAt)
	}

	// Get page and pageSize query params
	page, offset, pageSize := u.Paginate(ctx)

	paymentOrderQuery := storage.Client.PaymentOrder.Query()

	// Filter by sender
	paymentOrderQuery = paymentOrderQuery.Where(
		paymentorder.HasSenderProfileWith(senderprofile.IDEQ(sender.ID)),
	)

	// Filter by status
	statusQueryParam := ctx.Query("status")
	statusMap := map[string]paymentorder.Status{
		"initiated": paymentorder.StatusInitiated,
		"pending":   paymentorder.StatusPending,
		"expired":   paymentorder.StatusExpired,
		"settled":   paymentorder.StatusSettled,
		"refunded":  paymentorder.StatusRefunded,
	}

	if status, ok := statusMap[statusQueryParam]; ok {
		paymentOrderQuery = paymentOrderQuery.Where(
			paymentorder.StatusEQ(status),
		)
	}

	// Filter by token
	tokenQueryParam := ctx.Query("token")

	if tokenQueryParam != "" {
		tokenExists, err := storage.Client.Token.
			Query().
			Where(
				tokenEnt.SymbolEQ(tokenQueryParam),
			).
			Exist(ctx)
		if err != nil {
			logger.Errorf("error: %v", err)
			u.APIResponse(ctx, http.StatusInternalServerError, "error",
				"Failed to fetch payment orders", nil)
			return
		}

		if tokenExists {
			paymentOrderQuery = paymentOrderQuery.Where(
				paymentorder.HasTokenWith(
					tokenEnt.SymbolEQ(tokenQueryParam),
				),
			)
		}
	}

	// Filter by network
	networkQueryParam := ctx.Query("network")

	if networkQueryParam != "" {
		networkExists, err := storage.Client.Network.
			Query().
			Where(
				network.IdentifierEQ(networkQueryParam),
			).
			Exist(ctx)
		if err != nil {
			logger.Errorf("error: %v", err)
			u.APIResponse(ctx, http.StatusInternalServerError, "error",
				"Failed to fetch payment orders", nil)
			return
		}

		if networkExists {
			paymentOrderQuery = paymentOrderQuery.Where(
				paymentorder.HasTokenWith(
					tokenEnt.HasNetworkWith(
						network.IdentifierEQ(networkQueryParam),
					),
				),
			)
		}
	}

	count, err := paymentOrderQuery.Count(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch payment orders", nil)
		return
	}

	// Fetch payment orders
	paymentOrders, err := paymentOrderQuery.
		WithRecipient().
		WithToken(func(tq *ent.TokenQuery) {
			tq.WithNetwork()
		}).
		Limit(pageSize).
		Offset(offset).
		Order(order).
		All(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Failed to fetch payment orders", nil)
		return
	}

	var orders []types.PaymentOrderResponse

	for _, paymentOrder := range paymentOrders {
		institution, err := storage.Client.Institution.
			Query().
			Where(institution.CodeEQ(paymentOrder.Edges.Recipient.Institution)).
			WithFiatCurrency().
			Only(ctx)
		if err != nil {
			logger.Errorf("error: %v", err)
			u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch payment orders", nil)
			return
		}

		orders = append(orders, types.PaymentOrderResponse{
			ID:             paymentOrder.ID,
			Amount:         paymentOrder.Amount,
			AmountPaid:     paymentOrder.AmountPaid,
			AmountReturned: paymentOrder.AmountReturned,
			Token:          paymentOrder.Edges.Token.Symbol,
			SenderFee:      paymentOrder.SenderFee,
			TransactionFee: paymentOrder.NetworkFee.Add(paymentOrder.ProtocolFee),
			Rate:           paymentOrder.Rate,
			Network:        paymentOrder.Edges.Token.Edges.Network.Identifier,
			Recipient: types.PaymentOrderRecipient{
				Currency:          institution.Edges.FiatCurrency.Code,
				Institution:       institution.Name,
				AccountIdentifier: paymentOrder.Edges.Recipient.AccountIdentifier,
				AccountName:       paymentOrder.Edges.Recipient.AccountName,
				ProviderID:        paymentOrder.Edges.Recipient.ProviderID,
				Memo:              paymentOrder.Edges.Recipient.Memo,
			},
			FromAddress:    paymentOrder.FromAddress,
			ReturnAddress:  paymentOrder.ReturnAddress,
			ReceiveAddress: paymentOrder.ReceiveAddressText,
			FeeAddress:     paymentOrder.FeeAddress,
			Reference:      paymentOrder.Reference,
			GatewayID:      paymentOrder.GatewayID,
			CreatedAt:      paymentOrder.CreatedAt,
			UpdatedAt:      paymentOrder.UpdatedAt,
			TxHash:         paymentOrder.TxHash,
			Status:         paymentOrder.Status,
		})
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Payment orders retrieved successfully", types.SenderPaymentOrderList{
		Page:         page,
		PageSize:     pageSize,
		TotalRecords: count,
		Orders:       orders,
	})
}

// Stats controller fetches sender stats
func (ctrl *SenderController) Stats(ctx *gin.Context) {
	senderCtx, ok := ctx.Get("sender")
	if !ok {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Sender profile required", nil)
		return
	}
	sender := senderCtx.(*ent.SenderProfile)

	// Optional `?period=today` filter. Default (omitted / "all") returns
	// lifetime totals, preserving the historical API shape.
	var (
		periodSince *time.Time
		now         = time.Now()
	)
	switch strings.ToLower(ctx.Query("period")) {
	case "today":
		start := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
		periodSince = &start
	case "week":
		start := now.AddDate(0, 0, -7)
		periodSince = &start
	case "month":
		start := now.AddDate(0, -1, 0)
		periodSince = &start
	case "all", "":
		periodSince = nil
	default:
		u.APIResponse(ctx, http.StatusBadRequest, "error", "period must be one of: today, week, month, all", nil)
		return
	}

	// Volume + sender fees over settled orders in the period.
	volQuery := storage.Client.PaymentOrder.Query().Where(
		paymentorder.HasSenderProfileWith(senderprofile.IDEQ(sender.ID)),
		paymentorder.StatusEQ(paymentorder.StatusSettled),
	)
	if periodSince != nil {
		volQuery = volQuery.Where(paymentorder.CreatedAtGTE(*periodSince))
	}

	var w []struct {
		Sum               decimal.Decimal
		SumFieldSenderFee decimal.Decimal
	}
	if err := volQuery.
		Aggregate(
			ent.Sum(paymentorder.FieldAmount),
			ent.As(ent.Sum(paymentorder.FieldSenderFee), "SumFieldSenderFee"),
		).
		Scan(ctx, &w); err != nil {
		logger.Errorf("Stats.volume: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch sender stats", nil)
		return
	}

	// Order count over the same period — across all statuses so an
	// abandoned-cart count doesn't drop to zero on a slow day.
	countQuery := storage.Client.PaymentOrder.Query().Where(
		paymentorder.HasSenderProfileWith(senderprofile.IDEQ(sender.ID)),
	)
	if periodSince != nil {
		countQuery = countQuery.Where(paymentorder.CreatedAtGTE(*periodSince))
	}

	var v []struct{ Count int }
	if err := countQuery.Aggregate(ent.Count()).Scan(ctx, &v); err != nil {
		logger.Errorf("Stats.count: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch sender stats", nil)
		return
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Sender stats retrieved successfully", types.SenderStatsResponse{
		TotalOrders:      v[0].Count,
		TotalOrderVolume: w[0].Sum,
		TotalFeeEarnings: w[0].SumFieldSenderFee,
	})
}

// CancelOrder lets the sender abandon an in-flight PaymentOrder before
// the customer pays. Allowed only on orders the merchant actually owns,
// and only while the order is still in `initiated` or `pending` state —
// once settlement begins it's too late to cancel client-side.
//
// Idempotent: cancelling an already-cancelled / expired / settled order
// is a no-op 200 with the current state surfaced in the body, so the
// merchant app's tear-down path (back button, broadcast timeout) doesn't
// have to special-case 409s.
func (ctrl *SenderController) CancelOrder(ctx *gin.Context) {
	idStr := ctx.Param("id")
	orderID, err := uuid.Parse(idStr)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid order id", nil)
		return
	}

	sender, ok := ctx.Get("sender")
	if !ok || sender == nil {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Sender profile required", nil)
		return
	}
	senderProfile := sender.(*ent.SenderProfile)

	order, err := storage.Client.PaymentOrder.
		Query().
		Where(
			paymentorder.IDEQ(orderID),
			paymentorder.HasSenderProfileWith(senderprofile.IDEQ(senderProfile.ID)),
		).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			u.APIResponse(ctx, http.StatusNotFound, "error", "Order not found", nil)
			return
		}
		logger.Errorf("CancelOrder.query: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to cancel order", nil)
		return
	}

	// Idempotent — already in a terminal state.
	switch order.Status {
	case paymentorder.StatusCancelled, paymentorder.StatusExpired,
		paymentorder.StatusSettled, paymentorder.StatusRefunded:
		u.APIResponse(ctx, http.StatusOK, "success", "Order is already final",
			gin.H{"id": order.ID, "status": order.Status})
		return
	}

	// Active orders can be cancelled.
	updated, err := order.Update().
		SetStatus(paymentorder.StatusCancelled).
		Save(ctx)
	if err != nil {
		logger.Errorf("CancelOrder.update: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to cancel order", nil)
		return
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Order cancelled",
		gin.H{"id": updated.ID, "status": updated.Status})
}
