package v1

import (
	"encoding/base64"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/internal/agents"
	"github.com/usezoracle/tapp/api/internal/cash"
	"github.com/usezoracle/tapp/api/internal/money"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// MaxImageBytes bounds an uploaded photograph.
//
// A phone photograph downscaled for upload is a few hundred kilobytes. Six
// megabytes is generous for that and small enough that somebody cannot exhaust
// memory by posting full-resolution files in a loop.
const MaxImageBytes = 6 << 20

// CashHandler serves the cash pledge flow.
type CashHandler struct {
	Svc    *cash.Service
	Agents *agents.Store
	User   func(*gin.Context) (uuid.UUID, bool)
}

type pledgeRequest struct {
	Amount string  `json:"amount" binding:"required"`
	Lat    float64 `json:"lat"    binding:"required"`
	Lng    float64 `json:"lng"    binding:"required"`
	// Image is base64. The client captures it, downscales it, and sends it
	// once; the server hashes it and keeps the hash, not the picture.
	Image  string `json:"image"  binding:"required"`
	Device string `json:"device"`
}

// Pledge accepts a photograph of cash.
func (h *CashHandler) Pledge(ctx *gin.Context) {
	var req pledgeRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid request", u.GetErrorData(err))
		return
	}
	trader, ok := h.User(ctx)
	if !ok {
		return
	}

	image, err := base64.StdEncoding.DecodeString(req.Image)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "The photo could not be read", nil)
		return
	}
	if len(image) > MaxImageBytes {
		u.APIResponse(ctx, http.StatusRequestEntityTooLarge, "error",
			"That photo is too large. Please try again.", nil)
		return
	}

	minor, err := parseDecimalAmount(req.Amount, money.NGN)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", err.Error(), nil)
		return
	}

	pledge, err := h.Svc.Pledge(ctx.Request.Context(), cash.Request{
		TraderID: trader, Declared: money.New(minor, money.NGN),
		Lat: req.Lat, Lng: req.Lng, Image: image, Device: req.Device,
	})
	if err != nil {
		writeCashError(ctx, err, pledge)
		return
	}
	u.APIResponse(ctx, http.StatusCreated, "success",
		"Pledge accepted. Find an agent to hand the cash to.", pledge)
}

// Match offers the pledge to a nearby agent and locks their float.
func (h *CashHandler) Match(ctx *gin.Context) {
	pledgeID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid pledge id", nil)
		return
	}
	trader, ok := h.User(ctx)
	if !ok {
		return
	}

	handover, err := h.Svc.Match(ctx.Request.Context(), h.Agents, pledgeID, trader)
	if err != nil {
		writeCashError(ctx, err, nil)
		return
	}
	u.APIResponse(ctx, http.StatusOK, "success", "An agent is expecting you", handover)
}

type confirmRequest struct {
	// Code is required from the agent, who is told it by the person standing
	// in front of them. The trader does not send one -- they are the one
	// reading it out.
	Code string `json:"code"`
}

// ConfirmByTrader records the trader's side of a handover.
func (h *CashHandler) ConfirmByTrader(ctx *gin.Context) {
	h.confirm(ctx, true)
}

// ConfirmByAgent records the agent's side.
func (h *CashHandler) ConfirmByAgent(ctx *gin.Context) {
	h.confirm(ctx, false)
}

func (h *CashHandler) confirm(ctx *gin.Context, isTrader bool) {
	handoverID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid handover id", nil)
		return
	}
	actor, ok := h.User(ctx)
	if !ok {
		return
	}

	var req confirmRequest
	_ = ctx.ShouldBindJSON(&req)

	var handover *cash.Handover
	if isTrader {
		handover, err = h.Svc.ConfirmByTrader(ctx.Request.Context(), handoverID, actor)
	} else {
		handover, err = h.Svc.ConfirmByAgent(ctx.Request.Context(), handoverID, actor, req.Code)
	}
	if err != nil {
		writeCashError(ctx, err, nil)
		return
	}

	message := "Confirmed. Waiting for the other side."
	if handover.State == cash.HandoverCompleted {
		message = "Done. The money is in the trader's balance."
	}
	u.APIResponse(ctx, http.StatusOK, "success", message, handover)
}

// writeCashError maps a refusal onto a status and a code the client can act on.
func writeCashError(ctx *gin.Context, err error, pledge *cash.Pledge) {
	switch {
	case errors.Is(err, cash.ErrAlreadyPledged):
		// The double-spend guard. Worth its own code: the app should tell
		// somebody these specific notes are already committed, not that
		// something went wrong.
		u.APIResponse(ctx, http.StatusConflict, "error", err.Error(),
			map[string]any{"code": "already_pledged"})
	case errors.Is(err, cash.ErrRefused):
		// A refusal describes what was seen. Most people who see one will not
		// have done anything wrong.
		u.APIResponse(ctx, http.StatusUnprocessableEntity, "error", err.Error(),
			map[string]any{"code": "pledge_refused", "pledge": pledge})
	case errors.Is(err, cash.ErrNoAgent):
		u.APIResponse(ctx, http.StatusServiceUnavailable, "error",
			"No agent nearby can take this right now. Try again shortly, or a smaller amount.",
			map[string]any{"code": "no_agent"})
	case errors.Is(err, cash.ErrPledgeUnknown):
		u.APIResponse(ctx, http.StatusNotFound, "error", "Not found",
			map[string]any{"code": "not_found"})
	case errors.Is(err, cash.ErrWrongCode):
		u.APIResponse(ctx, http.StatusForbidden, "error",
			"That code is not right. Ask them to read it again.",
			map[string]any{"code": "wrong_code"})
	case errors.Is(err, cash.ErrWrongState):
		u.APIResponse(ctx, http.StatusConflict, "error", err.Error(),
			map[string]any{"code": "wrong_state"})
	default:
		logger.Errorf("cash: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Something went wrong. Nothing has moved.", nil)
	}
}
