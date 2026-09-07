// Confirming a payment order.
//
//	POST /v1/orders/:id/confirm

package controllers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/ent/paymentorder"
	svc "github.com/usezoracle/tapp/api/services"
	"github.com/usezoracle/tapp/api/storage"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

type confirmOrderPayload struct {
	TxDigest string `json:"txDigest" binding:"required"`
}

// ConfirmOrderPayment is the customer-side "I sent the USDC" ack.
//
// The Sui event indexer is authoritative — it watches the order's
// receive_address and will eventually fire payment.deposited on its own.
// This endpoint exists to (1) shave seconds off the merchant's UI by
// pre-emitting payment.deposited the moment the customer signs, and
// (2) capture tx_hash for support/debug without scanning the chain.
//
// We do NOT validate the digest on-chain here — the indexer does, and a
// fake digest can't move a customer's balance. The status update happens
// only when the indexer confirms the deposit; this endpoint just emits
// an optimistic SSE event the customer's own page subscribes to.
func (ctrl *Controller) ConfirmOrderPayment(ctx *gin.Context) {
	idStr := ctx.Param("id")
	orderID, err := uuid.Parse(idStr)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid order id", nil)
		return
	}

	var payload confirmOrderPayload
	if err := ctx.ShouldBindJSON(&payload); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Failed to validate payload", u.GetErrorData(err))
		return
	}

	po, err := storage.Client.PaymentOrder.
		Query().
		Where(paymentorder.IDEQ(orderID)).
		WithSenderProfile().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			u.APIResponse(ctx, http.StatusNotFound, "error", "Order not found", nil)
			return
		}
		logger.Errorf("ConfirmOrderPayment.query: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to record confirmation", nil)
		return
	}

	// Idempotent — same digest reposted is a no-op success.
	if po.TxHash == "" {
		if _, err := po.Update().SetTxHash(payload.TxDigest).Save(ctx); err != nil {
			logger.Errorf("ConfirmOrderPayment.update: %v", err)
			// Keep going — we still want to emit the SSE event so the
			// merchant UI advances. The tx_hash is observability nice-to-
			// have; the indexer will fill it in when it confirms.
		}
	}

	// Pre-emit a payment.deposited event so the merchant's SSE (and the
	// customer's new /v1/orders/:id/stream below) advance immediately.
	// The indexer will fire its own payment.deposited later when it sees
	// the on-chain effect; subscribers must tolerate duplicates (the
	// existing useTapBroadcast/PaymentsRealtimeProvider already do —
	// state transitions are idempotent).
	if po.Edges.SenderProfile != nil {
		svc.Bus().Publish(po.Edges.SenderProfile.ID, "payment.deposited", map[string]any{
			"order_id":    po.ID.String(),
			"sui_tx_hash": payload.TxDigest,
		})
	}

	logger.Infof("\n================================================================\n🔔 [ConfirmOrderPayment] Payment confirmation received for Order: %s (txDigest: %s)\n================================================================", po.ID, payload.TxDigest)

	u.APIResponse(ctx, http.StatusOK, "success", "Confirmation recorded", gin.H{
		"id":     po.ID,
		"status": po.Status,
	})
}

// StreamOrderStatus is a per-ORDER SSE stream — unauthenticated, scoped
// to one order ID. The customer-facing checkout PWA subscribes here
// after submitting their on-chain payment so the success screen can
// advance through Rails' bridge → settle pipeline in real time.
//
// Security: we look the order up, get its sender, subscribe to that
// sender's event bus, and filter events server-side to only those whose
// payload.order_id matches the URL param. The customer never sees other
// orders' events even though we're piggy-backing on the sender bus.
//
// Knowing an order's UUID is treated as the auth here — the same way
// the existing public GET /v1/orders/:id does. Order IDs are
// unguessable v4 UUIDs (~122 bits); guessing one is computationally
// infeasible.
func (ctrl *Controller) StreamOrderStatus(ctx *gin.Context) {
	idStr := ctx.Param("id")
	orderID, err := uuid.Parse(idStr)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid order id", nil)
		return
	}

	po, err := storage.Client.PaymentOrder.
		Query().
		Where(paymentorder.IDEQ(orderID)).
		WithSenderProfile().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			u.APIResponse(ctx, http.StatusNotFound, "error", "Order not found", nil)
			return
		}
		logger.Errorf("StreamOrderStatus.query: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to open stream", nil)
		return
	}
	if po.Edges.SenderProfile == nil {
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Order has no owner", nil)
		return
	}
	orderIDStr := po.ID.String()

	ctx.Writer.Header().Set("Content-Type", "text/event-stream")
	ctx.Writer.Header().Set("Cache-Control", "no-cache")
	ctx.Writer.Header().Set("Connection", "keep-alive")
	ctx.Writer.Header().Set("X-Accel-Buffering", "no")
	ctx.Writer.WriteHeader(http.StatusOK)

	flusher, isFlusher := ctx.Writer.(http.Flusher)
	if !isFlusher {
		_, _ = io.WriteString(ctx.Writer, "event: error\ndata: streaming not supported\n\n")
		return
	}

	lastEventID := ctx.GetHeader("Last-Event-ID")
	events, replay, unsubscribe := svc.Bus().Subscribe(po.Edges.SenderProfile.ID, lastEventID)
	defer unsubscribe()

	_, _ = io.WriteString(ctx.Writer, ": connected\n\n")
	flusher.Flush()

	// Replay matching events from the ring buffer (drops events for
	// other orders on this sender).
	for _, ev := range replay {
		if eventOrderID(ev) == orderIDStr {
			writeOrderSSE(ctx.Writer, ev)
			flusher.Flush()
		}
	}

	heartbeat := time.NewTicker(25 * time.Second)
	defer heartbeat.Stop()

	clientGone := ctx.Request.Context().Done()
	for {
		select {
		case <-clientGone:
			return
		case <-heartbeat.C:
			if _, err := io.WriteString(ctx.Writer, ": heartbeat\n\n"); err != nil {
				return
			}
			flusher.Flush()
		case ev, open := <-events:
			if !open {
				return
			}
			if eventOrderID(ev) != orderIDStr {
				// Different order on the same sender — skip.
				continue
			}
			writeOrderSSE(ctx.Writer, ev)
			flusher.Flush()
		}
	}
}

func eventOrderID(ev svc.PaymentEvent) string {
	if v, ok := ev.Payload["order_id"]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func writeOrderSSE(w io.Writer, ev svc.PaymentEvent) {
	data, err := json.Marshal(ev.Payload)
	if err != nil {
		logger.Errorf("OrderSSE marshal: %v", err)
		return
	}
	_, _ = fmt.Fprintf(w, "id: %s\nevent: %s\ndata: %s\n\n", ev.ID, ev.Name, data)
}
