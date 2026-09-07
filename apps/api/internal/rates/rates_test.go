package rates

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/internal/platform/migrate"
)

type fixedSource struct {
	id   string
	rate string
	err  error
	wait time.Duration
}

func (f fixedSource) Name() string { return f.id }
func (f fixedSource) Rate(ctx context.Context, _ Pair) (decimal.Decimal, error) {
	if f.wait > 0 {
		select {
		case <-time.After(f.wait):
		case <-ctx.Done():
			return decimal.Zero, ctx.Err()
		}
	}
	if f.err != nil {
		return decimal.Zero, f.err
	}
	return decimal.RequireFromString(f.rate), nil
}

func usdNgn() Pair { return Pair{Base: money.USD, Quote: money.NGN} }

func engine(sources ...Source) *Engine {
	return &Engine{
		Sources:      sources,
		Timeout:      time.Second,
		MaxDeviation: decimal.RequireFromString("0.05"),
	}
}

// The median, not the mean. A provider printing a broken number moves a mean
// and does not move a median, and providers do print broken numbers.
func TestTheMedianIsTakenNotTheMean(t *testing.T) {
	r, err := engine(
		fixedSource{id: "a", rate: "1500"},
		fixedSource{id: "b", rate: "1510"},
		fixedSource{id: "c", rate: "1505"},
	).Market(context.Background(), usdNgn())
	if err != nil {
		t.Fatalf("Market: %v", err)
	}
	if !r.Mid.Equal(decimal.RequireFromString("1505")) {
		t.Errorf("mid = %s, want 1505", r.Mid)
	}
	if len(r.Sources) != 3 {
		t.Errorf("sources = %v, want all three", r.Sources)
	}
}

// A provider well away from the others is discarded and NAMED, so a suspect
// price can be traced rather than silently averaged into everyone's rate.
func TestAnOutlierIsDiscardedAndNamed(t *testing.T) {
	r, err := engine(
		fixedSource{id: "good1", rate: "1500"},
		fixedSource{id: "good2", rate: "1505"},
		fixedSource{id: "good3", rate: "1502"},
		fixedSource{id: "broken", rate: "15000"}, // decimal point in the wrong place
	).Market(context.Background(), usdNgn())
	if err != nil {
		t.Fatalf("Market: %v", err)
	}

	if len(r.Discarded) != 1 || r.Discarded[0] != "broken" {
		t.Fatalf("discarded = %v, want [broken]", r.Discarded)
	}
	if r.Mid.GreaterThan(decimal.RequireFromString("1600")) {
		t.Errorf("mid = %s; the outlier moved the rate", r.Mid)
	}
}

// No fallback. A seeded or last-known rate used when every source is down
// means quoting a price nobody can honour.
func TestEveryProviderDownMeansNoRate(t *testing.T) {
	_, err := engine(
		fixedSource{id: "a", err: errors.New("timeout")},
		fixedSource{id: "b", err: errors.New("503")},
	).Market(context.Background(), usdNgn())

	if !errors.Is(err, ErrNoRate) {
		t.Fatalf("got %v, want ErrNoRate", err)
	}
}

func TestNoSourcesConfiguredIsRefused(t *testing.T) {
	if _, err := (&Engine{}).Market(context.Background(), usdNgn()); !errors.Is(err, ErrNoRate) {
		t.Fatalf("got %v, want ErrNoRate", err)
	}
}

// One slow provider must not hold up a quote the others can already price.
func TestASlowProviderIsNotWaitedFor(t *testing.T) {
	e := engine(
		fixedSource{id: "fast", rate: "1500"},
		fixedSource{id: "slow", rate: "1502", wait: 5 * time.Second},
	)
	e.Timeout = 100 * time.Millisecond

	start := time.Now()
	r, err := e.Market(context.Background(), usdNgn())
	if err != nil {
		t.Fatalf("Market: %v", err)
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Errorf("took %s; a slow provider was waited for", elapsed)
	}
	if !r.Mid.Equal(decimal.RequireFromString("1500")) {
		t.Errorf("mid = %s, want the fast provider's 1500", r.Mid)
	}
}

// ---------------------------------------------------------------- quotes

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

func quoter(t *testing.T, rate string) *Quoter {
	t.Helper()
	return &Quoter{
		Engine: engine(fixedSource{id: "test", rate: rate}),
		Spread: Spread{"USD/NGN": 50}, // 0.5%
		Pool:   testPool(t),
	}
}

