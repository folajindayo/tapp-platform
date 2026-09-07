package v1

import (
	"context"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/internal/checkout"
	"github.com/usezoracle/tapp/api/internal/ledger/movements"
	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/internal/orders"
	"github.com/usezoracle/tapp/api/internal/rates"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// OrderHandler serves the offramp: value in, fiat out to a bank.
type OrderHandler struct {
	Svc  *orders.Service
	User func(*gin.Context) (uuid.UUID, bool)
}

type createOrderRequest struct {
	// Sell is what the sender parts with, from their balance.
	Sell     string `json:"sell"     binding:"required"`
	From     string `json:"from"     binding:"required"`
	PayoutIn string `json:"payout_in"`
	// QuoteID prices the conversion. Required when the currencies differ:
	// without it the rate would be whatever it happened to be when the request
	// arrived, which nobody agreed to.
	QuoteID string `json:"quote_id"`

	BankCode      string `json:"bank_code"      binding:"required"`
	AccountNumber string `json:"account_number" binding:"required"`
	AccountName   string `json:"account_name"   binding:"required"`
	Narration     string `json:"narration"`
}

type orderResponse struct {
	ID            string `json:"id"`
	State         string `json:"state"`
	Sold          string `json:"sold"`
	Payout        string `json:"payout"`
	AccountName   string `json:"account_name"`
	AccountNumber string `json:"account_number"`
	BankCode      string `json:"bank_code"`
	Failure       string `json:"failure,omitempty"`
	CreatedAt     string `json:"created_at"`
}

func orderView(o *orders.Order) orderResponse {
	return orderResponse{
		ID: o.ID.String(), State: string(o.State),
		Sold: o.Sold.String(), Payout: o.Payout.String(),
		AccountName: o.AccountName, AccountNumber: o.AccountNumber,
		BankCode: o.BankCode, Failure: o.Failure,
		CreatedAt: o.CreatedAt.UTC().Format("2006-01-02T15:04:05Z"),
	}
}

// Create takes the sender's money and raises a payout.
func (h *OrderHandler) Create(ctx *gin.Context) {
	var req createOrderRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid request", u.GetErrorData(err))
		return
	}
	sender, ok := h.User(ctx)
	if !ok {
		return
	}

	from := money.Currency(req.From)
	if err := from.Valid(); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", err.Error(), nil)
		return
	}
	payoutIn := from
	if req.PayoutIn != "" {
		payoutIn = money.Currency(req.PayoutIn)
		if err := payoutIn.Valid(); err != nil {
			u.APIResponse(ctx, http.StatusBadRequest, "error", err.Error(), nil)
			return
		}
	}

	minor, err := parseDecimalAmount(req.Sell, from)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", err.Error(), nil)
		return
	}

	var quoteID *uuid.UUID
	if req.QuoteID != "" {
		parsed, err := uuid.Parse(req.QuoteID)
		if err != nil {
			u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid quote id", nil)
			return
		}
		quoteID = &parsed
	}

	order, err := h.Svc.Create(ctx.Request.Context(), orders.Request{
		SenderID: sender, Sell: money.New(minor, from), PayoutCurrency: payoutIn,
		QuoteID: quoteID, BankCode: req.BankCode, AccountNumber: req.AccountNumber,
		AccountName: req.AccountName, Narration: req.Narration,
		// The integrator's own key: their request times out, they retry, and
		// the same key must return the same order rather than paying twice.
		IdemKey: ctx.GetHeader("Idempotency-Key"),
	})
	if err != nil {
		writeOrderError(ctx, err)
		return
	}
	u.APIResponse(ctx, http.StatusCreated, "success", "Order created", orderView(order))
}

// Get reads one order.
func (h *OrderHandler) Get(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid order id", nil)
		return
	}
	sender, ok := h.User(ctx)
	if !ok {
		return
	}

	order, err := h.Svc.Get(ctx.Request.Context(), id, sender)
	if err != nil {
		writeOrderError(ctx, err)
		return
	}
	u.APIResponse(ctx, http.StatusOK, "success", "Order", orderView(order))
}

// List returns the sender's orders.
func (h *OrderHandler) List(ctx *gin.Context) {
	sender, ok := h.User(ctx)
	if !ok {
		return
	}
	found, err := h.Svc.List(ctx.Request.Context(), sender, 0)
	if err != nil {
		writeOrderError(ctx, err)
		return
	}
	views := make([]orderResponse, 0, len(found))
	for i := range found {
		views = append(views, orderView(&found[i]))
	}
	u.APIResponse(ctx, http.StatusOK, "success", "Orders", views)
}

func writeOrderError(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, orders.ErrNotFound):
		u.APIResponse(ctx, http.StatusNotFound, "error", "No such order",
			map[string]any{"code": "not_found"})
	case errors.Is(err, movements.ErrInsufficientFunds):
		u.APIResponse(ctx, http.StatusPaymentRequired, "error",
			"There is not enough in that balance.",
			map[string]any{"code": "insufficient_funds"})
	case errors.Is(err, rates.ErrQuoteExpired):
		u.APIResponse(ctx, http.StatusConflict, "error",
			"That price has expired. Ask for a new one.",
			map[string]any{"code": "quote_expired"})
	case errors.Is(err, rates.ErrQuoteUsed):
		u.APIResponse(ctx, http.StatusConflict, "error",
			"That price has already been used.", map[string]any{"code": "quote_used"})
	default:
		logger.Errorf("orders: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Something went wrong. Nothing has moved.", nil)
	}
}

