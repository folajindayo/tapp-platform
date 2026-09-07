// Package smileid verifies Nigerian identities through Smile Identity.
//
// Three checks, in the order the tiers use them:
//
//	job 5  Basic KYC       BVN matched against the bank records
//	job 4  SmartSelfie     a liveness-captured face matched to that identity
//	job 6  Document        a government ID
//
// The liveness capture happens in the client SDK, not here. That is not a
// convenience: liveness is a property of how images were captured, and a
// server handed a set of stills cannot tell a live capture from a printed
// photograph held to a camera. The SDK signs what it captured; this package
// forwards it.
package smileid

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/usezoracle/tapp/api/internal/identity/kyc"
)

// Job types, as Smile Identity numbers them.
const (
	jobBasicKYC       = 5
	jobSmartSelfie    = 4
	jobDocumentVerify = 6
)

// Result codes that mean the identity was confirmed. Everything else is a
// rejection or a failure, and the two are kept apart: "we could not reach the
// provider" must never be recorded as "this person is not who they say".
var approvedCodes = map[string]bool{
	"1012": true, // exact match
	"1020": true, // enrolled and matched
}

// Client talks to Smile Identity.
type Client struct {
	BaseURL   string
	PartnerID string
	APIKey    string
	// CallbackSecret verifies inbound notifications. Without it, callbacks
	// cannot be authenticated and are refused -- an unauthenticated callback
	// is an endpoint that lets anybody mark themselves verified.
	CallbackSecret string
	HTTP           *http.Client
}

// New builds a client, refusing an incomplete configuration.
//
// No partial mode: a client with no API key cannot verify anybody, and one
// that silently returns "pending" forever is worse than one that fails at
// startup, because the failure surfaces weeks later as a queue of people who
// can never raise their limits.
func New(baseURL, partnerID, apiKey, callbackSecret string) (*Client, error) {
	switch {
	case strings.TrimSpace(baseURL) == "":
		return nil, fmt.Errorf("smileid: SMILE_IDENTITY_BASE_URL is not set")
	case strings.TrimSpace(partnerID) == "":
		return nil, fmt.Errorf("smileid: SMILE_IDENTITY_PARTNER_ID is not set")
	case strings.TrimSpace(apiKey) == "":
		return nil, fmt.Errorf("smileid: SMILE_IDENTITY_API_KEY is not set")
	}
	return &Client{
		BaseURL:        strings.TrimRight(baseURL, "/"),
		PartnerID:      partnerID,
		APIKey:         apiKey,
		CallbackSecret: callbackSecret,
		HTTP:           &http.Client{Timeout: 30 * time.Second},
	}, nil
}

func (c *Client) Name() string { return "smile_identity" }

// signature is the provider's request authentication: an HMAC over the
// timestamp and partner id, keyed by the API key.
func (c *Client) signature(timestamp string) string {
	mac := hmac.New(sha256.New, []byte(c.APIKey))
	mac.Write([]byte(timestamp))
	mac.Write([]byte(c.PartnerID))
	mac.Write([]byte("sid_request"))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}

// VerifyBVN matches a BVN against the bank records.
func (c *Client) VerifyBVN(ctx context.Context, req kyc.BVNRequest) (*kyc.Result, error) {
	if err := req.Valid(); err != nil {
		return nil, err
	}

	body := c.envelope(req.UserID.String(), jobBasicKYC, req.CallbackURL)
	body["id_info"] = map[string]any{
		"country":      "NG",
		"id_type":      "BVN",
		"id_number":    req.BVN,
		"first_name":   req.FirstName,
		"last_name":    req.LastName,
		"dob":          req.DateOfBirth,
		"phone_number": req.Phone,
	}
	return c.submit(ctx, "/v1/id_verification", body, req.BVN)
}

// VerifySelfie matches a captured face to the identity.
func (c *Client) VerifySelfie(ctx context.Context, req kyc.SelfieRequest) (*kyc.Result, error) {
	if err := req.Valid(); err != nil {
		return nil, err
	}

	body := c.envelope(req.UserID.String(), jobSmartSelfie, req.CallbackURL)
	body["images"] = imagePayload(req.Images)
	if req.BVN != "" {
		body["id_info"] = map[string]any{
			"country": "NG", "id_type": "BVN", "id_number": req.BVN,
		}
	}
	return c.submit(ctx, "/v1/upload", body, req.BVN)
}

// VerifyDocument checks a government ID.
func (c *Client) VerifyDocument(ctx context.Context, req kyc.DocumentRequest) (*kyc.Result, error) {
	if err := req.Valid(); err != nil {
		return nil, err
	}

	country := req.CountryCode
	if country == "" {
		country = "NG"
	}
	body := c.envelope(req.UserID.String(), jobDocumentVerify, req.CallbackURL)
	body["images"] = imagePayload(req.Images)
	body["id_info"] = map[string]any{"country": country, "id_type": req.DocumentType}
	return c.submit(ctx, "/v1/upload", body, "")
}

// envelope builds the fields every job shares.
func (c *Client) envelope(userID string, jobType int, callbackURL string) map[string]any {
	timestamp := time.Now().UTC().Format(time.RFC3339)
	return map[string]any{
		"partner_id": c.PartnerID,
		"signature":  c.signature(timestamp),
		"timestamp":  timestamp,
		"partner_params": map[string]any{
			// The user id is the correlation key. When a callback arrives days
			// later this is what ties it back to a person.
			"user_id":  userID,
			"job_id":   userID + ":" + fmt.Sprint(jobType),
			"job_type": jobType,
		},
		"callback_url": callbackURL,
		"source_sdk":   "rest_api",
	}
}

