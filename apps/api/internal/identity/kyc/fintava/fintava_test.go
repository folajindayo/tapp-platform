package fintava

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	rail "github.com/usezoracle/tapp/api/services/baas/fintava"

	"github.com/usezoracle/tapp/api/internal/identity/kyc"
)

// The BVN endpoint is a lookup, so the name comparison IS the control. These
// cases are the ones that decide whether tier 1 means "this BVN exists" or
// "this BVN is yours".
func TestDisagrees(t *testing.T) {
	record := &rail.BVNRecord{
		FirstName:   "Chidinma",
		MiddleName:  "Ngozi",
		LastName:    "Okonkwo",
		DateOfBirth: "1992-10-04",
	}

	for _, tc := range []struct {
		name     string
		req      kyc.BVNRequest
		rejected bool
	}{
		{"exact match", kyc.BVNRequest{FirstName: "Chidinma", LastName: "Okonkwo"}, false},
		{"case and space differ", kyc.BVNRequest{FirstName: "  chidinma ", LastName: "OKONKWO"}, false},
		{"given name filed as middle name", kyc.BVNRequest{FirstName: "Ngozi", LastName: "Okonkwo"}, false},
		{"hyphen dropped", kyc.BVNRequest{FirstName: "Chidinma", LastName: "Okon-kwo"}, false},
		{"matching date of birth", kyc.BVNRequest{FirstName: "Chidinma", LastName: "Okonkwo", DateOfBirth: "1992-10-04"}, false},
		{"no date of birth claimed", kyc.BVNRequest{FirstName: "Chidinma", LastName: "Okonkwo", DateOfBirth: ""}, false},

		{"somebody else's BVN", kyc.BVNRequest{FirstName: "Emeka", LastName: "Adeyemi"}, true},
		{"same surname, wrong person", kyc.BVNRequest{FirstName: "Emeka", LastName: "Okonkwo"}, true},
		{"married name not on record", kyc.BVNRequest{FirstName: "Chidinma", LastName: "Bello"}, true},
		{"date of birth contradicted", kyc.BVNRequest{FirstName: "Chidinma", LastName: "Okonkwo", DateOfBirth: "1993-10-04"}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			why := disagrees(tc.req, record)
			if tc.rejected && why == "" {
				t.Fatalf("expected a rejection, got a match")
			}
			if !tc.rejected && why != "" {
				t.Fatalf("expected a match, got rejection: %s", why)
			}
		})
	}
}

// An empty record field must never satisfy a comparison: a rail that answers
// with blanks would otherwise verify everybody.
func TestBlankRecordNeverMatches(t *testing.T) {
	if why := disagrees(
		kyc.BVNRequest{FirstName: "Chidinma", LastName: "Okonkwo"},
		&rail.BVNRecord{},
	); why == "" {
		t.Fatal("a record with no name matched a claim")
	}
}

func provider(t *testing.T, h http.HandlerFunc) *Provider {
	t.Helper()
	srv := httptest.NewServer(h)
	t.Cleanup(srv.Close)
	p, err := New(rail.New("test-key", "", srv.URL))
	if err != nil {
		t.Fatal(err)
	}
	return p
}

const record = `{"data":{"customer":"8b619eb6-9909-4727-8258-f7507e20637d",` +
	`"bvn":"12345678901","first_name":"Chidinma","middle_name":"Ngozi",` +
	`"last_name":"Okonkwo","date_of_birth":"1992-10-04",` +
	`"phone_number1":"09012345678","gender":"Female","image":"c2VsZmll"}}`

func TestVerifyBVNApproves(t *testing.T) {
	p := provider(t, func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("bvn"); got != "12345678901" {
			t.Errorf("bvn query = %q", got)
		}
		if got := r.Header.Get("Authorization"); got != "Bearer test-key" {
			t.Errorf("authorization = %q", got)
		}
		_, _ = w.Write([]byte(record))
	})

	res, err := p.VerifyBVN(context.Background(), kyc.BVNRequest{
		UserID: uuid.New(), BVN: "12345678901",
		FirstName: "chidinma", LastName: "okonkwo",
	})
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != kyc.Approved {
		t.Fatalf("status = %s (%s)", res.Status, res.Reason)
	}
	// The bank's spelling, not the caller's.
	if res.Identity.FirstName != "Chidinma" || res.Identity.LastName != "Okonkwo" {
		t.Fatalf("identity = %+v; want the record's spelling", res.Identity)
	}
	// The BVN is reduced to four digits and the photograph is dropped.
	if res.Identity.BVNLast4 != "8901" {
		t.Fatalf("bvnLast4 = %q", res.Identity.BVNLast4)
	}
	if strings.Contains(res.Reason, "c2VsZmll") {
		t.Fatal("the bank's photograph leaked into the result")
	}
}

