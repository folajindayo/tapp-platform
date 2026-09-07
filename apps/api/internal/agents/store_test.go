package agents

import (
	"context"
	"crypto/rand"
	"errors"
	"math"
	"math/big"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/internal/platform/migrate"
)

func testStore(t *testing.T) *Store {
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
	return &Store{Pool: pool}
}

// Each test gets its own patch of map.
//
// Agents accumulate: the database is not reset between runs, and every test
// that registers one leaves it there. Sharing an origin meant a later test's
// search returned dozens of earlier tests' agents, and the result limit then
// truncated the ones it was actually looking for. Spacing the origins a degree
// apart -- about 111km, far beyond any search radius here -- makes each test
// blind to the others.
// The base is random per process. A counter starting from zero each run drops
// the next run's agents on top of the last run's, and a search then returns
// agents this test never registered.
var (
	originBase = randomOrigin()
	testOrigin atomic.Int64
)

func randomOrigin() float64 {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000))
	if err != nil {
		panic(err)
	}
	return float64(n.Int64())
}

func ownPatch(t *testing.T) (float64, float64) {
	t.Helper()
	n := originBase + float64(testOrigin.Add(1))
	return 4.5 + math.Mod(n*0.37, 9.0), 2.5 + math.Mod(n*0.53, 12.0)
}

func register(t *testing.T, s *Store, name string, lat, lng float64, verified bool) *Agent {
	t.Helper()
	a, err := s.Register(context.Background(), Registration{
		OperatorID: uuid.New(), Name: name, Kind: KindAgent,
		Address: name + " " + uuid.NewString(),
		Lat:     lat, Lng: lng, OpensAt: "08:00", ClosesAt: "18:00",
	})
	if err != nil {
		t.Fatalf("Register(%s): %v", name, err)
	}
	if verified {
		if err := s.Verify(context.Background(), a.ID); err != nil {
			t.Fatalf("Verify: %v", err)
		}
		a.Verified = true
	}
	return a
}

func TestDistanceIsAccurate(t *testing.T) {
	// Lagos to Abuja, about 525km.
	km := DistanceM(6.5244, 3.3792, 9.0765, 7.3986) / 1000
	if math.Abs(km-525) > 25 {
		t.Errorf("measured %.0fkm, want about 525", km)
	}
	if d := DistanceM(6.5244, 3.3792, 6.5244, 3.3792); d != 0 {
		t.Errorf("a point to itself measured %.4fm", d)
	}
}

func TestNearbyReturnsTheClosestFirst(t *testing.T) {
	s := testStore(t)
	centreLat, centreLng := ownPatch(t)

	far := register(t, s, "far", mustOffset(centreLat, 3000), centreLng, true)
	near := register(t, s, "near", mustOffset(centreLat, 300), centreLng, true)

	found, err := s.Nearby(context.Background(), Search{Lat: centreLat, Lng: centreLng, RadiusM: 5000})
	if err != nil {
		t.Fatalf("Nearby: %v", err)
	}

	var order []uuid.UUID
	for _, a := range found {
		if a.ID == near.ID || a.ID == far.ID {
			order = append(order, a.ID)
		}
	}
	if len(order) != 2 {
		t.Fatalf("found %d of the two agents", len(order))
	}
	if order[0] != near.ID {
		t.Error("the further agent was returned first")
	}
}

// The bounding box is a square and the radius is a circle. Without trimming
// the corners a search would return agents up to 40% further than asked.
func TestTheRadiusIsACircleNotASquare(t *testing.T) {
	s := testStore(t)
	centreLat, centreLng := ownPatch(t)

	// 900m north AND 900m east is about 1270m away: inside the bounding box,
	// outside the 1000m radius.
	//
	// The literals are floats on purpose. Written as 900/111_000 they are
	// untyped integer constants, Go divides them as integers, and the offset
	// is silently zero -- which put the agent due north at 900m and made this
	// test pass against a square radius.
	corner := register(t, s, "corner",
		mustOffset(centreLat, 900), centreLng+900.0/111_000.0, true)

	found, err := s.Nearby(context.Background(), Search{Lat: centreLat, Lng: centreLng, RadiusM: 1000})
	if err != nil {
		t.Fatalf("Nearby: %v", err)
	}
	for _, a := range found {
		if a.ID == corner.ID {
			t.Fatalf("an agent %dm away was returned for a 1000m search", a.DistanceM)
		}
	}
}

