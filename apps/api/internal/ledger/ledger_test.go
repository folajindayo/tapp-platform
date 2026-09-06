package ledger

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/internal/platform/migrate"
)

// These tests run against a real Postgres, deliberately. The guarantees under
// test -- a deferred constraint trigger, a composite foreign key, a unique
// index -- live in the database and cannot be exercised by a fake. A ledger
// verified only against a mock is verified against the assumptions of whoever
// wrote the mock.
func testPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://tapp:tapp@localhost:5433/tapp?sslmode=disable"
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Skipf("no test database (%v); start it with `docker compose up -d postgres`", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		t.Skipf("no test database (%v); start it with `docker compose up -d postgres`", err)
	}
	if err := migrate.Up(ctx, pool); err != nil {
		pool.Close()
		t.Fatalf("migrate: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// A fresh party per test, so tests do not have to coordinate over balances.
func someone() Owner { return User(uuid.New()) }

func acct(t *testing.T, pool *pgxpool.Pool, o Owner, kind string, c money.Currency) uuid.UUID {
	t.Helper()
	id, err := AccountFor(context.Background(), pool, o, kind, c)
	if err != nil {
		t.Fatalf("AccountFor(%s/%s/%s): %v", o.Kind, kind, c, err)
	}
	return id
}

func TestABalancedTransactionCommits(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	alice, bob := someone(), someone()
	from := acct(t, pool, alice, KindAvailable, money.NGN)
	to := acct(t, pool, bob, KindAvailable, money.NGN)

	if _, err := Post(ctx, pool, Ref{Type: "test"}, []Entry{
		{from, money.Naira(-500), "test.debit"},
		{to, money.Naira(500), "test.credit"},
	}); err != nil {
		t.Fatalf("Post: %v", err)
	}

	got, err := Balance(ctx, pool, bob, KindAvailable, money.NGN)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if got.Minor() != money.Naira(500).Minor() {
		t.Errorf("balance = %s, want %s", got, money.Naira(500))
	}
}

// The single most important property. An unbalanced set is refused before it
// reaches the database, and the message names the currency and the shortfall
// rather than surfacing a trigger failure with no context.
func TestAnUnbalancedTransactionIsRefused(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	alice := someone()
	from := acct(t, pool, alice, KindAvailable, money.NGN)
	to := acct(t, pool, someone(), KindAvailable, money.NGN)

	_, err := Post(ctx, pool, Ref{}, []Entry{
		{from, money.New(-500, money.NGN), "test.debit"},
		{to, money.New(499, money.NGN), "test.credit"},
	})
	if err == nil {
		t.Fatal("an unbalanced transaction was accepted")
	}

	// And nothing was written.
	bal, _ := Balance(ctx, pool, alice, KindAvailable, money.NGN)
	if !bal.IsZero() {
		t.Errorf("a refused transaction moved money: balance is %s", bal)
	}
}

// The multi-currency guarantee, and the reason the trigger groups by currency.
// These entries sum to zero in total. Accepting them would create dollars by
// destroying naira.
func TestZeroInTotalIsNotZeroPerCurrency(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	alice := someone()
	ngn := acct(t, pool, alice, KindAvailable, money.NGN)
	usd := acct(t, pool, alice, KindAvailable, money.USD)

	_, err := Post(ctx, pool, Ref{}, []Entry{
		{ngn, money.New(-1000, money.NGN), "test.ngn_leg"},
		{usd, money.New(1000, money.USD), "test.usd_leg"},
	})
	if err == nil {
		t.Fatal("a transaction balancing only in total was accepted: naira became dollars")
	}
}

// A conversion is one transaction with two legs, each balancing on its own.
func TestAConversionBalancesInBothCurrencies(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	alice := someone()
	userUSD := acct(t, pool, alice, KindAvailable, money.USD)
	userNGN := acct(t, pool, alice, KindAvailable, money.NGN)
	posUSD := acct(t, pool, System(), KindFXPosition, money.USD)
	posNGN := acct(t, pool, System(), KindFXPosition, money.NGN)
	revenue := acct(t, pool, System(), KindRevenue, money.NGN)

	// $10 at 1540 NGN/USD, less a 0.5% spread.
	if _, err := Post(ctx, pool, Ref{Type: "fx"}, []Entry{
		{userUSD, money.New(-1000, money.USD), "fx.sold"},
		{posUSD, money.New(1000, money.USD), "fx.position"},
		{posNGN, money.New(-1_540_000, money.NGN), "fx.position"},
		{userNGN, money.New(1_532_300, money.NGN), "fx.bought"},
		{revenue, money.New(7_700, money.NGN), "fx.spread"},
	}); err != nil {
		t.Fatalf("a balanced conversion was refused: %v", err)
	}

	usd, _ := Balance(ctx, pool, alice, KindAvailable, money.USD)
	ngn, _ := Balance(ctx, pool, alice, KindAvailable, money.NGN)
	if usd.Minor() != -1000 {
		t.Errorf("USD leg = %s, want -$10.00", usd)
	}
	if ngn.Minor() != 1_532_300 {
		t.Errorf("NGN leg = %s, want ₦15,323.00", ngn)
	}
}

// An idempotency key makes a movement happen at most once, whatever the caller
// does. This is what stands between a retried webhook and paying somebody
// twice.
func TestAnIdempotentMovementHappensOnce(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	alice, bob := someone(), someone()
	from := acct(t, pool, alice, KindAvailable, money.NGN)
	to := acct(t, pool, bob, KindAvailable, money.NGN)
	key := "payout:" + uuid.NewString()

	post := func() error {
		_, err := Post(ctx, pool, Ref{Type: "payout", IdemKey: key}, []Entry{
			{from, money.Naira(-100), "payout.sent"},
			{to, money.Naira(100), "payout.received"},
		})
		return err
	}

	if err := post(); err != nil {
		t.Fatalf("first posting: %v", err)
	}
	err := post()
	if !errors.Is(err, ErrDuplicate) {
		t.Fatalf("replay returned %v, want ErrDuplicate", err)
	}

	bal, _ := Balance(ctx, pool, bob, KindAvailable, money.NGN)
	if bal.Minor() != money.Naira(100).Minor() {
		t.Errorf("balance after a replayed payout = %s, want ₦100.00", bal)
	}
}

// Concurrent identical retries -- the shape a webhook redelivery storm
// actually takes. Exactly one must win.
func TestConcurrentRetriesPostOnce(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	alice, bob := someone(), someone()
	from := acct(t, pool, alice, KindAvailable, money.NGN)
	to := acct(t, pool, bob, KindAvailable, money.NGN)
	key := "concurrent:" + uuid.NewString()

	const attempts = 8
	var wg sync.WaitGroup
	errs := make([]error, attempts)
	for i := range attempts {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = Post(ctx, pool, Ref{Type: "payout", IdemKey: key}, []Entry{
				{from, money.Naira(-100), "payout.sent"},
				{to, money.Naira(100), "payout.received"},
			})
		}()
	}
	wg.Wait()

	succeeded := 0
	for _, err := range errs {
		if err == nil {
			succeeded++
		}
	}
	if succeeded != 1 {
		t.Fatalf("%d of %d concurrent retries succeeded, want exactly 1", succeeded, attempts)
	}

	bal, _ := Balance(ctx, pool, bob, KindAvailable, money.NGN)
	if bal.Minor() != money.Naira(100).Minor() {
		t.Errorf("balance = %s, want ₦100.00 -- money was moved more than once", bal)
	}
}

// Entries that are not movements are refused before reaching the database, so
// the caller is told which leg was wrong.
func TestNonMovementsAreRefused(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	a := acct(t, pool, someone(), KindAvailable, money.NGN)
	b := acct(t, pool, someone(), KindAvailable, money.NGN)

	for name, entries := range map[string][]Entry{
		"a single leg":    {{a, money.Naira(100), "test.one"}},
		"no legs":         {},
		"a zero amount":   {{a, money.Zero(money.NGN), "test.zero"}, {b, money.Zero(money.NGN), "test.zero"}},
		"an empty reason": {{a, money.Naira(-1), ""}, {b, money.Naira(1), "test.credit"}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := Post(ctx, pool, Ref{}, entries); err == nil {
				t.Fatalf("%s was accepted as a movement", name)
			}
		})
	}
}

