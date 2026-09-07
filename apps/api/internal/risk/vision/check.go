package vision

import (
	"context"
	"errors"
	"fmt"

	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/internal/risk"
)

// MinConfidence is the count confidence below which a reading is not worth
// acting on. Below this the recogniser is telling us it could not do the job,
// which is a reason to ask for a better photograph, not to accuse anybody.
const MinConfidence = 0.5

// Check reads the cash in a photograph and reports what it found.
//
// The ordering inside Inspect is the important part, and it is the fix that
// came out of this running against real notes: READABILITY IS ASSESSED BEFORE
// FRAUD. A photograph the recogniser could not read produces a "take another
// photo" signal, not a screen-replay accusation. Ranking it the other way told
// people photographing their own money on their own table that they were
// committing fraud, which is both wrong and the kind of wrong that loses a
// customer permanently.
type Check struct {
	Provider Provider
	// Declared is what the sender said they were pledging, in the subject's
	// currency. A mismatch is the single most useful signal here.
	Declared func(risk.Subject) (money.Amount, bool)
}

func (c *Check) Name() string { return "vision" }

// Inspect analyses the photograph.
func (c *Check) Inspect(ctx context.Context, s risk.Subject) ([]risk.Signal, error) {
	if len(s.Image) == 0 {
		return nil, nil
	}
	if c.Provider == nil {
		return nil, errors.New("vision: no recogniser configured")
	}

	declared := money.Zero(money.NGN)
	if c.Declared != nil {
		if d, ok := c.Declared(s); ok {
			declared = d
		}
	}

	result, err := c.Provider.Analyze(ctx, s.Image, declared)
	if err != nil {
		// A recogniser that is unreachable has not cleared the photograph. The
		// engine records the failure and does not score as though it had.
		return nil, fmt.Errorf("vision: %w", err)
	}

	// --- first: could it be read at all? ---
	if len(result.Notes) == 0 {
		return []risk.Signal{{
			Name:     "vision.no_notes",
			Detail:   "We could not see any banknotes in this photo. Lay them out flat and try again.",
			Severity: risk.High,
		}}, nil
	}
	if result.Confidence < MinConfidence {
		return []risk.Signal{{
			Name: "vision.low_confidence",
			Detail: "This photo is not clear enough to count. Try again in better light, " +
				"with the notes spread out.",
			Severity: risk.High,
		}}, nil
	}

	// --- only now, with something actually recognised, is a verdict worth
	// anything ---
	var out []risk.Signal

	if result.ScreenReplay {
		out = append(out, risk.Signal{
			Name:     "vision.screen_replay",
			Detail:   "This looks like a photo of a screen rather than banknotes on a surface.",
			Severity: risk.High,
		})
	}
	if result.PhotocopySuspected {
		out = append(out, risk.Signal{
			Name:     "vision.photocopy",
			Detail:   "These notes do not look like genuine currency.",
			Severity: risk.High,
		})
	}

	if declared.IsPositive() {
		cmp, err := result.Total.Cmp(declared)
		if err != nil {
			return nil, err
		}
		if cmp != 0 {
			out = append(out, risk.Signal{
				Name: "vision.amount_mismatch",
				Detail: fmt.Sprintf("We counted %s, but you entered %s.",
					result.Total, declared),
				Severity: risk.High,
			})
		}
	}

	for _, w := range result.Warnings {
		out = append(out, risk.Signal{Name: "vision.warning", Detail: w, Severity: risk.Info})
	}

	out = append(out, risk.Signal{
		Name: "vision.reading",
		Detail: fmt.Sprintf("counted %s across %d notes, confidence %.2f",
			result.Total, len(result.Notes), result.Confidence),
		Severity: risk.Info,
	})
	return out, nil
}
