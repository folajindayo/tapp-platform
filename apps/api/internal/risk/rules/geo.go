package rules

import (
	"context"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/usezoracle/tapp/api/internal/risk"
)

// MaxPlausibleKmH is the fastest somebody could reasonably have travelled
// between two points. Generous on purpose: it has to accommodate a domestic
// flight, and the signal is meant to catch the impossible rather than the
// merely quick.
const MaxPlausibleKmH = 900

// Geo notices two actions from places too far apart to have travelled between
// in the time available.
//
// The point is not distance. People travel. The point is a distance that
// cannot have been covered -- which means one of the two locations is not
// where the person was, and that is worth knowing.
//
// Location is often absent, and its absence is not evidence of anything: most
// people decline the permission. A subject with no coordinates simply produces
// no signal here.
type Geo struct {
	Pool *pgxpool.Pool
}

func (g *Geo) Name() string { return "geo" }

func (g *Geo) Inspect(ctx context.Context, s risk.Subject) ([]risk.Signal, error) {
	if s.Lat == nil || s.Lng == nil {
		return nil, nil
	}
	if g.Pool == nil {
		return nil, fmt.Errorf("rules: geo has no database")
	}

	var (
		prevLat, prevLng float64
		prevAt           time.Time
	)
	err := g.Pool.QueryRow(ctx, `
		SELECT lat, lng, at FROM risk_locations
		 WHERE user_id = $1 AND at < $2
		 ORDER BY at DESC LIMIT 1`, s.UserID, s.At).Scan(&prevLat, &prevLng, &prevAt)
	if err != nil {
		// No previous location is the ordinary case for a new account.
		return nil, nil
	}

	km := haversineKm(prevLat, prevLng, *s.Lat, *s.Lng)
	hours := s.At.Sub(prevAt).Hours()
	if hours <= 0 {
		hours = 1.0 / 3600 // treat same-instant as one second
	}
	speed := km / hours

	if speed > MaxPlausibleKmH {
		return []risk.Signal{{
			Name: "geo.impossible_travel",
			Detail: fmt.Sprintf("This is %.0fkm from where this account was %s ago.",
				km, s.At.Sub(prevAt).Round(time.Minute)),
			Severity: risk.High,
		}}, nil
	}

	return []risk.Signal{{
		Name:     "geo.observed",
		Detail:   fmt.Sprintf("%.1fkm from the previous location, %.1f hours earlier", km, hours),
		Severity: risk.Info,
	}}, nil
}

// haversineKm is the great-circle distance between two points.
func haversineKm(lat1, lng1, lat2, lng2 float64) float64 {
	const earthKm = 6371.0
	rad := func(d float64) float64 { return d * math.Pi / 180 }

	dLat, dLng := rad(lat2-lat1), rad(lng2-lng1)
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(rad(lat1))*math.Cos(rad(lat2))*math.Sin(dLng/2)*math.Sin(dLng/2)
	return earthKm * 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
}
