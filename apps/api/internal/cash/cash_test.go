package cash

import (
	"bytes"
	"context"
	"crypto/rand"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"math/big"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/agents"
	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/ledger/movements"
	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/internal/platform/migrate"
	"github.com/usezoracle/tapp/api/internal/risk"
	"github.com/usezoracle/tapp/api/internal/risk/vision"
	"github.com/usezoracle/tapp/api/internal/risk/vision/domain"
)

// A recogniser and an assessor the test controls. Defined here rather than as
// runtime modes: anything that fabricates a reading in production is one
// deployment mistake from accepting every pledge unscreened.
type fakeRecogniser struct {
	total money.Amount
	notes []domain.Note
	err   error
}

func (f fakeRecogniser) Analyze(context.Context, []byte, money.Amount) (*vision.Result, error) {
	if f.err != nil {
		return nil, f.err
	}
	return &vision.Result{Total: f.total, Notes: f.notes, Confidence: 0.95}, nil
}

type fakeAssessor struct {
	decision risk.Decision
	reason   string
}

func (f fakeAssessor) Assess(context.Context, risk.Subject) (*risk.Assessment, error) {
	d := f.decision
	if d == "" {
		d = risk.Allow
	}
	return &risk.Assessment{ID: uuid.New(), Decision: d, Reason: f.reason, At: time.Now()}, nil
}

