package smileid

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/internal/identity/kyc"
)

func client(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)

	c, err := New(server.URL, "partner-1", "api-key", "callback-secret")
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return c
}

func validBVN() kyc.BVNRequest {
	return kyc.BVNRequest{
		UserID: uuid.New(), BVN: "12345678901",
		FirstName: "Ada", LastName: "Okafor", DateOfBirth: "1990-01-01",
	}
}

// An incomplete configuration fails at construction. A client that silently
// returns "pending" forever surfaces weeks later as a queue of people who can
// never raise their limits.
func TestAnIncompleteConfigurationIsRefused(t *testing.T) {
	for name, args := range map[string][3]string{
		"no url":     {"", "partner", "key"},
		"no partner": {"https://api.example", "", "key"},
		"no key":     {"https://api.example", "partner", ""},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := New(args[0], args[1], args[2], "secret"); err == nil {
				t.Fatalf("%s was accepted", name)
			}
		})
	}
}

// A BVN is exactly 11 digits. Sending anything else costs a verification fee
// to be told so.
func TestAMalformedBVNIsRefusedBeforeTheProviderIsCalled(t *testing.T) {
	called := false
	c := client(t, func(w http.ResponseWriter, r *http.Request) { called = true })

	for name, bvn := range map[string]string{
		"too short": "1234567890",
		"too long":  "123456789012",
		"letters":   "1234567890A",
		"empty":     "",
	} {
		t.Run(name, func(t *testing.T) {
			req := validBVN()
			req.BVN = bvn
			if _, err := c.VerifyBVN(context.Background(), req); err == nil {
				t.Fatalf("%s BVN was accepted", name)
			}
		})
	}
	if called {
		t.Error("the provider was called with a BVN that could never match")
	}
}

func TestAMatchedBVNIsApproved(t *testing.T) {
	c := client(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"ResultCode": "1012", "ResultText": "Exact Match",
			"SmileJobID": "job-1", "FullName": "Ada Okafor", "DOB": "1990-01-01",
		})
	})

	res, err := c.VerifyBVN(context.Background(), validBVN())
	if err != nil {
		t.Fatalf("VerifyBVN: %v", err)
	}
	if res.Status != kyc.Approved {
		t.Fatalf("status = %q, want approved", res.Status)
	}
	if res.Identity == nil || res.Identity.FirstName != "Ada" {
		t.Errorf("identity = %+v, want the matched name", res.Identity)
	}
	// Only the last four digits of the BVN are kept.
	if res.Identity.BVNLast4 != "8901" {
		t.Errorf("BVN last four = %q, want 8901", res.Identity.BVNLast4)
	}
}

// The BVN itself must never be retained.
func TestTheFullBVNIsNotRetained(t *testing.T) {
	c := client(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"ResultCode": "1012", "SmileJobID": "job-1", "FullName": "Ada Okafor",
		})
	})

	res, err := c.VerifyBVN(context.Background(), validBVN())
	if err != nil {
		t.Fatalf("VerifyBVN: %v", err)
	}
	encoded, _ := json.Marshal(res.Identity)
	if strings.Contains(string(encoded), "12345678901") {
		t.Fatalf("the full BVN was retained: %s", encoded)
	}
}

// A provider that has not answered has not said no. Treating silence as
// rejection would fail people for the provider being busy.
func TestAnAsynchronousAcceptanceIsPendingNotRejected(t *testing.T) {
	c := client(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"SmileJobID": "job-2"})
	})

	res, err := c.VerifyBVN(context.Background(), validBVN())
	if err != nil {
		t.Fatalf("VerifyBVN: %v", err)
	}
	if res.Status != kyc.Pending {
		t.Fatalf("status = %q, want pending", res.Status)
	}
}

// Unreachable is a FAILURE, not a rejection. Recording it as a rejection would
// tell somebody they are not who they say because a server was down.
func TestAnUnreachableProviderIsNotARejection(t *testing.T) {
	c, err := New("http://127.0.0.1:1", "partner", "key", "secret")
	if err != nil {
		t.Fatal(err)
	}
	res, err := c.VerifyBVN(context.Background(), validBVN())
	if err == nil {
		t.Fatal("an unreachable provider returned a result")
	}
	if res != nil && res.Status == kyc.Rejected {
		t.Fatal("an unreachable provider was recorded as a rejection")
	}
}

func TestANonMatchIsRejected(t *testing.T) {
	c := client(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{
			"ResultCode": "1013", "ResultText": "No match", "SmileJobID": "job-3",
		})
	})

	res, err := c.VerifyBVN(context.Background(), validBVN())
	if err != nil {
		t.Fatalf("VerifyBVN: %v", err)
	}
	if res.Status != kyc.Rejected {
		t.Fatalf("status = %q, want rejected", res.Status)
	}
	if res.Reason == "" {
		t.Error("a rejection carried no reason")
	}
}

// An unauthenticated callback endpoint lets anybody mark themselves verified.
func TestCallbacksMustBeSigned(t *testing.T) {
	c := client(t, func(w http.ResponseWriter, r *http.Request) {})

	body, _ := json.Marshal(map[string]any{
		"ResultCode": "1012", "SmileJobID": "job-4", "timestamp": "2026-01-01T00:00:00Z",
	})

	if _, err := c.ParseCallback(body, "not-the-signature"); err == nil {
		t.Fatal("a callback with a wrong signature was accepted")
	}

	valid := c.callbackSignature("2026-01-01T00:00:00Z")
	cb, err := c.ParseCallback(body, valid)
	if err != nil {
		t.Fatalf("a correctly signed callback was refused: %v", err)
	}
	if cb.Status != kyc.Approved {
		t.Errorf("status = %q, want approved", cb.Status)
	}
}

// Fail closed on a missing secret. Accepting unsigned callbacks "until it is
// set" is how it stays unset.
func TestNoCallbackSecretMeansNoCallbacks(t *testing.T) {
	c, err := New("https://api.example", "partner", "key", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := c.ParseCallback([]byte(`{}`), "anything"); err == nil {
		t.Fatal("callbacks were accepted with no secret configured")
	}
}
