// Identity verification.
//
//	GET  /v1/kyc          what the caller has proved, and what it lets them move
//	POST /v1/kyc/bvn      a BVN matched against the bank's record       → tier 1
//	POST /v1/kyc/selfie   a face matched to the photo behind that BVN   → tier 2
//
// Synchronous, unlike the provider this replaces. The answer arrives on the
// same connection that asked, so there is no pending state for a client to
// poll, no callback endpoint to authenticate, and no way for somebody to be
// stranded at "still checking" because a webhook was lost.
//
// Everything here is scoped to the JWT's user. The predecessor keyed
// verification off a wallet address carried in the body and proved ownership
// with an EIP-191 signature -- a second authentication scheme, for one feature,
// on a platform where every other endpoint already knows who is calling.

package v1

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/internal/identity/kyc"
	"github.com/usezoracle/tapp/api/internal/identity/limits"
	"github.com/usezoracle/tapp/api/internal/money"
	u "github.com/usezoracle/tapp/api/utils"
	"github.com/usezoracle/tapp/api/utils/logger"
)

// KYCHandler runs verification checks and reports what they established.
type KYCHandler struct {
	Provider kyc.Provider
	Store    *kyc.Store
	Policy   *limits.Policy
	User     func(*gin.Context) (uuid.UUID, bool)
}

// kycResponse is the whole of what a client needs: where somebody is, what
// that lets them move, and what the next step would give them.
//
// The limits are included rather than left for the client to hardcode. A
// person deciding whether to hand over a BVN is answering "what do I get for
// this", and an app that answers it from a constant table will one day answer
// it wrongly.
type kycResponse struct {
	Tier     int           `json:"tier"`
	TierName string        `json:"tier_name"`
	Identity *kyc.Identity `json:"identity,omitempty"`

	Limits kycLimits `json:"limits"`
	// Next is the step still available, absent once there is none.
	Next *kycNextStep `json:"next,omitempty"`
}

type kycLimits struct {
	PerTransaction money.Amount `json:"per_transaction"`
	Daily          money.Amount `json:"daily"`
	Monthly        money.Amount `json:"monthly"`
	MaxBalance     money.Amount `json:"max_balance"`
}

type kycNextStep struct {
	Tier     int       `json:"tier"`
	TierName string    `json:"tier_name"`
	Unlocks  kycLimits `json:"unlocks"`
}

// highestTier is as far as this provider can take somebody. Fintava verifies a
// BVN and a selfie against it; it has no document check, so TierDocument is
// not reachable and the client is not invited to attempt it.
const highestTier = kyc.TierSelfie

// bvnRequest is a BVN and the name it is claimed to belong to.
//
// The name is required even though the rail's lookup does not need it. That
// endpoint returns the record behind ANY valid BVN, including one read off
// somebody else's bank slip, so the name is what turns a lookup into a match.
// Without it tier 1 would certify that a BVN exists, not that it is yours.
type bvnRequest struct {
	BVN         string `json:"bvn"         binding:"required,len=11,numeric"`
	FirstName   string `json:"firstName"   binding:"required"`
	LastName    string `json:"lastName"    binding:"required"`
	DateOfBirth string `json:"dateOfBirth"` // YYYY-MM-DD, optional; checked when given
}

// selfieRequest is a captured face and the BVN it should belong to.
type selfieRequest struct {
	BVN string `json:"bvn"   binding:"required,len=11,numeric"`
	// Image is a base64 frame from the client's liveness capture. Liveness is
	// a property of HOW an image was captured, so it is decided on the device;
	// a server handed a still cannot tell a live face from a photograph of one.
	Image string `json:"image" binding:"required"`
}

// Get reports where the caller stands.
func (h *KYCHandler) Get(ctx *gin.Context) {
	user, ok := h.User(ctx)
	if !ok {
		return
	}
	profile, err := h.Store.ProfileOf(ctx.Request.Context(), user)
	if err != nil {
		logger.Errorf("kyc: read profile: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Could not read your verification status", nil)
		return
	}
	u.APIResponse(ctx, http.StatusOK, "success", "Verification status", h.view(profile))
}

// BVN establishes tier 1.
func (h *KYCHandler) BVN(ctx *gin.Context) {
	user, ok := h.User(ctx)
	if !ok {
		return
	}
	var req bvnRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"An 11-digit BVN and the first and last name it belongs to are required",
			u.GetErrorData(err))
		return
	}

	h.run(ctx, user, kyc.TierBVN, func() (*kyc.Result, error) {
		return h.Provider.VerifyBVN(ctx.Request.Context(), kyc.BVNRequest{
			UserID:      user,
			BVN:         strings.TrimSpace(req.BVN),
			FirstName:   strings.TrimSpace(req.FirstName),
			LastName:    strings.TrimSpace(req.LastName),
			DateOfBirth: strings.TrimSpace(req.DateOfBirth),
		})
	})
}

