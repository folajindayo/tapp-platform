package transactions

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/ledger/movements"
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
	// users and merchant_bank_accounts are ent's; the columns read here are
	// enough.
	if _, err := pool.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS users (
			id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(),
			updated_at timestamptz NOT NULL DEFAULT now(),
			first_name text NOT NULL DEFAULT '', last_name text NOT NULL DEFAULT '',
			email text UNIQUE NOT NULL, password text NOT NULL DEFAULT '',
			scope text NOT NULL DEFAULT 'sender');
		CREATE TABLE IF NOT EXISTS merchant_bank_accounts (
			id uuid PRIMARY KEY, created_at timestamptz, updated_at timestamptz,
			currency text, bank_code text, account_number text, account_name text,
			verified_at timestamptz, sender_profile_merchant_bank_account uuid)`); err != nil {
		pool.Close()
		t.Fatalf("ent tables: %v", err)
	}
	t.Cleanup(pool.Close)
	return pool
}

// world is one merchant with a bank account, one cardholder, and the taps
// and offramp between them in every state the list has to name.
type world struct {
	merchantProfile, merchantUser, cardholder uuid.UUID
	settled, refundedOnce, failed, reversed  uuid.UUID
	offramp                                   uuid.UUID
}

func build(t *testing.T, pool *pgxpool.Pool) world {
	t.Helper()
	ctx := context.Background()
	w := world{
		merchantProfile: uuid.New(), merchantUser: uuid.New(), cardholder: uuid.New(),
	}
	email := "bright-" + w.cardholder.String()[:8] + "@example.com"
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	_, err := pool.Exec(ctx, `INSERT INTO users (id, email) VALUES ($1, $2)`, w.cardholder, email)
	must(err)
	_, err = pool.Exec(ctx, `
		INSERT INTO merchant_bank_accounts (id, currency, bank_code, account_number, account_name,
		                                    verified_at, sender_profile_merchant_bank_account)
		VALUES ($1, 'NGN', 'OPAYNGPC', '9034409271', 'OLUMIDE SILAS OGUNDELE', now(), $2)`,
		uuid.New(), w.merchantProfile)
	must(err)
	_, err = movements.Deposit(ctx, pool, w.cardholder, money.Naira(100_000), "bank", uuid.NewString())
	must(err)

	tap := func(amountNaira int64, settlement string, rounds int, reversed bool) uuid.UUID {
		id := uuid.New()
		amount := money.Naira(amountNaira)
		fee := money.FeeFor(amount, 50)
		owed, _ := amount.Sub(fee)
		must(movements.InTx(ctx, pool, func(tx pgx.Tx) error {
			ledgerTx, err := movements.Tap(ctx, tx, w.cardholder, w.merchantProfile, amount, fee, id)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `
				INSERT INTO card_taps (id, card_id, cardholder_id, merchant_id, currency,
				                       amount_minor, fee_minor, tier, ledger_tx_id, nonce)
				VALUES ($1, $2, $3, $4, 'NGN', $5, $6, 'none', $7, $8)`,
				id, uuid.New(), w.cardholder, w.merchantProfile, amount.Minor(), fee.Minor(), ledgerTx, uuid.NewString()); err != nil {
				return err
			}
			if settlement != "" {
				if _, err := tx.Exec(ctx, `
					INSERT INTO card_tap_settlements (tap_id, from_address, sell_micro, state, round, tx_hash, order_id, last_error)
					VALUES ($1, '0xb779226ee0f345b42681b981337205c918af8c3c', 1194844, $2, $3,
					        CASE WHEN $2 IN ('submitted','fulfilled') THEN '0xtx' END,
					        CASE WHEN $2 IN ('submitted','fulfilled') THEN '0xorder' END,
					        CASE WHEN $2 = 'failed' THEN 'round 2 (0xtx): refunded by the gateway' END)`,
					id, settlement, rounds); err != nil {
					return err
				}
			}
			for r := 0; r < rounds; r++ {
				if _, err := movements.MerchantSettledOnChain(ctx, tx, w.merchantProfile, owed, id, r); err != nil {
					return err
				}
				if r < rounds-1 || settlement == "failed" {
					if _, err := movements.MerchantSettlementRefunded(ctx, tx, w.merchantProfile, owed, id, r, "refunded by the gateway"); err != nil {
						return err
					}
				}
			}
			if reversed {
				ledgerTx, err := movements.TapReversal(ctx, tx, w.cardholder, w.merchantProfile, amount, fee, id, "goods_not_supplied")
				if err != nil {
					return err
				}
				if _, err := tx.Exec(ctx, `
					INSERT INTO card_tap_reversals (id, tap_id, reason, ledger_tx_id)
					VALUES (gen_random_uuid(), $1, 'goods_not_supplied', $2)`, id, ledgerTx); err != nil {
					return err
				}
			}
			return nil
		}))
		return id
	}
	w.settled = tap(1_600, "fulfilled", 1, false)
	w.refundedOnce = tap(1_500, "submitted", 2, false)
	w.failed = tap(2_000, "failed", 3, false)
	w.reversed = tap(1_000, "pending", 0, true)

	w.offramp = uuid.New()
	_, err = pool.Exec(ctx, `
		INSERT INTO orders (id, sender_id, sold_currency, sold_minor, payout_currency, payout_minor,
		                    bank_code, account_number, account_name, state, settled_at)
		VALUES ($1, $2, 'USD', 500, 'NGN', 700000, 'OPAYNGPC', '9034409271', 'OLUMIDE SILAS OGUNDELE', 'settled', now())`,
		w.offramp, w.merchantUser)
	must(err)
	return w
}

func byID(items []Transaction) map[uuid.UUID]Transaction {
	m := map[uuid.UUID]Transaction{}
	for _, t := range items {
		m[t.ID] = t
	}
	return m
}

func TestAMerchantSeesTheirTapsAndOfframpsWithOneVocabulary(t *testing.T) {
	pool := testPool(t)
	w := build(t, pool)

	items, total, err := List(context.Background(), pool, Filter{
		MerchantProfile: &w.merchantProfile, MerchantUser: &w.merchantUser, Limit: 50,
	})
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if total != 5 || len(items) != 5 {
		t.Fatalf("total=%d len=%d, want 5 of this merchant's and nobody else's", total, len(items))
	}
	got := byID(items)
	want := map[uuid.UUID]string{
		w.settled: StatusSettled, w.refundedOnce: StatusProcessing,
		w.failed: StatusFailed, w.reversed: StatusReversed, w.offramp: StatusSettled,
	}
	for id, status := range want {
		if got[id].Status != status {
			t.Errorf("%s: status = %q, want %q", id, got[id].Status, status)
		}
	}

	s := got[w.settled]
	if s.Kind != KindTap || s.Owed.Minor() != 159_200 || s.Fee.Minor() != 800 || s.Sold() != "1.194844" {
		t.Errorf("settled tap = %+v", s)
	}
	if s.Bank.AccountNumber != "9034409271" || s.CardholderEmail == "" || s.SettledAt == nil {
		t.Errorf("settled tap missing bank, payer or settled_at: %+v", s)
	}
	if r := got[w.refundedOnce]; r.Round != 2 || r.OrderID != "0xorder" {
		t.Errorf("resold tap = round %d order %q, want round 2 with its order", r.Round, r.OrderID)
	}
	if f := got[w.failed]; f.LastError == "" || f.Round != 3 {
		t.Errorf("failed tap says nothing about why: %+v", f)
	}
	if rv := got[w.reversed]; rv.Reason != "goods_not_supplied" {
		t.Errorf("reversed tap reason = %q", rv.Reason)
	}
	o := got[w.offramp]
	if o.Kind != KindOfframp || o.Owed.Minor() != 700_000 || o.Merchant != w.merchantUser {
		t.Errorf("offramp = %+v", o)
	}

	// Filters narrow, and the total follows them.
	items, total, err = List(context.Background(), pool, Filter{
		MerchantProfile: &w.merchantProfile, MerchantUser: &w.merchantUser, Status: StatusSettled,
	})
	if err != nil || total != 2 || len(items) != 2 {
		t.Errorf("settled only: total=%d len=%d err=%v, want 2", total, len(items), err)
	}
	items, _, err = List(context.Background(), pool, Filter{MerchantProfile: &w.merchantProfile, Kind: KindTap})
	if err != nil || len(items) != 4 {
		t.Errorf("taps only: len=%d err=%v, want 4", len(items), err)
	}
	// Somebody else sees none of it.
	other := uuid.New()
	items, total, _ = List(context.Background(), pool, Filter{MerchantProfile: &other, MerchantUser: &other})
	if total != 0 || len(items) != 0 {
		t.Errorf("another merchant sees %d of these", total)
	}
}

func TestPagingCountsTheWholeMatchNotThePage(t *testing.T) {
	pool := testPool(t)
	w := build(t, pool)
	items, total, err := List(context.Background(), pool, Filter{
		MerchantProfile: &w.merchantProfile, MerchantUser: &w.merchantUser, Page: 2, Limit: 2,
	})
	if err != nil {
		t.Fatal(err)
	}
	if total != 5 || len(items) != 2 {
		t.Errorf("page 2 of 2: total=%d len=%d, want 5 and 2", total, len(items))
	}
}

func TestTheTimelineIsTheLedgersOwnRecord(t *testing.T) {
	pool := testPool(t)
	w := build(t, pool)
	ctx := context.Background()

	tx, err := Get(ctx, pool, w.refundedOnce)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if tx.Status != StatusProcessing {
		t.Errorf("status = %s", tx.Status)
	}
	events, err := Events(ctx, pool, w.refundedOnce)
	if err != nil {
		t.Fatalf("Events: %v", err)
	}
	var types []string
	for _, e := range events {
		types = append(types, e.Type)
	}
	want := []string{"tap", "merchant_settled_onchain", "merchant_settlement_refunded", "merchant_settled_onchain"}
	if len(types) != len(want) {
		t.Fatalf("events = %v, want %v", types, want)
	}
	for i := range want {
		if types[i] != want[i] {
			t.Errorf("event %d = %s, want %s (all: %v)", i, types[i], want[i], types)
		}
	}
	if len(events[0].Entries) != 3 {
		t.Errorf("the tap has %d legs, want 3 (cardholder, fee, merchant)", len(events[0].Entries))
	}

	if _, err := Get(ctx, pool, uuid.New()); err != ErrNotFound {
		t.Errorf("Get(unknown) = %v, want ErrNotFound", err)
	}
}

func TestStatsCountWhatStoodAndSkipWhatWasReversed(t *testing.T) {
	pool := testPool(t)
	w := build(t, pool)
	s, err := StatsFor(context.Background(), pool, w.merchantProfile, w.merchantUser, money.NGN, nil)
	if err != nil {
		t.Fatal(err)
	}
	// Three taps stood (₦1,600 + ₦1,500 + ₦2,000) and one offramp of ₦7,000;
	// the reversed ₦1,000 tap does not count.
	if s.Count != 4 || s.Volume.Minor() != 1_210_000 || s.Fees.Minor() != 2_550 {
		t.Errorf("stats = %+v", s)
	}
	since := time.Now().Add(time.Hour)
	s, _ = StatsFor(context.Background(), pool, w.merchantProfile, w.merchantUser, money.NGN, &since)
	if s.Count != 0 {
		t.Errorf("nothing since the future, got %d", s.Count)
	}
}
