package risk

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PostgresStore records assessments.
type PostgresStore struct{ Pool *pgxpool.Pool }

// Save writes the assessment and, where one was given, the location.
//
// The image itself is deliberately NOT stored here. A photograph of somebody's
// cash is the most sensitive thing this system handles, and keeping every one
// forever so that a fraud analyst might one day look at it is not a trade
// worth making. What is kept is the hash, which is enough to recognise the
// same image again.
func (s *PostgresStore) Save(ctx context.Context, subject Subject, a Assessment) error {
	signals, err := json.Marshal(a.Signals)
	if err != nil {
		return err
	}

	var currency *string
	var amount *int64
	if subject.Currency != "" {
		currency = &subject.Currency
		amount = &subject.AmountMinor
	}
	var device *string
	if subject.Device != "" {
		device = &subject.Device
	}

	if _, err := s.Pool.Exec(ctx, `
		INSERT INTO risk_assessments
			(id, subject_kind, user_id, currency, amount_minor, decision, score,
			 signals, failed, device, lat, lng, at)
		VALUES ($1, $2, $3, $4::currency, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
		a.ID, subject.Kind, subject.UserID, currency, amount, string(a.Decision), a.Score,
		signals, a.Failed, device, subject.Lat, subject.Lng, a.At); err != nil {
		return fmt.Errorf("risk: save assessment: %w", err)
	}

	if subject.Lat != nil && subject.Lng != nil {
		if _, err := s.Pool.Exec(ctx, `
			INSERT INTO risk_locations (user_id, lat, lng, at) VALUES ($1, $2, $3, $4)`,
			subject.UserID, *subject.Lat, *subject.Lng, a.At); err != nil {
			return fmt.Errorf("risk: save location: %w", err)
		}
	}
	return nil
}