func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://tapp:tapp@localhost:5433/tapp?sslmode=disable"
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("no test database (%v)", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("no test database (%v)", err)
	}
	if err := migrate.Up(ctx, pool); err != nil {
		pool.Close()
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// patch returns a random point in Nigeria for this test's agents.
//
// Random per fixture, not a counter. Agents accumulate -- nothing resets the
// database -- so any scheme that walks a small range collides with an earlier
// run's agents sooner or later, and a test expecting "no agent can cover this"
// then finds a well-funded one from a previous run. That failure is
// intermittent, looks like a bug in the float check, and is not one.
//
// Nigeria spans about 9 degrees of latitude and 12 of longitude. At the search
// radii used here two points collide only if they fall within roughly 0.05
// degrees of each other, which is about one part in fifty thousand of the box.
func patch(t *testing.T) (float64, float64) {
	t.Helper()
	lat, err := rand.Int(rand.Reader, big.NewInt(9_000))
	if err != nil {
		t.Fatalf("rand: %v", err)
	}
	lng, err := rand.Int(rand.Reader, big.NewInt(12_000))
	if err != nil {
		t.Fatalf("rand: %v", err)
	}
	return 4.5 + float64(lat.Int64())/1000, 2.5 + float64(lng.Int64())/1000
}

// uniquePhoto is a photograph no other pledge has used.
//
// The pixels come from a random source rather than a counter. A counter starts
// from zero on every run, and pledges stay open across runs, so the second run
// re-sends the first run's photographs and is correctly refused for it -- a
// failure that looks like a bug in the duplicate guard and is actually the
// guard working.
func uniquePhoto(t *testing.T) []byte {
	t.Helper()
	noise := make([]byte, 64*64*3)
	if _, err := rand.Read(noise); err != nil {
		t.Fatalf("rand: %v", err)
	}

	img := image.NewRGBA(image.Rect(0, 0, 64, 64))
	for y := 0; y < 64; y++ {
		for x := 0; x < 64; x++ {
			i := (y*64 + x) * 3
			img.Set(x, y, color.RGBA{R: noise[i], G: noise[i+1], B: noise[i+2], A: 255})
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 92}); err != nil {
		t.Fatalf("encode: %v", err)
	}
	return buf.Bytes()
}

func photo(t *testing.T) []byte { return uniquePhoto(t) }

// notesFor builds a recognition reading with unique note identities, so tests
// do not collide on the double-spend guard.
func notesFor(count int, denom money.Amount) []domain.Note {
	out := make([]domain.Note, count)
	for i := range out {
		out[i] = domain.Note{Denomination: denom, PHash: uuid.NewString()}
	}
	return out
}

type fixture struct {
	Pool    *pgxpool.Pool
	Svc     *Service
	Store   *agents.Store
	Trader  uuid.UUID
	AgentID uuid.UUID
	Lat     float64
	Lng     float64
}

func newFixture(t *testing.T, declared money.Amount, agentFloat money.Amount) *fixture {
	t.Helper()
	pool := testPool(t)
	lat, lng := patch(t)

	store := &agents.Store{Pool: pool}
	agent, err := store.Register(context.Background(), agents.Registration{
		OperatorID: uuid.New(), Name: "Test Agent", Kind: agents.KindAgent,
		Address: "shop " + uuid.NewString(), Lat: lat, Lng: lng,
		OpensAt: "00:00", ClosesAt: "23:59",
	})
	if err != nil {
		t.Fatalf("register agent: %v", err)
	}
	if err := store.Verify(context.Background(), agent.ID); err != nil {
		t.Fatalf("verify agent: %v", err)
	}

	if agentFloat.IsPositive() {
		fundTreasuryAndAgent(t, pool, agent.ID, agentFloat)
	}

	return &fixture{
		Pool: pool, Store: store, Trader: uuid.New(), AgentID: agent.ID, Lat: lat, Lng: lng,
		Svc: &Service{
			Pool:       pool,
			Recogniser: fakeRecogniser{total: declared, notes: notesFor(4, money.Naira(1000))},
			Risk:       fakeAssessor{},
		},
	}
}

func (f *fixture) pledge(t *testing.T, declared money.Amount) (*Pledge, error) {
	t.Helper()
	return f.Svc.Pledge(context.Background(), Request{
		TraderID: f.Trader, Declared: declared,
		Lat: f.Lat, Lng: f.Lng, Image: uniquePhoto(t),
	})
}

func (f *fixture) traderBalance(t *testing.T) money.Amount {
	t.Helper()
	b, err := ledger.Balance(context.Background(), f.Pool,
		ledger.User(f.Trader), ledger.KindAvailable, money.NGN)
	if err != nil {
		t.Fatalf("balance: %v", err)
	}
	return b
}

func (f *fixture) agentFloat(t *testing.T) money.Amount {
	t.Helper()
	b, err := ledger.Balance(context.Background(), f.Pool,
		ledger.Agent(f.AgentID), ledger.KindAgentFloat, money.NGN)
	if err != nil {
		t.Fatalf("float: %v", err)
	}
	return b
}

func fundTreasuryAndAgent(t *testing.T, pool *pgxpool.Pool, agentID uuid.UUID, amount money.Amount) {
	t.Helper()
	ctx := context.Background()
	if _, err := movements.FundTreasury(ctx, pool, amount, uuid.NewString()); err != nil {
		t.Fatalf("fund treasury: %v", err)
	}
	if err := movements.InTx(ctx, pool, func(tx pgx.Tx) error {
		_, e := movements.AllocateFloat(ctx, tx, agentID, amount, uuid.NewString())
		return e
	}); err != nil {
		t.Fatalf("allocate float: %v", err)
	}
}

// The whole flow: photograph, walk, hand over, both confirm, get paid.
func TestAHandoverConfirmedByBothSidesPaysTheTrader(t *testing.T) {
	amount := money.Naira(4_000)
	f := newFixture(t, amount, money.Naira(50_000))
	ctx := context.Background()

	p, err := f.pledge(t, amount)
	if err != nil {
		t.Fatalf("Pledge: %v", err)
	}
	if p.State != StateOpen {
		t.Fatalf("state = %s, want open", p.State)
	}

	h, err := f.Svc.Match(ctx, f.Store, p.ID, f.Trader)
	if err != nil {
		t.Fatalf("Match: %v", err)
	}

	// The agent's float is locked the moment the offer is made, so a trader
	// who walks there does not arrive to find it spent.
	if got := f.agentFloat(t); got.Minor() != 4_600_000 {
		t.Errorf("agent float = %s, want ₦46,000.00 with ₦4,000 locked", got)
	}
	// And nothing has been credited yet.
	if got := f.traderBalance(t); !got.IsZero() {
		t.Errorf("trader was credited %s before the handover happened", got)
	}

	if _, err := f.Svc.ConfirmByTrader(ctx, h.ID, f.Trader); err != nil {
		t.Fatalf("ConfirmByTrader: %v", err)
	}
	// Still nothing: one side is not a handover.
	if got := f.traderBalance(t); !got.IsZero() {
		t.Fatalf("trader was credited %s on their own say-so", got)
	}

	if _, err := f.Svc.ConfirmByAgent(ctx, h.ID, f.AgentID, h.Code); err != nil {
		t.Fatalf("ConfirmByAgent: %v", err)
	}

	if got := f.traderBalance(t); got.Minor() != 400_000 {
		t.Errorf("trader balance = %s, want the full ₦4,000.00", got)
	}
	if got := f.agentFloat(t); got.Minor() != 4_600_000 {
		t.Errorf("agent float = %s, want ₦46,000.00 -- they gave cash and got the escrow", got)
	}
}

// The order does not matter, only that both happened.
func TestEitherSideMayConfirmFirst(t *testing.T) {
	amount := money.Naira(2_000)
	f := newFixture(t, amount, money.Naira(20_000))
	ctx := context.Background()

	p, _ := f.pledge(t, amount)
	h, err := f.Svc.Match(ctx, f.Store, p.ID, f.Trader)
	if err != nil {
		t.Fatalf("Match: %v", err)
	}

	if _, err := f.Svc.ConfirmByAgent(ctx, h.ID, f.AgentID, h.Code); err != nil {
		t.Fatalf("ConfirmByAgent: %v", err)
	}
	if got := f.traderBalance(t); !got.IsZero() {
		t.Fatal("the agent's confirmation alone credited the trader")
	}
	if _, err := f.Svc.ConfirmByTrader(ctx, h.ID, f.Trader); err != nil {
		t.Fatalf("ConfirmByTrader: %v", err)
	}
	if got := f.traderBalance(t); got.Minor() != 200_000 {
		t.Errorf("balance = %s, want ₦2,000.00", got)
	}
}

// The most important refusal in this package. Photographing the same cash
// twice is the obvious attack, and the database refuses it rather than a check
// somebody could forget to write.
func TestTheSameNotesCannotBePledgedTwice(t *testing.T) {
	amount := money.Naira(4_000)
	f := newFixture(t, amount, money.Naira(50_000))

	if _, err := f.pledge(t, amount); err != nil {
		t.Fatalf("first pledge: %v", err)
	}

	// A different photograph of the same notes: same note identities.
	_, err := f.pledge(t, amount)
	if !errors.Is(err, ErrAlreadyPledged) {
		t.Fatalf("re-pledging the same notes returned %v, want ErrAlreadyPledged", err)
	}
}

// And the same photograph, byte for byte.
func TestTheSamePhotographCannotOpenTwoPledges(t *testing.T) {
	amount := money.Naira(4_000)
	f := newFixture(t, amount, money.Naira(50_000))
	ctx := context.Background()
	image := uniquePhoto(t)

	req := Request{TraderID: f.Trader, Declared: amount, Lat: f.Lat, Lng: f.Lng, Image: image}
	if _, err := f.Svc.Pledge(ctx, req); err != nil {
		t.Fatalf("first pledge: %v", err)
	}
	if _, err := f.Svc.Pledge(ctx, req); !errors.Is(err, ErrAlreadyPledged) {
		t.Fatalf("resending the same photograph returned %v, want ErrAlreadyPledged", err)
	}
}

// A refused pledge must not hold notes hostage: somebody could otherwise lock
// up their own cash with a bad photograph, or a rival's by photographing it.
func TestARefusedPledgeDoesNotClaimTheNotes(t *testing.T) {
	amount := money.Naira(4_000)
	f := newFixture(t, amount, money.Naira(50_000))
	shared := notesFor(4, money.Naira(1000))
	f.Svc.Recogniser = fakeRecogniser{total: amount, notes: shared}
	f.Svc.Risk = fakeAssessor{decision: risk.Deny, reason: "This looks like a photo of a screen."}

	_, err := f.pledge(t, amount)
	if !errors.Is(err, ErrRefused) {
		t.Fatalf("a denied pledge returned %v, want ErrRefused", err)
	}

	// The same notes must still be pledgeable once the photograph is better.
	f.Svc.Risk = fakeAssessor{}
	if _, err := f.pledge(t, amount); err != nil {
		t.Fatalf("the notes were held by a refused pledge: %v", err)
	}
}

// An abandoned meeting must cost nobody anything.
func TestAnAbandonedHandoverReleasesTheFloat(t *testing.T) {
	amount := money.Naira(3_000)
	f := newFixture(t, amount, money.Naira(30_000))
	ctx := context.Background()

	p, _ := f.pledge(t, amount)
	if _, err := f.Svc.Match(ctx, f.Store, p.ID, f.Trader); err != nil {
		t.Fatalf("Match: %v", err)
	}
	if got := f.agentFloat(t); got.Minor() != 2_700_000 {
		t.Fatalf("setup: float = %s, want ₦27,000.00 locked", got)
	}

	// Nobody comes.
	if _, err := f.Pool.Exec(ctx,
		`UPDATE cash_handovers SET expires_at = now() - interval '1 minute' WHERE pledge_id = $1`,
		p.ID); err != nil {
		t.Fatalf("expire: %v", err)
	}
	if _, err := f.Svc.Sweep(ctx); err != nil {
		t.Fatalf("Sweep: %v", err)
	}

	if got := f.agentFloat(t); got.Minor() != 3_000_000 {
		t.Errorf("float = %s after expiry, want the full ₦30,000.00 back", got)
	}
	if got := f.traderBalance(t); !got.IsZero() {
		t.Errorf("trader kept %s from a handover that never happened", got)
	}

	// The pledge is open again: the trader still has their notes, and making
	// them start over would punish them for the agent's absence.
	var state string
	if err := f.Pool.QueryRow(ctx, `SELECT state FROM cash_pledges WHERE id = $1`, p.ID).
		Scan(&state); err != nil {
		t.Fatalf("read pledge: %v", err)
	}
	if state != string(StateOpen) {
		t.Errorf("pledge state = %s after an abandoned meeting, want open", state)
	}
}

func TestTheAgentMustQuoteTheRightCode(t *testing.T) {
	amount := money.Naira(2_000)
	f := newFixture(t, amount, money.Naira(20_000))
	ctx := context.Background()

	p, _ := f.pledge(t, amount)
	h, err := f.Svc.Match(ctx, f.Store, p.ID, f.Trader)
	if err != nil {
		t.Fatalf("Match: %v", err)
	}

	if _, err := f.Svc.ConfirmByAgent(ctx, h.ID, f.AgentID, "000000"); !errors.Is(err, ErrWrongCode) {
		t.Fatalf("a wrong code returned %v, want ErrWrongCode", err)
	}
	if got := f.traderBalance(t); !got.IsZero() {
		t.Error("a wrong code still credited the trader")
	}
}

// Nobody may confirm somebody else's handover.
func TestOnlyTheTwoPartiesMayConfirm(t *testing.T) {
	amount := money.Naira(2_000)
	f := newFixture(t, amount, money.Naira(20_000))
	ctx := context.Background()

	p, _ := f.pledge(t, amount)
	h, err := f.Svc.Match(ctx, f.Store, p.ID, f.Trader)
	if err != nil {
		t.Fatalf("Match: %v", err)
	}

	stranger := uuid.New()
	if _, err := f.Svc.ConfirmByTrader(ctx, h.ID, stranger); !errors.Is(err, ErrPledgeUnknown) {
		t.Errorf("a stranger confirmed as the trader: %v", err)
	}
	if _, err := f.Svc.ConfirmByAgent(ctx, h.ID, stranger, h.Code); !errors.Is(err, ErrPledgeUnknown) {
		t.Errorf("a stranger confirmed as the agent: %v", err)
	}
}

// No agent with enough float means no match, rather than a match nobody can honour.
func TestNoAgentWithFloatMeansNoMatch(t *testing.T) {
	amount := money.Naira(40_000)
	f := newFixture(t, amount, money.Naira(1_000)) // far too little
	ctx := context.Background()

	p, err := f.pledge(t, amount)
	if err != nil {
		t.Fatalf("Pledge: %v", err)
	}
	if _, err := f.Svc.Match(ctx, f.Store, p.ID, f.Trader); !errors.Is(err, ErrNoAgent) {
		t.Fatalf("got %v, want ErrNoAgent", err)
	}
}

func TestAPledgeNeedsALocationAndASensibleAmount(t *testing.T) {
	f := newFixture(t, money.Naira(1_000), money.Naira(10_000))
	ctx := context.Background()

	// No coordinates: the predecessor accepted these and then reported every
	// agent as 810km away.
	if _, err := f.Svc.Pledge(ctx, Request{
		TraderID: f.Trader, Declared: money.Naira(1_000), Image: photo(t),
	}); err == nil {
		t.Error("a pledge with no location was accepted")
	}

	// More than should change hands in one meeting.
	if _, err := f.Svc.Pledge(ctx, Request{
		TraderID: f.Trader, Declared: money.Naira(900_000),
		Lat: f.Lat, Lng: f.Lng, Image: photo(t),
	}); err == nil {
		t.Error("a pledge larger than the handover cap was accepted")
	}
}

// A recogniser that cannot be reached has not approved anything.
func TestAnUnreachableRecogniserRefusesThePledge(t *testing.T) {
	f := newFixture(t, money.Naira(1_000), money.Naira(10_000))
	f.Svc.Recogniser = fakeRecogniser{err: errors.New("service unavailable")}

	if _, err := f.pledge(t, money.Naira(1_000)); err == nil {
		t.Fatal("a pledge was accepted with no recognition at all")
	}
}

// Whatever happens, the books balance.
func TestTheLedgerBalancesThroughout(t *testing.T) {
	amount := money.Naira(5_000)
	f := newFixture(t, amount, money.Naira(50_000))
	ctx := context.Background()

	p, _ := f.pledge(t, amount)
	h, err := f.Svc.Match(ctx, f.Store, p.ID, f.Trader)
	if err != nil {
		t.Fatalf("Match: %v", err)
	}
	if _, err := f.Svc.ConfirmByTrader(ctx, h.ID, f.Trader); err != nil {
		t.Fatalf("ConfirmByTrader: %v", err)
	}
	if _, err := f.Svc.ConfirmByAgent(ctx, h.ID, f.AgentID, h.Code); err != nil {
		t.Fatalf("ConfirmByAgent: %v", err)
	}

	audit, err := ledger.Auditor(ctx, f.Pool)
	if err != nil {
		t.Fatalf("Auditor: %v", err)
	}
	if !audit.Balanced {
		t.Fatalf("the ledger does not balance after a settled handover: %+v", audit.Currencies)
	}
}