// An account is resolved once and reused. Two callers racing to create the
// same account must not produce two.
func TestAccountResolutionIsIdempotent(t *testing.T) {
	pool := testPool(t)
	alice := someone()

	first := acct(t, pool, alice, KindAvailable, money.NGN)
	second := acct(t, pool, alice, KindAvailable, money.NGN)
	if first != second {
		t.Fatalf("resolving the same account twice gave %s then %s", first, second)
	}

	// The same party in a different currency is a different account.
	usd := acct(t, pool, alice, KindAvailable, money.USD)
	if usd == first {
		t.Fatal("the NGN and USD accounts of one party are the same row")
	}
}

// The audit is the invariant made visible. It must report balanced after any
// sequence of movements, and it must notice if the ledger is ever written
// around -- which is the only way it can become unbalanced, since the trigger
// makes it unreachable through this package.
func TestAuditReportsBalanced(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	alice, bob := someone(), someone()
	from := acct(t, pool, alice, KindAvailable, money.NGN)
	to := acct(t, pool, bob, KindAvailable, money.NGN)
	if _, err := Post(ctx, pool, Ref{Type: "test"}, []Entry{
		{from, money.Naira(-250), "test.debit"},
		{to, money.Naira(250), "test.credit"},
	}); err != nil {
		t.Fatalf("Post: %v", err)
	}

	audit, err := Auditor(ctx, pool)
	if err != nil {
		t.Fatalf("Auditor: %v", err)
	}
	if !audit.Balanced {
		t.Error("the ledger reports unbalanced")
	}
	if len(audit.Currencies) != len(money.SupportedCurrencies()) {
		t.Errorf("audited %d currencies, want %d", len(audit.Currencies), len(money.SupportedCurrencies()))
	}
	for _, c := range audit.Currencies {
		if c.SumMinor != 0 {
			t.Errorf("%s sums to %d, must be 0", c.Currency, c.SumMinor)
		}
		if c.UnbalancedTransactions != 0 {
			t.Errorf("%s has %d unbalanced transactions; the trigger was bypassed",
				c.Currency, c.UnbalancedTransactions)
		}
	}
}
