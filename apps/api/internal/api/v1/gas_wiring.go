package v1

import "github.com/usezoracle/tapp/api/internal/chain/gas"

// gasPoster prices recorded gas into the ledger.
//
// Nil until an ETH price source exists. Deliberately a separate thing from the
// recorder: recording is exact and always possible, pricing is not, and
// conflating them would make the absence of a price feed look like a failure
// to record.
var gasPoster *gas.Poster

// SetGasPoster records the poster built at startup.
func SetGasPoster(p *gas.Poster) { gasPoster = p }

// GasPoster returns it, or nil when gas cannot be priced.
func GasPoster() *gas.Poster { return gasPoster }
