// Identity verification through SmileID: requesting it, and reading it back.
// The webhook that resolves it is in kyc_webhook.go.
//
//	POST /v1/kyc
//	GET  /v1/kyc/:wallet_address

package controllers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/gin-gonic/gin"
	u "github.com/usezoracle/tapp/api/utils"

	fastshot "github.com/opus-domini/fast-shot"
	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/ent/identityverificationrequest"
	"github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/types"
	"github.com/usezoracle/tapp/api/utils/logger"
)

func (ctrl *Controller) RequestIDVerification(ctx *gin.Context) {
	var payload types.NewIDVerificationRequest

	if err := ctx.ShouldBindJSON(&payload); err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"Failed to validate payload", u.GetErrorData(err))
		return
	}

	// Validate wallet signature
	signature, err := hex.DecodeString(payload.Signature)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid signature", "Signature is not in the correct format")
		return
	}

	if len(signature) != 65 {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid signature", "Signature length is not correct")
		return
	}

	if signature[64] != 27 && signature[64] != 28 {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid signature", "Invalid recovery ID")
		return
	}
	signature[64] -= 27

	// Verify wallet signature
	message := fmt.Sprintf("I accept the KYC Policy and hereby request an identity verification check for %s with nonce %s", payload.WalletAddress, payload.Nonce)

	prefix := "\x19Ethereum Signed Message:\n" + fmt.Sprint(len(message))
	hash := crypto.Keccak256Hash([]byte(prefix + message))

	sigPublicKeyECDSA, err := crypto.SigToPub(hash.Bytes(), signature)
	if err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid signature", nil)
		return
	}

	recoveredAddress := crypto.PubkeyToAddress(*sigPublicKeyECDSA)
	if !strings.EqualFold(recoveredAddress.Hex(), payload.WalletAddress) {
		u.APIResponse(ctx, http.StatusBadRequest, "error", "Invalid signature", nil)
		return
	}

	// Check if there is an existing verification request
	ivr, err := storage.Client.IdentityVerificationRequest.
		Query().
		Where(
			identityverificationrequest.WalletAddressEQ(payload.WalletAddress),
		).
		Only(ctx)
	if err != nil {
		if !ent.IsNotFound(err) {
			logger.Errorf("error: %v", err)
			u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to request identity verification", nil)
			return
		}
	}

	timestamp := time.Now()

	if ivr != nil {
		if ivr.WalletSignature == payload.Signature {
			u.APIResponse(ctx, http.StatusBadRequest, "error", "Signature already used for identity verification", nil)
			return
		}

		expiryPeriod := 15 * time.Minute

		if ivr.Status == identityverificationrequest.StatusFailed || (ivr.Status == identityverificationrequest.StatusPending && ivr.LastURLCreatedAt.Add(expiryPeriod).Before(timestamp)) {
			// Request is expired, delete db entry
			_, err := storage.Client.IdentityVerificationRequest.
				Delete().
				Where(
					identityverificationrequest.WalletAddressEQ(payload.WalletAddress),
				).
				Exec(ctx)
			if err != nil {
				logger.Errorf("error: %v", err)
				u.APIResponse(ctx, http.StatusBadRequest, "error", "Failed to request identity verification", nil)
				return
			}

		} else if ivr.Status == identityverificationrequest.StatusPending && (ivr.LastURLCreatedAt.Add(expiryPeriod).Equal(timestamp) || ivr.LastURLCreatedAt.Add(expiryPeriod).After(timestamp)) {
			// Update the wallet signature in db
			_, err = ivr.
				Update().
				SetWalletSignature(payload.Signature).
				Save(ctx)
			if err != nil {
				logger.Errorf("error: %v", err)
				u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to request identity verification", nil)
				return
			}

			u.APIResponse(ctx, http.StatusOK, "success", "This account has a pending identity verification request", &types.NewIDVerificationResponse{
				URL:       ivr.VerificationURL,
				ExpiresAt: ivr.LastURLCreatedAt,
			})
			return
		}

		if ivr.Status == "success" {
			u.APIResponse(ctx, http.StatusBadRequest, "success", "Failed to request identity verification", "This account has already been successfully verified")
			return
		}
	}

	// Generate Smile Identity signature
	h := hmac.New(sha256.New, []byte(identityConf.SmileIdentityApiKey))
	h.Write([]byte(timestamp.Format(time.RFC3339Nano)))
	h.Write([]byte(identityConf.SmileIdentityPartnerId))
	h.Write([]byte("sid_request"))

	// Initiate KYC verification
	res, err := fastshot.NewClient(identityConf.SmileIdentityBaseUrl).
		Config().SetTimeout(30 * time.Second).
		Build().POST("/v1/smile_links").
		Body().AsJSON(map[string]interface{}{
		"partner_id":   identityConf.SmileIdentityPartnerId,
		"signature":    base64.StdEncoding.EncodeToString(h.Sum(nil)),
		"timestamp":    timestamp,
		"name":         "Aggregator KYC",
		"company_name": "Rails",
		"id_types": []map[string]interface{}{
			// Nigeria
			{
				"country":             "NG",
				"id_type":             "PASSPORT",
				"verification_method": "doc_verification",
			},
			{
				"country":             "NG",
				"id_type":             "DRIVERS_LICENSE",
				"verification_method": "doc_verification",
			},
			{
				"country":             "NG",
				"id_type":             "V_NIN",
				"verification_method": "biometric_kyc",
			},
			{
				"country":             "NG",
				"id_type":             "VOTER_ID",
				"verification_method": "biometric_kyc",
			},
			{
				"country":             "NG",
				"id_type":             "RESIDENT_ID",
				"verification_method": "doc_verification",
			},
			{
				"country":             "NG",
				"id_type":             "IDENTITY_CARD",
				"verification_method": "doc_verification",
			},

			// Kenya
			{
				"country":             "KE",
				"id_type":             "PASSPORT",
				"verification_method": "enhanced_document_verification",
			},
			{
				"country":             "KE",
				"id_type":             "DRIVERS_LICENSE",
				"verification_method": "doc_verification",
			},
			{
				"country":             "KE",
				"id_type":             "ALIEN_CARD",
				"verification_method": "biometric_kyc",
			},
			{
				"country":             "KE",
				"id_type":             "NATIONAL_ID",
				"verification_method": "biometric_kyc",
			},

			// Ghana
			// {
			// 	"country":             "GH",
			// 	"id_type":             "PASSPORT",
			// 	"verification_method": "enhanced_document_verification",
			// },
			// {
			// 	"country":             "GH",
			// 	"id_type":             "VOTER_ID",
			// 	"verification_method": "enhanced_document_verification",
			// },
			// {
			// 	"country":             "GH",
			// 	"id_type":             "NEW_VOTER_ID",
			// 	"verification_method": "biometric_kyc",
			// },
			// {
			// 	"country":             "GH",
			// 	"id_type":             "DRIVERS_LICENSE",
			// 	"verification_method": "doc_verification",
			// },
			// {
			// 	"country":             "GH",
			// 	"id_type":             "SSNIT",
			// 	"verification_method": "biometric_kyc",
			// },

			// South Africa
			// {
			// 	"country":             "ZA",
			// 	"id_type":             "PASSPORT",
			// 	"verification_method": "doc_verification",
			// },
			// {
			// 	"country":             "ZA",
			// 	"id_type":             "DRIVERS_LICENSE",
			// 	"verification_method": "doc_verification",
			// },
			// {
			// 	"country":             "ZA",
			// 	"id_type":             "RESIDENT_ID",
			// 	"verification_method": "doc_verification",
			// },
			// {
			// 	"country":             "ZA",
			// 	"id_type":             "NATIONAL_ID",
			// 	"verification_method": "biometric_kyc",
			// },
		},
		"callback_url":            fmt.Sprintf("%s/v1/kyc/webhook", serverConf.HostDomain),
		"data_privacy_policy_url": "https://github.com/usezoracle/tapp/api",
		"logo_url":                "https://i.postimg.cc/Twrq0gjC/mark-2x-2.png",
		"is_single_use":           true,
		"user_id":                 payload.WalletAddress,
		"expires_at":              timestamp.Add(1 * time.Hour).Format(time.RFC3339Nano),
	}).
		Send()
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusServiceUnavailable, "error", "Failed to request identity verification", "Couldn't reach identity provider")
		return
	}

	data, err := u.ParseJSONResponse(res.RawResponse)
	if err != nil {
		logger.Errorf("error: %v %v", err, data)
		u.APIResponse(ctx, http.StatusServiceUnavailable, "error", "Failed to request identity verification", data)
		return
	}

	// Save the verification details to the database
	ivr, err = storage.Client.IdentityVerificationRequest.
		Create().
		SetWalletAddress(payload.WalletAddress).
		SetWalletSignature(payload.Signature).
		SetPlatform("smile_id").
		SetPlatformRef(data["ref_id"].(string)).
		SetVerificationURL(data["link"].(string)).
		SetLastURLCreatedAt(timestamp.Add(24 * time.Hour)).
		Save(ctx)
	if err != nil {
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to request identity verification", nil)
		return
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Identity verification requested successfully", &types.NewIDVerificationResponse{
		URL:       ivr.VerificationURL,
		ExpiresAt: ivr.LastURLCreatedAt,
	})
}

