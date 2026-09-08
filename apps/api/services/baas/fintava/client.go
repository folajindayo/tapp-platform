// Package fintava is the Fintava (fintavapay.com) BaaS adapter — the
// second NGN rail behind baas.Provider, selectable for Route B/C.
//
// Fintava's model (fintava.readme.io):
//   - Auth: `Authorization: Bearer <api key>` per environment.
//   - Pooled money: the MERCHANT WALLET (GET /merchant/balance), paid
//     out via POST /bank/credit/merchant which accepts our own
//     CustomerReference — the idempotency/trace anchor.
//   - Permanent deposit accounts: CUSTOMERS with fundingMethod
//     STATIC_FUND (POST /create/customer; BVN+NIN+DOB+address) — each
//     gets a wallet with a NUBAN that holds funds, our LP deposit
//     account equivalent.
//   - Webhooks: x-fintava-signature = HMAC-SHA512 over the RAW body,
//     keyed with the dashboard webhook secret.
//
// The docs hide most response schemas behind a login, so every decode
// here is deliberately tolerant: alternate field names are accepted
// and unknown statuses degrade to "pending" (never to "success").
package fintava

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/shopspring/decimal"
)

// DefaultLiveBaseURL / DefaultSandboxBaseURL are Fintava's documented
// environments.
const (
	DefaultLiveBaseURL    = "https://live.fintavapay.com/api/dev"
	DefaultSandboxBaseURL = "https://dev.fintavapay.com/api/dev"
)

// Client is a thin HTTP client over the Fintava REST API.
type Client struct {
	BaseURL       string
	APIKey        string
	WebhookSecret string
	HTTP          *http.Client
}

// New builds a client. Empty baseURL defaults to the LIVE environment
// (this platform's default posture).
func New(apiKey, webhookSecret, baseURL string) *Client {
	if baseURL == "" {
		baseURL = DefaultLiveBaseURL
	}
	return &Client{
		BaseURL:       strings.TrimRight(baseURL, "/"),
		APIKey:        apiKey,
		WebhookSecret: webhookSecret,
		HTTP:          &http.Client{Timeout: 60 * time.Second},
	}
}

// envelope is the tolerant response wrapper: Fintava responses carry
// some mix of status/statusCode/message/data.
type envelope struct {
	Status     any             `json:"status"`
	StatusCode any             `json:"statusCode"`
	Message    string          `json:"message"`
	Data       json.RawMessage `json:"data"`
}

// APIError is a non-2xx answer from Fintava.
//
// Typed rather than a formatted string because callers have to tell "the rail
// read the request and said no" from "the rail could not be reached", and
// those two mean opposite things to a person being verified: one is a
// rejection, the other is "try again in a minute". A caller that has to grep
// an error message for a status code eventually gets that wrong.
type APIError struct {
	StatusCode int
	Message    string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("fintava: http %d: %s", e.StatusCode, e.Message)
}

// Refused reports whether Fintava understood the request and declined it, as
// opposed to failing to answer. 4xx is the rail's verdict; 5xx is its absence.
func (e *APIError) Refused() bool { return e.StatusCode >= 400 && e.StatusCode < 500 }

func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	var rdr io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("fintava: marshal: %w", err)
		}
		rdr = bytes.NewReader(raw)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.BaseURL+path, rdr)
	if err != nil {
		return fmt.Errorf("fintava: request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.APIKey)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return fmt.Errorf("fintava: %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("fintava: read body: %w", err)
	}

	var env envelope
	_ = json.Unmarshal(raw, &env) // tolerate non-envelope bodies

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := env.Message
		if msg == "" {
			msg = strings.TrimSpace(string(raw))
			if len(msg) > 300 {
				msg = msg[:300]
			}
		}
		return &APIError{StatusCode: resp.StatusCode, Message: msg}
	}
	if out != nil {
		// Prefer the data field; fall back to the whole body for
		// endpoints that respond bare.
		src := env.Data
		if len(src) == 0 || string(src) == "null" {
			src = raw
		}
		if err := json.Unmarshal(src, out); err != nil {
			return fmt.Errorf("fintava: decode %s: %w", path, err)
		}
	}
	return nil
}

// flexDecimal accepts numbers or numeric strings.
type flexDecimal struct{ decimal.Decimal }

func (f *flexDecimal) UnmarshalJSON(b []byte) error {
	s := strings.Trim(string(b), `"`)
	if s == "" || s == "null" {
		f.Decimal = decimal.Zero
		return nil
	}
	d, err := decimal.NewFromString(s)
	if err != nil {
		return err
	}
	f.Decimal = d
	return nil
}

// Bank is one beneficiary bank; SortCode is what transfers/enquiries
// take.
type Bank struct {
	Name     string `json:"name"`
	BankName string `json:"bankName"`
	SortCode string `json:"sortCode"`
	Code     string `json:"code"`
}

