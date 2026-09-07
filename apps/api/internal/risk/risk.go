// Package risk decides whether a movement of value should be allowed.
//
// One engine, consulted wherever value can enter or leave: a cash pledge, a
// card tap, a payout, a withdrawal. It gathers independent signals, combines
// them into a score, and returns a decision along with every signal that
// contributed -- so a refusal can be explained to the person it affects and a
// threshold can be tuned from evidence rather than intuition.
//
// What this is not: an authority on authenticity. Nothing here can establish
// that a banknote is genuine. Cash recognition is a pre-filter that catches
// wrong amounts and obvious replays so people do not waste a trip; the
// counterparty who physically receives the notes is what makes a forgery
// worthless. Any design that lets a photograph secure value collapses under
// the first hostile question, and no amount of scoring changes that.
package risk

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Decision is what the engine concluded.
type Decision string

const (
	// Allow: proceed.
	Allow Decision = "allow"
	// StepUp: proceed only with stronger proof from the person -- a PIN, a
	// biometric approval, a document.
	StepUp Decision = "step_up"
	// Review: hold for a human. Used where refusing outright would be wrong
	// but proceeding unattended would be worse.
	Review Decision = "review"
	// Deny: refuse.
	Deny Decision = "deny"
)

// Severity is how much a signal moves the score.
type Severity int

const (
	// Info records something worth keeping without moving the score. Most of
	// what an investigator later wants was Info at the time.
	Info Severity = 0
	// Low, Medium and High contribute increasing weight.
	Low    Severity = 10
	Medium Severity = 30
	High   Severity = 60
	// Fatal is a single fact sufficient on its own -- the same banknotes
	// pledged twice, a photograph already used. It short-circuits scoring,
	// because averaging a certainty with weaker evidence only weakens it.
	Fatal Severity = 100
)

// Signal is one observation.
type Signal struct {
	// Name is a stable identifier such as "vision.screen_replay" or
	// "velocity.pledges_per_hour". Dashboards and alerts key on it, so it must
	// not change once shipped.
	Name string `json:"name"`
	// Detail is for a human reading an investigation.
	Detail   string   `json:"detail"`
	Severity Severity `json:"severity"`
	// Source names the check that produced this, for attributing a bad rule.
	Source string `json:"source"`
}

// Subject is what is being assessed.
type Subject struct {
	// Kind is the action: "pledge", "tap", "payout", "withdrawal".
	Kind string
	// UserID is whose action it is.
	UserID uuid.UUID
	// AmountMinor and Currency describe the value at stake. Larger amounts
	// warrant more scrutiny, so the engine sees them.
	AmountMinor int64
	Currency    string

	// Image is a photograph accompanying the action, if any. Only a cash
	// pledge has one.
	Image []byte

	// Device identifies the client, where the client supplies one. Absent is
	// normal and is itself weak evidence.
	Device string
	// Lat and Lng are where the action was taken, when known.
	Lat, Lng *float64

	// At is when the action happened. Zero means now.
	At time.Time
}

// Check is one contributor. Checks run independently and must not depend on
// each other's output: a check that needs another's result is really one
// check, and splitting it hides that.
type Check interface {
	// Name identifies the check for attribution.
	Name() string
	// Inspect returns whatever it observed. Returning no signals means it
	// found nothing, which is not the same as approving.
	Inspect(ctx context.Context, s Subject) ([]Signal, error)
}

// Assessment is the engine's answer.
type Assessment struct {
	ID       uuid.UUID `json:"id"`
	Decision Decision  `json:"decision"`
	// Score runs 0 (nothing seen) to 100 (certain).
	Score   int      `json:"score"`
	Signals []Signal `json:"signals"`
	// Reason summarises why, in language that can be shown to the person
	// affected without accusing them of anything the evidence does not support.
	Reason string `json:"reason"`
	// Failed lists checks that could not run. A check that errored has NOT
	// cleared the subject, and the engine says so rather than scoring as
	// though it had.
	Failed []string  `json:"failed,omitempty"`
	At     time.Time `json:"at"`
}

// Thresholds map a score onto a decision.
//
// They are configuration, not constants, because the right values depend on
// what fraud actually costs against what a wrong refusal costs -- and those
// are business facts that change.
type Thresholds struct {
	StepUpAt int
	ReviewAt int
	DenyAt   int
}

// DefaultThresholds is a starting point, deliberately conservative about
// denial: refusing a legitimate transfer has a cost that does not show up in
// fraud statistics.
func DefaultThresholds() Thresholds {
	return Thresholds{StepUpAt: 30, ReviewAt: 55, DenyAt: 80}
}