func TestAQuoteAppliesTheSpreadAndRecordsWhy(t *testing.T) {
	q := quoter(t, "1540")

	// $10 at 1540 = ₦15,400 gross; 0.5% spread = ₦77; customer gets ₦15,323.
	quote, err := q.Offer(context.Background(), money.Dollars(10), money.NGN)
	if err != nil {
		t.Fatalf("Offer: %v", err)
	}

	if quote.Buy.Minor() != 1_532_300 {
		t.Errorf("buy = %s, want ₦15,323.00", quote.Buy)
	}
	if quote.Fee.Minor() != 7_700 {
		t.Errorf("fee = %s, want ₦77.00", quote.Fee)
	}
	if quote.SpreadBPS != 50 {
		t.Errorf("spread = %d bps, want 50", quote.SpreadBPS)
	}
	if !quote.MarketRate.Equal(decimal.RequireFromString("1540")) {
		t.Errorf("market rate = %s, want 1540", quote.MarketRate)
	}
	// Buy + Fee must equal the gross, or the books cannot balance.
	total, err := quote.Buy.Add(quote.Fee)
	if err != nil {
		t.Fatal(err)
	}
	if total.Minor() != 1_540_000 {
		t.Errorf("buy + fee = %s, want the full ₦15,400.00", total)
	}
}

// A pair with no configured spread cannot be quoted. A default would be the
// platform guessing at its own margin.
func TestAPairWithNoSpreadCannotBeQuoted(t *testing.T) {
	q := quoter(t, "1540")
	q.Spread = Spread{}

	if _, err := q.Offer(context.Background(), money.Dollars(10), money.NGN); err == nil {
		t.Fatal("a pair with no configured spread was quoted")
	}
}

// Single use. Two conversions at one locked price is a free option against the
// platform.
func TestAQuoteCanOnlyBeUsedOnce(t *testing.T) {
	q := quoter(t, "1540")
	ctx := context.Background()

	quote, err := q.Offer(ctx, money.Dollars(10), money.NGN)
	if err != nil {
		t.Fatalf("Offer: %v", err)
	}

	redeem := func() error {
		tx, err := q.Pool.Begin(ctx)
		if err != nil {
			return err
		}
		defer tx.Rollback(ctx)
		if _, err := q.Redeem(ctx, tx, quote.ID); err != nil {
			return err
		}
		return tx.Commit(ctx)
	}

	if err := redeem(); err != nil {
		t.Fatalf("first redemption: %v", err)
	}
	if err := redeem(); !errors.Is(err, ErrQuoteUsed) {
		t.Fatalf("second redemption returned %v, want ErrQuoteUsed", err)
	}
}

// An expired quote is refused, and says so distinctly from an already-used
// one -- they lead somewhere different for the person holding it.
func TestAnExpiredQuoteIsRefusedDistinctly(t *testing.T) {
	q := quoter(t, "1540")
	q.Now = func() time.Time { return time.Now().Add(-2 * QuoteTTL) }
	ctx := context.Background()

	quote, err := q.Offer(ctx, money.Dollars(10), money.NGN)
	if err != nil {
		t.Fatalf("Offer: %v", err)
	}

	tx, err := q.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	_, err = q.Redeem(ctx, tx, quote.ID)
	if !errors.Is(err, ErrQuoteExpired) {
		t.Fatalf("got %v, want ErrQuoteExpired", err)
	}
}

func TestAnUnknownQuoteIsRefused(t *testing.T) {
	q := quoter(t, "1540")
	ctx := context.Background()
	tx, err := q.Pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)

	if _, err := q.Redeem(ctx, tx, uuidNew()); !errors.Is(err, ErrQuoteUnknown) {
		t.Fatalf("got %v, want ErrQuoteUnknown", err)
	}
}

// A conversion cannot be quoted when no source can price it, rather than
// falling back to a stale number.
func TestNoRateMeansNoQuote(t *testing.T) {
	q := quoter(t, "1540")
	q.Engine = engine(fixedSource{id: "down", err: errors.New("unreachable")})

	if _, err := q.Offer(context.Background(), money.Dollars(10), money.NGN); !errors.Is(err, ErrNoRate) {
		t.Fatalf("got %v, want ErrNoRate", err)
	}
}

func TestNonsenseConversionsAreRefused(t *testing.T) {
	q := quoter(t, "1540")
	ctx := context.Background()

	if _, err := q.Offer(ctx, money.Naira(100), money.NGN); err == nil {
		t.Error("naira to naira was quoted as a conversion")
	}
	if _, err := q.Offer(ctx, money.Dollars(-1), money.NGN); err == nil {
		t.Error("a negative sale was quoted")
	}
	if _, err := q.Offer(ctx, money.Dollars(0), money.NGN); err == nil {
		t.Error("a zero sale was quoted")
	}
}

func uuidNew() uuid.UUID { return uuid.New() }
