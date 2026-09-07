package money

import (
	"encoding/json"
	"testing"
)

func TestAnAmountCarriesItsCurrencyOverTheWire(t *testing.T) {
	b, err := json.Marshal(New(150_000, NGN))
	if err != nil {
		t.Fatal(err)
	}
	var got struct {
		Minor    int64  `json:"minor"`
		Currency string `json:"currency"`
		Display  string `json:"display"`
	}
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if got.Minor != 150_000 || got.Currency != "NGN" {
		t.Fatalf("got %+v", got)
	}
	// The display is the server's rendering, not the client's guess at one.
	if got.Display != "₦1,500.00" {
		t.Fatalf("display = %q", got.Display)
	}
}

func TestTheSameNumberInTwoCurrenciesIsNotTheSameAmount(t *testing.T) {
	ngn, _ := json.Marshal(New(150_000, NGN))
	usd, _ := json.Marshal(New(150_000, USD))
	if string(ngn) == string(usd) {
		t.Fatal("₦1,500.00 and $1,500.00 serialised identically")
	}
}

func TestRoundTripPreservesTheAmountExactly(t *testing.T) {
	for _, want := range []Amount{
		New(150_000, NGN), New(-2_50, USD), Zero(NGN), New(1, USD),
	} {
		b, err := json.Marshal(want)
		if err != nil {
			t.Fatal(err)
		}
		var got Amount
		if err := json.Unmarshal(b, &got); err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("%s round-tripped to %s", want, got)
		}
	}
}

// An Amount nobody assigned to has no currency. It must not acquire one.
func TestAnUnsetAmountDoesNotInventACurrency(t *testing.T) {
	b, err := json.Marshal(Amount{})
	if err != nil {
		t.Fatal(err)
	}
	if string(b) != "null" {
		t.Fatalf("unset amount serialised as %s", b)
	}
	var got Amount
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if got != (Amount{}) {
		t.Fatalf("null round-tripped to %+v", got)
	}
}

// A client must not be able to name a currency the ledger cannot hold.
func TestAnUnsupportedCurrencyIsRefusedOnTheWayIn(t *testing.T) {
	var got Amount
	err := json.Unmarshal([]byte(`{"minor":100,"currency":"XYZ"}`), &got)
	if err == nil {
		t.Fatal("accepted XYZ")
	}
}

// `display` is output. Accepting an inbound one would let a caller show a user
// one number while the server acts on another.
func TestAnInboundDisplayIsIgnored(t *testing.T) {
	var got Amount
	err := json.Unmarshal(
		[]byte(`{"minor":100,"currency":"NGN","display":"₦1,000,000.00"}`), &got)
	if err != nil {
		t.Fatal(err)
	}
	if got.String() != "₦1.00" {
		t.Fatalf("display overrode the amount: %s", got)
	}
}
