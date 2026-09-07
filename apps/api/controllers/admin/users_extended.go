package admin

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/ent/identityverificationrequest"
	"github.com/usezoracle/tapp/api/ent/paymentorder"
	"github.com/usezoracle/tapp/api/ent/refreshtoken"
	"github.com/usezoracle/tapp/api/ent/senderprofile"
	userEnt "github.com/usezoracle/tapp/api/ent/user"
	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/storage"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// GetUser returns a single user with profile presence, KYC status, order
// count, ledger balances and card details.
//
//	GET /v1/admin/users/:id
func (c *UsersController) GetUser(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "id must be a uuid", nil)
		return
	}
	user, err := storage.Client.User.Query().
		Where(userEnt.IDEQ(id)).
		WithSenderProfile().
		WithProviderProfile().
		WithTappCards().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			u.APIResponse(ctx, http.StatusNotFound, "error", "user not found", nil)
			return
		}
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "failed to load user", nil)
		return
	}

	kyc := "not_started"
	if ivr, e := storage.Client.IdentityVerificationRequest.Query().
		Where(identityverificationrequest.WalletAddressEQ(id.String())).Only(ctx); e == nil && ivr != nil {
		kyc = ivr.Status.String()
	}

	orderCount := 0
	if user.Edges.SenderProfile != nil {
		orderCount, _ = storage.Client.PaymentOrder.Query().
			Where(paymentorder.HasSenderProfileWith(senderprofile.HasUserWith(userEnt.IDEQ(id)))).
			Count(ctx)
	}

	cardList := make([]gin.H, 0, len(user.Edges.TappCards))
	for _, card := range user.Edges.TappCards {
		cardList = append(cardList, gin.H{
			"id":                        card.ID.String(),
			"status":                    card.Status.String(),
			"needs_resync":              card.NeedsResync,
			"pin_attempts_remaining":    card.PinAttemptsRemaining,
			"token_mismatch_count":      card.TokenMismatchCount,
			"created_at":                card.CreatedAt.Format(tsLayout),
			"daily_limit_subunit":       card.DailyLimitSubunit,
			"per_tap_limit_subunit":     card.PerTapLimitSubunit,
			"step_up_threshold_subunit": card.StepUpThresholdSubunit,
			"spent_today_subunit":       operatorSpentToday(ctx, card.ID),
		})
	}

	// What this user holds, per currency, read from the ledger.
	//
	// This replaces a Sui address and its SUI and USDC balances, which were
	// read over RPC and left empty on any error -- so an operator looking at
	// this screen during an incident saw the same thing as an operator looking
	// at an empty account. Balances come from the ledger now, and a read that
	// fails says so rather than reporting zero.
	balances := make([]gin.H, 0, len(money.SupportedCurrencies()))
	for _, currency := range money.SupportedCurrencies() {
		available, err := ledger.Balance(ctx.Request.Context(), storage.Pool,
			ledger.User(user.ID), ledger.KindAvailable, currency)
		if err != nil {
			logger.Errorf("admin GetUser: balance %s: %v", currency, err)
			u.APIResponse(ctx, http.StatusInternalServerError, "error",
				"failed to read balances", nil)
			return
		}
		escrow, err := ledger.Balance(ctx.Request.Context(), storage.Pool,
			ledger.User(user.ID), ledger.KindEscrow, currency)
		if err != nil {
			logger.Errorf("admin GetUser: escrow %s: %v", currency, err)
			u.APIResponse(ctx, http.StatusInternalServerError, "error",
				"failed to read balances", nil)
			return
		}
		balances = append(balances, gin.H{
			"currency": currency, "available": available, "escrow": escrow,
		})
	}

	u.APIResponse(ctx, http.StatusOK, "success", "ok", gin.H{
		"id":                user.ID.String(),
		"email":             user.Email,
		"first_name":        user.FirstName,
		"last_name":         user.LastName,
		"scope":             user.Scope,
		"is_email_verified": user.IsEmailVerified,
		"has_early_access":  user.HasEarlyAccess,
		"created_at":        user.CreatedAt.Format(tsLayout),
		"has_sender":        user.Edges.SenderProfile != nil,
		"has_provider":      user.Edges.ProviderProfile != nil,
		"tapp_cards":        len(user.Edges.TappCards),
		"kyc_status":        kyc,
		"order_count":       orderCount,
		"balances":          balances,
		"cards":             cardList,
	})
}

func parseUint64(val any) uint64 {
	switch v := val.(type) {
	case string:
		u, _ := strconv.ParseUint(v, 10, 64)
		return u
	case float64:
		return uint64(v)
	case int:
		return uint64(v)
	case int64:
		return uint64(v)
	case uint64:
		return v
	}
	return 0
}

type userPatch struct {
	Scope           *string `json:"scope"`
	IsEmailVerified *bool   `json:"is_email_verified"`
	HasEarlyAccess  *bool   `json:"has_early_access"`
}

// UpdateUser sets a user's scope, email-verified flag, and/or early access.
//
//	PATCH /v1/admin/users/:id
func (c *UsersController) UpdateUser(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "id must be a uuid", nil)
		return
	}
	var body userPatch
	if err := ctx.ShouldBindJSON(&body); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "invalid body", nil)
		return
	}
	upd := storage.Client.User.UpdateOneID(id)
	detail := map[string]any{}
	if body.Scope != nil {
		s := strings.TrimSpace(*body.Scope)
		upd.SetScope(s)
		detail["scope"] = s
	}
	if body.IsEmailVerified != nil {
		upd.SetIsEmailVerified(*body.IsEmailVerified)
		detail["is_email_verified"] = *body.IsEmailVerified
	}
	if body.HasEarlyAccess != nil {
		upd.SetHasEarlyAccess(*body.HasEarlyAccess)
		detail["has_early_access"] = *body.HasEarlyAccess
	}
	if len(detail) == 0 {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "nothing to update", nil)
		return
	}
	if _, err := upd.Save(ctx); err != nil {
		if ent.IsNotFound(err) {
			u.APIResponse(ctx, http.StatusNotFound, "error", "user not found", nil)
			return
		}
		logger.Errorf("admin UpdateUser %s: %v", id, err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "failed to update user", nil)
		return
	}
	writeAudit(ctx, "user.update", id.String(), detail)
	u.APIResponse(ctx, http.StatusOK, "success", "user updated", detail)
}

// RevokeSessions revokes all of a user's active refresh tokens — forcing them to
// re-authenticate everywhere. The closest thing to a "suspend" without a schema
// change; a hard block-login suspend needs an is_active column (a migration).
//
//	POST /v1/admin/users/:id/revoke-sessions
func (c *UsersController) RevokeSessions(ctx *gin.Context) {
	id, err := uuid.Parse(ctx.Param("id"))
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "id must be a uuid", nil)
		return
	}
	n, err := storage.Client.RefreshToken.Update().
		Where(
			refreshtoken.HasOwnerWith(userEnt.IDEQ(id)),
			refreshtoken.RevokedAtIsNil(),
		).
		SetRevokedAt(time.Now()).
		Save(ctx)
	if err != nil {
		logger.Errorf("admin RevokeSessions %s: %v", id, err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "failed to revoke sessions", nil)
		return
	}
	detail := map[string]any{"revoked": n}
	writeAudit(ctx, "user.revoke_sessions", id.String(), detail)
	u.APIResponse(ctx, http.StatusOK, "success", "sessions revoked", detail)
}