// A 4xx is the rail's verdict about the BVN. It must be recorded as a
// rejection, and must not surface as an error the handler files under "we
// could not reach the provider".
func TestVerifyBVNRefusalIsRejection(t *testing.T) {
	p := provider(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"statusCode":400,"message":"bvn: Invalid bvn supplied, ","error":"Bad Request"}`))
	})
	res, err := p.VerifyBVN(context.Background(), kyc.BVNRequest{
		UserID: uuid.New(), BVN: "12345678901", FirstName: "A", LastName: "B",
	})
	if err != nil {
		t.Fatalf("a refusal must not be an error: %v", err)
	}
	if res.Status != kyc.Rejected {
		t.Fatalf("status = %s, want rejected", res.Status)
	}
	if !strings.Contains(res.Reason, "Invalid bvn") {
		t.Fatalf("reason = %q; the rail's own words are the useful part", res.Reason)
	}
}

// A 5xx decided nothing. It must be an error, so the caller records `failed`
// rather than telling somebody they are not who they say.
func TestVerifyBVNOutageIsError(t *testing.T) {
	p := provider(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	})
	if _, err := p.VerifyBVN(context.Background(), kyc.BVNRequest{
		UserID: uuid.New(), BVN: "12345678901", FirstName: "A", LastName: "B",
	}); err == nil {
		t.Fatal("an unreachable rail must not resolve to a verdict")
	}
}

// The selfie endpoint answers with an empty body either way, so the status is
// the whole signal.
func TestVerifySelfie(t *testing.T) {
	t.Run("match", func(t *testing.T) {
		p := provider(t, func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path != "/compliance/verify/bvn/selfie" {
				t.Errorf("path = %s", r.URL.Path)
			}
			_, _ = w.Write([]byte(`{}`))
		})
		res, err := p.VerifySelfie(context.Background(), kyc.SelfieRequest{
			UserID: uuid.New(), BVN: "12345678901", Images: []string{"aW1n"},
		})
		if err != nil || res.Status != kyc.Approved {
			t.Fatalf("res = %+v, err = %v", res, err)
		}
	})

	t.Run("no match", func(t *testing.T) {
		p := provider(t, func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{}`))
		})
		res, err := p.VerifySelfie(context.Background(), kyc.SelfieRequest{
			UserID: uuid.New(), BVN: "12345678901", Images: []string{"aW1n"},
		})
		if err != nil {
			t.Fatalf("a refusal must not be an error: %v", err)
		}
		if res.Status != kyc.Rejected || res.Reason == "" {
			t.Fatalf("res = %+v; a rejection needs a reason somebody can act on", res)
		}
	})

	t.Run("without a bvn", func(t *testing.T) {
		p := provider(t, func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("the rail must not be called (and charged) without a BVN")
		})
		if _, err := p.VerifySelfie(context.Background(), kyc.SelfieRequest{
			UserID: uuid.New(), Images: []string{"aW1n"},
		}); err == nil {
			t.Fatal("expected an error")
		}
	})
}

// Documents and callbacks are not offered. Both must say so rather than
// answering "pending", which is how somebody ends up waiting forever.
func TestUnsupported(t *testing.T) {
	p, err := New(rail.New("k", "", "http://example.invalid"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := p.VerifyDocument(context.Background(), kyc.DocumentRequest{
		UserID: uuid.New(), DocumentType: "passport", Images: []string{"aW1n"},
	}); err == nil {
		t.Fatal("expected an error")
	}
	if _, err := p.ParseCallback([]byte(`{}`), ""); err == nil {
		t.Fatal("expected an error")
	}
}

func TestNewRefusesUnconfigured(t *testing.T) {
	if _, err := New(rail.New("", "", "")); err == nil {
		t.Fatal("a provider with no key cannot verify anybody and must not be built")
	}
}
