// Package movements is the ledger's business vocabulary.
//
// ledger.Post is the primitive: it writes a balanced set of entries and knows
// nothing about what they mean. Everything in this package is a named
// movement -- a tap, a deposit, a conversion, a payout -- expressed once, in
// one place, so that "what happens to the books when a card is tapped" has a
// single answer that can be read and tested rather than being reassembled from
// whichever handler happened to write the entries.
//
// Nothing outside this package may call ledger.Post for a business movement.
// A handler that assembles its own entries is a handler that can invent a
// movement nobody reviewed.
package movements

import (
	"context"

	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/internal/ledger"
	"github.com/usezoracle/tapp/api/internal/money"
)

// resolve is shorthand for the account lookups every movement starts with.
type resolver struct {
	ctx context.Context
	q   ledger.Querier
	err error
}

func newResolver(ctx context.Context, q ledger.Querier) *resolver {
	return &resolver{ctx: ctx, q: q}
}

// account resolves one account, remembering the first failure so a movement
// can name its accounts in a readable block instead of five error checks.
func (r *resolver) account(owner ledger.Owner, kind string, c money.Currency) uuid.UUID {
	if r.err != nil {
		return uuid.Nil
	}
	id, err := ledger.AccountFor(r.ctx, r.q, owner, kind, c)
	if err != nil {
		r.err = err
	}
	return id
}
