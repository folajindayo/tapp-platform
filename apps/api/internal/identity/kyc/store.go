package kyc

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Store records verification state.
type Store struct{ Pool *pgxpool.Pool }

// TierOf reports how well established somebody's identity is.
//
// Somebody with no record is TierNone, not an error. Every account starts
// there, and treating an absent row as a failure would make the limits check
// fail closed on the most common case in the system.
func (s *Store) TierOf(ctx context.Context, user uuid.UUID) (Tier, error) {
	var tier int
	err := s.Pool.QueryRow(ctx, `SELECT tier FROM kyc_status WHERE user_id = $1`, user).Scan(&tier)
	if errors.Is(err, pgx.ErrNoRows) {
		return TierNone, nil
	}
	if err != nil {
		return TierNone, fmt.Errorf("kyc: read tier: %w", err)
	}
	return Tier(tier), nil
}

// RecordCheck saves a submitted verification attempt.
func (s *Store) RecordCheck(ctx context.Context, c Check) error {
	_, err := s.Pool.Exec(ctx, `
		INSERT INTO kyc_checks (id, user_id, tier, provider, provider_ref, status, reason)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		c.ID, c.UserID, int(c.Tier), c.Provider, nullIfEmpty(c.ProviderRef),
		string(c.Status), nullIfEmpty(c.Reason))
	if err != nil {
		return fmt.Errorf("kyc: record check: %w", err)
	}
	return nil
}

// Settle applies a provider's answer and raises the tier when it approves.
//
// The tier only ever goes UP here. A later failed attempt at a higher tier
// must not demote somebody below what they already proved -- losing a verified
// status because a document photo was blurry would be both wrong and
// infuriating.
func (s *Store) Settle(ctx context.Context, cb Callback, provider string) error {
	tx, err := s.Pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var (
		checkID uuid.UUID
		user    uuid.UUID
		tier    int
	)
	err = tx.QueryRow(ctx, `
		UPDATE kyc_checks
		   SET status = $3, reason = $4, settled_at = now()
		 WHERE provider = $1 AND provider_ref = $2 AND status = 'pending'
		RETURNING id, user_id, tier`,
		provider, cb.ProviderRef, string(cb.Status), nullIfEmpty(cb.Reason)).
		Scan(&checkID, &user, &tier)
	if errors.Is(err, pgx.ErrNoRows) {
		// Already settled, or unknown. A redelivered callback is normal --
		// providers retry -- and must not be an error.
		return nil
	}
	if err != nil {
		return fmt.Errorf("kyc: settle check: %w", err)
	}

	if cb.Status != Approved {
		return tx.Commit(ctx)
	}

	id := cb.Identity
	if id == nil {
		id = &Identity{}
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO kyc_status
			(user_id, tier, first_name, last_name, date_of_birth, phone, bvn_last4, tier_reached_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, now())
		ON CONFLICT (user_id) DO UPDATE SET
			tier            = GREATEST(kyc_status.tier, EXCLUDED.tier),
			first_name      = COALESCE(EXCLUDED.first_name, kyc_status.first_name),
			last_name       = COALESCE(EXCLUDED.last_name, kyc_status.last_name),
			date_of_birth   = COALESCE(EXCLUDED.date_of_birth, kyc_status.date_of_birth),
			phone           = COALESCE(EXCLUDED.phone, kyc_status.phone),
			bvn_last4       = COALESCE(EXCLUDED.bvn_last4, kyc_status.bvn_last4),
			tier_reached_at = CASE WHEN EXCLUDED.tier > kyc_status.tier
			                       THEN now() ELSE kyc_status.tier_reached_at END,
			updated_at      = now()`,
		user, tier, nullIfEmpty(id.FirstName), nullIfEmpty(id.LastName),
		nullIfEmpty(id.DateOfBirth), nullIfEmpty(id.Phone), nullIfEmpty(id.BVNLast4)); err != nil {
		return fmt.Errorf("kyc: raise tier: %w", err)
	}
	return tx.Commit(ctx)
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
