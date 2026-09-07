package ledger

import (
	"context"
	"errors"
	"testing"

	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/internal/money"
)

func TestHistoryReportsOnlyThisPartysMovements(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	mine, theirs := someone(), someone()

	me := acct(t, pool, mine, KindAvailable, money.NGN)
	them := acct(t, pool, theirs, KindAvailable, money.NGN)
	amount := money.Naira(1_000)

	// One transaction, two parties. Each should see their own leg and only
	// their own leg -- a feed that leaks the counterparty's account movements
	// is a feed that tells you what a stranger's balance did.
	if _, err := Post(ctx, pool, Ref{}, []Entry{
		{AccountID: me, Amount: amount, Reason: "transfer.received"},
		{AccountID: them, Amount: amount.Neg(), Reason: "transfer.sent"},
	}); err != nil {
		t.Fatal(err)
	}

	page, err := History(ctx, pool, mine, 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Movements) != 1 {
		t.Fatalf("expected 1 movement, got %d", len(page.Movements))
	}
	got := page.Movements[0]
	if got.Reason != "transfer.received" {
		t.Fatalf("reason = %q", got.Reason)
	}
	if got.Amount != amount {
		t.Fatalf("amount = %s, want %s", got.Amount, amount)
	}
	if got.Account != KindAvailable {
		t.Fatalf("account = %q", got.Account)
	}
}

func TestASpendReadsAsNegativeToTheSpender(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	owner := someone()
	me := acct(t, pool, owner, KindAvailable, money.NGN)
	world := acct(t, pool, System(), KindExternal, money.NGN)

	if _, err := Post(ctx, pool, Ref{}, []Entry{
		{AccountID: me, Amount: money.Naira(-500), Reason: "tap.debit"},
		{AccountID: world, Amount: money.Naira(500), Reason: "tap.debit"},
	}); err != nil {
		t.Fatal(err)
	}

	page, err := History(ctx, pool, owner, 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Movements) != 1 || !page.Movements[0].Amount.IsNegative() {
		t.Fatalf("a debit did not read as negative: %+v", page.Movements)
	}
}

// Paging must not skip a movement that arrives between two page reads. This is
// the whole reason the cursor is a keyset rather than an offset.
func TestPagingDoesNotSkipAMovementThatArrivesMidRead(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	owner := someone()
	me := acct(t, pool, owner, KindAvailable, money.NGN)
	world := acct(t, pool, System(), KindExternal, money.NGN)

	write := func(reason string) {
		t.Helper()
		if _, err := Post(ctx, pool, Ref{}, []Entry{
			{AccountID: me, Amount: money.Naira(100), Reason: reason},
			{AccountID: world, Amount: money.Naira(-100), Reason: reason},
		}); err != nil {
			t.Fatal(err)
		}
	}

	for _, r := range []string{"one", "two", "three", "four"} {
		write(r)
	}

	first, err := History(ctx, pool, owner, 2, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Movements) != 2 || first.NextCursor == "" {
		t.Fatalf("first page: %d movements, cursor %q", len(first.Movements), first.NextCursor)
	}
	if first.Movements[0].Reason != "four" || first.Movements[1].Reason != "three" {
		t.Fatalf("not newest-first: %q, %q", first.Movements[0].Reason, first.Movements[1].Reason)
	}

	// Something lands while the reader is looking at page one.
	write("five")

	second, err := History(ctx, pool, owner, 2, first.NextCursor)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Movements) != 2 {
		t.Fatalf("second page: %d movements", len(second.Movements))
	}
	// With an OFFSET this would have returned "two" and "one" shifted by the
	// new arrival, silently dropping one of them.
	if second.Movements[0].Reason != "two" || second.Movements[1].Reason != "one" {
		t.Fatalf("second page = %q, %q -- a movement was skipped",
			second.Movements[0].Reason, second.Movements[1].Reason)
	}
}

func TestTheLastPageOffersNoCursor(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	owner := someone()
	me := acct(t, pool, owner, KindAvailable, money.NGN)
	world := acct(t, pool, System(), KindExternal, money.NGN)
	if _, err := Post(ctx, pool, Ref{}, []Entry{
		{AccountID: me, Amount: money.Naira(10), Reason: "only"},
		{AccountID: world, Amount: money.Naira(-10), Reason: "only"},
	}); err != nil {
		t.Fatal(err)
	}

	page, err := History(ctx, pool, owner, 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if page.NextCursor != "" {
		t.Fatalf("offered a next page when there is none: %q", page.NextCursor)
	}
}

func TestAPartyWithNoMovementsGetsAnEmptyFeedNotAnError(t *testing.T) {
	pool := testPool(t)
	page, err := History(context.Background(), pool, User(uuid.New()), 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Movements) != 0 || page.NextCursor != "" {
		t.Fatalf("%+v", page)
	}
}

func TestACursorWeDidNotIssueIsRefused(t *testing.T) {
	pool := testPool(t)
	for _, bad := range []string{"nonsense", "MTIz", "ZTpub3RhbnVtYmVy"} {
		_, err := History(context.Background(), pool, someone(), 10, bad)
		var target ErrBadCursor
		if !errors.As(err, &target) {
			t.Fatalf("cursor %q: err = %v, want ErrBadCursor", bad, err)
		}
	}
}
