// Package migrate applies the ledger schema from inside the binary.
//
// These are the hand-written migrations that ent does not own, plus the seed
// rows (the NGN currency, its banks, its provision buckets) that the code
// assumes exist. The ledger is
// not an ent schema because its central guarantee -- a deferred constraint
// trigger that makes an unbalanced write impossible to commit -- cannot be
// expressed through an ORM, and because account_balances must be a view over
// the entries so a cached balance can never disagree with them.
//
// Embedding them means the schema travels with the code that expects it, and a
// deployment cannot start against a database it predates.
//
// Applying migrations on boot is safe here because it is guarded by an advisory
// lock: when several instances start at once, one applies and the others wait
// and then find nothing to do.
package migrate

import (
	"context"
	"embed"
	"fmt"
	"log/slog"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// sql/ is the ledger schema, self-contained: it can be applied to an empty
// database, which is how the package tests and the tests of everything built
// on the ledger run. seeds/ inserts into ent's tables and so can only run
// after ent's schema exists; keeping the two apart is what lets Up stay
// independent of ent. Both record what they applied in schema_migrations,
// keyed by filename, so names must be unique across the two directories.
//
//go:embed sql/*.sql seeds/*.sql
var files embed.FS

// lockID is an arbitrary constant; it only has to be the same in every instance.
const lockID = 8_675_309

// Locked runs fn while holding the migration advisory lock, so that several
// instances booting together serialise their schema work. The lock is
// session-level and tied to one pooled connection, which is why fn must not
// call back into Locked or Up: a nested call would wait, on a different
// connection, for the lock this one holds.
func Locked(ctx context.Context, pool *pgxpool.Pool, fn func(ctx context.Context) error) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, lockID); err != nil {
		return fmt.Errorf("take migration lock: %w", err)
	}
	defer conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, lockID)

	return fn(ctx)
}

// Up applies every ledger migration that has not been applied yet, in
// filename order. It needs nothing but an empty database.
func Up(ctx context.Context, pool *pgxpool.Pool) error {
	return apply(ctx, pool, "sql")
}

// Seed applies the seed rows that have not been applied yet. It must run after
// ent's schema exists, since the seeds insert into ent's tables.
func Seed(ctx context.Context, pool *pgxpool.Pool) error {
	return apply(ctx, pool, "seeds")
}

func apply(ctx context.Context, pool *pgxpool.Pool, dir string) error {
	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer conn.Release()

	// Serialise across instances. Two containers booting together would
	// otherwise both try to add the same column.
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock($1)`, lockID); err != nil {
		return fmt.Errorf("take migration lock: %w", err)
	}
	defer conn.Exec(context.WithoutCancel(ctx), `SELECT pg_advisory_unlock($1)`, lockID)

	if _, err := conn.Exec(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			filename   text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now())`); err != nil {
		return fmt.Errorf("create migrations table: %w", err)
	}

	entries, err := files.ReadDir(dir)
	if err != nil {
		return err
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)

	for _, name := range names {
		var applied bool
		if err := conn.QueryRow(ctx,
			`SELECT true FROM schema_migrations WHERE filename = $1`, name).Scan(&applied); err == nil {
			continue
		}

		body, err := files.ReadFile(dir + "/" + name)
		if err != nil {
			return err
		}
		slog.Info("applying migration", "file", name)

		// Deliberately not wrapped in one transaction: several migrations use
		// ALTER TYPE ... ADD VALUE, which Postgres refuses to run inside a
		// transaction block that later uses the new value. Each file manages
		// its own BEGIN/COMMIT instead.
		if _, err := conn.Exec(ctx, string(body)); err != nil {
			return fmt.Errorf("migration %s: %w", name, err)
		}
		if _, err := conn.Exec(ctx,
			`INSERT INTO schema_migrations (filename) VALUES ($1)`, name); err != nil {
			return err
		}
	}
	return nil
}
