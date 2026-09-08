// Package fintava verifies Nigerian identities through Fintava's compliance
// endpoints -- the same rail that opens the naira account being verified for.
//
//	GET  /compliance/verify/bvn          the bank's record behind a BVN
//	POST /compliance/verify/bvn/selfie   a live face matched to that record's photo
//
// Two properties make this materially simpler than the Smile Identity
// integration it replaces.
//
// It is SYNCHRONOUS. Both calls answer inside the request, so there is no
// callback endpoint to authenticate, no pending state to reconcile, and no
// class of person who is stuck at "we are still waiting" forever because a
// webhook was lost. The answer arrives on the same connection that asked.
//
// It is the SAME VENDOR that holds the money. The BVN checked here is the BVN
// Fintava will check again when it opens the person's naira account, so a
// verification that passes here cannot fail there for disagreeing about who
// somebody is -- which is what happens when identity and banking are bought
// from two companies with two views of the same person.
//
// What it does not do is documents. Fintava has no document endpoint, so
// TierDocument is unreachable through this provider and VerifyDocument says so
// rather than pretending. The tier stays in the ladder for whoever adds one.
package fintava

import (
	"context"
	"errors"
	"fmt"
	"strings"

	rail "github.com/usezoracle/tapp/api/services/baas/fintava"

	"github.com/usezoracle/tapp/api/internal/identity/kyc"
)

// Provider implements kyc.Provider on top of the Fintava client.
type Provider struct{ c *rail.Client }

// New wraps a configured Fintava client.
//
// Refuses an unconfigured one rather than returning a provider that answers
// "pending" forever: a KYC provider that cannot reach its vendor is not a
// degraded feature, it is a queue of people who can never raise their limits,
// discovered weeks later.
func New(c *rail.Client) (*Provider, error) {
	if c == nil || strings.TrimSpace(c.APIKey) == "" {
		return nil, fmt.Errorf("kyc/fintava: FINTAVA_API_KEY is not set")
	}
	return &Provider{c: c}, nil
}

func (p *Provider) Name() string { return "fintava" }

// VerifyBVN matches a BVN against the bank's record.
//
// The rail's endpoint is a lookup: it returns the record behind any valid BVN,
// including one read off somebody else's bank slip. So the comparison against
// what the person actually claimed happens HERE. Without it, tier 1 would
// certify that a BVN exists rather than that it is theirs, and the whole
// ladder would rest on a number printed on other people's paperwork.
func (p *Provider) VerifyBVN(ctx context.Context, req kyc.BVNRequest) (*kyc.Result, error) {
	if err := req.Valid(); err != nil {
		return nil, err
	}

	record, err := p.c.VerifyBVN(ctx, req.BVN)
	if err != nil {
		if refused, ok := refusal(err); ok {
			// The rail read the request and said no. That is an answer about
			// the BVN, not an outage, and recording it as a failure would hide
			// a real rejection in the operational noise.
			return &kyc.Result{Status: kyc.Rejected, Reason: refused}, nil
		}
		return nil, fmt.Errorf("kyc/fintava: verify bvn: %w", err)
	}

	if why := disagrees(req, record); why != "" {
		return &kyc.Result{Status: kyc.Rejected, Reason: why}, nil
	}
	return &kyc.Result{
		Status:      kyc.Approved,
		ProviderRef: record.Customer,
		Identity:    identityFrom(record, req.BVN),
	}, nil
}

// VerifySelfie matches a captured face to the photo the bank holds.
//
// The liveness capture belongs to the client, not here: liveness is a property
// of how images were captured, and a server handed a still cannot tell a live
// capture from a printed photograph held up to a camera.
func (p *Provider) VerifySelfie(ctx context.Context, req kyc.SelfieRequest) (*kyc.Result, error) {
	if err := req.Valid(); err != nil {
		return nil, err
	}
	if strings.TrimSpace(req.BVN) == "" {
		// There is nothing to match a face against otherwise. Failing here is
		// better than sending the rail a request it will charge for and refuse.
		return nil, fmt.Errorf("kyc/fintava: a selfie is matched against a BVN, so one is required")
	}

	// One image. The rail takes a single frame; the extra frames a client
	// captures are for its own liveness decision, not for this call.
	if err := p.c.VerifyBVNSelfie(ctx, req.BVN, req.Images[0]); err != nil {
		if refused, ok := refusal(err); ok {
			return &kyc.Result{Status: kyc.Rejected, Reason: orDefault(refused,
				"the photograph did not match the one held against this BVN")}, nil
		}
		return nil, fmt.Errorf("kyc/fintava: verify selfie: %w", err)
	}
	return &kyc.Result{Status: kyc.Approved}, nil
}