func imagePayload(images []string) []map[string]any {
	out := make([]map[string]any, 0, len(images))
	for _, img := range images {
		// image_type 2 is a base64 selfie; 6 is a base64 ID card image.
		out = append(out, map[string]any{"image_type_id": 2, "image": img})
	}
	return out
}

func (c *Client) submit(ctx context.Context, path string, body map[string]any, bvn string) (*kyc.Result, error) {
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+path, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.HTTP.Do(req)
	if err != nil {
		// Unreachable is a failure, not a rejection. Recording it as a
		// rejection would tell somebody they are not who they say because a
		// server was down.
		return nil, fmt.Errorf("smileid: %w", err)
	}
	defer resp.Body.Close()

	var decoded struct {
		ResultCode  string            `json:"ResultCode"`
		ResultText  string            `json:"ResultText"`
		SmileJobID  string            `json:"SmileJobID"`
		Actions     map[string]string `json:"Actions"`
		FullName    string            `json:"FullName"`
		DOB         string            `json:"DOB"`
		PhoneNumber string            `json:"PhoneNumber"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, fmt.Errorf("smileid: unreadable response (HTTP %d): %w", resp.StatusCode, err)
	}
	if resp.StatusCode >= 500 {
		return nil, fmt.Errorf("smileid: HTTP %d: %s", resp.StatusCode, decoded.ResultText)
	}

	result := &kyc.Result{ProviderRef: decoded.SmileJobID, Reason: decoded.ResultText}
	switch {
	case approvedCodes[decoded.ResultCode]:
		result.Status = kyc.Approved
		result.Identity = identityFrom(decoded.FullName, decoded.DOB, decoded.PhoneNumber, bvn)
	case decoded.ResultCode == "":
		// Accepted for asynchronous processing. Not an answer yet, and
		// treating silence as rejection would fail people for the provider
		// being busy.
		result.Status = kyc.Pending
	default:
		result.Status = kyc.Rejected
	}
	return result, nil
}

// identityFrom keeps only what the platform needs.
//
// The BVN is reduced to its last four digits. It is a national identifier and
// the most sensitive thing a Nigerian fintech can hold; what is needed is that
// one was verified, not what it was. Four digits let a person recognise which
// of their numbers was used and are useless to whoever steals the table.
func identityFrom(fullName, dob, phone, bvn string) *kyc.Identity {
	id := &kyc.Identity{DateOfBirth: dob, Phone: phone}
	if first, last, ok := strings.Cut(strings.TrimSpace(fullName), " "); ok {
		id.FirstName, id.LastName = first, last
	} else {
		id.FirstName = fullName
	}
	if len(bvn) >= 4 {
		id.BVNLast4 = bvn[len(bvn)-4:]
	}
	return id
}

// ParseCallback decodes and authenticates an inbound notification.
//
// Verification is asynchronous, so this is where most results actually arrive.
// The signature check is not optional: an unauthenticated callback endpoint is
// one that lets anybody mark themselves verified, which is the whole control
// this package exists to provide.
func (c *Client) ParseCallback(body []byte, signature string) (*kyc.Callback, error) {
	if c.CallbackSecret == "" {
		// Fail closed. A missing secret is a misconfiguration, and accepting
		// unsigned callbacks "until it is set" is how it stays unset.
		return nil, fmt.Errorf("smileid: no callback secret configured; callbacks cannot be trusted")
	}

	var decoded struct {
		ResultCode  string `json:"ResultCode"`
		ResultText  string `json:"ResultText"`
		SmileJobID  string `json:"SmileJobID"`
		Timestamp   string `json:"timestamp"`
		Signature   string `json:"signature"`
		FullName    string `json:"FullName"`
		DOB         string `json:"DOB"`
		PhoneNumber string `json:"PhoneNumber"`
	}
	if err := json.Unmarshal(body, &decoded); err != nil {
		return nil, fmt.Errorf("smileid: unreadable callback: %w", err)
	}

	// The provider signs with the timestamp it sent. Prefer the header when
	// one is given, falling back to the body field the provider also sets.
	presented := signature
	if presented == "" {
		presented = decoded.Signature
	}
	expected := c.callbackSignature(decoded.Timestamp)
	if !hmac.Equal([]byte(presented), []byte(expected)) {
		return nil, fmt.Errorf("smileid: callback signature does not verify")
	}

	cb := &kyc.Callback{ProviderRef: decoded.SmileJobID, Reason: decoded.ResultText}
	switch {
	case approvedCodes[decoded.ResultCode]:
		cb.Status = kyc.Approved
		cb.Identity = identityFrom(decoded.FullName, decoded.DOB, decoded.PhoneNumber, "")
	case decoded.ResultCode == "":
		cb.Status = kyc.Pending
	default:
		cb.Status = kyc.Rejected
	}
	return cb, nil
}

func (c *Client) callbackSignature(timestamp string) string {
	mac := hmac.New(sha256.New, []byte(c.CallbackSecret))
	mac.Write([]byte(timestamp))
	mac.Write([]byte(c.PartnerID))
	mac.Write([]byte("sid_request"))
	return base64.StdEncoding.EncodeToString(mac.Sum(nil))
}
