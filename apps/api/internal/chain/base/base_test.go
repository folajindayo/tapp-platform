package base

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/internal/platform/migrate"
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

func fixture(t *testing.T) (*Addresses, *Deposits) {
	t.Helper()
	pool := testPool(t)
	addrs := &Addresses{Pool: pool, Deriver: deriver(t)}
	return addrs, &Deposits{Pool: pool, Addresses: addrs, Confirmations: 12}
}

func TestEachUserGetsTheirOwnStableAddress(t *testing.T) {
	addrs, _ := fixture(t)
	ctx := context.Background()

	alice, bob := uuid.New(), uuid.New()

	a1, err := addrs.For(ctx, alice)
	if err != nil {
		t.Fatalf("For(alice): %v", err)
	}
	a2, err := addrs.For(ctx, alice)
	if err != nil {
		t.Fatalf("For(alice) again: %v", err)
	}
	if a1 != a2 {
		t.Errorf("alice got two addresses: %s then %s", a1, a2)
	}

	b, err := addrs.For(ctx, bob)
	if err != nil {
		t.Fatalf("For(bob): %v", err)
	}
	if b == a1 {
		t.Fatal("two users share a deposit address; their deposits are indistinguishable")
	}
}

// The check that catches a changed seed. Without it the system would keep
// handing out addresses whose funds it can no longer sweep.
func TestAnAddressFromADifferentSeedIsRefused(t *testing.T) {
	addrs, _ := fixture(t)
	ctx := context.Background()
	user := uuid.New()

	if _, err := addrs.For(ctx, user); err != nil {
		t.Fatalf("For: %v", err)
	}

	otherSeed, _ := ParseSeed(strings.Repeat("cd", SeedLen))
	other, err := NewDeriver(otherSeed)
	if err != nil {
		t.Fatal(err)
	}
	addrs.Deriver = other

	if _, err := addrs.For(ctx, user); !errors.Is(err, ErrAddressMismatch) {
		t.Fatalf("got %v, want ErrAddressMismatch", err)
	}
}

// The chain's own identity for an event is the idempotency key, which is what
// makes a restarted watcher safe.
func TestReScanningABlockDoesNotCreditTwice(t *testing.T) {
	addrs, deposits := fixture(t)
	ctx := context.Background()
	user := uuid.New()

	address, err := addrs.For(ctx, user)
	if err != nil {
		t.Fatalf("For: %v", err)
	}

	transfer := Transfer{
		TxHash:   "0x" + uuid.NewString()[:8] + strings.Repeat("a", 56),
		LogIndex: 3, From: "0xsender", To: address,
		AmountMicro: 10_000_000, BlockNumber: 100, // $10
	}

	// Seen three times, as a restarted watcher would.
	for i := 0; i < 3; i++ {
		if err := deposits.Record(ctx, transfer); err != nil {
			t.Fatalf("Record %d: %v", i, err)
		}
	}

	credited, err := deposits.CreditConfirmed(ctx, 200)
	if err != nil {
		t.Fatalf("CreditConfirmed: %v", err)
	}
	if credited != 1 {
		t.Errorf("credited %d times, want once", credited)
	}

	balance, err := ledger.Balance(ctx, deposits.Pool, ledger.User(user), ledger.KindAvailable, money.USD)
	if err != nil {
		t.Fatalf("Balance: %v", err)
	}
	if balance.Minor() != 1000 {
		t.Errorf("balance = %s, want $10.00", balance)
	}

	// And crediting again finds nothing to do.
	if again, _ := deposits.CreditConfirmed(ctx, 300); again != 0 {
		t.Errorf("a second pass credited %d more", again)
	}
}

// Base can reorg. Crediting on first sighting would mean crediting deposits
// that later never happened, by which time the money is spent.
func TestADepositIsNotCreditedUntilConfirmed(t *testing.T) {
	addrs, deposits := fixture(t)
	ctx := context.Background()
	user := uuid.New()

	address, _ := addrs.For(ctx, user)
	if err := deposits.Record(ctx, Transfer{
		TxHash:   "0x" + strings.Repeat("b", 62) + uuid.NewString()[:2],
		LogIndex: 0, From: "0xsender", To: address,
		AmountMicro: 5_000_000, BlockNumber: 100,
	}); err != nil {
		t.Fatalf("Record: %v", err)
	}

	// Only 5 blocks on top: not enough.
	if credited, _ := deposits.CreditConfirmed(ctx, 105); credited != 0 {
		t.Fatalf("credited %d deposits with 5 confirmations, want 0", credited)
	}
	if b, _ := ledger.Balance(ctx, deposits.Pool, ledger.User(user), ledger.KindAvailable, money.USD); !b.IsZero() {
		t.Fatalf("balance = %s before confirmation", b)
	}

	// Twelve is enough.
	if credited, _ := deposits.CreditConfirmed(ctx, 112); credited != 1 {
		t.Fatalf("credited %d deposits with 12 confirmations, want 1", credited)
	}
}

// A transfer to an address nobody owns is not ours and must not error.
func TestATransferToAnUnknownAddressIsIgnored(t *testing.T) {
	_, deposits := fixture(t)
	err := deposits.Record(context.Background(), Transfer{
		TxHash: "0x" + strings.Repeat("c", 64), LogIndex: 0,
		From: "0xsender", To: "0x" + strings.Repeat("9", 40),
		AmountMicro: 1_000_000, BlockNumber: 10,
	})
	if err != nil {
		t.Fatalf("a transfer to somebody else's address errored: %v", err)
	}
}

// USDC has six decimals, the ledger has two. Truncating rather than rounding:
// rounding up would credit a cent that never arrived.
func TestSubCentAmountsAreNotRoundedUp(t *testing.T) {
	for micro, wantCents := range map[int64]int64{
		10_000_000: 1000, // $10.00
		1_234_567:  123,  // $1.234567 -> $1.23, not $1.24
		9_999:      0,    // under a cent
		10_000:     1,    // exactly a cent
	} {
		if got := usdFromMicro(micro); got.Minor() != wantCents {
			t.Errorf("%d micro -> %s, want %d cents", micro, got, wantCents)
		}
	}
}

// A sub-cent deposit cannot be credited and must not be retried forever.
func TestASubCentDepositIsMarkedRatherThanRetried(t *testing.T) {
	addrs, deposits := fixture(t)
	ctx := context.Background()
	user := uuid.New()

	address, _ := addrs.For(ctx, user)
	txHash := "0x" + strings.Repeat("d", 62) + uuid.NewString()[:2]
	if err := deposits.Record(ctx, Transfer{
		TxHash: txHash, LogIndex: 0, From: "0xsender", To: address,
		AmountMicro: 500, BlockNumber: 100, // half a cent
	}); err != nil {
		t.Fatalf("Record: %v", err)
	}

	if credited, err := deposits.CreditConfirmed(ctx, 200); err != nil || credited != 0 {
		t.Fatalf("credited=%d err=%v, want 0 and no error", credited, err)
	}

	var state string
	if err := deposits.Pool.QueryRow(ctx,
		`SELECT state FROM base_deposits WHERE tx_hash = $1`, strings.ToLower(txHash)).
		Scan(&state); err != nil {
		t.Fatalf("read deposit: %v", err)
	}
	if state != "failed" {
		t.Errorf("state = %q, want failed so it is not retried every pass", state)
	}
}