// VerifyDocument is not offered by this rail.
//
// An error rather than a silent "pending": a person who submits a passport and
// is told nothing is a person who will submit it again tomorrow.
func (p *Provider) VerifyDocument(context.Context, kyc.DocumentRequest) (*kyc.Result, error) {
	return nil, fmt.Errorf("kyc/fintava: this rail verifies BVN and selfie only; document checks need another provider")
}

// ParseCallback is unreachable by design: these checks answer synchronously,
// so there is no callback to authenticate. An endpoint that accepted one would
// be an endpoint that lets a stranger mark themselves verified.
func (p *Provider) ParseCallback([]byte, string) (*kyc.Callback, error) {
	return nil, fmt.Errorf("kyc/fintava: verification is synchronous; there are no callbacks")
}

// refusal reports the rail's own words when it understood the request and
// declined it, and false when it simply did not answer.
func refusal(err error) (string, bool) {
	var apiErr *rail.APIError
	if errors.As(err, &apiErr) && apiErr.Refused() {
		return strings.TrimSpace(apiErr.Message), true
	}
	return "", false
}

// disagrees reports why the claim does not match the record, or "" when it does.
//
// Surname must match. The given name must match the record's first OR middle
// name, because Nigerian records order names inconsistently and rejecting
// somebody over which of their two given names a bank filed first is a support
// queue, not a control. Date of birth is compared only when the caller offered
// one -- an absent claim is not a contradicted one.
func disagrees(req kyc.BVNRequest, rec *rail.BVNRecord) string {
	if !sameName(req.LastName, rec.LastName) {
		return "the surname does not match the one held against this BVN"
	}
	if !sameName(req.FirstName, rec.FirstName) && !sameName(req.FirstName, rec.MiddleName) {
		return "the first name does not match the one held against this BVN"
	}
	if d := strings.TrimSpace(req.DateOfBirth); d != "" && rec.DateOfBirth != "" &&
		d != strings.TrimSpace(rec.DateOfBirth) {
		return "the date of birth does not match the one held against this BVN"
	}
	return ""
}

// sameName compares one name part, ignoring case, surrounding space and the
// hyphens and apostrophes that the same person spells differently on different
// forms. Never true for an empty part: an absent record field is not a match.
func sameName(a, b string) bool {
	na, nb := normalizeName(a), normalizeName(b)
	return na != "" && na == nb
}

func normalizeName(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	return strings.NewReplacer("-", "", "'", "", "’", "", ".", "", " ", "").Replace(s)
}

// identityFrom keeps only what the platform needs, in the bank's spelling.
//
// The name comes from the RECORD, not from the submission: the point of the
// check is that the record is authoritative, and storing what somebody typed
// would mean storing the version nobody verified.
//
// The BVN is reduced to its last four digits, and the bank's photograph is
// dropped entirely. A BVN is a national identifier and a face is biometric
// data; what this platform needs is that one was verified, not what it was.
func identityFrom(rec *rail.BVNRecord, bvn string) *kyc.Identity {
	id := &kyc.Identity{
		FirstName:   strings.TrimSpace(rec.FirstName),
		LastName:    strings.TrimSpace(rec.LastName),
		DateOfBirth: strings.TrimSpace(rec.DateOfBirth),
		Phone:       strings.TrimSpace(rec.Phone),
	}
	if len(bvn) >= 4 {
		id.BVNLast4 = bvn[len(bvn)-4:]
	}
	return id
}

func orDefault(v, def string) string {
	if v != "" {
		return v
	}
	return def
}
