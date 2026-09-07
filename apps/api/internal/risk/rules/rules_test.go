package rules

import (
	"context"
	"math"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/platform/migrate"
	"github.com/usezoracle/tapp/api/internal/risk"
)

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

func TestDistanceIsRight(t *testing.T) {
	// Lagos to Abuja, about 525km great-circle.
	km := haversineKm(6.5244, 3.3792, 9.0765, 7.3986)
	if math.Abs(km-525) > 25 {
		t.Errorf("Lagos to Abuja measured %.0fkm, want about 525", km)
	}
	if d := haversineKm(6.5244, 3.3792, 6.5244, 3.3792); d != 0 {
		t.Errorf("a point to itself measured %.6fkm", d)
	}
}

// Two actions from places too far apart to have travelled between. This is the
// only geo signal that means anything: people travel, so distance alone is not
// evidence -- a distance that could not have been covered is.
func TestImpossibleTravelIsFlagged(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	user := uuid.New()
	now := time.Now()

	// In Lagos ten minutes ago.
	if _, err := pool.Exec(ctx,
		`INSERT INTO risk_locations (user_id, lat, lng, at) VALUES ($1, 6.5244, 3.3792, $2)`,
		user, now.Add(-10*time.Minute)); err != nil {
		t.Fatalf("seed location: %v", err)
	}

	g := &Geo{Pool: pool}
	lat, lng := 51.5074, -0.1278 // London
	signals, err := g.Inspect(ctx, risk.Subject{
		Kind: "tap", UserID: user, Lat: &lat, Lng: &lng, At: now,
	})
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}

	var found bool
	for _, s := range signals {
		if s.Name == "geo.impossible_travel" {
			found = true
			if s.Severity < risk.High {
				t.Errorf("severity %d, want high", s.Severity)
			}
		}
	}
	if !found {
		t.Fatalf("Lagos to London in ten minutes was not flagged: %+v", signals)
	}
}

// Ordinary travel is not flagged. Across Lagos in ten minutes is a car ride.
func TestOrdinaryTravelIsNotFlagged(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	user := uuid.New()
	now := time.Now()

	if _, err := pool.Exec(ctx,
		`INSERT INTO risk_locations (user_id, lat, lng, at) VALUES ($1, 6.5244, 3.3792, $2)`,
		user, now.Add(-30*time.Minute)); err != nil {
		t.Fatalf("seed location: %v", err)
	}

	lat, lng := 6.6018, 3.3515 // about 10km away
	signals, err := (&Geo{Pool: pool}).Inspect(ctx, risk.Subject{
		Kind: "tap", UserID: user, Lat: &lat, Lng: &lng, At: now,
	})
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}
	for _, s := range signals {
		if s.Severity > risk.Info {
			t.Errorf("a 10km trip in half an hour produced %q at severity %d", s.Name, s.Severity)
		}
	}
}

// Absent location is not evidence. Most people decline the permission, and
// treating that as suspicious would penalise the cautious.
func TestNoLocationIsNotSuspicious(t *testing.T) {
	pool := testPool(t)
	signals, err := (&Geo{Pool: pool}).Inspect(context.Background(), risk.Subject{
		Kind: "tap", UserID: uuid.New(), At: time.Now(),
	})
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}
	if len(signals) != 0 {
		t.Errorf("a subject with no location produced %d signals", len(signals))
	}
}

func TestAFirstActionHasNothingToCompareAgainst(t *testing.T) {
	pool := testPool(t)
	lat, lng := 6.5244, 3.3792
	signals, err := (&Geo{Pool: pool}).Inspect(context.Background(), risk.Subject{
		Kind: "tap", UserID: uuid.New(), Lat: &lat, Lng: &lng, At: time.Now(),
	})
	if err != nil {
		t.Fatalf("a first-ever action errored: %v", err)
	}
	if len(signals) != 0 {
		t.Errorf("a first-ever action produced %d signals", len(signals))
	}
}

// A quiet account produces no velocity signal. The thresholds are sized for a
// market trader's ordinary day, so the common case must stay silent.
func TestAQuietAccountIsNotFlagged(t *testing.T) {
	pool := testPool(t)
	signals, err := NewVelocity(pool).Inspect(context.Background(), risk.Subject{
		Kind: "tap", UserID: uuid.New(), At: time.Now(),
	})
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}
	for _, s := range signals {
		if s.Severity > risk.Info {
			t.Errorf("an account with no history produced %q at severity %d", s.Name, s.Severity)
		}
	}
}
