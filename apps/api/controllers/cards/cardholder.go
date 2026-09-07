// Cardholder-facing Tapp Card endpoints — what the PWA drives once a card is
// linked.
//
//	GET  /v1/cards/me
//	POST /v1/cards/me/limits
//	POST /v1/cards/revoke
//	POST /v1/cards/reset
//
// Linking itself is a session resource and lives in internal/card/link.
// Resync, relink and admin recovery are in the sibling files.
//
// All of these sit behind middleware.JWTMiddleware and derive the user from
// the JWT's `user_id` claim.

package cards

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/ent/cardservernonce"
	"github.com/usezoracle/tapp/api/ent/tappcard"
	userEnt "github.com/usezoracle/tapp/api/ent/user"
	tapsvc "github.com/usezoracle/tapp/api/internal/card/tap"
	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/storage"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

func userFromCtx(ctx *gin.Context) (*ent.User, bool) {
	v, exists := ctx.Get("user_id")
	if !exists {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Not authenticated", nil)
		return nil, false
	}
	userID, err := uuid.Parse(v.(string))
	if err != nil {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Invalid session", nil)
		return nil, false
	}
	user, err := storage.Client.User.
		Query().
		Where(userEnt.IDEQ(userID)).
		Only(ctx)
	if err != nil {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "User not found", nil)
		return nil, false
	}
	return user, true
}

// cardForUser loads the user's single linked card. v1 enforces 1:1
// user↔card; multi-card support lives in v2 and would replace this
// with a `card_id` route param.
func cardForUser(ctx *gin.Context, user *ent.User) (*ent.TappCard, bool) {
	// Prefer the user's LIVE card over abandoned claimed/issued attempts.
	// Without this, a user who re-runs linking sees the new *claimed* row
	// here and the client cannot tell they already have a working card.
	// Falling back to most-recent keeps first-time linking working.
	live, err := storage.Client.TappCard.
		Query().
		Where(
			tappcard.HasUserWith(userEnt.IDEQ(user.ID)),
			tappcard.StatusEQ(tappcard.StatusLive),
		).
		Order(ent.Desc(tappcard.FieldCreatedAt)).
		First(ctx)
	if err == nil {
		return live, true
	}

	card, err := storage.Client.TappCard.
		Query().
		Where(tappcard.HasUserWith(userEnt.IDEQ(user.ID))).
		Order(ent.Desc(tappcard.FieldCreatedAt)).
		First(ctx)
	if err != nil {
		u.APIResponse(ctx, http.StatusNotFound, "error",
			"No card linked to this account",
			map[string]any{"code": "card_not_linked"})
		return nil, false
	}
	return card, true
}

// -----------------------------------------------------------------------------
// GET /v1/cards/me
// -----------------------------------------------------------------------------

type cardSummaryResponse struct {
	ID     string `json:"id"`
	Status string `json:"status"`

	DailyLimitSubunit      uint64 `json:"daily_limit_subunit"`
	PerTapLimitSubunit     uint64 `json:"per_tap_limit_subunit"`
	StepUpThresholdSubunit uint64 `json:"step_up_threshold_subunit"`
	SpentTodaySubunit      uint64 `json:"spent_today_subunit"`

	// Spendable is the holder's ledger balance, which is what the card
	// actually spends. Its predecessor reported an on-chain "cap balance"
	// read over RPC that returned "0" on any error -- so an unreachable node
	// and an empty card were the same answer.
	Spendable money.Amount `json:"spendable"`

	NeedsResync          bool `json:"needs_resync"`
	PinAttemptsRemaining int  `json:"pin_attempts_remaining"`
}

// Me returns the cardholder's card summary. Drives the PWA dashboard and the
// "needs resync" banner.
func (ctrl *Controller) Me(ctx *gin.Context) {
	user, ok := userFromCtx(ctx)
	if !ok {
		return
	}
	card, ok := cardForUser(ctx, user)
	if !ok {
		return
	}

	spendable, err := ledger.Balance(ctx.Request.Context(), storage.Pool,
		ledger.User(user.ID), ledger.KindAvailable, money.NGN)
	if err != nil {
		// The balance is the headline number on this screen. Reporting a
		// summary with a wrong one is worse than reporting none: somebody
		// decides whether to tap on the strength of it.
		logger.Errorf("cards/me: balance: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"We could not read your card just now.", nil)
		return
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Card", cardSummaryResponse{
		ID:                     card.ID.String(),
		Status:                 string(card.Status),
		DailyLimitSubunit:      card.DailyLimitSubunit,
		PerTapLimitSubunit:     card.PerTapLimitSubunit,
		StepUpThresholdSubunit: card.StepUpThresholdSubunit,
		SpentTodaySubunit:      spentTodayMinor(ctx, card.ID),
		Spendable:              spendable,
		NeedsResync:            card.NeedsResync,
		PinAttemptsRemaining:   card.PinAttemptsRemaining,
	})
}

// -----------------------------------------------------------------------------
// POST /v1/cards/reset
// -----------------------------------------------------------------------------

