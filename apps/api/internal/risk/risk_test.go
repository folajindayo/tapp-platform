package risk

import (
	"context"
	"errors"
	"testing"
)

type fakeCheck struct {
	name    string
	signals []Signal
	err     error
}

func (f fakeCheck) Name() string { return f.name }
func (f fakeCheck) Inspect(context.Context, Subject) ([]Signal, error) {
	return f.signals, f.err
}

func engineWith(checks ...Check) *Engine {
	return &Engine{Checks: checks, Thresholds: DefaultThresholds()}
}

func TestNothingObservedIsAllowed(t *testing.T) {
	a, err := engineWith(fakeCheck{name: "quiet"}).Assess(context.Background(), Subject{Kind: "tap"})
	if err != nil {
		t.Fatalf("Assess: %v", err)
	}
	if a.Decision != Allow || a.Score != 0 {
		t.Fatalf("decision %q score %d, want allow at 0", a.Decision, a.Score)
	}
	if a.Reason != "" {
		t.Errorf("an allowed action carried a reason: %q", a.Reason)
	}
}

// The property that keeps this usable. Weak signals correlate -- a poor
// photograph produces several at once and they are all the same observation
// from different angles -- so they must not add up to a certainty.
func TestWeakSignalsDoNotAccumulateIntoADenial(t *testing.T) {
	var weak []Signal
	for i := 0; i < 12; i++ {
		weak = append(weak, Signal{Name: "weak", Detail: "something minor", Severity: Low})
	}

	a, err := engineWith(fakeCheck{name: "noisy", signals: weak}).
		Assess(context.Background(), Subject{Kind: "pledge"})
	if err != nil {
		t.Fatalf("Assess: %v", err)
	}
	if a.Decision == Deny {
		t.Fatalf("twelve weak signals denied the action (score %d)", a.Score)
	}
}

// And the converse: one certainty is enough on its own.
func TestAFatalSignalDeniesImmediately(t *testing.T) {
	a, err := engineWith(fakeCheck{name: "registry", signals: []Signal{{
		Name: "notes.already_pledged", Detail: "These notes are already in another transfer.",
		Severity: Fatal,
	}}}).Assess(context.Background(), Subject{Kind: "pledge"})
	if err != nil {
		t.Fatalf("Assess: %v", err)
	}
	if a.Decision != Deny || a.Score != 100 {
		t.Fatalf("decision %q score %d, want deny at 100", a.Decision, a.Score)
	}
	if a.Reason == "" {
		t.Error("a denial carried no reason to show the person")
	}
}

// Only a certainty reaches certainty. Anything short leaves room for us being
// wrong about somebody.
func TestShortOfFatalNeverReachesOneHundred(t *testing.T) {
	var many []Signal
	for i := 0; i < 50; i++ {
		many = append(many, Signal{Name: "high", Detail: "serious", Severity: High})
	}
	a, _ := engineWith(fakeCheck{name: "many", signals: many}).
		Assess(context.Background(), Subject{Kind: "pledge"})
	if a.Score >= 100 {
		t.Fatalf("score reached %d without a fatal signal", a.Score)
	}
}

func TestInfoSignalsAreRecordedWithoutMovingTheScore(t *testing.T) {
	a, err := engineWith(fakeCheck{name: "context", signals: []Signal{
		{Name: "forensics.encoding", Detail: "quality 92", Severity: Info},
		{Name: "device.seen_before", Detail: "known device", Severity: Info},
	}}).Assess(context.Background(), Subject{Kind: "tap"})
	if err != nil {
		t.Fatalf("Assess: %v", err)
	}
	if a.Score != 0 {
		t.Errorf("info signals moved the score to %d", a.Score)
	}
	if len(a.Signals) != 2 {
		t.Errorf("recorded %d signals, want both kept for the audit trail", len(a.Signals))
	}
}

// A check that crashed has NOT cleared the subject. Treating a failure as a
// clean result is how a broken detector silently becomes an approval.
func TestAFailedCheckIsNotACleanResult(t *testing.T) {
	a, err := engineWith(
		fakeCheck{name: "broken", err: errors.New("upstream is down")},
	).Assess(context.Background(), Subject{Kind: "pledge"})
	if err != nil {
		t.Fatalf("Assess: %v", err)
	}
	if a.Decision != Review {
		t.Fatalf("decision %q when every check failed, want review", a.Decision)
	}
	if len(a.Failed) != 1 || a.Failed[0] != "broken" {
		t.Errorf("failed checks = %v, want [broken]", a.Failed)
	}
}

// But one failure among several working checks is recorded, not fatal.
func TestOneFailedCheckAmongManyIsRecorded(t *testing.T) {
	a, err := engineWith(
		fakeCheck{name: "broken", err: errors.New("down")},
		fakeCheck{name: "fine"},
	).Assess(context.Background(), Subject{Kind: "tap"})
	if err != nil {
		t.Fatalf("Assess: %v", err)
	}
	if a.Decision != Allow {
		t.Errorf("decision %q, want allow -- one failed check should not block", a.Decision)
	}
	if len(a.Failed) != 1 {
		t.Errorf("failed = %v, want the failure recorded", a.Failed)
	}
}

func TestSignalsAreAttributedToTheirCheck(t *testing.T) {
	a, _ := engineWith(fakeCheck{name: "forensics", signals: []Signal{
		{Name: "forensics.edited", Detail: "edited", Severity: Medium},
	}}).Assess(context.Background(), Subject{Kind: "pledge"})

	if len(a.Signals) != 1 || a.Signals[0].Source != "forensics" {
		t.Fatalf("signal source = %q, want the check's name", a.Signals[0].Source)
	}
}

// The reason shown to a person describes what was seen, not what it implies.
// Most people who see it will not have done anything wrong.
func TestTheReasonDescribesRatherThanAccuses(t *testing.T) {
	a, _ := engineWith(fakeCheck{name: "vision", signals: []Signal{
		{Name: "vision.screen_replay", Detail: "This looks like a photo of a screen.", Severity: High},
	}}).Assess(context.Background(), Subject{Kind: "pledge"})

	if a.Reason != "This looks like a photo of a screen." {
		t.Errorf("reason = %q", a.Reason)
	}
}

func TestIncoherentThresholdsAreRefused(t *testing.T) {
	for name, th := range map[string]Thresholds{
		"unset":          {},
		"out of order":   {StepUpAt: 80, ReviewAt: 50, DenyAt: 90},
		"deny above 100": {StepUpAt: 30, ReviewAt: 60, DenyAt: 140},
		"equal":          {StepUpAt: 50, ReviewAt: 50, DenyAt: 80},
	} {
		t.Run(name, func(t *testing.T) {
			e := &Engine{Thresholds: th}
			if _, err := e.Assess(context.Background(), Subject{Kind: "tap"}); err == nil {
				t.Fatalf("%s thresholds were accepted", name)
			}
		})
	}
}

func TestScoreMapsOntoTheRightDecision(t *testing.T) {
	th := DefaultThresholds()
	for _, tc := range []struct {
		score int
		want  Decision
	}{
		{0, Allow}, {29, Allow},
		{30, StepUp}, {54, StepUp},
		{55, Review}, {79, Review},
		{80, Deny}, {100, Deny},
	} {
		if got := th.decide(tc.score); got != tc.want {
			t.Errorf("score %d -> %q, want %q", tc.score, got, tc.want)
		}
	}
}
