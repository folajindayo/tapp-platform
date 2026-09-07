package ledger

import (
	"context"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/usezoracle/tapp/api/internal/money"
)

// Movement is one change to one of a party's accounts.
//
// This is the activity feed, and it is derived from the same rows that decide
// the balance rather than from a parallel record of "things that happened".
// A feed assembled separately can disagree with the balance it sits under, and
// when it does there is no way to tell which one is lying.
type Movement struct {
	ID   int64     `json:"id"`
	TxID uuid.UUID `json:"txId"`

	// Amount is signed from the party's point of view: positive is money
	// arriving, negative is money leaving.
	Amount money.Amount `json:"amount"`

	// Account is which of their accounts moved -- available, escrow, or an
	// obligation. A pledge locking into escrow is not the same event as it
	// settling into a spendable balance, and the feed should not pretend it is.
	Account string `json:"account"`

	// Reason is the movement's kind, as the ledger recorded it: "tap.debit",
	// "handover.settled", "fx.bought". Stable enough for a client to switch on
	// for an icon or a label; the prefix before the dot is the domain.
	Reason string `json:"reason"`

	RefType string     `json:"refType,omitempty"`
	RefID   *uuid.UUID `json:"refId,omitempty"`

	At time.Time `json:"at"`
}

// Page is one page of movements, plus how to ask for the next.
type Page struct {
	Movements []Movement `json:"movements"`
	// NextCursor is empty when there is nothing more.
	NextCursor string `json:"nextCursor,omitempty"`
}

// DefaultPageSize is what a caller gets when they do not ask.
const DefaultPageSize = 30

// MaxPageSize bounds what they can ask for.
const MaxPageSize = 100

// History returns a party's movements, newest first.
//
// Paged by keyset rather than OFFSET. A feed that grows while somebody is
// reading it shifts every offset, so page two of an OFFSET query silently
// skips whatever arrived in the meantime -- and the movement it skips is
// exactly the one they opened the app to see.
func History(ctx context.Context, q Querier, owner Owner, limit int, cursor string) (*Page, error) {
	if limit <= 0 || limit > MaxPageSize {
		limit = DefaultPageSize
	}

	after, err := decodeCursor(cursor)
	if err != nil {
		return nil, err
	}

	// Fetch one more than asked for, so whether a next page exists is known
	// without a second count query.
	rows, err := q.Query(ctx, `
		SELECT e.id, e.tx_id, e.amount_minor, e.currency, a.kind,
		       e.reason, COALESCE(t.ref_type, ''), t.ref_id, e.created_at
		  FROM ledger_entries e
		  JOIN ledger_accounts a       ON a.id = e.account_id
		  JOIN ledger_transactions t   ON t.id = e.tx_id
		 WHERE a.owner_id IS NOT DISTINCT FROM $1
		   AND a.owner_kind = $2::owner_kind
		   AND ($3::bigint IS NULL OR e.id < $3::bigint)
		 ORDER BY e.id DESC
		 LIMIT $4`,
		owner.ID, owner.Kind, after, limit+1)
	if err != nil {
		return nil, fmt.Errorf("ledger: history: %w", err)
	}
	defer rows.Close()

	page := &Page{Movements: make([]Movement, 0, limit)}
	for rows.Next() {
		var (
			m        Movement
			minor    int64
			currency string
		)
		if err := rows.Scan(&m.ID, &m.TxID, &minor, &currency, &m.Account,
			&m.Reason, &m.RefType, &m.RefID, &m.At); err != nil {
			return nil, fmt.Errorf("ledger: history: %w", err)
		}
		m.Amount = money.New(minor, money.Currency(currency))
		page.Movements = append(page.Movements, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("ledger: history: %w", err)
	}

	if len(page.Movements) > limit {
		page.Movements = page.Movements[:limit]
		page.NextCursor = encodeCursor(page.Movements[limit-1].ID)
	}
	return page, nil
}

// The cursor is the last entry id seen, base64'd.
//
// Encoded rather than handed over as a bare number so that it reads as an
// opaque token: a client that starts doing arithmetic on it will break the
// first time the paging key changes, and the encoding says not to.
const cursorPrefix = "e:"

func encodeCursor(id int64) string {
	return base64.RawURLEncoding.EncodeToString([]byte(cursorPrefix + strconv.FormatInt(id, 10)))
}

// ErrBadCursor is returned for a cursor this code did not issue.
type ErrBadCursor struct{ Cursor string }

func (e ErrBadCursor) Error() string { return "ledger: unusable cursor " + strconv.Quote(e.Cursor) }

func decodeCursor(cursor string) (*int64, error) {
	if cursor == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return nil, ErrBadCursor{Cursor: cursor}
	}
	text, ok := strings.CutPrefix(string(raw), cursorPrefix)
	if !ok {
		return nil, ErrBadCursor{Cursor: cursor}
	}
	id, err := strconv.ParseInt(text, 10, 64)
	if err != nil {
		return nil, ErrBadCursor{Cursor: cursor}
	}
	return &id, nil
}