// ---------------------------------------------------------------- checkout

// CheckoutHandler serves phone-to-phone payments.
type CheckoutHandler struct {
	Svc      *checkout.Service
	Merchant func(*gin.Context) (uuid.UUID, bool)
	User     func(*gin.Context) (uuid.UUID, bool)
	// CheckoutBaseURL is where a payer opens a request. The merchant app
	// broadcasts this over NFC or shows it as a QR.
	CheckoutBaseURL string
}

type openCheckoutRequest struct {
	Amount    string `json:"amount" binding:"required"`
	Currency  string `json:"currency"`
	Narration string `json:"narration"`
}

type checkoutResponse struct {
	ID          string `json:"id"`
	CheckoutURL string `json:"checkout_url"`

	// Amount is the money type, so the payer's screen shows the same rendering
	// the receipt will. The string form is kept alongside for the merchant app,
	// which reads it into a display it already has.
	Amount    money.Amount `json:"amount"`
	Display   string       `json:"amount_display"`
	Currency  string       `json:"currency"`
	Narration string       `json:"narration,omitempty"`

	// MerchantName is who the payer is paying. Empty when we cannot say --
	// the screen then says "this merchant" rather than inventing a name.
	MerchantName string `json:"merchant_name"`

	State     string `json:"state"`
	ExpiresAt string `json:"expires_at"`
}

// Open creates a payment request for the merchant to broadcast.
func (h *CheckoutHandler) Open(ctx *gin.Context) {
	var req openCheckoutRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid request", u.GetErrorData(err))
		return
	}
	merchant, ok := h.Merchant(ctx)
	if !ok {
		return
	}

	currency := money.NGN
	if req.Currency != "" {
		currency = money.Currency(req.Currency)
		if err := currency.Valid(); err != nil {
			u.APIResponse(ctx, http.StatusBadRequest, "error", err.Error(), nil)
			return
		}
	}
	minor, err := parseDecimalAmount(req.Amount, currency)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", err.Error(), nil)
		return
	}

	c, err := h.Svc.Open(ctx.Request.Context(), merchant, money.New(minor, currency),
		req.Narration, ctx.GetHeader("Idempotency-Key"))
	if err != nil {
		writeCheckoutError(ctx, err)
		return
	}
	u.APIResponse(ctx, http.StatusCreated, "success", "Ready to accept", h.view(ctx.Request.Context(), c))
}

// Get is what the payer's phone opens.
func (h *CheckoutHandler) Get(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid id", nil)
		return
	}
	c, err := h.Svc.Get(ctx.Request.Context(), id)
	if err != nil {
		writeCheckoutError(ctx, err)
		return
	}
	u.APIResponse(ctx, http.StatusOK, "success", "Payment request", h.view(ctx.Request.Context(), c))
}

// Pay settles it from the payer's balance.
func (h *CheckoutHandler) Pay(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid id", nil)
		return
	}
	payer, ok := h.User(ctx)
	if !ok {
		return
	}
	c, err := h.Svc.Pay(ctx.Request.Context(), id, payer)
	if err != nil {
		writeCheckoutError(ctx, err)
		return
	}
	u.APIResponse(ctx, http.StatusOK, "success", "Paid", h.view(ctx.Request.Context(), c))
}

func (h *CheckoutHandler) view(ctx context.Context, c *checkout.Checkout) checkoutResponse {
	return checkoutResponse{
		ID:           c.ID.String(),
		CheckoutURL:  h.CheckoutBaseURL + "/pay/" + c.ID.String(),
		Amount:       c.Amount,
		Display:      c.Amount.String(),
		Currency:     string(c.Amount.Currency()),
		Narration:    c.Narration,
		MerchantName: MerchantName(ctx, c.MerchantID),
		State:        string(c.State),
		ExpiresAt:    c.ExpiresAt.UTC().Format("2006-01-02T15:04:05Z"),
	}
}

func writeCheckoutError(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, checkout.ErrNotFound):
		u.APIResponse(ctx, http.StatusNotFound, "error", "No such payment request",
			map[string]any{"code": "not_found"})
	case errors.Is(err, checkout.ErrNotOpen):
		u.APIResponse(ctx, http.StatusConflict, "error", err.Error(),
			map[string]any{"code": "not_open"})
	case errors.Is(err, checkout.ErrOwnCheckout):
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"You cannot pay your own request.", map[string]any{"code": "own_request"})
	case errors.Is(err, movements.ErrInsufficientFunds):
		u.APIResponse(ctx, http.StatusPaymentRequired, "error",
			"There is not enough in your balance.",
			map[string]any{"code": "insufficient_funds"})
	default:
		logger.Errorf("checkout: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Something went wrong. Nothing has moved.", nil)
	}
}
