// cdp-reissue moves every user still holding a seed-derived deposit address
// onto a CDP Smart Account.
//
// The API does this on its own, the first time each person reads their deposit
// address. This command is for not waiting: somebody who has not opened the
// app since the migration keeps a derived address in the table until they do,
// and an operator who wants the table to say what it means today can run this
// instead of hoping everybody logs in.
//
// What it does NOT do is unwatch anything. Retiring an address leaves its row,
// so money sent to it by somebody who saved it as a payee still credits and
// the seed can still sweep it. See migration 0017.
//
// Dry by default. Creating a Smart Account is a real side effect at Coinbase,
// and a command that does that to every user in the table on a mistyped
// invocation is not one worth having.
//
//	go run ./cmd/cdp-reissue            # report what would change
//	go run ./cmd/cdp-reissue -apply     # do it
package main

import (
	"context"
	"flag"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/config"
	"github.com/usezoracle/tapp/api/internal/chain/base"
	"github.com/usezoracle/tapp/api/internal/chain/cdp"
)

func main() {
	apply := flag.Bool("apply", false, "actually reissue; without it nothing is changed")
	includeTest := flag.Bool("include-test-users", false,
		"also reissue @test.local users (fixtures left by the test suite)")
	flag.Parse()

	ctx := context.Background()
	if err := run(ctx, *apply, *includeTest); err != nil {
		fmt.Fprintln(os.Stderr, "cdp-reissue:", err)
		os.Exit(1)
	}
}

// target renders the DSN as host/dbname, with any credentials stripped.
func target(dsn string) string {
	u, err := url.Parse(dsn)
	if err != nil || u.Host == "" {
		return "(unparseable DSN)"
	}
	return u.Host + strings.TrimSuffix(u.Path, "/")
}

func run(ctx context.Context, apply, includeTest bool) error {
	dsn := config.DBConfig()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return err
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("database: %w", err)
	}

	// Say which database this is, before anything is created.
	//
	// The config falls back through DATABASE_URL, DB_URL and then the discrete
	// DB_* vars, so a run meant for production that is missing the first two
	// lands on whatever the local .env points at -- and the operator would
	// never know, because everything else about the run looks identical.
	// Host and database name only; the credentials stay out of the terminal.
	fmt.Printf("database: %s\n\n", target(dsn))

	// Only users that still exist. The table accumulates rows whose user was
	// deleted, and opening a bank-grade account at Coinbase for a row nobody
	// owns is spend with no purpose.
	// Test fixtures are excluded by default. The suite leaves users behind on
	// whatever database it ran against, and a Smart Account opened at Coinbase
	// for one of them is a real account this platform will never use.
	rows, err := pool.Query(ctx, `
		SELECT u.id, coalesce(u.email, ''), a.address, a.provider
		  FROM users u
		  LEFT JOIN base_deposit_addresses a
		         ON a.user_id = u.id AND a.retired_at IS NULL
		 WHERE (a.address IS NULL OR a.provider <> 'cdp')
		   AND ($1 OR coalesce(u.email, '') NOT LIKE '%@test.local')
		 ORDER BY u.created_at`, includeTest)
	if err != nil {
		return err
	}
	type pending struct {
		user     uuid.UUID
		email    string
		current  *string
		provider *string
	}
	var due []pending
	for rows.Next() {
		var t pending
		if err := rows.Scan(&t.user, &t.email, &t.current, &t.provider); err != nil {
			rows.Close()
			return err
		}
		due = append(due, t)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	if len(due) == 0 {
		fmt.Println("every user already has a CDP deposit address; nothing to do")
		return nil
	}

	if !apply {
		fmt.Printf("%d user(s) would be reissued (dry run — nothing changed):\n\n", len(due))
		for _, t := range due {
			from := "no current address"
			if t.current != nil {
				from = *t.provider + " " + *t.current + " (would be retired, still watched)"
			}
			fmt.Printf("  %s  %-34s  %s\n", t.user, t.email, from)
		}
		fmt.Println("\nre-run with -apply to create the CDP accounts")
		return nil
	}

	cdpCfg := config.CDPConfig()
	if !cdpCfg.Enabled() {
		return fmt.Errorf("CDP is not configured; set CDP_API_KEY_ID, CDP_API_KEY_SECRET, " +
			"CDP_WALLET_SECRET and CDP_PAYMASTER_URL")
	}
	chainID := config.OrderConfig().BaseChainID
	client, err := cdp.New(cdp.Config{
		APIKeyID: cdpCfg.APIKeyID, APIKeySecret: cdpCfg.APIKeySecret,
		WalletSecret: cdpCfg.WalletSecret, PaymasterURL: cdpCfg.PaymasterURL,
		BaseURL: cdpCfg.BaseURL,
	}, chainID)
	if err != nil {
		return err
	}

	addresses := &base.Addresses{Pool: pool, SmartAccounts: client}

	var done, failed int
	for _, t := range due {
		// For does the whole transition: retire the derived row if there is
		// one, ask CDP for the account, record it. Using it rather than
		// repeating the steps here means this command and the API can never
		// disagree about what reissuing means.
		address, err := addresses.For(ctx, t.user)
		if err != nil {
			fmt.Printf("  FAILED %s %s: %v\n", t.user, t.email, err)
			failed++
			continue
		}
		fmt.Printf("  %s  %-34s  -> %s\n", t.user, t.email, address)
		done++
	}
	fmt.Printf("\nreissued %d, failed %d\n", done, failed)
	if failed > 0 {
		return fmt.Errorf("%d user(s) could not be reissued", failed)
	}
	return nil
}