// Selfie establishes tier 2.
//
// Requires tier 1 first. A selfie matched against a BVN nobody has claimed
// proves that a face belongs to a stranger's bank record, which is not a step
// up from anything -- the ladder's second rung has to stand on its first.
func (h *KYCHandler) Selfie(ctx *gin.Context) {
	user, ok := h.User(ctx)
	if !ok {
		return
	}
	var req selfieRequest
	if err := ctx.ShouldBindJSON(&req); err != nil {
		u.APIResponse(ctx, http.StatusBadRequest, "error",
			"A photograph and the 11-digit BVN to match it against are required",
			u.GetErrorData(err))
		return
	}

	tier, err := h.Store.TierOf(ctx.Request.Context(), user)
	if err != nil {
		logger.Errorf("kyc: read tier: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Could not read your verification status", nil)
		return
	}
	if tier < kyc.TierBVN {
		u.APIResponse(ctx, http.StatusConflict, "error",
			"Verify your BVN before adding a photograph",
			map[string]any{"code": "bvn_required"})
		return
	}

	h.run(ctx, user, kyc.TierSelfie, func() (*kyc.Result, error) {
		return h.Provider.VerifySelfie(ctx.Request.Context(), kyc.SelfieRequest{
			UserID: user,
			BVN:    strings.TrimSpace(req.BVN),
			Images: []string{req.Image},
		})
	})
}

// run performs a check, records it, and answers with the resulting status.
//
// Every outcome is written down, approved or not. A rejection nobody recorded
// is a person who will be told something different tomorrow, and a queue of
// failures is how an outage at the rail becomes visible before the support
// inbox notices it.
func (h *KYCHandler) run(
	ctx *gin.Context, user uuid.UUID, tier kyc.Tier, check func() (*kyc.Result, error),
) {
	if h.Provider == nil {
		u.APIResponse(ctx, http.StatusServiceUnavailable, "error",
			"Verification is temporarily unavailable.",
			map[string]any{"code": "provider_unavailable"})
		return
	}

	result, err := check()
	if err != nil {
		// The check could not be completed. Recorded as `failed`, which is
		// deliberately not `rejected`: "we could not reach the provider" must
		// never be stored as "this person is not who they say".
		logger.Errorf("kyc: %s tier-%d check for %s: %v", h.Provider.Name(), tier, user, err)
		h.record(ctx, kyc.Check{
			ID: uuid.New(), UserID: user, Tier: tier,
			Provider: h.Provider.Name(), Status: kyc.Failed, Reason: err.Error(),
		}, nil)
		u.APIResponse(ctx, http.StatusBadGateway, "error",
			"We could not check that just now. Please try again.",
			map[string]any{"code": "provider_error"})
		return
	}

	h.record(ctx, kyc.Check{
		ID: uuid.New(), UserID: user, Tier: tier,
		Provider:    h.Provider.Name(),
		ProviderRef: result.ProviderRef,
		Status:      result.Status,
		Reason:      result.Reason,
	}, result.Identity)

	if result.Status != kyc.Approved {
		// 200, not 4xx. Nothing about the request was wrong; the answer was
		// no, and the reason is the useful part -- a client that treats this
		// as a protocol error will show "something went wrong" to somebody
		// whose surname was misspelt.
		u.APIResponse(ctx, http.StatusOK, "success", "Not verified", map[string]any{
			"status": string(result.Status),
			"reason": result.Reason,
		})
		return
	}

	profile, err := h.Store.ProfileOf(ctx.Request.Context(), user)
	if err != nil {
		logger.Errorf("kyc: read profile after approval: %v", err)
		u.APIResponse(ctx, http.StatusInternalServerError, "error",
			"Verified, but we could not read your new limits back", nil)
		return
	}
	view := h.view(profile)
	view["status"] = string(kyc.Approved)
	u.APIResponse(ctx, http.StatusOK, "success", "Verified", view)
}

// record writes the attempt down. A write that fails is logged and not fatal:
// the check itself already happened at the rail, and refusing to tell somebody
// their own result because an audit row would not insert helps nobody.
func (h *KYCHandler) record(ctx *gin.Context, c kyc.Check, id *kyc.Identity) {
	if err := h.Store.RecordSettled(ctx.Request.Context(), c, id); err != nil {
		logger.Errorf("kyc: record %s check %s for %s: %v", c.Status, c.ID, c.UserID, err)
	}
}

func (h *KYCHandler) view(p *kyc.Profile) map[string]any {
	body := kycResponse{
		Tier:     int(p.Tier),
		TierName: p.TierName,
		Limits:   h.limitsFor(p.Tier),
	}
	if p.Identity != nil && *p.Identity != (kyc.Identity{}) {
		body.Identity = p.Identity
	}
	if p.Tier < highestTier {
		next := p.Tier + 1
		body.Next = &kycNextStep{
			Tier: int(next), TierName: next.String(), Unlocks: h.limitsFor(next),
		}
	}
	return map[string]any{
		"tier": body.Tier, "tier_name": body.TierName,
		"identity": body.Identity, "limits": body.Limits, "next": body.Next,
	}
}

func (h *KYCHandler) limitsFor(t kyc.Tier) kycLimits {
	l := h.Policy.For(t)
	return kycLimits{
		PerTransaction: l.PerTransaction,
		Daily:          l.Daily,
		Monthly:        l.Monthly,
		MaxBalance:     l.MaxBalance,
	}
}
