// Package settlement delivers what the ledger says is owed.
//
// The ledger decides that value has moved; this decides whether it has
// arrived. They are deliberately separate, and the gap between them is the
// `payable` account: money sits there from the moment a merchant earns it
// until a bank confirms the credit, which is the only honest way to represent
// "we owe this and it has not landed yet".
//
// # The rule that matters
//
// A payout is discharged when the PROVIDER CONFIRMS the credit -- never when
// our own request is accepted. A request that was accepted and then failed
// leaves money owed; a request that timed out may or may not have moved money.
// Treating either as delivery is how a ledger comes to claim it has paid
// somebody it has not.
package settlement

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/internal/money"
)

// State is where a payout has got to.
type State string

const (
	// Pending: owed, nothing sent yet.
	Pending State = "pending"
	// Submitting: a request is in flight. Claimed by exactly one worker.
	Submitting State = "submitting"
	// Unknown: the request timed out. It may or may not have moved money, so
	// it must be CHASED with the provider rather than retried -- retrying an
	// unknown is how somebody gets paid twice.
	Unknown State = "unknown"
	// Sent: the provider accepted it; the bank has not confirmed.
	Sent State = "sent"
	// Confirmed: the money reached the account.
	Confirmed State = "confirmed"
	// Failed: refused on the merits. No money moved.
	Failed State = "failed"
)

// Final reports whether a state needs no further work.
func (s State) Final() bool { return s == Confirmed || s == Failed }

// Beneficiary is who is being paid.
type Beneficiary struct {
	// Kind is "merchant" or "user".
	Kind string
	ID   uuid.UUID
}

const (
	Merchant = "merchant"
	User     = "user"
)

// Payout is one delivery attempt.
type Payout struct {
	ID          uuid.UUID
	Beneficiary Beneficiary

	Amount money.Amount

	BankCode      string
	AccountNumber string
	// AccountName is what the BANK returned for the number, never what
	// somebody typed. It is the thing a person checks before money moves.
	AccountName string
	Narration   string

	State    State
	Attempts int

	Provider        string
	ProviderRef     string
	ProviderSession string
	LastError       string

	CreatedAt   time.Time
	SubmittedAt *time.Time
}

var (
	// ErrTemporary means the provider refused for a reason that will stop
	// being true: an empty float, a rate limit, their side down.
	//
	// The distinction from a terminal refusal is the whole reason this error
	// exists. A payout that fails because the float is empty must go back in
	// the queue; one that fails because the account number is wrong must not,
	// and must return the money. Getting this backwards either loses a
	// transfer that a top-up would have fixed, or retries a wrong account
	// number forever.
	ErrTemporary = errors.New("settlement: temporary provider failure")

	// ErrUnknown means the request timed out with no answer. The payout may or
	// may not have moved money and must be chased, never retried.
	ErrUnknown = errors.New("settlement: provider did not answer")

	// ErrNoRail means no provider is configured.
	ErrNoRail = errors.New("settlement: no payout provider configured")
)

// Request opens a payout.
type Request struct {
	Beneficiary   Beneficiary
	Amount        money.Amount
	BankCode      string
	AccountNumber string
	AccountName   string
	Narration     string
}

// Valid checks a request before it reserves anything.
func (r Request) Valid() error {
	switch {
	case r.Beneficiary.ID == uuid.Nil:
		return fmt.Errorf("settlement: a payout needs a beneficiary")
	case r.Beneficiary.Kind != Merchant && r.Beneficiary.Kind != User:
		return fmt.Errorf("settlement: %q is not a kind of beneficiary", r.Beneficiary.Kind)
	case !r.Amount.IsPositive():
		return fmt.Errorf("settlement: a payout must be positive, got %s", r.Amount)
	case r.BankCode == "" || r.AccountNumber == "":
		return fmt.Errorf("settlement: a payout needs a bank and an account number")
	case r.AccountName == "":
		// Not cosmetic. The name comes from a name enquiry against the bank,
		// and refusing to send without one is what stops money going to a
		// mistyped account number that happens to exist.
		return fmt.Errorf("settlement: a payout needs the name the bank returned for the account")
	}
	return nil
}
