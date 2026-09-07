// Reference data: what currencies exist, which banks serve them, what a
// token is worth, and the key a sender encrypts a recipient with. All public,
// all read-only, all cacheable -- nothing here touches money.

package controllers

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/shopspring/decimal"
	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/ent/fiatcurrency"
	"github.com/usezoracle/tapp/api/ent/institution"
	"github.com/usezoracle/tapp/api/ent/providerprofile"
	"github.com/usezoracle/tapp/api/ent/token"
	"github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/types"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

func (ctrl *Controller) GetFiatCurrencies(ctx *gin.Context) {
	// fetch stored fiat currencies.
	fiatcurrencies, err := storage.Client.FiatCurrency.
		Query().
		Where(fiatcurrency.IsEnabledEQ(true)).
		All(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"Failed to fetch FiatCurrencies", err.Error())
		return
	}

	currencies := make([]types.SupportedCurrencies, 0, len(fiatcurrencies))
	for _, currency := range fiatcurrencies {
		currencies = append(currencies, types.SupportedCurrencies{
			Code:       currency.Code,
			Name:       currency.Name,
			ShortName:  currency.ShortName,
			Decimals:   int8(currency.Decimals),
			Symbol:     currency.Symbol,
			MarketRate: currency.MarketRate,
		})
	}

	u.APIResponse(ctx, http.StatusOK, "success", "OK", currencies)
}

// GetInstitutionsByCurrency controller fetches the supported institutions for a given currency
func (ctrl *Controller) GetInstitutionsByCurrency(ctx *gin.Context) {
	// Get currency code from the URL
	currencyCode := ctx.Param("currency_code")

	// Query institutions from the local database (seeded via SQL migrations)
	institutions, err := storage.Client.Institution.
		Query().
		Where(institution.HasFiatCurrencyWith(
			fiatcurrency.CodeEQ(currencyCode),
		)).
		All(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"Failed to fetch institutions", nil)
		return
	}

	response := make([]types.SupportedInstitutions, 0, len(institutions))
	for _, institution := range institutions {
		response = append(response, types.SupportedInstitutions{
			Code: institution.Code,
			Name: institution.Name,
			Type: institution.Type,
		})
	}

	u.APIResponse(ctx, http.StatusOK, "success", "OK", response)
}

// GetTokenRate controller fetches the current rate of the cryptocurrency token against the fiat currency
func (ctrl *Controller) GetTokenRate(ctx *gin.Context) {
	// Parse path parameters
	token, err := storage.Client.Token.
		Query().
		Where(
			token.SymbolEQ(strings.ToUpper(ctx.Param("token"))),
			token.IsEnabledEQ(true),
		).
		WithNetwork().
		First(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch token rate", nil)
		return
	}

	if token == nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Token is not supported", nil)
		return
	}

	currency, err := storage.Client.FiatCurrency.
		Query().
		Where(
			fiatcurrency.IsEnabledEQ(true),
			fiatcurrency.CodeEQ(strings.ToUpper(ctx.Param("fiat"))),
		).
		Only(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Fiat currency is not supported", nil)
		return
	}

	tokenAmount, err := decimal.NewFromString(ctx.Param("amount"))
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid amount", nil)
		return
	}

	rateResponse := currency.MarketRate
	// The Route A quote branch is gone with Sui. It priced a bridge from Sui
	// USDC to Base USDC before settlement, and applied only to sui-* networks;
	// deposits land on Base directly now, so there is nothing to bridge and
	// nothing extra to price.
	routeAQuoted := false

	// get providerID from query params
	providerID := ctx.Query("provider_id")
	if routeAQuoted {
		u.APIResponse(ctx, http.StatusOK, "success", "Rate fetched successfully", rateResponse)
		return
	}
	if providerID != "" {
		// get the provider from the bucket
		provider, err := storage.Client.ProviderProfile.
			Query().
			Where(providerprofile.IDEQ(providerID)).
			Only(ctx)
		if err != nil {
			if ent.IsNotFound(err) {
				u.APIResponse(ctx, http.StatusBadRequest, "error", "Provider not found", nil)
				return
			} else {
				u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch provider profile", nil)
				return
			}
		}

		rateResponse, err = ctrl.priorityQueueService.GetProviderRate(ctx, provider, token.Symbol)
		if err != nil {
			u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch provider rate", nil)
			return
		}

	} else {
		// Get redis keys for provision buckets
		keys, _, err := storage.RedisClient.Scan(ctx, uint64(0), "bucket_"+currency.Code+"_*_*", 100).Result()
		if err != nil {
			u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch rates", nil)
			return
		}

		highestMaxAmount := decimal.NewFromInt(0)

		// Scan through the buckets to find a matching rate
		for _, key := range keys {
			bucketData := strings.Split(key, "_")
			minAmount, _ := decimal.NewFromString(bucketData[2])
			maxAmount, _ := decimal.NewFromString(bucketData[3])

			for index := 0; ; index++ {
				// Get the topmost provider in the priority queue of the bucket
				providerData, err := storage.RedisClient.LIndex(ctx, key, int64(index)).Result()
				if err != nil {
					break
				}

				if strings.Split(providerData, ":")[1] == token.Symbol {
					// Get fiat equivalent of the token amount
					rate, _ := decimal.NewFromString(strings.Split(providerData, ":")[2])
					fiatAmount := tokenAmount.Mul(rate)

					// Check if fiat amount is within the bucket range and set the rate
					if fiatAmount.GreaterThanOrEqual(minAmount) && fiatAmount.LessThanOrEqual(maxAmount) {
						rateResponse = rate
						break
					} else if maxAmount.GreaterThan(highestMaxAmount) {
						// Get the highest max amount
						highestMaxAmount = maxAmount
						rateResponse = rate
					}
				}
			}
		}
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Rate fetched successfully", rateResponse)
}

// GetAggregatorPublicKey controller expose Aggregator Public Key
func (ctrl *Controller) GetAggregatorPublicKey(ctx *gin.Context) {
	u.APIResponse(ctx, http.StatusOK, "success", "OK", cryptoConf.AggregatorPublicKey)
}
