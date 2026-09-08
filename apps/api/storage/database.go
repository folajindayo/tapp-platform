package storage

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	"entgo.io/ent/dialect"
	entsql "entgo.io/ent/dialect/sql"
	"github.com/usezoracle/tapp/api/ent"
	"github.com/usezoracle/tapp/api/ent/migrate"
	_ "github.com/usezoracle/tapp/api/ent/runtime" // ent runtime
	ledgermigrate "github.com/usezoracle/tapp/api/internal/platform/migrate"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
)

var (
	// Client holds the database connection
	Client *ent.Client
	// DB holds the database connection
	DB *sql.DB
	// Pool is the same connection pool as DB, exposed with pgx's native API.
	//
	// The ledger uses this rather than DB because it needs pgx.Tx: a tap has
	// to consume its nonce, check its limit and post its entries in one
	// transaction, and a limit check that commits separately from the movement
	// it authorised is not a check.
	//
	// One pool, two APIs. ent needs database/sql and gets it via
	// stdlib.OpenDBFromPool, so there is no second set of connections
	// competing for the same server.
	Pool *pgxpool.Pool
	// Err holds database connection error
	Err error
)

// DBConnection creates the connection pool and brings both schemas up.
func DBConnection(DSN string) error {
	cfg, err := pgxpool.ParseConfig(DSN)
	if err != nil {
		Err = err
		return fmt.Errorf("parse database URL: %w", err)
	}
	cfg.MaxConns = 100
	cfg.MinConns = 2
	cfg.MaxConnLifetime = 2 * time.Minute

	ctx := context.Background()
	var pool *pgxpool.Pool
	for i := 0; i < 3; i++ { // Retry mechanism
		pool, err = pgxpool.NewWithConfig(ctx, cfg)
		if err == nil {
			if err = pool.Ping(ctx); err == nil {
				break
			}
			pool.Close()
		}
		time.Sleep(2 * time.Second) // Wait before retrying
	}

	if err != nil {
		Err = err
		log.Println("Database connection error")
		return err
	}

	Pool = pool
	db := stdlib.OpenDBFromPool(pool)
	DB = db

	// Create an ent.Driver from `db`.
	drv := entsql.OpenDB(dialect.Postgres, db)

	// Integrate sql.DB to ent.Client.
	client := ent.NewClient(ent.Driver(drv))

	// Bring the ent schema up to what this binary expects, in every
	// environment. It used to run only in local, with production expected to
	// apply the versioned files under ent/migrate/migrations beforehand. Those
	// files stopped being regenerated, the deployment target has no pre-deploy
	// step, and a service that boots against a database missing its tables
	// fails on the first request rather than at start. ent's auto-migration
	// is additive and idempotent, and the advisory lock keeps two instances
	// booting together from racing on the same ALTER.
	if err := ledgermigrate.Locked(ctx, pool, func(ctx context.Context) error {
		return client.Schema.Create(ctx, migrate.WithGlobalUniqueID(true))
	}); err != nil {
		return fmt.Errorf("ent schema: %w", err)
	}

	Client = client

	// The ledger schema is hand-written SQL that ent does not own, applied on
	// every boot for the same reasons as above: a service that starts against
	// a database predating its ledger would accept movements it cannot record.
	if err := ledgermigrate.Up(ctx, pool); err != nil {
		return fmt.Errorf("ledger migrations: %w", err)
	}

	// Seed rows (the NGN currency, its banks, its provision buckets) insert
	// into ent's tables, so they come last.
	if err := ledgermigrate.Seed(ctx, pool); err != nil {
		return fmt.Errorf("seeds: %w", err)
	}

	return nil
}

// GetClient connection
func GetClient() *ent.Client {
	return Client
}

// GetError connection error
func GetError() error {
	return Err
}
