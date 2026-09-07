// Package kyc establishes who somebody is, to the degree the amounts they move
// warrant.
//
// Verification is a ladder, not a gate. Requiring a document scan before
// anybody can hold a naira would lose most of the people this product exists
// for -- a market trader is not going to photograph a passport to accept a
// ₦2,000 payment. Requiring nothing before somebody moves ₦2,000,000 would be
// negligent. So each tier unlocks limits proportionate to what it proves.
package kyc

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Tier is how well established an identity is.
type Tier int

const (
	// TierNone: an email address and nothing else. Enough to receive, and to
	// spend small amounts.
	TierNone Tier = 0
	// TierBVN: a Bank Verification Number, matched against the bank's records.
	// This is the strongest single check available in Nigeria and the cheapest
	// -- it is the workhorse tier.
	TierBVN Tier = 1
	// TierSelfie: BVN plus a liveness-checked selfie matched to the photo the
	// bank holds. Proves the person presenting the BVN is the person it
	// belongs to, which BVN alone does not.
	TierSelfie Tier = 2
	// TierDocument: adds a government ID and an address. Required for the
	// largest amounts and for anybody the risk engine has flagged.
	TierDocument Tier = 3
)

func (t Tier) String() string {
	switch t {
	case TierNone:
		return "none"
	case TierBVN:
		return "bvn"
	case TierSelfie:
		return "selfie"
	case TierDocument:
		return "document"
	default:
		return fmt.Sprintf("tier(%d)", int(t))
	}
}

func (t Tier) Valid() bool { return t >= TierNone && t <= TierDocument }

// Status is where a verification attempt has got to.
type Status string

const (
	// Pending: submitted, awaiting the provider.
	Pending Status = "pending"
	// Approved: the provider confirmed the identity.
	Approved Status = "approved"
	// Rejected: the provider could not confirm it. Not an accusation -- a
	// blurred selfie and a stolen identity both land here, and the difference
	// matters to the person, so the reason is kept.
	Rejected Status = "rejected"
	// Failed: the check could not be completed. Distinct from rejected,
	// because "we could not reach the provider" must never be recorded as
	// "this person is not who they say".
	Failed Status = "failed"
)

// Check is one verification attempt.
type Check struct {
	ID     uuid.UUID `json:"id"`
	UserID uuid.UUID `json:"-"`

	// Tier this check would establish if it succeeds.
	Tier Tier `json:"tier"`
	// Provider names who performed it, for audit.
	Provider string `json:"provider"`
	// ProviderRef is their identifier for it, so a disputed result can be
	// chased with them.
	ProviderRef string `json:"providerRef,omitempty"`

	Status Status `json:"status"`
	// Reason is the provider's explanation when they could not confirm.
	Reason string `json:"reason,omitempty"`

	SubmittedAt time.Time  `json:"submittedAt"`
	SettledAt   *time.Time `json:"settledAt,omitempty"`
}

// Identity is what a verification proves about somebody.
//
// The BVN itself is deliberately absent. It is a national identifier and the
// most sensitive thing a Nigerian fintech can hold; the platform needs to know
// that one was verified, not what it was. What is kept is the last four
// digits, which is enough for a person to recognise which of their numbers was
// used and useless to anybody who steals the table.
type Identity struct {
	FirstName   string `json:"firstName"`
	LastName    string `json:"lastName"`
	DateOfBirth string `json:"dateOfBirth,omitempty"`
	Phone       string `json:"phone,omitempty"`
	BVNLast4    string `json:"bvnLast4,omitempty"`
}

// Provider performs verifications.
type Provider interface {
	Name() string

	// VerifyBVN matches a BVN against the bank records.
	VerifyBVN(ctx Context, req BVNRequest) (*Result, error)
	// VerifySelfie matches a liveness-checked selfie to the photo held against
	// an identity.
	VerifySelfie(ctx Context, req SelfieRequest) (*Result, error)
	// VerifyDocument checks a government ID.
	VerifyDocument(ctx Context, req DocumentRequest) (*Result, error)

	// ParseCallback decodes an inbound provider notification. Verification is
	// asynchronous: the provider answers on its own schedule, and treating a
	// missing answer as a failure would reject people for being patient.
	ParseCallback(body []byte, signature string) (*Callback, error)
}

// Context is the subset of context.Context providers need. Named so this
// package's interface does not pull a concrete provider's dependencies into
// everything that imports it.
type Context = context.Context

// BVNRequest asks a provider to match a BVN.
type BVNRequest struct {
	UserID      uuid.UUID
	BVN         string
	FirstName   string
	LastName    string
	DateOfBirth string // YYYY-MM-DD
	Phone       string
	// CallbackURL is where the provider reports the result.
	CallbackURL string
}

// Valid checks a request before it reaches a provider that charges per call.
func (r BVNRequest) Valid() error {
	if r.UserID == uuid.Nil {
		return fmt.Errorf("kyc: a verification needs a user")
	}
	if len(r.BVN) != 11 {
		// A BVN is exactly 11 digits. Sending anything else costs a
		// verification fee to be told so.
		return fmt.Errorf("kyc: a BVN is 11 digits, got %d", len(r.BVN))
	}
	for _, c := range r.BVN {
		if c < '0' || c > '9' {
			return fmt.Errorf("kyc: a BVN is digits only")
		}
	}
	if r.FirstName == "" || r.LastName == "" {
		return fmt.Errorf("kyc: a verification needs the name to match against")
	}
	return nil
}

// SelfieRequest asks a provider to match a face.
type SelfieRequest struct {
	UserID uuid.UUID
	// Images are base64-encoded frames from the client SDK, which performs the
	// liveness capture. The server never sees a raw camera stream and does not
	// want to: a still it could be handed is a still an attacker could hand it.
	Images      []string
	BVN         string
	CallbackURL string
}

func (r SelfieRequest) Valid() error {
	if r.UserID == uuid.Nil {
		return fmt.Errorf("kyc: a verification needs a user")
	}
	if len(r.Images) == 0 {
		return fmt.Errorf("kyc: a selfie check needs captured images")
	}
	return nil
}

// DocumentRequest asks a provider to check a government ID.
type DocumentRequest struct {
	UserID       uuid.UUID
	DocumentType string // passport, drivers_license, national_id, voter_id
	CountryCode  string
	Images       []string
	CallbackURL  string
}

func (r DocumentRequest) Valid() error {
	if r.UserID == uuid.Nil {
		return fmt.Errorf("kyc: a verification needs a user")
	}
	if r.DocumentType == "" {
		return fmt.Errorf("kyc: a document check needs to know what document it is")
	}
	if len(r.Images) == 0 {
		return fmt.Errorf("kyc: a document check needs captured images")
	}
	return nil
}

// Result is a provider's immediate answer.
//
// Usually Pending: these checks are asynchronous, and a provider that has not
// answered yet has not said no. Treating silence as rejection would fail
// people for the provider being busy.
type Result struct {
	Status      Status
	ProviderRef string
	Reason      string
	Identity    *Identity
}

// Callback is an inbound notification that a check has settled.
type Callback struct {
	ProviderRef string
	Status      Status
	Reason      string
	Identity    *Identity
}
