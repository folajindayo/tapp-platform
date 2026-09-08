package v1

import (
	"context"

	"github.com/usezoracle/tapp/api/storage"
)

// gasSpendSummary totals what has been spent, split by whether the transaction
// it paid for succeeded.
//
// The split is the point. Gas is charged whether or not the call worked, so a
// rising reverted total is the signal that something upstream is building
// transactions the chain refuses -- a cost that otherwise shows up only as a
// slowly emptying wallet.
type spendSummary struct {
	Transactions   int    `json:"transactions"`
	TotalWei       string `json:"total_wei"`
	RevertedCount  int    `json:"reverted_transactions"`
	RevertedWei    string `json:"reverted_wei"`
	PostedUSDMinor int64  `json:"posted_usd_minor"`
}

func gasSpendSummary(ctx context.Context) (*spendSummary, error) {
	var s spendSummary
	err := storage.Pool.QueryRow(ctx, `
		SELECT count(*),
		       coalesce(sum(cost_wei), 0)::text,
		       count(*) FILTER (WHERE NOT succeeded),
		       coalesce(sum(cost_wei) FILTER (WHERE NOT succeeded), 0)::text,
		       coalesce(sum(cost_usd_minor), 0)
		  FROM gas_transactions`).Scan(
		&s.Transactions, &s.TotalWei, &s.RevertedCount, &s.RevertedWei, &s.PostedUSDMinor)
	if err != nil {
		return nil, err
	}
	return &s, nil
}
