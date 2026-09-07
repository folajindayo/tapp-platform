package v1

import (
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/usezoracle/tapp/api/internal/card/tap"
	"github.com/usezoracle/tapp/api/internal/ledger/movements"
	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/internal/rates"
	"github.com/usezoracle/tapp/api/storage"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// ConvertHandler prices and executes currency conversions.
//
// Two steps on purpose. The customer is shown a price, and then accepts it.
// Collapsing them into one call would mean converting at whatever the rate
// happened to be when the request arrived -- which is what the predecessor
// did, and why nobody could say afterwards what anyone should have received.
type ConvertHandler struct {
	Quoter *rates.Quoter
	// User resolves the authenticated caller.
	User func(*gin.Context) (uuid.UUID, bool)
}

type quoteRequest struct {
	Sell string `json:"sell"     binding:"required"`
	From string `json:"from"     binding:"required"`
	To   string `json:"to"       binding:"required"`
}

type quoteResponse struct {
	QuoteID   string `json:"quote_id"`
	Sell      string `json:"sell"`
	Receive   string `json:"receive"`
	Fee       string `json:"fee"`
	Rate      string `json:"rate"`
	SpreadBPS int    `json:"spread_bps"`
	ExpiresAt string `json:"expires_at"`
}

// Quote offers a price.
func (h *ConvertHandler) Quote(ctx *gin.Context) {
	var req quoteRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid request", u.GetErrorData(err))
		return
	}
	if _, ok := h.User(ctx); !ok {
		return
	}

	from, to := money.Currency(req.From), money.Currency(req.To)
	if err := from.Valid(); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", err.Error(), nil)
		return
	}
	if err := to.Valid(); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", err.Error(), nil)
		return
	}

	minor, err := parseDecimalAmount(req.Sell, from)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", err.Error(), nil)
		return
	}

	quote, err := h.Quoter.Offer(ctx.Request.Context(), money.New(minor, from), to)
	if err != nil {
		writeQuoteError(ctx, err)
		return
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Price offered", quoteResponse{
		QuoteID:   quote.ID.String(),
		Sell:      quote.Sell.String(),
		Receive:   quote.Buy.String(),
		Fee:       quote.Fee.String(),
		Rate:      quote.MarketRate.String(),
		SpreadBPS: quote.SpreadBPS,
		ExpiresAt: quote.ExpiresAt.UTC().Format("2006-01-02T15:04:05Z"),
	})
}

type executeRequest struct {
	QuoteID string `json:"quote_id" binding:"required"`
}

// Execute accepts a price and moves the money.
//
// The quote is redeemed and the ledger entries posted in one transaction, so a
// price can never be consumed without the conversion happening, nor a
// conversion happen at a price nobody claimed.
func (h *ConvertHandler) Execute(ctx *gin.Context) {
	var req executeRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid request", u.GetErrorData(err))
		return
	}
	user, ok := h.User(ctx)
	if !ok {
		return
	}
	quoteID, err := uuid.Parse(req.QuoteID)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid quote id", nil)
		return
	}

	var receipt quoteResponse
	err = movements.InTx(ctx.Request.Context(), storage.Pool, func(tx pgx.Tx) error {
		quote, err := h.Quoter.Redeem(ctx.Request.Context(), tx, quoteID)
		if err != nil {
			return err
		}
		if _, err := movements.Convert(ctx.Request.Context(), tx, user, movements.Conversion{
			Sold:    quote.Sell,
			Bought:  quote.Buy,
			Spread:  quote.Fee,
			QuoteID: quote.ID.String(),
		}); err != nil {
			return err
		}
		receipt = quoteResponse{
			QuoteID:   quote.ID.String(),
			Sell:      quote.Sell.String(),
			Receive:   quote.Buy.String(),
			Fee:       quote.Fee.String(),
			Rate:      quote.MarketRate.String(),
			SpreadBPS: quote.SpreadBPS,
		}
		return nil
	})
	if err != nil {
		writeQuoteError(ctx, err)
		return
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Converted", receipt)
}

func writeQuoteError(ctx *gin.Context, err error) {
	switch {
	case errors.Is(err, rates.ErrQuoteExpired):
		u.APIResponse(ctx, http.StatusConflict, "error",
			"That price has expired. Ask for a new one.",
			map[string]any{"code": "quote_expired"})
	case errors.Is(err, rates.ErrQuoteUsed):
		u.APIResponse(ctx, http.StatusConflict, "error",
			"That conversion has already gone through.",
			map[string]any{"code": "quote_used"})
	case errors.Is(err, rates.ErrQuoteUnknown):
		u.APIResponse(ctx, http.StatusNotFound, "error",
			"No such price.", map[string]any{"code": "quote_unknown"})
	case errors.Is(err, rates.ErrNoRate), errors.Is(err, rates.ErrStale):
		// Not a fault. Refusing to quote is correct when nothing can price the
		// pair -- the alternative is offering a number nobody can honour.
		logger.Errorf("convert: %v", err)
		u.APIResponse(ctx, http.StatusServiceUnavailable, "error",
			"We cannot price this right now. Please try again shortly.",
			map[string]any{"code": "rate_unavailable"})
	case errors.Is(err, movements.ErrInsufficientFunds):
		u.APIResponse(ctx, http.StatusPaymentRequired, "error",
			"There is not enough in that balance.",
			map[string]any{"code": "insufficient_funds"})
	default:
		logger.Errorf("convert failed: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Something went wrong. Nothing has been converted.", nil)
	}
}

// parseDecimalAmount reads a decimal into minor units, exactly.
//
// The same parser the card path uses. Two different readings of "1500.00"
// would be a way to make an executed conversion disagree with the price that
// was quoted.
func parseDecimalAmount(s string, c money.Currency) (int64, error) {
	return tap.ParseAmount(s, c)
}