// Registration is open; verification is not. An unverified shopfront takes no
// handovers, because trusting a self-declared address reintroduces exactly the
// anonymous counterparty that tying handovers to premises removes.
func TestUnverifiedAgentsAreNotReturned(t *testing.T) {
	s := testStore(t)
	centreLat, centreLng := ownPatch(t)
	unverified := register(t, s, "unverified", mustOffset(centreLat, 100), centreLng, false)

	found, err := s.Nearby(context.Background(), Search{Lat: centreLat, Lng: centreLng, RadiusM: 2000})
	if err != nil {
		t.Fatalf("Nearby: %v", err)
	}
	for _, a := range found {
		if a.ID == unverified.ID {
			t.Fatal("an unverified agent was offered for a handover")
		}
	}

	if err := s.Verify(context.Background(), unverified.ID); err != nil {
		t.Fatalf("Verify: %v", err)
	}
	found, _ = s.Nearby(context.Background(), Search{Lat: centreLat, Lng: centreLng, RadiusM: 2000})
	var seen bool
	for _, a := range found {
		if a.ID == unverified.ID {
			seen = true
		}
	}
	if !seen {
		t.Fatal("a verified agent was still not returned")
	}
}

// An agent who cannot cover the amount is not a result, however close. Their
// capacity is a ledger balance, so it cannot drift from the money.
func TestAnAgentWhoCannotPayIsNotOffered(t *testing.T) {
	s := testStore(t)
	ctx := context.Background()
	centreLat, centreLng := ownPatch(t)

	poor := register(t, s, "poor", mustOffset(centreLat, 100), centreLng, true)
	rich := register(t, s, "rich", mustOffset(centreLat, 2000), centreLng, true)

	// Fund the further agent only.
	fundAgent(t, s.Pool, rich.ID, money.Naira(50_000))

	found, err := s.Nearby(ctx, Search{
		Lat: centreLat, Lng: centreLng, RadiusM: 5000, Amount: money.Naira(20_000),
	})
	if err != nil {
		t.Fatalf("Nearby: %v", err)
	}

	for _, a := range found {
		if a.ID == poor.ID {
			t.Error("an agent with no float was offered for a ₦20,000 handover")
		}
	}
	var foundRich bool
	for _, a := range found {
		if a.ID == rich.ID {
			foundRich = true
			if a.Float.Minor() != 5_000_000 {
				t.Errorf("float reported as %s, want ₦50,000.00", a.Float)
			}
		}
	}
	if !foundRich {
		t.Error("the funded agent was not offered")
	}
}

func TestOpeningHoursAreRespected(t *testing.T) {
	s := testStore(t)
	centreLat, centreLng := ownPatch(t)
	a := register(t, s, "shop", mustOffset(centreLat, 100), centreLng, true)

	atNoon := time.Date(2026, 1, 5, 12, 0, 0, 0, time.Local)
	atMidnight := time.Date(2026, 1, 5, 2, 0, 0, 0, time.Local)

	open, err := s.Nearby(context.Background(), Search{
		Lat: centreLat, Lng: centreLng, RadiusM: 2000, OpenAt: atNoon})
	if err != nil {
		t.Fatalf("Nearby: %v", err)
	}
	if !contains(open, a.ID) {
		t.Error("a shop open 08:00-18:00 was not offered at noon")
	}

	shut, _ := s.Nearby(context.Background(), Search{
		Lat: centreLat, Lng: centreLng, RadiusM: 2000, OpenAt: atMidnight})
	if contains(shut, a.ID) {
		t.Error("a shop open 08:00-18:00 was offered at 2am")
	}
}

