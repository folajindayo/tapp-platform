// Package token implements the card's rotating anti-replay token.
//
// The card carries 32 bytes of server-generated randomness. Every debit issues
// a fresh value, the merchant app writes it to the card over NFC, and the next
// debit presents it back. A clone made from a card read at some point in the
// past presents a stale token and is refused.
//
// What this buys, stated honestly: cloning is DETECTED on the next tap, not
// prevented. An NTAG215 has no secret the reader cannot extract -- the token is
// a bearer value and any merchant who has taken a tap has seen one. The
// guarantee is that a cloned card and the real one cannot both keep working:
// whichever presents the stale token is refused and the card is flagged. That
// is the same guarantee an EMV application transaction counter gives, and it is
// the most an unauthenticated tag can offer. NTAG424 DNA, which computes a
// fresh CMAC per tap from a key that never leaves the chip, is the upgrade that
// would make cloning impossible rather than merely detectable.
package token

import (
	"crypto/rand"
	"crypto/subtle"
	"errors"
	"time"
)

// Len is the token size in bytes.
const Len = 32

// PendingTTL bounds how long an unacknowledged token stays acceptable.
//
// Between a debit and its acknowledgement two tokens are valid, which is a
// wider replay window than one. The window is bounded so it cannot be held
// open indefinitely by an app that simply never acknowledges: past this, the
// pending token is disregarded and the card is back to a single valid value.
const PendingTTL = 10 * time.Minute

var (
	// ErrMismatch means the card presented neither the current token nor a
	// live pending one. Either it is a clone, or a write was lost long enough
	// ago that the pending token expired.
	ErrMismatch = errors.New("card token does not match")

	// ErrNotProvisioned means the card has no token at all, so it was never
	// finished being linked.
	ErrNotProvisioned = errors.New("card has no token; it was never activated")
)

// New returns a fresh token.
func New() ([]byte, error) {
	b := make([]byte, Len)
	if _, err := rand.Read(b); err != nil {
		return nil, err
	}
	return b, nil
}

// State is what the database holds for one card's token.
type State struct {
	Current         []byte
	Pending         []byte
	PendingIssuedAt *time.Time
}

// Match reports which of the card's tokens the presented value is.
type Match int

const (
	NoMatch Match = iota
	// MatchesCurrent: the ordinary case, the last write succeeded.
	MatchesCurrent
	// MatchesPending: the card is presenting the token from the previous
	// debit, which means that write DID land but its acknowledgement did not
	// reach us. Treated as valid, and the pending token is promoted.
	MatchesPending
)

// Verify checks a presented token against the card's state.
//
// Both comparisons are constant time. The predecessor used a hand-rolled
// byte-equality loop that returned on the first differing byte, which leaks
// how much of a guess was correct -- and the value being guessed is the one
// thing standing between a cloned card and a working one.
func (s State) Verify(presented []byte, now time.Time) (Match, error) {
	if len(s.Current) == 0 {
		return NoMatch, ErrNotProvisioned
	}
	if len(presented) != Len {
		return NoMatch, ErrMismatch
	}

	if subtle.ConstantTimeCompare(presented, s.Current) == 1 {
		return MatchesCurrent, nil
	}

	if s.pendingLive(now) && subtle.ConstantTimeCompare(presented, s.Pending) == 1 {
		return MatchesPending, nil
	}

	return NoMatch, ErrMismatch
}

// pendingLive reports whether an unacknowledged token is still within its TTL.
func (s State) pendingLive(now time.Time) bool {
	if len(s.Pending) != Len || s.PendingIssuedAt == nil {
		return false
	}
	return now.Sub(*s.PendingIssuedAt) <= PendingTTL
}
