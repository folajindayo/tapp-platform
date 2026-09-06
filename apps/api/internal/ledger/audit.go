package ledger

import (
	"context"
	"fmt"

	"github.com/usezoracle/tapp/api/internal/money"
)

// Audit is the whole ledger's health in one answer.
//
// It exists because "every transaction balances" is worth very little as a
// claim in a design document and a great deal as a number anybody can pull up.
// The invariant is enforced by a database trigger, so a failure here means
// something has bypassed the ledger entirely -- a hand-edited row, a restored
// backup, a migration that moved entries. Those are exactly the events that
// otherwise go unnoticed until reconciliation.
type Audit struct {
	Currencies []CurrencyAudit `json:"currencies"`
	// Balanced is true only when every currency is. It is the single field an
	// alert should watch.
	Balanced bool `json:"balanced"`
}

// CurrencyAudit is the position in one currency.
type CurrencyAudit struct {
	Currency money.Currency `json:"currency"`

	// Sum of every entry. Must be exactly zero: value enters and leaves only
	// through `external`, so anything else means value was invented.
	SumMinor int64  `json:"sumMinor"`
	Sum      string `json:"sum"`
	Balanced bool   `json:"balanced"`

	// UnbalancedTransactions counts transactions that do not sum to zero.
	// Should be impossible; a non-zero value means the trigger was bypassed.
	UnbalancedTransactions int `json:"unbalancedTransactions"`

	Entries      int64            `json:"entries"`
	Transactions int64            `json:"transactions"`
	Holdings     []AccountHolding `json:"holdings"`
}

// AccountHolding is what one kind of account holds in aggregate. Grouped by
// kind rather than listed per account, because the useful question is "how
// much is owed to merchants" rather than "what does each merchant hold".
type AccountHolding struct {
	OwnerKind    string `json:"ownerKind"`
	Kind         string `json:"kind"`
	BalanceMinor int64  `json:"balanceMinor"`
	Balance      string `json:"balance"`
	Accounts     int    `json:"accounts"`
}

// Auditor reads the ledger's aggregate state.
func Auditor(ctx context.Context, q Querier) (*Audit, error) {
	audit := &Audit{Balanced: true}

	for _, c := range money.SupportedCurrencies() {
		ca, err := auditCurrency(ctx, q, c)
		if err != nil {
			return nil, err
		}
		if !ca.Balanced {
			audit.Balanced = false
		}
		audit.Currencies = append(audit.Currencies, *ca)
	}
	return audit, nil
}

func auditCurrency(ctx context.Context, q Querier, c money.Currency) (*CurrencyAudit, error) {
	ca := &CurrencyAudit{Currency: c}

	err := q.QueryRow(ctx, `
		SELECT COALESCE(SUM(amount_minor), 0), COUNT(*), COUNT(DISTINCT tx_id)
		  FROM ledger_entries WHERE currency = $1::currency`,
		string(c)).Scan(&ca.SumMinor, &ca.Entries, &ca.Transactions)
	if err != nil {
		return nil, fmt.Errorf("ledger: audit sum for %s: %w", c, err)
	}
	ca.Sum = money.New(ca.SumMinor, c).String()

	// Per-transaction check. The trigger makes this impossible to violate
	// through the application, which is precisely why it is worth verifying
	// independently: if it is ever non-zero, the ledger was written around.
	if err := q.QueryRow(ctx, `
		SELECT COUNT(*) FROM (
			SELECT tx_id FROM ledger_entries
			 WHERE currency = $1::currency
			 GROUP BY tx_id, currency
			HAVING SUM(amount_minor) <> 0
		) AS unbalanced`, string(c)).Scan(&ca.UnbalancedTransactions); err != nil {
		return nil, fmt.Errorf("ledger: audit transactions for %s: %w", c, err)
	}

	ca.Balanced = ca.SumMinor == 0 && ca.UnbalancedTransactions == 0

	rows, err := q.Query(ctx, `
		SELECT owner_kind::text, kind::text, COALESCE(SUM(balance_minor), 0), COUNT(*)
		  FROM ledger_balances
		 WHERE currency = $1::currency
		 GROUP BY owner_kind, kind
		 ORDER BY owner_kind, kind`, string(c))
	if err != nil {
		return nil, fmt.Errorf("ledger: audit holdings for %s: %w", c, err)
	}
	defer rows.Close()

	for rows.Next() {
		var h AccountHolding
		if err := rows.Scan(&h.OwnerKind, &h.Kind, &h.BalanceMinor, &h.Accounts); err != nil {
			return nil, err
		}
		h.Balance = money.New(h.BalanceMinor, c).String()
		ca.Holdings = append(ca.Holdings, h)
	}
	return ca, rows.Err()
}
