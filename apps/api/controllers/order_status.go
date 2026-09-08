// Reading a payment order: its status, and the live stream of its progress.
//
// Both are public and scoped to the one order named in the path: the customer
// paying a checkout has to watch it advance through bridge → settle without
// signing in, and must not see the sender's other orders.
//
//	GET /v1/orders/:id
//	GET /v1/orders/:id/stream   (SSE)

package controllers

import (
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/shopspring/decimal"
	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/ent/lockpaymentorder"
	"github.com/usezoracle/tapp/api/ent/paymentorder"
	"github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/types"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// GetLockPaymentOrderStatus controller fetches a payment order status by ID
func (ctrl *Controller) GetLockPaymentOrderStatus(ctx *gin.Context) {
	// Get order ID from the URL
	orderID := ctx.Param("id")

	// Define the combined response type that satisfies both types.LockPaymentOrderStatusResponse
	// and the PWA's OrderDetails requirements.
	type CombinedOrderResponse struct {
		OrderID       string                             `json:"orderId"`
		Amount        decimal.Decimal                    `json:"amount"`
		Token         string                             `json:"token"`
		Network       string                             `json:"network"`
		SettlePercent decimal.Decimal                    `json:"settlePercent"`
		Status        lockpaymentorder.Status            `json:"status"`
		TxHash        string                             `json:"txHash"`
		Settlements   []types.LockPaymentOrderSplitOrder `json:"settlements"`
		TxReceipts    []types.LockPaymentOrderTxReceipt  `json:"txReceipts"`
		UpdatedAt     time.Time                          `json:"updatedAt"`

		// PWA OrderDetails fields
		ID              string  `json:"id"`
		MerchantName    string  `json:"merchant_name"`
		MerchantLogoURL string  `json:"merchant_logo_url,omitempty"`
		AmountSubunit   int64   `json:"amount_subunit"`
		NgnRate         float64 `json:"ngn_rate"`
		Reference       string  `json:"reference"`
		ExpiresAt       int64   `json:"expires_at"`
		StepUpRequired  bool    `json:"step_up_required"`

		// On-chain deposit target. The customer's wallet sends
		// `amount_subunit` of `coin_type` to this Sui address; the
		// indexer picks the deposit up and advances the order state.
		ReceiveAddress string `json:"receive_address,omitempty"`
		CoinType       string `json:"coin_type,omitempty"`
	}

	// First, try to fetch related lock payment orders from the database
	orders, err := storage.Client.LockPaymentOrder.
		Query().
		Where(
			lockpaymentorder.GatewayIDEQ(orderID),
		).
		WithToken(func(tq *ent.TokenQuery) {
			tq.WithNetwork()
		}).
		WithTransactions().
		All(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch order status", nil)
		return
	}

	// If LockPaymentOrder records exist, build the response from them (and fetch PaymentOrder for PWA details if possible)
	if len(orders) > 0 {
		var settlements []types.LockPaymentOrderSplitOrder
		var receipts []types.LockPaymentOrderTxReceipt
		var settlePercent decimal.Decimal
		var totalAmount decimal.Decimal

		for _, order := range orders {
			for _, transaction := range order.Edges.Transactions {
				if u.ContainsString([]string{"order_settled", "order_created", "order_refunded"}, transaction.Status.String()) {
					var status lockpaymentorder.Status
					if transaction.Status.String() == "order_created" {
						status = lockpaymentorder.StatusPending
					} else {
						status = lockpaymentorder.Status(strings.TrimPrefix(transaction.Status.String(), "order_"))
					}
					receipts = append(receipts, types.LockPaymentOrderTxReceipt{
						Status:    status,
						TxHash:    transaction.TxHash,
						Timestamp: transaction.CreatedAt,
					})
				}
			}

			settlements = append(settlements, types.LockPaymentOrderSplitOrder{
				SplitOrderID: order.ID,
				Amount:       order.Amount,
				Rate:         order.Rate,
				OrderPercent: order.OrderPercent,
			})

			settlePercent = settlePercent.Add(order.OrderPercent)
			totalAmount = totalAmount.Add(order.Amount)
		}

		// Sort receipts by latest timestamp
		slices.SortStableFunc(receipts, func(a, b types.LockPaymentOrderTxReceipt) int {
			return b.Timestamp.Compare(a.Timestamp)
		})

		status := orders[0].Status
		if status == lockpaymentorder.StatusCancelled {
			status = lockpaymentorder.StatusProcessing
		}

		var merchantName string
		var reference string
		var expiresAt int64
		var ngnRate float64
		var receiveAddress string
		var coinType string

		poID, err := uuid.Parse(orders[0].GatewayID)
		if err == nil {
			po, err := storage.Client.PaymentOrder.
				Query().
				Where(paymentorder.IDEQ(poID)).
				WithRecipient().
				Only(ctx)
			if err == nil {
				if po.Edges.Recipient != nil {
					merchantName = po.Edges.Recipient.AccountName
				}
				reference = po.Reference
				// There is no one-time receive address to publish any more.
				// A payer funds an order from their balance rather than by
				// sending to an address the order minted for them.
				expiresAt = po.CreatedAt.Add(1 * time.Hour).UnixMilli()
				ngnRate, _ = po.Rate.Float64()
			}
		}
		if merchantName == "" {
			merchantName = orders[0].AccountName
		}
		if reference == "" {
			reference = orders[0].Memo
		}
		if expiresAt == 0 {
			expiresAt = orders[0].CreatedAt.Add(1 * time.Hour).UnixMilli()
		}
		if ngnRate == 0 {
			ngnRate, _ = orders[0].Rate.Float64()
		}

		txHash := ""
		if len(receipts) > 0 {
			txHash = receipts[0].TxHash
		}

		response := &CombinedOrderResponse{
			OrderID:       orders[0].GatewayID,
			Amount:        totalAmount,
			Token:         orders[0].Edges.Token.Symbol,
			Network:       orders[0].Edges.Token.Edges.Network.Identifier,
			SettlePercent: settlePercent,
			Status:        status,
			TxHash:        txHash,
			Settlements:   settlements,
			TxReceipts:    receipts,
			UpdatedAt:     orders[0].UpdatedAt,

			ID:             orders[0].GatewayID,
			MerchantName:   merchantName,
			AmountSubunit:  u.ToSubunit(totalAmount, orders[0].Edges.Token.Decimals).Int64(),
			NgnRate:        ngnRate,
			Reference:      reference,
			ExpiresAt:      expiresAt,
			StepUpRequired: false,
			ReceiveAddress: receiveAddress,
			CoinType:       coinType,
		}

		u.APIResponse(ctx, http.StatusOK, "success", "Order status fetched successfully", response)
		return
	}

	// Fallback: If no LockPaymentOrder exists, check if a PaymentOrder exists with the matching UUID
	poID, err := uuid.Parse(orderID)
	if err != nil {
		// Not a UUID, return 404
		u.APIResponse(ctx, http.StatusNotFound, "error", "Order not found", nil)
		return
	}

	// Retrieve from payment_orders
	po, err := storage.Client.PaymentOrder.
		Query().
		Where(paymentorder.IDEQ(poID)).
		WithToken(func(tq *ent.TokenQuery) {
			tq.WithNetwork()
		}).
		WithRecipient().
		WithTransactions().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			u.APIResponse(ctx, http.StatusNotFound, "error", "Order not found", nil)
		} else {
			logger.Errorf("error: %v", err)
			u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch order details", nil)
		}
		return
	}

	// Map PaymentOrder status to lockpaymentorder.Status
	status := lockpaymentorder.StatusPending
	switch po.Status {
	case paymentorder.StatusInitiated, paymentorder.StatusPending:
		status = lockpaymentorder.StatusPending
	case paymentorder.StatusExpired, paymentorder.StatusCancelled:
		status = lockpaymentorder.StatusCancelled
	case paymentorder.StatusSettled:
		status = lockpaymentorder.StatusSettled
	case paymentorder.StatusRefunded:
		status = lockpaymentorder.StatusRefunded
	}

	merchantName := ""
	if po.Edges.Recipient != nil {
		merchantName = po.Edges.Recipient.AccountName
	}

	expiresAt := po.CreatedAt.Add(1 * time.Hour).UnixMilli()
	// No one-time receive address: a payer funds an order from their balance
	// rather than by sending to an address the order minted for them.
	var receiveAddress string
	var coinType string

	ngnRate, _ := po.Rate.Float64()

	var receipts []types.LockPaymentOrderTxReceipt
	for _, transaction := range po.Edges.Transactions {
		if u.ContainsString([]string{"order_settled", "order_created", "order_refunded"}, transaction.Status.String()) {
			var txStatus lockpaymentorder.Status
			if transaction.Status.String() == "order_created" {
				txStatus = lockpaymentorder.StatusPending
			} else {
				txStatus = lockpaymentorder.Status(strings.TrimPrefix(transaction.Status.String(), "order_"))
			}
			receipts = append(receipts, types.LockPaymentOrderTxReceipt{
				Status:    txStatus,
				TxHash:    transaction.TxHash,
				Timestamp: transaction.CreatedAt,
			})
		}
	}

	txHash := ""
	if len(receipts) > 0 {
		txHash = receipts[0].TxHash
	}

	response := &CombinedOrderResponse{
		OrderID:       po.ID.String(),
		Amount:        po.Amount,
		Token:         po.Edges.Token.Symbol,
		Network:       po.Edges.Token.Edges.Network.Identifier,
		SettlePercent: po.PercentSettled,
		Status:        status,
		TxHash:        txHash,
		Settlements:   []types.LockPaymentOrderSplitOrder{},
		TxReceipts:    receipts,
		UpdatedAt:     po.UpdatedAt,

		ID:             po.ID.String(),
		MerchantName:   merchantName,
		AmountSubunit:  u.ToSubunit(po.Amount, po.Edges.Token.Decimals).Int64(),
		NgnRate:        ngnRate,
		Reference:      po.Reference,
		ExpiresAt:      expiresAt,
		StepUpRequired: false,
		ReceiveAddress: receiveAddress,
		CoinType:       coinType,
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Order status fetched successfully", response)
}
