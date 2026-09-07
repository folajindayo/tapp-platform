package v1

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/ent"
	u "github.com/usezoracle/tapp/api/utils"
)

// MerchantFromContext resolves the authenticated caller to a merchant id.
//
// The auth middleware has already put the sender profile on the context; this
// only narrows it to the identifier the tap service needs, so that service
// never has to know what an ent.SenderProfile is.
func MerchantFromContext(ctx *gin.Context) (uuid.UUID, bool) {
	value, exists := ctx.Get("sender")
	if !exists || value == nil {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Not authenticated", nil)
		return uuid.Nil, false
	}
	sender, ok := value.(*ent.SenderProfile)
	if !ok || sender == nil {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Not authenticated as a merchant", nil)
		return uuid.Nil, false
	}
	return sender.ID, true
}