// GetIDVerificationStatus controller fetches the status of an identity verification request
func (ctrl *Controller) GetIDVerificationStatus(ctx *gin.Context) {
	// Get wallet address from the URL
	walletAddress := ctx.Param("wallet_address")

	// Fetch related identity verification request from the database
	ivr, err := storage.Client.IdentityVerificationRequest.
		Query().
		Where(
			identityverificationrequest.WalletAddressEQ(walletAddress),
		).
		Only(ctx)
	if err != nil {
		if ent.IsNotFound(err) {
			// Check the platform's status endpoint
			u.APIResponse(ctx, http.StatusNotFound, "error", "No verification request found for this wallet address", nil)
			return
		}
		logger.Errorf("error: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to fetch identity verification status", nil)
		return
	}

	// Check if the status is pending and fetch the status from the platform
	// if ivr.Status == identityverificationrequest.StatusPending {
	// 	status, err := getSmileLinkStatus(ivr.PlatformRef)
	// 	if err != nil {
	// 		logger.Errorf("error: %v", err)
	// 		u.APIResponse(ctx, http.StatusServiceUnavailable, "error", "Failed to fetch identity verification status", nil)
	// 		return
	// 	}

	// 	response.Status = status

	// 	if status != "pending" {
	// 		// Update the verification status in the database if it's not pending
	// 		_, err := storage.Client.IdentityVerificationRequest.
	// 			Update().
	// 			Where(
	// 				identityverificationrequest.WalletAddressEQ(walletAddress),
	// 			).
	// 			SetStatus(identityverificationrequest.Status(response.Status)).
	// 			Save(ctx)
	// 		if err != nil {
	// 			logger.Errorf("error: %v", err)
	// 			u.APIResponse(ctx, http.StatusInternalServerError, "error", "Failed to update identity verification status", nil)
	// 			return
	// 		}
	// 	}
	// }

	var status string

	// Check if the verification URL has expired
	if ivr.LastURLCreatedAt.Add(1 * time.Hour).Before(time.Now()) {
		status = "expired"
	} else {
		status = ivr.Status.String()
	}

	u.APIResponse(ctx, http.StatusOK, "success", "Identity verification status fetched successfully", &types.IDVerificationStatusResponse{
		Status: status,
		URL:    ivr.VerificationURL,
	})
}

// KYCWebhook handles the webhook callback from Smile Identity
