// The provider profile: a liquidity provider's rates, currencies and
// availability.
//
//	PATCH /v1/settings/provider

package accounts

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/ent/fiatcurrency"
	"github.com/usezoracle/tapp/api/ent/network"
	"github.com/usezoracle/tapp/api/ent/providerordertoken"
	"github.com/usezoracle/tapp/api/ent/providerprofile"
	"github.com/usezoracle/tapp/api/ent/provisionbucket"
	"github.com/usezoracle/tapp/api/ent/token"
	"github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/types"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// UpdateProviderProfile controller updates the provider profile
func (ctrl *ProfileController) UpdateProviderProfile(ctx *gin.Context) {
	var payload types.ProviderProfilePayload

	if err := ctx.ShouldBindJSON(&payload); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"Failed to validate payload", u.GetErrorData(err))
		return
	}

	// Get provider profile from the context
	providerCtx, ok := ctx.Get("provider")
	if !ok {
		u.APIResponse(ctx, http.StatusUnauthorized, "error", "Invalid API key or token", nil)
		return
	}
	provider := providerCtx.(*ent.ProviderProfile)

	update := provider.Update()

	if payload.TradingName != "" {
		update.SetTradingName(payload.TradingName)
	}

	if payload.HostIdentifier != "" {
		update.SetHostIdentifier(payload.HostIdentifier)
	}

	if payload.IsAvailable {
		update.SetIsAvailable(true)
	} else {
		update.SetIsAvailable(false)
	}

	if payload.Currency != "" {
		currency, err := storage.Client.FiatCurrency.
			Query().
			Where(
				fiatcurrency.IsEnabledEQ(true),
				fiatcurrency.CodeEQ(payload.Currency),
			).
			Only(ctx)
		if err != nil {
			u.APIResponse(ctx, http.StatusBadRequest, "error", "Failed to validate payload", types.ErrorData{
				Field:   "FiatCurrency",
				Message: "This field is required",
			})
			return
		}
		update.SetCurrency(currency)
	}

	if payload.VisibilityMode != "" {
		update.SetVisibilityMode(providerprofile.VisibilityMode(payload.VisibilityMode))
	}

	if payload.Address != "" {
		update.SetAddress(payload.Address)
	}

	if payload.MobileNumber != "" {
		if !u.IsValidMobileNumber(payload.MobileNumber) {
			u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid mobile number", nil)
			return
		}
		update.SetMobileNumber(payload.MobileNumber)
	}

	if !payload.DateOfBirth.IsZero() {
		update.SetDateOfBirth(payload.DateOfBirth)
	}

	if payload.BusinessName != "" {
		update.SetBusinessName(payload.BusinessName)
	}

	if payload.IdentityDocumentType != "" {
		if providerprofile.IdentityDocumentType(payload.IdentityDocumentType) != providerprofile.IdentityDocumentTypePassport &&
			providerprofile.IdentityDocumentType(payload.IdentityDocumentType) != providerprofile.IdentityDocumentTypeDriversLicense &&
			providerprofile.IdentityDocumentType(payload.IdentityDocumentType) != providerprofile.IdentityDocumentTypeNationalID {
			u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid identity document type", nil)
			return
		}
		update.SetIdentityDocumentType(providerprofile.IdentityDocumentType(payload.IdentityDocumentType))
	}

	if payload.IdentityDocument != "" {
		if !u.IsValidFileURL(payload.IdentityDocument) {
			u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid identity document URL", nil)
			return
		}
		update.SetIdentityDocument(payload.IdentityDocument)
	}

	if payload.BusinessDocument != "" {
		if !u.IsValidFileURL(payload.BusinessDocument) {
			u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid business document URL", nil)
			return
		}
		update.SetBusinessDocument(payload.BusinessDocument)
	}

	// Update tokens
	for _, tokenPayload := range payload.Tokens {
		if len(tokenPayload.Addresses) == 0 {
			u.APIResponse(ctx, http.StatusBadRequest, "error", fmt.Sprintf("No wallet address provided for %s settlements", tokenPayload.Symbol), nil)
			return
		}

		// Check if token is supported
		_, err := storage.Client.Token.
			Query().
			Where(token.Symbol(tokenPayload.Symbol)).
			First(ctx)
		if err != nil {
			u.APIResponse(ctx, http.StatusBadRequest, "error", "Token not supported", nil)
			return
		}

		// Check if network is supported
		for _, addressPayload := range tokenPayload.Addresses {
			_, err = storage.Client.Network.
				Query().
				Where(network.IdentifierEQ(addressPayload.Network)).
				First(ctx)
			if err != nil {
				u.APIResponse(
					ctx,
					http.StatusBadRequest,
					"error", "Network not supported - "+addressPayload.Network,
					nil,
				)
				return
			}
		}

		// Ensure rate is within allowed deviation from the market rate
		currency, err := storage.Client.FiatCurrency.
			Query().
			Where(
				fiatcurrency.IsEnabledEQ(true),
				fiatcurrency.CodeEQ(payload.Currency),
			).
			Only(ctx)
		if err != nil {
			u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch currency", nil)
			return
		}

		var rate decimal.Decimal

		if tokenPayload.ConversionRateType == providerordertoken.ConversionRateTypeFloating {
			rate = currency.MarketRate.Add(tokenPayload.FloatingConversionRate)

			percentDeviation := u.AbsPercentageDeviation(currency.MarketRate, rate)
			if percentDeviation.GreaterThan(orderConf.PercentDeviationFromMarketRate) {
				u.APIResponse(ctx, http.StatusBadRequest, "error", "Rate is too far from market rate", nil)
				return
			}
		}

		// See if token already exists for provider
		orderToken, err := storage.Client.ProviderOrderToken.
			Query().
			Where(
				providerordertoken.SymbolEQ(tokenPayload.Symbol),
				providerordertoken.HasProviderWith(providerprofile.IDEQ(provider.ID)),
			).
			Only(ctx)

		if err != nil {
			if ent.IsNotFound(err) {
				// Token doesn't exist, create it
				_, err = storage.Client.ProviderOrderToken.
					Create().
					SetSymbol(tokenPayload.Symbol).
					SetConversionRateType(tokenPayload.ConversionRateType).
					SetFixedConversionRate(tokenPayload.FixedConversionRate).
					SetFloatingConversionRate(tokenPayload.FloatingConversionRate).
					SetMaxOrderAmount(tokenPayload.MaxOrderAmount).
					SetMinOrderAmount(tokenPayload.MinOrderAmount).
					SetAddresses(tokenPayload.Addresses).
					SetProviderID(provider.ID).
					Save(ctx)
				if err != nil {
					u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to set token - "+tokenPayload.Symbol, nil)
					return
				}
			} else {
				u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to set token - "+tokenPayload.Symbol, nil)
				return
			}
		} else {
			// Token exists, update it
			_, err = orderToken.Update().
				SetConversionRateType(tokenPayload.ConversionRateType).
				SetFixedConversionRate(tokenPayload.FixedConversionRate).
				SetFloatingConversionRate(tokenPayload.FloatingConversionRate).
				SetMaxOrderAmount(tokenPayload.MaxOrderAmount).
				SetMinOrderAmount(tokenPayload.MinOrderAmount).
				SetAddresses(tokenPayload.Addresses).
				Save(ctx)
			if err != nil {
				u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to set token - "+tokenPayload.Symbol, nil)
				return
			}
		}

		rate, err = ctrl.priorityQueueService.GetProviderRate(ctx, provider, tokenPayload.Symbol)
		if err != nil {
			u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to set token", nil)
			return
		}

		// Add provider to buckets
		buckets, err := storage.Client.ProvisionBucket.
			Query().
			Where(
				provisionbucket.Or(
					provisionbucket.MinAmountLTE(tokenPayload.MinOrderAmount.Mul(rate)),
					provisionbucket.MinAmountLTE(tokenPayload.MaxOrderAmount.Mul(rate)),
					provisionbucket.MaxAmountGTE(tokenPayload.MaxOrderAmount.Mul(rate)),
				),
			).
			All(ctx)
		if err != nil {
			logger.Errorf("Failed to assign provider %s to buckets", provider.ID)
		} else {
			update.ClearProvisionBuckets()
			update.AddProvisionBuckets(buckets...)
		}
	}

	// // Update rate and order amount range
	// // TODO: remove this when rate and range is handled per token in dashboard
	// _, err := storage.Client.ProviderOrderToken.
	// 	Update().
	// 	Where(
	// 		providerordertoken.HasProviderWith(providerprofile.IDEQ(provider.ID)),
	// 	).
	// 	SetConversionRateType(payload.Tokens[0].ConversionRateType).
	// 	SetFixedConversionRate(payload.Tokens[0].FixedConversionRate).
	// 	SetFloatingConversionRate(payload.Tokens[0].FloatingConversionRate).
	// 	SetMaxOrderAmount(payload.Tokens[0].MaxOrderAmount).
	// 	SetMinOrderAmount(payload.Tokens[0].MinOrderAmount).
	// 	Save(ctx)
	// if err != nil {
	// 	u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to set token - "+payload.Tokens[0].Symbol, nil)
	// 	return
	// }

	// Activate profile
	if payload.BusinessDocument != "" && payload.IdentityDocument != "" {
		update.SetIsActive(true)
	}

	_, err := update.Save(ctx)
	if err != nil {
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to update profile", nil)
		return
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Profile updated successfully", nil)
}
