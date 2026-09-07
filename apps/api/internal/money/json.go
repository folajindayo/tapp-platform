package money

import "encoding/json"

// Amount crosses the wire as an object, not a number.
//
// A bare number cannot say what it is. 150000 is ₦1,500.00 and it is also
// $1,500.00 and it is also 150,000 of something with no minor unit, and a
// client that guesses wrong is wrong by a factor of a hundred. So the currency
// travels with the number here for the same reason it travels with it in
// memory.
//
// `display` is the server's own rendering, carried alongside. Clients show it
// rather than formatting `minor` themselves: grouping, symbol placement and the
// exponent are decided in exactly one place, so a receipt printed by the API
// and a balance drawn by the app can never disagree about what a number looks
// like. `minor` remains authoritative for arithmetic and comparison.
type wireAmount struct {
	Minor    int64    `json:"minor"`
	Currency Currency `json:"currency"`
	Display  string   `json:"display"`
}

// MarshalJSON renders the amount for a client.
func (a Amount) MarshalJSON() ([]byte, error) {
	// A zero Amount{} has no currency -- it is the value a struct field takes
	// before anybody assigns to it. Emitting it as though it were a real
	// currency would invent one, so it goes out as null and the client renders
	// nothing rather than "0" in a currency nobody chose.
	if a.currency == "" {
		return []byte("null"), nil
	}
	return json.Marshal(wireAmount{
		Minor:    a.minor,
		Currency: a.currency,
		Display:  a.String(),
	})
}

// UnmarshalJSON reads an amount a client sent.
//
// `display` is ignored on the way in. It is derived output; honouring an
// inbound one would let a caller present a number to a user that disagrees
// with the number the server acts on, which is the whole problem this type
// exists to prevent.
func (a *Amount) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		*a = Amount{}
		return nil
	}
	var w wireAmount
	if err := json.Unmarshal(data, &w); err != nil {
		return err
	}
	if err := w.Currency.Valid(); err != nil {
		return err
	}
	*a = Amount{minor: w.Minor, currency: w.Currency}
	return nil
}

var (
	_ json.Marshaler   = Amount{}
	_ json.Unmarshaler = (*Amount)(nil)
)