func (b Bank) DisplayName() string {
	if b.Name != "" {
		return b.Name
	}
	return b.BankName
}

func (b Bank) BankCode() string {
	if b.SortCode != "" {
		return b.SortCode
	}
	return b.Code
}

// ListBanks returns the beneficiary bank list.
func (c *Client) ListBanks(ctx context.Context) ([]Bank, error) {
	var out []Bank
	if err := c.do(ctx, http.MethodGet, "/banks", nil, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// MerchantWallet is the merchant wallet read. Live-verified shape:
//
//	{"data":{"accountName":"octa hq","accountNumber":"0033988783",
//	         "balance":{"bookedBalance":0,"availableBalance":0}}}
//
// The wallet has its own NUBAN — usable as the float reload
// destination.
type MerchantWallet struct {
	AccountName   string `json:"accountName"`
	AccountNumber string `json:"accountNumber"`
	Balance       struct {
		BookedBalance    flexDecimal `json:"bookedBalance"`
		AvailableBalance flexDecimal `json:"availableBalance"`
	} `json:"balance"`
}

func (m MerchantWallet) Available() decimal.Decimal { return m.Balance.AvailableBalance.Decimal }
func (m MerchantWallet) Booked() decimal.Decimal    { return m.Balance.BookedBalance.Decimal }

// MerchantBalance reads the pooled merchant wallet.
func (c *Client) MerchantBalance(ctx context.Context) (*MerchantWallet, error) {
	var out MerchantWallet
	if err := c.do(ctx, http.MethodGet, "/merchant/balance", nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// NameEnquiryResult resolves a beneficiary.
type NameEnquiryResult struct {
	AccountName   string `json:"accountName"`
	AccountNumber string `json:"accountNumber"`
	SortCode      string `json:"sortCode"`
	BankName      string `json:"bankName"`
}

// NameEnquiry resolves the account name behind number+sortCode.
func (c *Client) NameEnquiry(ctx context.Context, accountNumber, sortCode string) (*NameEnquiryResult, error) {
	q := url.Values{"accountNumber": {accountNumber}, "sortCode": {sortCode}}
	var out NameEnquiryResult
	if err := c.do(ctx, http.MethodGet, "/name/enquiry?"+q.Encode(), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// TransferResult is the tolerant decode of transfer submit/status
// responses.
type TransferResult struct {
	Reference         string      `json:"reference"`
	TransactionRef    string      `json:"transactionReference"`
	CustomerReference string      `json:"customerReference"`
	Status            string      `json:"status"`
	Amount            flexDecimal `json:"amount"`
	Charges           flexDecimal `json:"charges"`
	Message           string      `json:"message"`
}

func (t TransferResult) AnyReference() string {
	if t.Reference != "" {
		return t.Reference
	}
	return t.TransactionRef
}

// MerchantTransfer pays a bank account from the MERCHANT wallet.
// customerReference is OUR deterministic reference (claim-first refs
// from the dispatcher) — Fintava echoes it on webhooks.
func (c *Client) MerchantTransfer(ctx context.Context, customerReference string, amount decimal.Decimal, accountNumber, accountName, sortCode, narration string) (*TransferResult, error) {
	body := map[string]any{
		"amount":            amount, // naira (documented float, e.g. 1000.00)
		"accountNumber":     accountNumber,
		"accountName":       accountName,
		"sortCode":          sortCode,
		"narration":         narration,
		"CustomerReference": customerReference, // sic — documented capitalised
	}
	var out TransferResult
	if err := c.do(ctx, http.MethodPost, "/bank/credit/merchant", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// TransactionByReference looks a transaction up by reference (vendor
// reference, or our CustomerReference where Fintava indexes it).
func (c *Client) TransactionByReference(ctx context.Context, ref string) (*TransferResult, error) {
	var out TransferResult
	if err := c.do(ctx, http.MethodGet, "/transaction/reference/"+url.PathEscape(ref), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// CreateCustomerRequest opens a permanent STATIC_FUND customer wallet
// — the LP deposit account. Fintava verifies BVN/NIN itself.
type CreateCustomerRequest struct {
	FirstName   string `json:"firstName"`
	LastName    string `json:"lastName"`
	PhoneNumber string `json:"phoneNumber"`
	Email       string `json:"email"`
	Address     string `json:"address"`
	DateOfBirth string `json:"dateOfBirth"` // YYYY-MM-DD
	BVN         string `json:"bvn"`
	NIN         string `json:"nin"`
}

// Customer is the tolerant decode of a created/fetched customer with
// their wallet.
type Customer struct {
	ID     string `json:"id"`
	CustID string `json:"customerId"`
	Wallet struct {
		ID            string      `json:"id"`
		AccountNumber string      `json:"accountNumber"`
		AccountName   string      `json:"accountName"`
		BankName      string      `json:"bankName"`
		Balance       flexDecimal `json:"availableBalance"`
	} `json:"wallet"`
	AccountNumber string `json:"accountNumber"` // some responses flatten
	AccountName   string `json:"accountName"`
	BankName      string `json:"bankName"`
}

func (cu Customer) CustomerID() string {
	if cu.CustID != "" {
		return cu.CustID
	}
	return cu.ID
}

func (cu Customer) DepositAccountNumber() string {
	if cu.Wallet.AccountNumber != "" {
		return cu.Wallet.AccountNumber
	}
	return cu.AccountNumber
}

func (cu Customer) DepositBankName() string {
	if cu.Wallet.BankName != "" {
		return cu.Wallet.BankName
	}
	if cu.BankName != "" {
		return cu.BankName
	}
	return "Fintava partner bank"
}

// CreateCustomer opens the permanent wallet (STATIC_FUND: funds remain
// until transferred — bank-account semantics).
func (c *Client) CreateCustomer(ctx context.Context, req CreateCustomerRequest) (*Customer, error) {
	body := map[string]any{
		"firstName":     req.FirstName,
		"lastName":      req.LastName,
		"phoneNumber":   req.PhoneNumber,
		"email":         req.Email,
		"fundingMethod": "STATIC_FUND",
		"address":       req.Address,
		"dateOfBirth":   req.DateOfBirth,
		"bvn":           req.BVN,
		"nin":           req.NIN,
	}
	var out Customer
	if err := c.do(ctx, http.MethodPost, "/create/customer", body, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// WalletBalance reads one customer wallet.
func (c *Client) WalletBalance(ctx context.Context, walletID string) (decimal.Decimal, error) {
	var out struct {
		Balance          flexDecimal `json:"balance"`
		AvailableBalance flexDecimal `json:"availableBalance"`
	}
	if err := c.do(ctx, http.MethodGet, "/customer/wallet/balance/"+url.PathEscape(walletID), nil, &out); err != nil {
		return decimal.Zero, err
	}
	if !out.AvailableBalance.IsZero() {
		return out.AvailableBalance.Decimal, nil
	}
	return out.Balance.Decimal, nil
}

// -----------------------------------------------------------------------------
// Compliance: identity verification
//
// Fintava verifies identities on the same key that opens accounts, which is
// why KYC lives on this client rather than behind a second vendor. Both calls
// answer synchronously -- there is no callback to wait for and no job to poll.
// -----------------------------------------------------------------------------

// BVNRecord is what the bank holds against a Bank Verification Number.
//
// It is the authoritative spelling of somebody's name and date of birth, which
// is the point: a person's own typing is a claim, and this is the record that
// claim is checked against.
type BVNRecord struct {
	// Customer is Fintava's id for the person behind the BVN.
	Customer string `json:"customer"`
	BVN      string `json:"bvn"`

	FirstName  string `json:"first_name"`
	MiddleName string `json:"middle_name"`
	LastName   string `json:"last_name"`
	// DateOfBirth is YYYY-MM-DD.
	DateOfBirth string `json:"date_of_birth"`
	Phone       string `json:"phone_number1"`
	Gender      string `json:"gender"`

	// Image is the base64 photograph the bank holds. It is returned by the
	// endpoint and deliberately never persisted: it is biometric data about a
	// person, it is of no use once a selfie has been matched against it, and
	// the only thing keeping it would add to this system is a breach.
	Image string `json:"image"`
}

// VerifyBVN reads the bank's record for a BVN.
//
//	GET /compliance/verify/bvn?bvn=...
//
// This is a LOOKUP, not a match. It returns the record behind any valid BVN,
// including one read off somebody else's bank slip -- so the caller must
// compare the record to what the person actually claimed. See the kyc/fintava
// provider, which does exactly that.
func (c *Client) VerifyBVN(ctx context.Context, bvn string) (*BVNRecord, error) {
	q := url.Values{"bvn": {bvn}}
	var out BVNRecord
	if err := c.do(ctx, http.MethodGet, "/compliance/verify/bvn?"+q.Encode(), nil, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

// VerifyBVNSelfie matches a live face against the photo held behind a BVN.
//
//	POST /compliance/verify/bvn/selfie   {"bvn": "...", "image": "<base64>"}
//
// The endpoint answers with an empty body either way, so the HTTP status IS
// the answer: 2xx is a match, 4xx is not. A nil error therefore means matched,
// and an *APIError with Refused() true means it did not -- which the caller
// must not confuse with the 5xx/transport case, where nothing was decided.
func (c *Client) VerifyBVNSelfie(ctx context.Context, bvn, imageBase64 string) error {
	return c.do(ctx, http.MethodPost, "/compliance/verify/bvn/selfie", map[string]any{
		"bvn":   bvn,
		"image": imageBase64,
	}, nil)
}
