// Step-up polling for the merchant app.
//
// The merchant shows the cardholder a code, the cardholder approves the
// payment in their own app, and the merchant polls this until it flips. Kept
// from the controller that used to hold the whole debit path; everything else
// in that file was replaced by internal/card/tap, which does the same work in
// one database transaction instead of none.

package cards

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/ent/cardservernonce"
	"github.com/usezoracle/tapp/api/ent/senderprofile"
	"github.com/usezoracle/tapp/api/storage"
	u "github.com/usezoracle/tapp/api/utils"
)

// senderFromCtx narrows the authenticated caller to their merchant profile.
func senderFromCtx(ctx *gin.Context) (*ent.SenderProfile, bool) {
	senderCtx, ok := ctx.Get("sender")
	if !ok || senderCtx == nil {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Invalid API key or token", nil)
		return nil, false
	}
	sender, ok := senderCtx.(*ent.SenderProfile)
	if !ok || sender == nil {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Sender not authenticated", nil)
		return nil, false
	}
	return sender, true
}

// -----------------------------------------------------------------------------

// TapCardStepUpPoll resolves the step-up grant state for the
// merchant app's polling loop. Reads CardServerNonce by ID; reports:
//   - granted  → cardholder completed WebAuthn in their PWA
//   - expired  → nonce TTL elapsed without grant
//   - pending  → still waiting
func (ctrl *Controller) TapCardStepUpPoll(ctx *gin.Context) {
	tokenStr := ctx.Query("token")
	if tokenStr == "" {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"token query param required", nil)
		return
	}
	nonceID, err := uuid.Parse(tokenStr)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"token must be a uuid", nil)
		return
	}
	sender, ok := senderFromCtx(ctx)
	if !ok {
		return
	}
	nonceRow, err := storage.Client.CardServerNonce.
		Query().
		Where(
			cardservernonce.IDEQ(nonceID),
			cardservernonce.HasSenderProfileWith(senderprofile.IDEQ(sender.ID)),
		).
		Only(ctx)
	if err != nil {
		u.APIResponse(ctx, http.StatusNotFound, "error",
			"Step-up token not found", nil)
		return
	}
	now := time.Now()
	if nonceRow.StepUpGrantedAt != nil {
		u.APIResponse(ctx, http.StatusOK, "success", "Granted",
			map[string]any{"status": "granted"})
		return
	}
	if nonceRow.ExpiresAt.Before(now) {
		u.APIResponse(ctx, http.StatusOK, "success", "Expired",
			map[string]any{"status": "expired"})
		return
	}
	u.APIResponse(ctx, http.StatusOK, "success", "Pending",
		map[string]any{"status": "pending"})
}
