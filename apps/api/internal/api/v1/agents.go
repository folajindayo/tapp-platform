package v1

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/usezoracle/tapp/api/internal/agents"
	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/ledger/movements"
	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/storage"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// AgentHandler serves the agent network: registering premises, finding nearby
// ones, and moving float to them.
type AgentHandler struct {
	Store *agents.Store
	User  func(*gin.Context) (uuid.UUID, bool)
}

type registerAgentRequest struct {
	Name     string  `json:"name"      binding:"required"`
	Kind     string  `json:"kind"      binding:"required"`
	Address  string  `json:"address"   binding:"required"`
	Phone    string  `json:"phone"`
	Lat      float64 `json:"lat"       binding:"required"`
	Lng      float64 `json:"lng"       binding:"required"`
	OpensAt  string  `json:"opens_at"  binding:"required"`
	ClosesAt string  `json:"closes_at" binding:"required"`
}

// Register adds premises to the network, unverified.
//
// Open to any authenticated user: anybody can put their shop forward. It takes
// no handovers until somebody has confirmed the premises exist, which is the
// operator-gated Verify below.
func (h *AgentHandler) Register(ctx *gin.Context) {
	var req registerAgentRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid request", u.GetErrorData(err))
		return
	}
	operator, ok := h.User(ctx)
	if !ok {
		return
	}

	agent, err := h.Store.Register(ctx.Request.Context(), agents.Registration{
		OperatorID: operator, Name: req.Name, Kind: agents.Kind(req.Kind),
		Address: req.Address, Phone: req.Phone, Lat: req.Lat, Lng: req.Lng,
		OpensAt: req.OpensAt, ClosesAt: req.ClosesAt,
	})
	if err != nil {
		if errors.Is(err, agents.ErrDuplicate) {
			u.APIResponse(ctx, http.StatusConflict, "error",
				"These premises are already registered.", nil)
			return
		}
		// A rejected registration is the caller's mistake, and the message
		// names what was wrong so they can fix it.
		u.APIResponse(ctx, http.StatusBadRequest, "error", err.Error(), nil)
		return
	}

	u.APIResponse(ctx, http.StatusCreated, "success",
		"Registered. It will take handovers once verified.", agent)
}

// Nearby finds agents a trader can walk to.
func (h *AgentHandler) Nearby(ctx *gin.Context) {
	lat, err := strconv.ParseFloat(ctx.Query("lat"), 64)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "lat is required", nil)
		return
	}
	lng, err := strconv.ParseFloat(ctx.Query("lng"), 64)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "lng is required", nil)
		return
	}

	search := agents.Search{Lat: lat, Lng: lng, OpenAt: time.Now()}
	if r := ctx.Query("radius"); r != "" {
		if search.RadiusM, err = strconv.Atoi(r); err != nil {
			u.APIResponse(ctx, http.StatusBadRequest, "error", "radius must be a number of metres", nil)
			return
		}
	}
	if a := ctx.Query("amount"); a != "" {
		// Filtering by amount is what makes the list useful: an agent who
		// cannot cover the handover is not a result, however close.
		minor, err := parseDecimalAmount(a, money.NGN)
		if err != nil {
			u.APIResponse(ctx, http.StatusBadRequest, "error", err.Error(), nil)
			return
		}
		search.Amount = money.New(minor, money.NGN)
	}

	found, err := h.Store.Nearby(ctx.Request.Context(), search)
	if err != nil {
		logger.Errorf("agents: nearby: %v", err)
		u.APIResponse(ctx, http.StatusBadRequest, "error", err.Error(), nil)
		return
	}
	u.APIResponse(ctx, http.StatusOK, "success", "Agents nearby", found)
}

// Verify confirms premises exist. Operator-gated.
func (h *AgentHandler) Verify(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid agent id", nil)
		return
	}
	if err := h.Store.Verify(ctx.Request.Context(), id); err != nil {
		if errors.Is(err, agents.ErrNotFound) {
			u.APIResponse(ctx, http.StatusNotFound, "error", "No such agent", nil)
			return
		}
		logger.Errorf("agents: verify: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Could not verify", nil)
		return
	}
	u.APIResponse(ctx, http.StatusOK, "success", "Verified", nil)
}

type allocateRequest struct {
	Amount    string `json:"amount"    binding:"required"`
	Currency  string `json:"currency"`
	Reference string `json:"reference" binding:"required"`
}

// Allocate moves platform capital into an agent's float. Operator-gated.
//
// The reference is required and is the idempotency key. An operator running an
// allocation twice -- which happens, because the first response was slow --
// must not double the agent's float.
func (h *AgentHandler) Allocate(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid agent id", nil)
		return
	}
	var req allocateRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid request", u.GetErrorData(err))
		return
	}

	currency := money.Currency(req.Currency)
	if req.Currency == "" {
		currency = money.NGN
	}
	if err := currency.Valid(); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", err.Error(), nil)
		return
	}
	minor, err := parseDecimalAmount(req.Amount, currency)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", err.Error(), nil)
		return
	}

	err = movements.InTx(ctx.Request.Context(), storage.Pool, func(tx pgx.Tx) error {
		_, e := movements.AllocateFloat(ctx.Request.Context(), tx, id,
			money.New(minor, currency), req.Reference)
		return e
	})
	switch {
	case errors.Is(err, movements.ErrInsufficientFunds):
		u.APIResponse(ctx, http.StatusPaymentRequired, "error",
			"The treasury does not hold enough to allocate that.",
			map[string]any{"code": "treasury_insufficient"})
	case errors.Is(err, ledger.ErrDuplicate):
		// Not an error to the caller: the allocation they asked for has
		// happened. Reporting a failure would invite them to retry again.
		u.APIResponse(ctx, http.StatusOK, "success", "Already allocated", nil)
	case err != nil:
		logger.Errorf("agents: allocate: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Could not allocate. Nothing has moved.", nil)
	default:
		u.APIResponse(ctx, http.StatusOK, "success", "Allocated", nil)
	}
}