// Reset deletes all of the user's card rows so they can link again.
//
// It no longer refuses while an on-chain cap holds a balance, because there is
// no cap and no on-chain balance: the money is in the ledger, keyed to the
// user rather than to the card, and deleting a card row cannot orphan it.
func (ctrl *Controller) Reset(ctx *gin.Context) {
	user, ok := userFromCtx(ctx)
	if !ok {
		return
	}

	// Per-card server nonces reference the card, so they go first.
	if _, err := storage.Client.CardServerNonce.Delete().
		Where(cardservernonce.HasCardWith(tappcard.HasUserWith(userEnt.IDEQ(user.ID)))).
		Exec(ctx); err != nil {
		logger.Errorf("Reset: delete nonces: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Failed to reset cards", nil)
		return
	}
	n, err := storage.Client.TappCard.Delete().
		Where(tappcard.HasUserWith(userEnt.IDEQ(user.ID))).
		Exec(ctx)
	if err != nil {
		logger.Errorf("Reset: delete cards: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Failed to reset cards", nil)
		return
	}
	u.APIResponse(ctx, http.StatusOK, "success", "Cards reset", gin.H{"deleted": n})
}

// -----------------------------------------------------------------------------
// POST /v1/cards/revoke
// -----------------------------------------------------------------------------

// Revoke stops the card.
//
// This is now a real revocation rather than a description of one. The
// predecessor returned a Move call for the holder to sign and marked the row
// optimistically, so a card was "revoked" in the database whether or not
// anything was ever signed. A revoked card is refused inside the debit
// transaction, which is the only place a refusal counts.
func (ctrl *Controller) Revoke(ctx *gin.Context) {
	user, ok := userFromCtx(ctx)
	if !ok {
		return
	}
	card, ok := cardForUser(ctx, user)
	if !ok {
		return
	}
	if card.Status == tappcard.StatusRevoked {
		u.APIResponse(ctx, http.StatusOK, "success", "Card already revoked",
			gin.H{"card_id": card.ID.String(), "status": string(card.Status)})
		return
	}

	updated, err := card.Update().SetStatus(tappcard.StatusRevoked).Save(ctx)
	if err != nil {
		logger.Errorf("Revoke: persist: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Failed to revoke the card. It is still active.", nil)
		return
	}
	u.APIResponse(ctx, http.StatusOK, "success", "Card revoked",
		gin.H{"card_id": updated.ID.String(), "status": string(updated.Status)})
}

// -----------------------------------------------------------------------------
// POST /v1/cards/me/limits
// -----------------------------------------------------------------------------

type updateLimitsRequest struct {
	DailyLimitSubunit      uint64 `json:"daily_limit_subunit"`
	PerTapLimitSubunit     uint64 `json:"per_tap_limit_subunit"`
	StepUpThresholdSubunit uint64 `json:"step_up_threshold_subunit"`
}

// UpdateLimits saves new spend limits.
//
// The limits are enforced inside the debit transaction against these columns,
// so saving them here is the whole operation. The predecessor also returned a
// Move call to sign -- and refused outright unless the card carried a Sui
// object id, which no card linked through the current flow has. Every attempt
// to change a limit answered 409.
func (ctrl *Controller) UpdateLimits(ctx *gin.Context) {
	var req updateLimitsRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"Failed to validate payload", u.GetErrorData(err))
		return
	}
	// Validated explicitly rather than with `binding:"required"`, because zero
	// is a meaningful value here and `required` rejects it.
	if req.PerTapLimitSubunit == 0 ||
		req.PerTapLimitSubunit > req.StepUpThresholdSubunit ||
		req.StepUpThresholdSubunit > req.DailyLimitSubunit {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"Limits must satisfy: 0 < per-tap ≤ step-up ≤ daily",
			map[string]any{"code": "limits_invalid"})
		return
	}

	user, ok := userFromCtx(ctx)
	if !ok {
		return
	}
	card, ok := cardForUser(ctx, user)
	if !ok {
		return
	}
	// Only a live card has limits worth editing. A card still being linked has
	// its limits set by the linking session itself, so accepting them here
	// would save values that the next step of linking overwrites -- the user
	// would be told their change was saved and then find it was not.
	//
	// The predecessor refused on a different test: whether the card carried a
	// Sui object id. No card linked through the current flow carries one, so
	// that check refused every card there is.
	if card.Status != tappcard.StatusLive {
		u.APIResponse(ctx, http.StatusConflict, "error",
			"Finish linking your card before changing its limits",
			map[string]any{"code": "card_not_live"})
		return
	}

	updated, err := card.Update().
		SetDailyLimitSubunit(req.DailyLimitSubunit).
		SetPerTapLimitSubunit(req.PerTapLimitSubunit).
		SetStepUpThresholdSubunit(req.StepUpThresholdSubunit).
		Save(ctx)
	if err != nil {
		logger.Errorf("UpdateLimits: persist: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Failed to save limits", nil)
		return
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Limits saved", gin.H{
		"daily_limit_subunit":       updated.DailyLimitSubunit,
		"per_tap_limit_subunit":     updated.PerTapLimitSubunit,
		"step_up_threshold_subunit": updated.StepUpThresholdSubunit,
	})
}

// spentTodayMinor reads what this card has spent today from the tap record.
//
// The card row carries a spent_today_subunit column that is no longer written:
// it was a counter incremented outside any transaction, raced by concurrent
// taps, and compared against a day index that was never checked, so it never
// reset. Reporting it now would show every cardholder a permanent zero.
//
// A read failure reports zero and logs. This is a display field, and nothing
// decides anything on the basis of it -- the limit itself is enforced inside
// the debit transaction, from the same source.
func spentTodayMinor(ctx *gin.Context, cardID uuid.UUID) uint64 {
	spent, err := tapsvc.SpentToday(ctx.Request.Context(), storage.Pool, cardID, money.NGN, time.Now())
	if err != nil {
		logger.Errorf("cardholder: today's spend for card %s: %v", cardID, err)
		return 0
	}
	if spent.Minor() < 0 {
		return 0
	}
	return uint64(spent.Minor())
}
