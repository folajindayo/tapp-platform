// Package link binds a physical card to an account.
//
// One session, four transitions, resumable at any point:
//
//	Start       claim the card for this user
//	Provision   the client commits its PIN proof; the server issues a token
//	Activate    the client confirms it wrote the token and read it back
//	(expire)    anything left unfinished is released
//
// The predecessor was four screens each POSTing to a different endpoint with
// no state between them, so a dropped connection meant repeating the whole
// ceremony -- and the ceremony generates a secret, writes it to a chip over
// NFC, and commits a PIN proof, none of which is free to redo.
//
// # What the server learns, and does not
//
// The card holds a secret K. The cardholder chooses a PIN. The server sees
// neither, ever. What it receives is an anchor:
//
//	anchor = HMAC(HMAC(K, PIN), "linking-anchor-v1")
//
// from which neither can be recovered, and which is enough to verify a
// challenge response later. So a stolen database yields no ability to
// impersonate a cardholder -- which is the property worth protecting, and it
// is why the client computes this rather than sending its inputs.
package link

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// State is where a linking session has got to.
type State string

const (
	StateStarted     State = "started"
	StateProvisioned State = "provisioned"
	StateActivated   State = "activated"
	StateAbandoned   State = "abandoned"
	StateFailed      State = "failed"
)

// SessionTTL bounds an unfinished ceremony.
//
// Long enough to fetch the card from another room and read the instructions;
// short enough that an abandoned session does not hold a card indefinitely
// against somebody who has since given up and wants to start again.
const SessionTTL = 30 * time.Minute

var (
	// ErrCardUnknown means no card carries this activation token.
	ErrCardUnknown = errors.New("link: no such card")
	// ErrCardTaken means somebody else has already claimed it.
	ErrCardTaken = errors.New("link: this card belongs to another account")
	// ErrAlreadyLive means the card is already linked and working.
	ErrAlreadyLive = errors.New("link: this card is already active")
	// ErrSessionUnknown means no such session, or not this user's.
	ErrSessionUnknown = errors.New("link: no such linking session")
	// ErrWrongState means the requested step does not follow from where the
	// session is.
	ErrWrongState = errors.New("link: that step does not come next")
	// ErrUIDTaken means this physical chip is already bound to another card
	// record.
	ErrUIDTaken = errors.New("link: this card is already registered")
)

// Session is one linking ceremony.
type Session struct {
	ID     uuid.UUID `json:"id"`
	CardID uuid.UUID `json:"cardId"`
	State  State     `json:"state"`

	// WriteToken is what the client must write to the chip. Present only once
	// the session is provisioned, and returned again on every read so a client
	// that lost its connection mid-write can resume with the SAME value rather
	// than a new one -- two tokens written to one chip is how a card ends up
	// out of sync before it has ever been used.
	WriteToken string `json:"writeToken,omitempty"`

	Failure   string    `json:"failure,omitempty"`
	ExpiresAt time.Time `json:"expiresAt"`
}

// Limits are the ceilings a cardholder chooses at linking.
//
// Chosen, not defaulted. The predecessor fell back to package constants when a
// card had none, which meant a card that never finished linking silently
// acquired a daily allowance nobody had agreed to.
type Limits struct {
	PerTapMinor int64
	StepUpMinor int64
	DailyMinor  int64
}

// Valid checks the limits are coherent and within what the platform allows.
func (l Limits) Valid(maxDailyMinor int64) error {
	switch {
	case l.PerTapMinor <= 0 || l.StepUpMinor <= 0 || l.DailyMinor <= 0:
		return fmt.Errorf("link: every limit must be set and positive")
	case l.PerTapMinor > l.StepUpMinor:
		return fmt.Errorf("link: the PIN threshold cannot be above the approval threshold")
	case l.StepUpMinor > l.DailyMinor:
		return fmt.Errorf("link: the approval threshold cannot be above the daily limit")
	case l.DailyMinor > maxDailyMinor:
		return fmt.Errorf("link: the daily limit cannot exceed what your account is verified for")
	}
	return nil
}

// Provisioning is what the client commits before writing to the chip.
type Provisioning struct {
	// UIDHash is sha256 of the chip's factory UID. The raw UID is never sent:
	// it identifies the physical card and there is no reason for the server to
	// hold it.
	UIDHash []byte
	// Anchor is HMAC(HMAC(K, PIN), "linking-anchor-v1"). See the package
	// comment for why this and not its inputs.
	Anchor []byte
	Limits Limits
}

// Valid checks a provisioning before it is committed.
func (p Provisioning) Valid(maxDailyMinor int64) error {
	if len(p.UIDHash) != 32 {
		return fmt.Errorf("link: the card UID hash must be a 32-byte sha256")
	}
	if len(p.Anchor) != 32 {
		return fmt.Errorf("link: the PIN anchor must be 32 bytes")
	}
	return p.Limits.Valid(maxDailyMinor)
}
