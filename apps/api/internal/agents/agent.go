// Package agents is the network a cash pledge is handed to.
//
// An agent is fixed premises with somebody accountable for them: a shopfront,
// a filling station, a market office. Never a coordinate somebody typed in for
// one transaction.
//
// That constraint is load-bearing rather than cosmetic. Escrow guarantees
// nobody loses money on paper and is powerless against somebody who takes the
// notes and never confirms -- before handovers were tied to known premises,
// that theft was free: the match expired, the escrow returned, and the thief
// kept the cash. What closes it is a counterparty with a name, an address and
// a reputation to lose.
package agents

import (
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/internal/money"
)

// Kind is what sort of premises this is.
type Kind string

const (
	KindAgent          Kind = "agent"
	KindBank           Kind = "bank"
	KindFillingStation Kind = "filling_station"
	KindMarketOffice   Kind = "market_office"
	KindPharmacy       Kind = "pharmacy"
	KindSupermarket    Kind = "supermarket"
)

func (k Kind) Valid() bool {
	switch k {
	case KindAgent, KindBank, KindFillingStation, KindMarketOffice, KindPharmacy, KindSupermarket:
		return true
	}
	return false
}

// Nigeria's bounding box. A coordinate outside it is a client bug or somebody
// probing; either way it is not premises a trader can walk to.
const (
	MinLat, MaxLat = 4.0, 14.0
	MinLng, MaxLng = 2.0, 15.0
)

// Agent is one registered location.
type Agent struct {
	ID         uuid.UUID `json:"id"`
	OperatorID uuid.UUID `json:"-"`

	Name    string `json:"name"`
	Kind    Kind   `json:"kind"`
	Address string `json:"address"`
	Phone   string `json:"phone,omitempty"`

	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`

	OpensAt  string `json:"opensAt"`
	ClosesAt string `json:"closesAt"`

	Verified bool `json:"verified"`
	Active   bool `json:"active"`

	SettledCount  int `json:"settledCount"`
	DisputedCount int `json:"disputedCount"`

	// Float is what this agent can currently hand out as cash. Read from the
	// ledger, not stored here: capacity is a balance, and a stored flag saying
	// "has cash" drifts from the money within a day.
	Float money.Amount `json:"float"`

	// DistanceM is set only by a nearby search.
	DistanceM int `json:"distanceM,omitempty"`
	// OpenNow is evaluated against the caller's clock.
	OpenNow bool `json:"openNow"`
}

// Registration is a request to add premises to the network.
type Registration struct {
	OperatorID uuid.UUID
	Name       string
	Kind       Kind
	Address    string
	Phone      string
	Lat, Lng   float64
	OpensAt    string
	ClosesAt   string
}

// Valid checks a registration before it reaches the database.
//
// The bounds are also a database constraint. Both, deliberately: the check
// here produces a message somebody can act on, and the constraint is what
// holds when a future code path forgets to call this.
func (r Registration) Valid() error {
	switch {
	case r.OperatorID == uuid.Nil:
		return fmt.Errorf("agents: an agent needs an accountable operator")
	case r.Name == "":
		return fmt.Errorf("agents: an agent needs a name")
	case r.Address == "":
		return fmt.Errorf("agents: an agent needs an address people can find")
	case !r.Kind.Valid():
		return fmt.Errorf("agents: %q is not a kind of premises", r.Kind)
	case r.Lat < MinLat || r.Lat > MaxLat || r.Lng < MinLng || r.Lng > MaxLng:
		return fmt.Errorf("agents: %.4f,%.4f is outside Nigeria", r.Lat, r.Lng)
	}

	opens, err := time.Parse("15:04", r.OpensAt)
	if err != nil {
		return fmt.Errorf("agents: opening time %q is not HH:MM", r.OpensAt)
	}
	closes, err := time.Parse("15:04", r.ClosesAt)
	if err != nil {
		return fmt.Errorf("agents: closing time %q is not HH:MM", r.ClosesAt)
	}
	if !opens.Before(closes) {
		return fmt.Errorf("agents: opens at %s but closes at %s", r.OpensAt, r.ClosesAt)
	}
	return nil
}
