// Relink — re-provisioning the SAME physical card after a torn write
// destroyed its NDEF payload, which resync cannot repair because resync
// needs the key that was on the chip.
//
//	POST /v1/cards/me/relink

package cards

import (
	"bytes"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/usezoracle/tapp/api/ent/tappcard"
	userEnt "github.com/usezoracle/tapp/api/ent/user"
	"github.com/usezoracle/tapp/api/storage"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// -----------------------------------------------------------------------------
// POST /v1/cards/me/relink — same-card re-provisioning
// -----------------------------------------------------------------------------

type relinkRequest struct {
	CardUIDHash    string `json:"card_uid_hash"    binding:"required"`
	LinkingProof   string `json:"linking_proof"    binding:"required"`
	PinVerifier    string `json:"pin_verifier"     binding:"required"`
	CardPassword   string `json:"card_password"    binding:"required"`
	CurrentTokenCT string `json:"current_token_ct" binding:"required"`
}

// Relink re-provisions the holder's OWN live card after its NDEF
// payload was destroyed (a torn token-rotation write — interrupted
// post-tap "tap once more" step — leaves the chip with no readable
// Tapp record, and the resync flow can't run because it needs K from
// the card). The PWA reruns the full link ceremony — fresh K, PIN,
// rotation token, card password written to the chip and verified by
// readback — and submits the same material LinkComplete accepts,
// minus everything cap-related: the on-chain CardSpendingCap (and its
// funds) is untouched.
//
// Identity anchor: the chip's hardware UID. The re-provision is
// accepted only when sha256(UID) equals the stored card_uid_hash, so
// this can never bind a DIFFERENT physical card to a funded cap.
// Trust model is identical to LinkComplete — authenticated session +
// the physical card in hand — and grants nothing the holder couldn't
// already do via revoke → reclaim → link → re-fund; it just skips
// destroying the cap.
func (ctrl *Controller) Relink(ctx *gin.Context) {
	var req relinkRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"Failed to validate payload", u.GetErrorData(err))
		return
	}
	user, ok := userFromCtx(ctx)
	if !ok {
		return
	}

	uidHash, err := DecodeHex(req.CardUIDHash)
	if err != nil || len(uidHash) != 32 {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"card_uid_hash must be hex sha256", nil)
		return
	}
	linkingProof, err := DecodeHex(req.LinkingProof)
	if err != nil || len(linkingProof) != 32 {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"linking_proof must be 32-byte hex", nil)
		return
	}
	pinVerifier, err := DecodeHex(req.PinVerifier)
	if err != nil || len(pinVerifier) != 32 {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"pin_verifier must be 32-byte hex", nil)
		return
	}
	cardPwd, err := DecodeHex(req.CardPassword)
	if err != nil || len(cardPwd) != 4 {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"card_password must be 4-byte hex (NTAG215 PWD)", nil)
		return
	}
	currentToken, err := DecodeHex(req.CurrentTokenCT)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"current_token_ct must be hex", nil)
		return
	}

	card, err := storage.Client.TappCard.Query().
		Where(
			tappcard.HasUserWith(userEnt.IDEQ(user.ID)),
			tappcard.StatusEQ(tappcard.StatusLive),
		).
		First(ctx)
	if err != nil {
		u.APIResponse(ctx, http.StatusNotFound, "error",
			"No live card to re-link",
			map[string]any{"code": "no_live_card"})
		return
	}
	if card.CardUIDHash == nil || !bytes.Equal(*card.CardUIDHash, uidHash) {
		u.APIResponse(ctx, http.StatusConflict, "error",
			"This is a different card — revoke your current card before linking a new one",
			map[string]any{"code": "card_uid_mismatch"})
		return
	}

	if _, err := card.Update().
		SetLinkingProof(linkingProof).
		SetPinVerifier(pinVerifier).
		SetCardPassword(cardPwd).
		SetCurrentTokenCiphertext(currentToken).
		SetTokenRotatedAt(time.Now()).
		SetNeedsResync(false).
		SetTokenMismatchCount(0).
		SetPinAttemptsRemaining(5).
		Save(ctx); err != nil {
		logger.Errorf("Relink: persist for card %s: %v", card.ID, err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Failed to re-link card", nil)
		return
	}

	logger.Infof("card %s re-linked by %s (same uid, cap untouched)", card.ID, user.Email)
	u.APIResponse(ctx, http.StatusOK, "success",
		"Card re-linked — your balance and limits are unchanged",
		map[string]any{"card_id": card.ID.String()})
}