func TestRegistrationRefusesWhatCannotBeFound(t *testing.T) {
	s := testStore(t)
	base := Registration{
		OperatorID: uuid.New(), Name: "Shop", Kind: KindAgent, Address: "1 Road",
		Lat: 6.5, Lng: 3.3, OpensAt: "08:00", ClosesAt: "18:00",
	}

	bad := map[string]func(*Registration){
		"no operator":     func(r *Registration) { r.OperatorID = uuid.Nil },
		"no name":         func(r *Registration) { r.Name = "" },
		"no address":      func(r *Registration) { r.Address = "" },
		"unknown kind":    func(r *Registration) { r.Kind = "casino" },
		"outside Nigeria": func(r *Registration) { r.Lat, r.Lng = 51.5, -0.12 },
		"closes first":    func(r *Registration) { r.OpensAt, r.ClosesAt = "18:00", "08:00" },
		"bad time":        func(r *Registration) { r.OpensAt = "half past eight" },
	}
	for name, mutate := range bad {
		t.Run(name, func(t *testing.T) {
			r := base
			mutate(&r)
			if _, err := s.Register(context.Background(), r); err == nil {
				t.Fatalf("%s was accepted", name)
			}
		})
	}
}

// The same shopfront registered twice would split its reputation and its float
// across two rows.
func TestTheSamePremisesCannotBeRegisteredTwice(t *testing.T) {
	s := testStore(t)
	operator := uuid.New()
	r := Registration{
		OperatorID: operator, Name: "Mama Ngozi Stores", Kind: KindAgent,
		Address: "14 Balogun Street, Lagos Island",
		Lat:     6.45, Lng: 3.39, OpensAt: "07:00", ClosesAt: "19:00",
	}

	if _, err := s.Register(context.Background(), r); err != nil {
		t.Fatalf("first registration: %v", err)
	}
	if _, err := s.Register(context.Background(), r); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("second registration returned %v, want ErrDuplicate", err)
	}
}

func TestASearchOutsideNigeriaIsRefused(t *testing.T) {
	s := testStore(t)
	if _, err := s.Nearby(context.Background(), Search{Lat: 51.5, Lng: -0.12}); err == nil {
		t.Fatal("a search in London was accepted")
	}
}

func mustOffset(lat, metres float64) float64 { return lat + metres/111_000 }

func contains(agents []Agent, id uuid.UUID) bool {
	for _, a := range agents {
		if a.ID == id {
			return true
		}
	}
	return false
}

// fundAgent moves platform capital into an agent's float, the way an operator
// allocation does.
func fundAgent(t *testing.T, pool *pgxpool.Pool, agentID uuid.UUID, amount money.Amount) {
	t.Helper()
	ctx := context.Background()

	treasury, err := ledger.AccountFor(ctx, pool, ledger.System(), ledger.KindTreasury, amount.Currency())
	if err != nil {
		t.Fatalf("treasury account: %v", err)
	}
	external, err := ledger.AccountFor(ctx, pool, ledger.System(), ledger.KindExternal, amount.Currency())
	if err != nil {
		t.Fatalf("external account: %v", err)
	}
	float, err := ledger.AccountFor(ctx, pool, ledger.Agent(agentID), ledger.KindAgentFloat, amount.Currency())
	if err != nil {
		t.Fatalf("float account: %v", err)
	}

	if _, err := ledger.Post(ctx, pool, ledger.Ref{Type: "test_funding"}, []ledger.Entry{
		{AccountID: treasury, Amount: amount, Reason: "test.capital_in"},
		{AccountID: external, Amount: amount.Neg(), Reason: "test.external"},
	}); err != nil {
		t.Fatalf("fund treasury: %v", err)
	}
	if _, err := ledger.Post(ctx, pool, ledger.Ref{Type: "test_allocation"}, []ledger.Entry{
		{AccountID: treasury, Amount: amount.Neg(), Reason: "test.allocated_out"},
		{AccountID: float, Amount: amount, Reason: "test.allocated"},
	}); err != nil {
		t.Fatalf("allocate float: %v", err)
	}
}
