// ledger-convert moves existing balances into the ledger currency.
//
// Deposits are credited in LEDGER_CURRENCY now, but balances credited before
// that change are still in the currency they arrived as -- and a balance in a
// currency no card spends is money its owner can see and cannot use. This
// converts them once, through the same quoter the deposit path and the offramp
// use, so every conversion in the system is priced the same way.
//
// Dry by default. It moves real customer balances; a command that does that on
// a mistyped invocation is not one worth having.
//
//	go run ./cmd/ledger-convert            # report what would move
//	go run ./cmd/ledger-convert -apply     # move it
package main

import (
	"context"
	"flag"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/spf13/viper"

	"github.com/usezoracle/tapp/api/config"
	"github.com/usezoracle/tapp/api/internal/ledger/movements"
	"github.com/usezoracle/tapp/api/internal/money"
	"github.com/usezoracle/tapp/api/internal/rates"
	"github.com/usezoracle/tapp/api/internal/rates/ratescfg"
)

func main() {
	apply := flag.Bool("apply", false, "actually convert; without it nothing changes")
	flag.Parse()
	if err := run(context.Background(), *apply); err != nil {
		fmt.Fprintln(os.Stderr, "ledger-convert:", err)
		os.Exit(1)
	}
}

func target(dsn string) string {
	u, err := url.Parse(dsn)
	if err != nil || u.Host == "" {
		return "(unparseable DSN)"
	}
	return u.Host + strings.TrimSuffix(u.Path, "/")
}

func run(ctx context.Context, apply bool) error {
	into := money.Currency(viper.GetString("LEDGER_CURRENCY"))
	if into == "" {
		return fmt.Errorf("LEDGER_CURRENCY is not set, so there is no currency to convert into")
	}
	if err := into.Valid(); err != nil {
		return err
	}

	dsn := config.DBConfig()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("database: %w", err)
	}
	// Say which database this is before anything moves. The DSN falls through
	// several variables and a run meant for production that misses them lands
	// on whatever the local .env points at, indistinguishably.
	fmt.Printf("database: %s\nconverting into: %s\n\n", target(dsn), into)

	quoter, err := buildQuoter(pool)
	if err != nil {
		return err
	}

	// Only spendable balances, only in other currencies, only positive ones.
	rows, err := pool.Query(ctx, `
		SELECT a.owner_id, a.currency, COALESCE(SUM(e.amount_minor), 0) AS minor
		  FROM ledger_accounts a
		  JOIN ledger_entries e ON e.account_id = a.id
		 WHERE a.owner_kind = 'user' AND a.kind = 'available' AND a.currency <> $1
		 GROUP BY a.owner_id, a.currency
		HAVING COALESCE(SUM(e.amount_minor), 0) > 0
		 ORDER BY a.owner_id`, string(into))
	if err != nil {
		return err
	}
	type holding struct {
		user   uuid.UUID
		amount money.Amount
	}
	var due []holding
	for rows.Next() {
		var u uuid.UUID
		var cur string
		var minor int64
		if err := rows.Scan(&u, &cur, &minor); err != nil {
			rows.Close()
			return err
		}
		due = append(due, holding{user: u, amount: money.New(minor, money.Currency(cur))})
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	if len(due) == 0 {
		fmt.Printf("every user balance is already in %s; nothing to do\n", into)
		return nil
	}

	if !apply {
		fmt.Printf("%d balance(s) would be converted (dry run — nothing changed):\n\n", len(due))
		for _, h := range due {
			q, err := quoter.Offer(ctx, h.amount, into)
			if err != nil {
				fmt.Printf("  %s  %-12s  CANNOT PRICE: %v\n", h.user, h.amount, err)
				continue
			}
			fmt.Printf("  %s  %-12s -> %-14s (rate %s, spread %d bps, fee %s)\n",
				h.user, h.amount, q.Buy, q.MarketRate, q.SpreadBPS, q.Fee)
		}
		fmt.Println("\nre-run with -apply to convert")
		return nil
	}

	var done, failed int
	for _, h := range due {
		q, err := quoter.Offer(ctx, h.amount, into)
		if err != nil {
			fmt.Printf("  FAILED %s %s: %v\n", h.user, h.amount, err)
			failed++
			continue
		}
		err = movements.InTx(ctx, pool, func(tx pgx.Tx) error {
			redeemed, err := quoter.Redeem(ctx, tx, q.ID)
			if err != nil {
				return err
			}
			_, err = movements.Convert(ctx, tx, h.user, movements.Conversion{
				Sold: redeemed.Sell, Bought: redeemed.Buy, Spread: redeemed.Fee,
				QuoteID: redeemed.ID.String(),
			})
			return err
		})
		if err != nil {
			fmt.Printf("  FAILED %s %s: %v\n", h.user, h.amount, err)
			failed++
			continue
		}
		fmt.Printf("  %s  %-12s -> %s\n", h.user, h.amount, q.Buy)
		done++
	}
	fmt.Printf("\nconverted %d, failed %d\n", done, failed)
	if failed > 0 {
		return fmt.Errorf("%d balance(s) could not be converted", failed)
	}
	return nil
}

// buildQuoter mirrors the API's own rate wiring so a conversion run here is
// priced exactly as the deposit path would price it.
func buildQuoter(pool *pgxpool.Pool) (*rates.Quoter, error) {
	engine, spread, err := ratescfg.FromEnv()
	if err != nil {
		return nil, err
	}
	if len(engine.Sources) == 0 {
		return nil, fmt.Errorf("FX_SOURCES is empty, so nothing can be priced")
	}
	if len(spread) == 0 {
		return nil, fmt.Errorf("FX_SPREADS is empty, so nothing can be priced")
	}
	return &rates.Quoter{Engine: engine, Spread: spread, Pool: pool}, nil
}
