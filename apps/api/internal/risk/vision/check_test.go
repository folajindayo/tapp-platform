package vision

import (
	"context"
	"errors"
	"testing"

	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/internal/risk"
	"github.com/usezoracle/tapp/api/internal/risk/vision/domain"
)

// A recogniser under the test's control. Defined here rather than as a
// runtime "stub mode": a mode that fabricates readings is one deployment
// mistake away from accepting every pledge unscreened.
type fakeProvider struct {
	result *Result
	err    error
}

func (f fakeProvider) Mode() string { return "fake" }
func (f fakeProvider) Analyze(context.Context, []byte, money.Amount) (*Result, error) {
	return f.result, f.err
}

func notes(n int) []domain.Note {
	out := make([]domain.Note, n)
	for i := range out {
		out[i] = domain.Note{Denomination: money.Naira(1000)}
	}
	return out
}

func inspect(t *testing.T, p Provider, declared money.Amount) []risk.Signal {
	t.Helper()
	c := &Check{
		Provider: p,
		Declared: func(risk.Subject) (money.Amount, bool) { return declared, true },
	}
	signals, err := c.Inspect(context.Background(), risk.Subject{
		Kind: "pledge", Image: []byte("a photograph"),
	})
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}
	return signals
}

func named(signals []risk.Signal, name string) *risk.Signal {
	for i := range signals {
		if signals[i].Name == name {
			return &signals[i]
		}
	}
	return nil
}

// The fix that came out of running this against real banknotes. A photograph
// the recogniser could not read must produce "take another photo", NOT a fraud
// accusation -- the person is holding their own money on their own table.
func TestAnUnreadablePhotoIsNotAnAccusation(t *testing.T) {
	signals := inspect(t, fakeProvider{result: &Result{
		Notes: nil, Confidence: 0.2,
		// The recogniser also cried fraud. It must not be relayed: it had
		// nothing to base that on, having read nothing.
		ScreenReplay: true, PhotocopySuspected: true,
	}}, money.Naira(20_000))

	if named(signals, "vision.no_notes") == nil {
		t.Fatal("an unreadable photo produced no readability signal")
	}
	if named(signals, "vision.screen_replay") != nil {
		t.Error("an unreadable photo produced a screen-replay accusation")
	}
	if named(signals, "vision.photocopy") != nil {
		t.Error("an unreadable photo produced a counterfeit accusation")
	}
}

func TestALowConfidenceReadingAsksForABetterPhoto(t *testing.T) {
	signals := inspect(t, fakeProvider{result: &Result{
		Notes: notes(4), Total: money.Naira(4_000), Confidence: 0.3, ScreenReplay: true,
	}}, money.Naira(4_000))

	if named(signals, "vision.low_confidence") == nil {
		t.Fatal("a low-confidence reading produced no signal")
	}
	if named(signals, "vision.screen_replay") != nil {
		t.Error("a low-confidence reading was reported as a screen replay")
	}
}

// With a confident reading, a genuine verdict IS relayed.
func TestAConfidentScreenReplayIsReported(t *testing.T) {
	signals := inspect(t, fakeProvider{result: &Result{
		Notes: notes(20), Total: money.Naira(20_000), Confidence: 0.95, ScreenReplay: true,
	}}, money.Naira(20_000))

	s := named(signals, "vision.screen_replay")
	if s == nil {
		t.Fatal("a confident screen-replay reading was not reported")
	}
	if s.Severity < risk.High {
		t.Errorf("severity %d, want high", s.Severity)
	}
}

// The most useful signal: what was counted does not match what was entered.
func TestACountThatDisagreesWithTheDeclaredAmountIsFlagged(t *testing.T) {
	signals := inspect(t, fakeProvider{result: &Result{
		Notes: notes(15), Total: money.Naira(15_000), Confidence: 0.95,
	}}, money.Naira(20_000))

	s := named(signals, "vision.amount_mismatch")
	if s == nil {
		t.Fatal("a count of ₦15,000 against a declared ₦20,000 was not flagged")
	}
	if s.Detail == "" {
		t.Error("the mismatch did not say what the two figures were")
	}
}

func TestAMatchingCountProducesNoAccusation(t *testing.T) {
	signals := inspect(t, fakeProvider{result: &Result{
		Notes: notes(20), Total: money.Naira(20_000), Confidence: 0.95,
	}}, money.Naira(20_000))

	for _, s := range signals {
		if s.Severity > risk.Info {
			t.Errorf("a clean reading produced %q at severity %d", s.Name, s.Severity)
		}
	}
}

// A recogniser that cannot be reached has NOT cleared the photograph, and must
// surface as an error so the engine records the check as failed.
func TestAnUnreachableRecogniserIsAFailureNotAPass(t *testing.T) {
	c := &Check{Provider: fakeProvider{err: errors.New("service unavailable")}}
	if _, err := c.Inspect(context.Background(), risk.Subject{
		Kind: "pledge", Image: []byte("photo"),
	}); err == nil {
		t.Fatal("an unreachable recogniser reported success")
	}
}

func TestNoRecogniserConfiguredIsAFailure(t *testing.T) {
	c := &Check{}
	if _, err := c.Inspect(context.Background(), risk.Subject{
		Kind: "pledge", Image: []byte("photo"),
	}); err == nil {
		t.Fatal("a check with no recogniser silently passed the photograph")
	}
}

func TestNoImageMeansNothingToSay(t *testing.T) {
	c := &Check{Provider: fakeProvider{}}
	signals, err := c.Inspect(context.Background(), risk.Subject{Kind: "tap"})
	if err != nil || len(signals) != 0 {
		t.Fatalf("a subject with no image gave %v, %v", signals, err)
	}
}
