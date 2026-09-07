// The SmileID webhook: how a verification actually resolves.
//
//	POST /v1/kyc/webhook

package controllers

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/gin-gonic/gin"
	fastshot "github.com/opus-domini/fast-shot"
	"github.com/usezoracle/tapp/api/ent/identityverificationrequest"
	"github.com/usezoracle/tapp/api/storage"
	"github.com/usezoracle/tapp/api/types"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

func (ctrl *Controller) KYCWebhook(ctx *gin.Context) {
	var payload types.SmileIDWebhookPayload

	// Parse the JSON payload
	if err := ctx.ShouldBindJSON(&payload); err != nil {
		logger.Errorf("Failed to parse webhook payload: %v", err)
		ctx.JSON(http.StatusBadRequest, gin.H{"error": "Invalid payload"})
		return
	}

	// Verify the webhook signature
	if !verifySmileIDWebhookSignature(payload, payload.Signature) {
		logger.Errorf("Invalid webhook signature")
		ctx.JSON(http.StatusUnauthorized, gin.H{"error": "Invalid signature"})
		return
	}

	// Process the webhook
	status := identityverificationrequest.StatusPending

	// Check for success codes
	successCodes := []string{
		"0810", // Document Verified
		"1020", // Exact Match (Basic KYC and Enhanced KYC)
		"1012", // Valid ID / ID Number Validated (Enhanced KYC)
		"0820", // Authenticate User Machine Judgement - PASS
		"0840", // Enroll User PASS - Machine Judgement
	}

	// Check for failed codes
	failedCodes := []string{
		"0811", // No Face Match
		"0812", // Filed Security Features Check
		"0813", // Document Not Verified - Machine Judgement
		"1022", // No Match
		"1023", // No Found
		"1011", // Invalid ID / ID Number Invalid
		"1013", // ID Number Not Found
		"1014", // Unsupported ID Type
		"0821", // Images did not match
		"0911", // No Face Found
		"0912", // Face Not Matching
		"0921", // Face Not Found
		"0922", // Selfie Quality Too Poor
		"0841", // Enroll User FAIL
		"0941", // Face Not Found
		"0942", // Face Poor Quality
	}

	if slices.Contains(successCodes, payload.ResultCode) {
		status = identityverificationrequest.StatusSuccess
	}

	if slices.Contains(failedCodes, payload.ResultCode) {
		status = identityverificationrequest.StatusFailed
	}

	// Update the verification status in the database
	_, err := storage.Client.IdentityVerificationRequest.
		Update().
		Where(
			identityverificationrequest.WalletAddressEQ(payload.PartnerParams.UserID),
			identityverificationrequest.StatusEQ(identityverificationrequest.StatusPending),
		).
		SetStatus(status).
		Save(ctx)
	if err != nil {
		logger.Errorf("Failed to update verification status: %v", err)
		ctx.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to process webhook"})
		return
	}

	ctx.JSON(http.StatusOK, gin.H{"message": "Webhook processed successfully"})
}

// verifyWebhookSignature verifies the signature of a Smile Identity webhook
func verifySmileIDWebhookSignature(payload types.SmileIDWebhookPayload, receivedSignature string) bool {
	// Create HMAC
	// Generate Smile Identity signature
	h := hmac.New(sha256.New, []byte(identityConf.SmileIdentityApiKey))
	h.Write([]byte(payload.Timestamp))
	h.Write([]byte(identityConf.SmileIdentityPartnerId))
	h.Write([]byte("sid_request"))

	// Compare the computed signature with the one in the header
	computedSignature := base64.StdEncoding.EncodeToString(h.Sum(nil))
	return computedSignature == receivedSignature
}

// getSmileLinkStatus fetches the status of a Smile Link
func getSmileLinkStatus(linkID string) (string, error) {
	// Generate signature
	timestamp := time.Now().Format(time.RFC3339Nano)
	h := hmac.New(sha256.New, []byte(identityConf.SmileIdentityApiKey))
	h.Write([]byte(timestamp))
	h.Write([]byte(identityConf.SmileIdentityPartnerId))
	h.Write([]byte("sid_request"))

	// Get Smile Link status
	res, err := fastshot.NewClient(identityConf.SmileIdentityBaseUrl).
		Config().SetTimeout(30 * time.Second).
		Build().POST(fmt.Sprintf("/v1/smile_links/%s", linkID)).
		Body().AsJSON(map[string]interface{}{
		"partner_id": identityConf.SmileIdentityPartnerId,
		"signature":  base64.StdEncoding.EncodeToString(h.Sum(nil)),
		"timestamp":  timestamp,
	}).
		Send()
	if err != nil {
		return "", fmt.Errorf("failed to get Smile Link status: %w", err)
	}

	data, err := u.ParseJSONResponse(res.RawResponse)
	if err != nil {
		return "", fmt.Errorf("failed to parse Smile Link response: %w", err)
	}

	totalJobs := data["total_jobs"].(float64)
	successfulJobs := data["successful_jobs"].(float64)
	failedJobs := data["failed_jobs"].(float64)

	if failedJobs+successfulJobs < totalJobs {
		return "pending", nil
	}

	if totalJobs == successfulJobs && failedJobs == 0 {
		return "success", nil
	}

	if failedJobs > 0 {
		return "failed", nil
	}

	return "", nil
}

// ─────────────────────────────────────────────────────────────────────────────
// Public order endpoints (customer-facing checkout PWA).
// /v1/orders/:id is already public; the two below extend the same path
// with a confirm-after-pay ack and a per-order SSE stream so the
// customer's UI can mirror the merchant's bridge → settle progress
// without exposing the sender's other orders.
// ─────────────────────────────────────────────────────────────────────────────
