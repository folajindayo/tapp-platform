// Card recovery — the escape hatch for a cardholder whose phone cannot run
// Web NFC (which is every iPhone).
//
//	POST /v1/admin/cards/:id/recovery
//
// The reset itself is operator-driven: support reads the code to the holder
// over a call, then performs the resync on an Android device on their behalf.
// The code exists to prove the person on the call is reachable at the address
// on the account, which is the only thing this flow can establish remotely.

package cards

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	svc "github.com/usezoracle/tapp/api/services"
	"github.com/usezoracle/tapp/api/storage"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

type recoveryRequest struct {
	UserEmail string `json:"user_email" binding:"required,email"`
}

// AdminRecovery emails a six-digit recovery code to the cardholder.
func (ctrl *Controller) AdminRecovery(ctx *gin.Context) {
	cardID, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid card id", nil)
		return
	}
	var req recoveryRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"Failed to validate payload", u.GetErrorData(err))
		return
	}

	card, err := storage.Client.TappCard.Get(ctx, cardID)
	if err != nil {
		u.APIResponse(ctx, http.StatusNotFound, "error", "Card not found", nil)
		return
	}

	codeBytes, err := GenerateServerNonce()
	if err != nil {
		logger.Errorf("admin recovery: generate code: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Failed to issue recovery code", nil)
		return
	}
	code := codeFromBytes(codeBytes)

	// A failed send is a failed recovery.
	//
	// The predecessor logged the error, answered 200, and returned the code
	// itself in the response body as `debug_code` -- so an operator was told
	// the cardholder had been emailed when they had not been, and anyone
	// holding the admin token could read a code that was never sent to
	// anybody. Both halves of that are gone: the send must succeed, and the
	// code is never in the response.
	if _, err := emailService().SendCardRecoveryCode(ctx.Request.Context(), req.UserEmail, code); err != nil {
		logger.Errorf("admin recovery: send email: %v", err)
		u.APIResponse(ctx, http.StatusBadGateway, "error",
			"The recovery code could not be emailed. Nothing has been issued.",
			map[string]any{"code": "recovery_email_failed"})
		return
	}

	logger.Infof("admin recovery issued: card=%s email=%s", card.ID, req.UserEmail)
	u.APIResponse(ctx, http.StatusOK, "success", "Recovery code issued",
		map[string]any{
			"acknowledged": true,
			"note":         "Code emailed to the cardholder. Have them read it over the support call.",
		})
}

// emailService lazily instantiates an EmailService over the configured mail
// provider. Same pattern AuthController uses; kept here so the full controller
// wiring is not dragged across packages.
var emailServiceInstance *svc.EmailService

func emailService() *svc.EmailService {
	if emailServiceInstance == nil {
		emailServiceInstance = svc.NewEmailService(svc.DefaultMailProvider())
	}
	return emailServiceInstance
}

// codeFromBytes turns random bytes into a six-digit code. Modulo bias across
// u32 → 1,000,000 is under 1 in 4,000 -- acceptable for a code with a short
// life that is read aloud on a call.
func codeFromBytes(b []byte) string {
	if len(b) < 4 {
		// The caller passes a nonce from crypto/rand, which is always long
		// enough. Returning a fixed string here would make a broken generator
		// look like a working one, so this refuses to produce a code at all
		// and the empty string fails the send.
		return ""
	}
	v := (uint32(b[0])<<24 | uint32(b[1])<<16 | uint32(b[2])<<8 | uint32(b[3])) % 1_000_000
	return zeroPad(v, 6)
}

func zeroPad(v uint32, width int) string {
	s := uint64ToString(uint64(v))
	for len(s) < width {
		s = "0" + s
	}
	return s
}

func uint64ToString(n uint64) string {
	if n == 0 {
		return "0"
	}
	digits := ""
	for n > 0 {
		digits = string(rune('0'+(n%10))) + digits
		n /= 10
	}
	return digits
}
