package v1

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/ent/merchantbankaccount"
	"github.com/usezoracle/tapp/api/ent/senderprofile"
	"github.com/usezoracle/tapp/api/storage"
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

// MerchantName resolves a merchant's display name for the payer's screen.
//
// The payer is about to hand over money and the first thing they need is who
// to. Preference order is deliberate: the bank account name was resolved
// against the bank when the merchant saved it, so it is the one name here that
// somebody had to prove. The account holder's own name comes next.
//
// When neither is known this returns empty rather than a placeholder like
// "Merchant". The screen then says "this merchant", which is true; a
// fabricated name on a payment confirmation is not.
func MerchantName(ctx context.Context, merchantID uuid.UUID) string {
	if account, err := storage.Client.MerchantBankAccount.Query().
		Where(merchantbankaccount.HasSenderProfileWith(senderprofile.IDEQ(merchantID))).
		Only(ctx); err == nil && account.AccountName != "" {
		return account.AccountName
	}

	profile, err := storage.Client.SenderProfile.Query().
		Where(senderprofile.IDEQ(merchantID)).
		WithUser().
		Only(ctx)
	if err != nil || profile.Edges.User == nil {
		return ""
	}
	name := strings.TrimSpace(profile.Edges.User.FirstName + " " + profile.Edges.User.LastName)
	return name
}
