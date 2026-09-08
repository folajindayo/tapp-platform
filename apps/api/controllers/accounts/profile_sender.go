// The sender profile: who is sending value, and where their payouts go.
//
//	PATCH /v1/settings/sender

package accounts

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/ent/network"
	"github.com/usezoracle/tapp/api/ent/senderordertoken"
	"github.com/usezoracle/tapp/api/ent/senderprofile"
	"github.com/usezoracle/tapp/api/ent/token"
	"github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/types"
	u "github.com/usezoracle/tapp/api/utils"
)

// UpdateSenderProfile controller updates the sender profile
func (ctrl *ProfileController) UpdateSenderProfile(ctx *gin.Context) {
	var payload types.SenderProfilePayload

	if err := ctx.ShouldBindJSON(&payload); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"Failed to validate payload", u.GetErrorData(err))
		return
	}

	if payload.WebhookURL != "" && !u.IsURL(payload.WebhookURL) {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Failed to validate payload", []types.ErrorData{{
			Field:   "WebhookURL",
			Message: "Invalid URL",
		}})
		return
	}

	// Get sender profile from the context
	senderCtx, ok := ctx.Get("sender")
	if !ok {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Invalid API key or token", nil)
		return
	}
	sender := senderCtx.(*ent.SenderProfile)

	update := sender.Update()

	if payload.WebhookURL != "" || (payload.WebhookURL == "" && sender.WebhookURL != "") {
		update.SetWebhookURL(payload.WebhookURL)
	}

	if payload.DomainWhitelist != nil || (payload.DomainWhitelist == nil && sender.DomainWhitelist != nil) {
		update.SetDomainWhitelist(payload.DomainWhitelist)
	}

	// save or update SenderOrderToken
	tx, err := storage.Client.Tx(ctx)
	if err != nil {
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to update profile init", nil)
		return
	}

	for _, tokenPayload := range payload.Tokens {

		if len(tokenPayload.Addresses) == 0 {
			u.APIResponse(ctx, http.StatusBadRequest, "error", fmt.Sprintf("No wallet address provided for %s token", tokenPayload.Symbol), nil)
			return
		}

		// Check if token is supported
		_, err := tx.Token.
			Query().
			Where(token.Symbol(tokenPayload.Symbol)).
			First(ctx)
		if err != nil {
			u.APIResponse(ctx, http.StatusBadRequest, "error", "Token not supported", nil)
			return
		}

		var networksToTokenId map[string]int = map[string]int{}
		for _, address := range tokenPayload.Addresses {

			if strings.HasPrefix(address.Network, "tron") {
				feeAddressIsValid := u.IsValidTronAddress(address.FeeAddress)
				if address.FeeAddress != "" && !feeAddressIsValid {
					u.APIResponse(ctx, http.StatusBadRequest, "error", "Failed to validate payload", types.ErrorData{
						Field:   "FeeAddress",
						Message: "Invalid Tron address",
					})
					return
				}
				networksToTokenId[address.Network] = 0
			} else {
				feeAddressIsValid := u.IsValidEthereumAddress(address.FeeAddress)
				if address.FeeAddress != "" && !feeAddressIsValid {
					u.APIResponse(ctx, http.StatusBadRequest, "error", "Failed to validate payload", types.ErrorData{
						Field:   "FeeAddress",
						Message: "Invalid Ethereum address",
					})
					return
				}
				networksToTokenId[address.Network] = 0
			}
		}

		// Check if network is supported
		for key := range networksToTokenId {
			tokenId, err := tx.Token.
				Query().
				Where(
					token.And(
						token.HasNetworkWith(network.IdentifierEQ(key)),
						token.SymbolEQ(tokenPayload.Symbol),
					)).
				Only(ctx)
			if err != nil {
				u.APIResponse(
					ctx,
					http.StatusBadRequest,
					"error", "Network not supported - "+key,
					nil,
				)
				return
			}
			networksToTokenId[key] = tokenId.ID
		}

		for _, address := range tokenPayload.Addresses {
			senderToken, err := tx.SenderOrderToken.
				Query().
				Where(
					senderordertoken.And(
						senderordertoken.HasTokenWith(token.IDEQ(networksToTokenId[address.Network])),
						senderordertoken.HasSenderWith(senderprofile.IDEQ(sender.ID)),
					),
				).Only(context.Background())
			if err != nil {
				if ent.IsNotFound(err) {
					_, err := tx.SenderOrderToken.
						Create().
						SetSenderID(sender.ID).
						SetTokenID(networksToTokenId[address.Network]).
						SetRefundAddress(address.RefundAddress).
						SetFeePercent(tokenPayload.FeePercent).
						SetFeeAddress(address.FeeAddress).
						Save(context.Background())
					if err != nil {
						u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to update profile", nil)
						return
					}
				} else {
					u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to update profile err:", nil)
					return
				}

			} else {
				_, err := senderToken.
					Update().
					SetRefundAddress(address.RefundAddress).
					SetFeePercent(tokenPayload.FeePercent).
					SetFeeAddress(address.FeeAddress).
					Save(context.Background())
				if err != nil {
					u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to update profile", nil)
					return
				}
			}
		}
	}

	// Commit the transaction
	if err := tx.Commit(); err != nil {
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to update profile commit", nil)
		return
	}

	if !sender.IsActive {
		update.SetIsActive(true)
	}

	_, err = update.Save(ctx)
	if err != nil {
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to update profile", nil)
		return
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Profile updated successfully", nil)
}