func (t Thresholds) valid() error {
	if t.StepUpAt <= 0 || t.StepUpAt >= t.ReviewAt || t.ReviewAt >= t.DenyAt || t.DenyAt > 100 {
		return fmt.Errorf("risk: thresholds must be 0 < stepUp(%d) < review(%d) < deny(%d) <= 100",
			t.StepUpAt, t.ReviewAt, t.DenyAt)
	}
	return nil
}

func (t Thresholds) decide(score int) Decision {
	switch {
	case score >= t.DenyAt:
		return Deny
	case score >= t.ReviewAt:
		return Review
	case score >= t.StepUpAt:
		return StepUp
	default:
		return Allow
	}
}

// Engine runs the checks and combines what they find.
type Engine struct {
	Checks     []Check
	Thresholds Thresholds
	// Store persists assessments. Optional: an engine with no store still
	// decides, it just cannot be audited afterwards.
	Store Store
}

// Store records assessments so decisions can be reviewed and thresholds tuned
// against outcomes rather than opinions.
type Store interface {
	Save(ctx context.Context, subject Subject, a Assessment) error
}

// Assess gathers signals and reaches a decision.
//
// A check that fails is recorded as failed and does not contribute. It is
// explicitly NOT treated as having found nothing: "the manipulation detector
// crashed" and "the manipulation detector found nothing" are opposite facts,
// and conflating them is how a broken check silently becomes an approval.
// Where every check fails, the engine says so and returns Review.
func (e *Engine) Assess(ctx context.Context, s Subject) (*Assessment, error) {
	if err := e.Thresholds.valid(); err != nil {
		return nil, err
	}
	if s.At.IsZero() {
		s.At = time.Now()
	}

	a := Assessment{ID: uuid.New(), At: s.At}

	for _, c := range e.Checks {
		found, err := c.Inspect(ctx, s)
		if err != nil {
			a.Failed = append(a.Failed, c.Name())
			continue
		}
		for _, sig := range found {
			if sig.Source == "" {
				sig.Source = c.Name()
			}
			a.Signals = append(a.Signals, sig)
		}
	}

	a.Score = score(a.Signals)
	a.Decision = e.Thresholds.decide(a.Score)

	// Nothing ran. The subject has not been cleared; it has not been examined.
	if len(e.Checks) > 0 && len(a.Failed) == len(e.Checks) {
		a.Decision = Review
		a.Reason = "Checks could not be completed, so this needs a look before it goes through."
	} else {
		a.Reason = explain(a.Decision, a.Signals)
	}

	if e.Store != nil {
		if err := e.Store.Save(ctx, s, a); err != nil {
			// A decision that cannot be recorded is still a decision, and
			// refusing the action because the audit write failed would punish
			// the user for our problem. It is logged by the caller.
			return &a, fmt.Errorf("risk: assessment %s not recorded: %w", a.ID, err)
		}
	}
	return &a, nil
}

// score combines signals.
//
// Not a sum: three weak signals should not add up to a certainty, because weak
// signals correlate -- a poor photograph produces several at once and they are
// all the same observation seen from different angles. Combination is
// probabilistic, so each additional signal moves the score less than the last,
// and no accumulation of weak evidence reaches the certainty of a strong one.
func score(signals []Signal) int {
	remaining := 1.0
	for _, s := range signals {
		if s.Severity >= Fatal {
			return 100
		}
		if s.Severity <= Info {
			continue
		}
		remaining *= 1 - float64(s.Severity)/100
	}

	result := int((1 - remaining) * 100)
	if result > 99 {
		// Only a Fatal signal reaches certainty. Anything short of one leaves
		// room for the possibility that we are wrong about somebody.
		result = 99
	}
	return result
}

// explain writes the reason shown to the person affected.
//
// It names what was observed, not what it implies. "This looks like a photo of
// a screen" is something somebody can act on; "fraud detected" is an
// accusation, and most of the people who see it will be innocent.
func explain(d Decision, signals []Signal) string {
	if d == Allow {
		return ""
	}

	var reasons []string
	seen := map[string]bool{}
	sorted := append([]Signal(nil), signals...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].Severity > sorted[j].Severity })

	for _, s := range sorted {
		if s.Severity <= Info || s.Detail == "" || seen[s.Detail] {
			continue
		}
		seen[s.Detail] = true
		reasons = append(reasons, s.Detail)
		if len(reasons) == 3 {
			break
		}
	}
	if len(reasons) == 0 {
		return "This needs an extra check before it can go through."
	}
	return strings.Join(reasons, " ")
}
