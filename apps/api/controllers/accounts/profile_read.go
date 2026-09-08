// Reading a profile back.
//
//	GET /v1/settings/sender
//	GET /v1/settings/provider

package accounts

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/ent/providerprofile"
	"github.com/usezoracle/tapp/api/ent/senderordertoken"
	"github.com/usezoracle/tapp/api/ent/senderprofile"
	"github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/types"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// GetSenderProfile retrieves the sender profile
func (ctrl *ProfileController) GetSenderProfile(ctx *gin.Context) {
	// Get sender profile from the context
	senderCtx, ok := ctx.Get("sender")
	if !ok {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Invalid API key or token", nil)
		return
	}
	sender := senderCtx.(*ent.SenderProfile)

	user, err := sender.QueryUser().Only(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to retrieve profile 4", nil)
		return
	}

	// Get API key
	apiKey, err := ctrl.apiKeyService.GetAPIKey(ctx, sender, nil)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to retrieve profile 3", nil)
		return
	}

	senderToken, err := storage.Client.SenderOrderToken.
		Query().
		Where(senderordertoken.HasSenderWith(senderprofile.IDEQ(sender.ID))).
		WithToken(
			func(tq *ent.TokenQuery) {
				tq.WithNetwork()
			},
		).
		All(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to retrieve profile 2", nil)
		return
	}

	tokensPayload := make([]types.SenderOrderTokenResponse, len(sender.Edges.OrderTokens))
	for i, token := range senderToken {
		payload := types.SenderOrderTokenResponse{
			Symbol:        token.Edges.Token.Symbol,
			RefundAddress: token.RefundAddress,
			FeePercent:    token.FeePercent,
			FeeAddress:    token.FeeAddress,
			Network:       token.Edges.Token.Edges.Network.Identifier,
		}

		tokensPayload[i] = payload
	}

	response := &types.SenderProfileResponse{
		ID:              sender.ID,
		FirstName:       user.FirstName,
		LastName:        user.LastName,
		Email:           user.Email,
		WebhookURL:      sender.WebhookURL,
		DomainWhitelist: sender.DomainWhitelist,
		Tokens:          tokensPayload,
		APIKey:          *apiKey,
		IsActive:        sender.IsActive,
	}

	linkedProvider, err := storage.Client.ProviderProfile.
		Query().
		Where(providerprofile.IDEQ(sender.ProviderID)).
		WithCurrency().
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			// do nothing
		} else {
			logger.Errorf("error: %v", err)
			u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to retrieve profile 1", nil)
			return
		}
	}

	if linkedProvider != nil {
		response.ProviderID = sender.ProviderID
		response.ProviderCurrency = linkedProvider.Edges.Currency.Code
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Profile retrieved successfully", response)
}

// GetProviderProfile retrieves the provider profile
func (ctrl *ProfileController) GetProviderProfile(ctx *gin.Context) {
	// Get provider profile from the context
	providerCtx, ok := ctx.Get("provider")
	if !ok {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Invalid API key or token", nil)
		return
	}
	provider := providerCtx.(*ent.ProviderProfile)

	user, err := provider.QueryUser().Only(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to retrieve profile", nil)
		return
	}

	// Get currency
	currency, err := provider.QueryCurrency().Only(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to retrieve profile", nil)
		return
	}

	// Get tokens
	tokens, err := provider.QueryOrderTokens().All(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to retrieve profile", nil)
		return
	}

	tokensPayload := make([]types.ProviderOrderTokenPayload, len(tokens))
	for i, token := range tokens {
		payload := types.ProviderOrderTokenPayload{
			Symbol:                 token.Symbol,
			ConversionRateType:     token.ConversionRateType,
			FixedConversionRate:    token.FixedConversionRate,
			FloatingConversionRate: token.FloatingConversionRate,
			MaxOrderAmount:         token.MaxOrderAmount,
			MinOrderAmount:         token.MinOrderAmount,
			Addresses: make([]struct {
				Address string `json:"address"`
				Network string `json:"network"`
			}, len(token.Addresses)),
		}

		for j, address := range token.Addresses {
			payload.Addresses[j] = struct {
				Address string `json:"address"`
				Network string `json:"network"`
			}{
				Address: address.Address,
				Network: address.Network,
			}
		}

		tokensPayload[i] = payload
	}

	// Get API key
	apiKey, err := ctrl.apiKeyService.GetAPIKey(ctx, nil, provider)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to retrieve profile", nil)
		return
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Profile retrieved successfully", &types.ProviderProfileResponse{
		ID:                   provider.ID,
		FirstName:            user.FirstName,
		LastName:             user.LastName,
		Email:                user.Email,
		TradingName:          provider.TradingName,
		Currency:             currency.Code,
		HostIdentifier:       provider.HostIdentifier,
		IsAvailable:          provider.IsAvailable,
		Tokens:               tokensPayload,
		APIKey:               *apiKey,
		IsActive:             provider.IsActive,
		Address:              provider.Address,
		MobileNumber:         provider.MobileNumber,
		DateOfBirth:          provider.DateOfBirth,
		BusinessName:         provider.BusinessName,
		VisibilityMode:       provider.VisibilityMode,
		IdentityDocumentType: provider.IdentityDocumentType,
		IdentityDocument:     provider.IdentityDocument,
		BusinessDocument:     provider.BusinessDocument,
		IsKybVerified:        provider.IsKybVerified,
	})
}
