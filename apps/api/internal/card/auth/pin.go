// Package auth decides whether a tap is allowed to proceed: which
// authentication tier an amount requires, and whether the cardholder has
// satisfied it.
//
// The PIN protocol is carried over from the predecessor unchanged, because it
// is genuinely good. The server never learns the PIN, and never learns K (the
// secret on the card). At linking, the cardholder's app computes
//
//	K'      = HMAC-SHA256(K, PIN)
//	anchor  = HMAC-SHA256(K', "linking-anchor-v1")
//
// and commits `anchor` to the server. At a debit the server issues a nonce and
// the app answers HMAC-SHA256(anchor, nonce). The server can verify that
// answer without being able to produce one, so a server compromise does not
// yield the ability to impersonate a cardholder -- and neither does a database
// dump.
package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"errors"
	"fmt"
)

const (
	// AnchorLen is the size of the committed linking proof and of a response.
	AnchorLen = sha256.Size
	// NonceLen is the size of a per-debit challenge.
	NonceLen = 32
)

var (
	// ErrWrongPIN means the response did not verify. It is a normal outcome --
	// people mistype PINs -- and must be reported as a refusal the cardholder
	// can retry, never as a fault.
	ErrWrongPIN = errors.New("incorrect PIN")

	// ErrNoPIN means the card has no committed anchor, so it cannot answer a
	// challenge at all. That is a linking failure, not a wrong PIN, and saying
	// so is the difference between a cardholder retrying forever and one being
	// told to re-link.
	ErrNoPIN = errors.New("card has no PIN set")
)

// VerifyPIN checks a response against the anchor committed at linking time.
//
// anchor and response are compared in constant time. The comparison is the
// only thing standing between a captured response and a working one, and a
// timing oracle on it would let an attacker walk a forgery byte by byte.
func VerifyPIN(anchor, nonce, response []byte) error {
	if len(anchor) != AnchorLen {
		return ErrNoPIN
	}
	if len(nonce) != NonceLen {
		return fmt.Errorf("auth: nonce must be %d bytes, got %d", NonceLen, len(nonce))
	}
	if len(response) != AnchorLen {
		// A wrong length is a wrong answer. Reporting it distinctly would tell
		// an attacker their guess was the right shape.
		return ErrWrongPIN
	}

	mac := hmac.New(sha256.New, anchor)
	mac.Write(nonce)
	if subtle.ConstantTimeCompare(mac.Sum(nil), response) != 1 {
		return ErrWrongPIN
	}
	return nil
}

// ---------------------------------------------------------------- the client half

// The two functions below are the cardholder's side of the protocol. The
// server never calls them in production -- it has neither K nor the PIN, which
// is the entire point -- but they belong here, next to the verifier, for two
// reasons: they are the specification of what a client must compute, and
// keeping them together is what stops the two halves drifting apart. Tests and
// any client SDK we publish use them.

// AnchorInfo domain-separates the anchor derivation, so the value committed at
// linking cannot be reused as any other HMAC output in the protocol.
const AnchorInfo = "linking-anchor-v1"

// Anchor derives the value a cardholder commits to the server at linking time:
//
//	anchor = HMAC(HMAC(K, PIN), "linking-anchor-v1")
//
// Neither K nor the PIN can be recovered from it, so a server that stores only
// this cannot impersonate the cardholder -- and neither can anyone who takes a
// copy of the database.
func Anchor(k []byte, pin string) []byte {
	kPrime := hmac.New(sha256.New, k)
	kPrime.Write([]byte(pin))

	a := hmac.New(sha256.New, kPrime.Sum(nil))
	a.Write([]byte(AnchorInfo))
	return a.Sum(nil)
}

// Respond answers a challenge: HMAC(anchor, nonce).
//
// Bound to one nonce, so a response captured at a terminal is worthless
// against the next debit.
func Respond(anchor, nonce []byte) []byte {
	r := hmac.New(sha256.New, anchor)
	r.Write(nonce)
	return r.Sum(nil)
}
