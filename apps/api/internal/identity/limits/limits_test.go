package limits

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/identity/kyc"
	"github.com/usezoracle/tapp/api/internal/ledger/movements"
	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/internal/platform/migrate"
)

func testChecker(t *testing.T) *Checker {
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
	return &Checker{Pool: pool, Policy: NGNPolicy()}
}

// The ladder must actually climb. A tier that did not raise a limit would be a
// verification somebody did for nothing.
func TestEachTierRaisesEveryLimit(t *testing.T) {
	p := NGNPolicy()
	tiers := []kyc.Tier{kyc.TierNone, kyc.TierBVN, kyc.TierSelfie, kyc.TierDocument}

	for i := 1; i < len(tiers); i++ {
		lower, higher := p.For(tiers[i-1]), p.For(tiers[i])
		for name, pair := range map[string][2]money.Amount{
			"per transaction": {lower.PerTransaction, higher.PerTransaction},
			"daily":           {lower.Daily, higher.Daily},
			"monthly":         {lower.Monthly, higher.Monthly},
			"max balance":     {lower.MaxBalance, higher.MaxBalance},
		} {
			if cmp, _ := pair[1].Cmp(pair[0]); cmp <= 0 {
				t.Errorf("%s does not raise the %s limit: %s -> %s",
					tiers[i], name, pair[0], pair[1])
			}
		}
	}
}

// Within a tier the ceilings must be coherent: a per-transaction limit above
// the daily one would let a single payment pass a limit it exceeds.
func TestLimitsWithinATierAreCoherent(t *testing.T) {
	p := NGNPolicy()
	for _, tier := range []kyc.Tier{kyc.TierNone, kyc.TierBVN, kyc.TierSelfie, kyc.TierDocument} {
		l := p.For(tier)
		if cmp, _ := l.PerTransaction.Cmp(l.Daily); cmp > 0 {
			t.Errorf("%s: a single payment (%s) may exceed the daily limit (%s)",
				tier, l.PerTransaction, l.Daily)
		}
		if cmp, _ := l.Daily.Cmp(l.Monthly); cmp > 0 {
			t.Errorf("%s: the daily limit (%s) exceeds the monthly one (%s)",
				tier, l.Daily, l.Monthly)
		}
	}
}

// An unrecognised tier gets the LOWEST limits. A tier this code does not know
// is one a future migration added, and the safe reading of "I do not know how
// verified this person is" is "not at all".
func TestAnUnknownTierGetsTheLowestLimits(t *testing.T) {
	p := NGNPolicy()
	unknown := p.For(kyc.Tier(99))
	none := p.For(kyc.TierNone)

	if unknown.PerTransaction.Minor() != none.PerTransaction.Minor() {
		t.Errorf("an unknown tier got %s per transaction, want the unverified %s",
			unknown.PerTransaction, none.PerTransaction)
	}
}

func TestASinglePaymentOverTheLimitIsRefusedWithAWayForward(t *testing.T) {
	c := testChecker(t)
	user := uuid.New()

	// ₦10,000 exceeds the ₦5,000 unverified per-payment limit.
	v, err := c.Check(context.Background(), user, kyc.TierNone, money.Naira(10_000))
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if v.Allowed {
		t.Fatal("₦10,000 was allowed on an unverified account")
	}
	if v.RequiredTier != kyc.TierBVN {
		t.Errorf("required tier = %s, want bvn -- the refusal should say what would lift it",
			v.RequiredTier)
	}
	if v.Reason == "" {
		t.Error("a refusal carried no reason")
	}

	// The same payment is fine once the BVN is verified.
	v, err = c.Check(context.Background(), user, kyc.TierBVN, money.Naira(10_000))
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if !v.Allowed {
		t.Fatalf("₦10,000 was refused at the BVN tier: %s", v.Reason)
	}
}

// Spend is summed from the ledger. A counter would have to be incremented by
// every path that moves money, and the first one that forgot would create a
// limit that silently did not apply.
func TestDailySpendIsSummedFromTheLedger(t *testing.T) {
	c := testChecker(t)
	ctx := context.Background()
	user, merchant := uuid.New(), uuid.New()

	if _, err := movements.Deposit(ctx, c.Pool, user, money.Naira(500_000), "test", uuid.NewString()); err != nil {
		t.Fatalf("Deposit: %v", err)
	}

	// Spend ₦180,000 of the ₦200,000 BVN daily limit.
	spend(t, c.Pool, user, merchant, money.Naira(180_000))

	v, err := c.Check(ctx, user, kyc.TierBVN, money.Naira(30_000))
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if v.Allowed {
		t.Fatal("a payment taking the day to ₦210,000 was allowed against a ₦200,000 limit")
	}
	if v.SpentToday.Minor() != 18_000_000 {
		t.Errorf("spent today = %s, want ₦180,000.00", v.SpentToday)
	}

	// ₦20,000 exactly reaches the limit and is allowed.
	v, err = c.Check(ctx, user, kyc.TierBVN, money.Naira(20_000))
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if !v.Allowed {
		t.Fatalf("a payment reaching exactly the limit was refused: %s", v.Reason)
	}
}

// Receiving money is not spending it. A limit that counted inbound value would
// stop somebody being paid.
func TestReceivingDoesNotConsumeTheLimit(t *testing.T) {
	c := testChecker(t)
	ctx := context.Background()
	user := uuid.New()

	// A large deposit, no spending.
	if _, err := movements.Deposit(ctx, c.Pool, user, money.Naira(500_000), "test", uuid.NewString()); err != nil {
		t.Fatalf("Deposit: %v", err)
	}

	v, err := c.Check(ctx, user, kyc.TierBVN, money.Naira(50_000))
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if !v.Allowed {
		t.Fatalf("receiving ₦500,000 consumed the spending limit: %s", v.Reason)
	}
	if !v.SpentToday.IsZero() {
		t.Errorf("spent today = %s after only receiving, want zero", v.SpentToday)
	}
}

// The daily window is a person's day, not UTC's. In Lagos those differ by an
// hour, which is an hour every night in which the limit resets early.
func TestTheDailyWindowRollsOver(t *testing.T) {
	c := testChecker(t)
	ctx := context.Background()
	user, merchant := uuid.New(), uuid.New()

	if _, err := movements.Deposit(ctx, c.Pool, user, money.Naira(500_000), "test", uuid.NewString()); err != nil {
		t.Fatalf("Deposit: %v", err)
	}
	spend(t, c.Pool, user, merchant, money.Naira(190_000))

	if v, _ := c.Check(ctx, user, kyc.TierBVN, money.Naira(20_000)); v.Allowed {
		t.Fatal("setup: the daily limit was not reached")
	}

	c.Now = func() time.Time { return time.Now().Add(25 * time.Hour) }
	v, err := c.Check(ctx, user, kyc.TierBVN, money.Naira(20_000))
	if err != nil {
		t.Fatalf("Check: %v", err)
	}
	if !v.Allowed {
		t.Fatalf("the daily limit did not reset overnight: %s", v.Reason)
	}
}

func spend(t *testing.T, pool *pgxpool.Pool, user, merchant uuid.UUID, amount money.Amount) {
	t.Helper()
	ctx := context.Background()
	err := movements.InTx(ctx, pool, func(tx pgx.Tx) error {
		_, e := movements.Tap(ctx, tx, user, merchant, amount, money.Zero(amount.Currency()), uuid.New())
		return e
	})
	if err != nil {
		t.Fatalf("spend %s: %v", amount, err)
	}
}
