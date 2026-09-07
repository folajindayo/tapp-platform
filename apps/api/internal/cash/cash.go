// Package cash turns physical banknotes into a balance.
//
// A market trader photographs the notes they are holding, walks them to a
// nearby agent, and hands them over. The agent's float pays the trader; the
// agent now has the cash and the platform's capital sits with them instead.
// Nothing is credited until that handover is confirmed by both sides.
//
// # What the photograph is for
//
// Evidence, and a way to avoid wasting somebody's walk. Not collateral. Anyone
// can photograph a stranger's cash, a shop's till, or an image off the
// internet, so a design in which the picture moves money fails the first time
// somebody thinks about it for a minute.
//
// What actually secures the transaction is that a named agent, at known
// premises, with a reputation and a float, has to physically take the notes
// and say so. They are the one who loses if the notes are fake, which is why
// they are the one who checks.
package cash

import (
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/internal/money"
)

// State is where a pledge has got to.
type State string

const (
	StateScreening  State = "screening"
	StateOpen       State = "open"
	StateMatched    State = "matched"
	StateHandedOver State = "handed_over"
	StateSettled    State = "settled"
	StateExpired    State = "expired"
	StateRefused    State = "refused"
	StateDisputed   State = "disputed"
)

// HandoverState is where one meeting has got to.
type HandoverState string

const (
	HandoverProposed        HandoverState = "proposed"
	HandoverTraderConfirmed HandoverState = "trader_confirmed"
	HandoverAgentConfirmed  HandoverState = "agent_confirmed"
	HandoverCompleted       HandoverState = "completed"
	HandoverExpired         HandoverState = "expired"
	HandoverRefused         HandoverState = "refused"
	HandoverDisputed        HandoverState = "disputed"
)

// How long things stay open.
//
// A pledge lives long enough to walk somewhere; a handover expires faster,
// because it locks an agent's float and every minute it is held is float that
// cannot serve anybody else.
const (
	PledgeTTL   = 2 * time.Hour
	HandoverTTL = 30 * time.Minute
)

// MaxHandover is the most cash that may change hands in one meeting.
//
// Large amounts make a meeting worth targeting. A trader with more than this
// makes several trips, which is inconvenient and is the point: the alternative
// is concentrating a robbery-sized sum into one predictable encounter at a
// published address.
var MaxHandover = money.Naira(500_000)

// Pledge is one photograph of cash and what became of it.
type Pledge struct {
	ID  uuid.UUID `json:"id"`
	Ref int64     `json:"ref"`

	TraderID uuid.UUID `json:"-"`

	// Declared is what the trader said; Counted is what recognition made of
	// the photograph. Kept apart on purpose -- a disagreement is the most
	// useful signal there is, and reconciling them away destroys it.
	Declared money.Amount `json:"declared"`
	Counted  money.Amount `json:"counted"`

	State State `json:"state"`

	Lat, Lng float64 `json:"-"`

	RiskScore     int    `json:"riskScore,omitempty"`
	RefusedReason string `json:"refusedReason,omitempty"`

	CreatedAt time.Time  `json:"createdAt"`
	ExpiresAt time.Time  `json:"expiresAt"`
	SettledAt *time.Time `json:"settledAt,omitempty"`
}

// Handover is a meeting between a trader and an agent.
type Handover struct {
	ID       uuid.UUID `json:"id"`
	PledgeID uuid.UUID `json:"pledgeId"`
	AgentID  uuid.UUID `json:"agentId"`

	Amount money.Amount `json:"amount"`

	// Code is spoken aloud at the counter. It is not a secret worth much: it
	// bounds a window, it does not authenticate anybody. What authenticates
	// the meeting is that both sides confirm it independently.
	Code string `json:"code"`

	DistanceM int           `json:"distanceM"`
	State     HandoverState `json:"state"`

	ExpiresAt time.Time `json:"expiresAt"`
}

// Note is one banknote claimed by a pledge.
type Note struct {
	Denomination     money.Amount
	Serial           string
	SerialConfidence float64
	PHash            string
}

// Request is a trader offering cash.
type Request struct {
	TraderID uuid.UUID
	Declared money.Amount
	Lat, Lng float64
	// Image is the photograph. Screened, hashed, and then discarded -- the
	// hash is what is kept.
	Image []byte
	// Device identifies the client, for the risk engine.
	Device string
}

// Valid checks a request before anything expensive happens.
func (r Request) Valid() error {
	switch {
	case r.TraderID == uuid.Nil:
		return fmt.Errorf("cash: a pledge needs a trader")
	case !r.Declared.IsPositive():
		return fmt.Errorf("cash: a pledge must be for a positive amount, got %s", r.Declared)
	case len(r.Image) == 0:
		return fmt.Errorf("cash: a pledge needs a photograph of the notes")
	}

	if over, err := r.Declared.Cmp(MaxHandover); err != nil {
		return err
	} else if over > 0 {
		return fmt.Errorf(
			"cash: %s is more than can safely change hands at once (%s). Please split it",
			r.Declared, MaxHandover)
	}

	// The coordinates matter: without them no agent can be found, and the
	// predecessor accepted pledges with none and then reported every agent as
	// 810km away.
	if r.Lat == 0 && r.Lng == 0 {
		return fmt.Errorf("cash: a pledge needs your location so an agent can be found near you")
	}
	return nil
}
