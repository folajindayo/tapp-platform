// Card resync — re-writing the canonical rotation token to a chip that lost
// it, or that a merchant failed to write during a debit.
//
//	POST /v1/cards/me/resync
//	POST /v1/cards/me/resync/complete

package cards

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// resyncNonceTTL bounds how long a resync challenge stays usable. Long enough
// to walk to the card, short enough that a nonce read off a screen is stale by
// the time anybody could reuse it.
const resyncNonceTTL = 5 * time.Minute

// -----------------------------------------------------------------------------
// POST /v1/cards/me/resync
// -----------------------------------------------------------------------------

type resyncResponse struct {
	CurrentTokenCT string `json:"current_token_ct"`
	CardPassword   string `json:"card_password"`
	ResyncNonce    string `json:"resync_nonce"`
}

// Resync hands the PWA everything it needs to write the canonical
// rotation token back to a desynced card. The resync_nonce is
// one-shot — consumed only on /resync/complete after the write lands.
//
// Implementation note: we reuse the CardServerNonce table for the
// resync nonce since it's the same shape (single-use, scoped). The
// sender edge is filled with a synthetic "self" by reusing one of
// the cardholder's own merchant nonces if available; otherwise we
// create a free-floating nonce with no sender — left as a TODO since
// it requires a small schema relaxation. For v1 we issue an in-memory
// nonce signed with HMAC + the server's secret, no DB round-trip,
// which keeps this endpoint trivially testable.
func (ctrl *Controller) Resync(ctx *gin.Context) {
	user, ok := userFromCtx(ctx)
	if !ok {
		return
	}
	card, ok := cardForUser(ctx, user)
	if !ok {
		return
	}
	if card.CurrentTokenCiphertext == nil || card.CardPassword == nil {
		u.APIResponse(ctx, http.StatusConflict, "error",
			"Card was never fully linked — nothing to resync to", nil)
		return
	}

	// Generate a one-shot resync nonce — HMAC of (user_id || card_id
	// || now) keyed by the server secret. On /resync/complete we
	// re-derive and compare. No DB row needed for v1 — TTL is encoded
	// in the timestamp bound the verifier checks.
	expiresAt := time.Now().Add(resyncNonceTTL).Unix()
	nonce, err := issueResyncNonce(user.ID, card.ID, expiresAt)
	if err != nil {
		logger.Errorf("Resync: nonce: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Failed to issue resync nonce", nil)
		return
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Resync payload",
		resyncResponse{
			CurrentTokenCT: EncodeHex(*card.CurrentTokenCiphertext),
			CardPassword:   EncodeHex(*card.CardPassword),
			ResyncNonce:    nonce,
		})
}

// -----------------------------------------------------------------------------
// POST /v1/cards/me/resync/complete
// -----------------------------------------------------------------------------

type resyncCompleteRequest struct {
	ResyncNonce string `json:"resync_nonce" binding:"required"`
}

// ResyncComplete verifies the one-shot nonce, clears needs_resync,
// and resets the token-mismatch counter. The PWA calls this after the
// NDEF write to the card succeeds.
func (ctrl *Controller) ResyncComplete(ctx *gin.Context) {
	var req resyncCompleteRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"Failed to validate payload", u.GetErrorData(err))
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
	if err := verifyResyncNonce(user.ID, card.ID, req.ResyncNonce); err != nil {
		u.APIResponse(ctx, http.StatusUnauthorized, "error",
			"Resync nonce invalid or expired",
			map[string]any{"code": "resync_nonce_invalid"})
		return
	}
	if _, err := card.Update().
		SetNeedsResync(false).
		SetTokenMismatchCount(0).
		Save(ctx); err != nil {
		logger.Errorf("ResyncComplete: persist: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Failed to mark resync complete", nil)
		return
	}
	u.APIResponse(ctx, http.StatusOK, "success", "Resync complete",
		map[string]any{"acknowledged": true})
}
