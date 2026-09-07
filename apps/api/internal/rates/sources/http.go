// Package sources holds the individual rate providers.
//
// Each is independent and each can be wrong. That is the premise the engine is
// built on: one broken provider must not move the price, which is why they are
// combined by median and why one that disagrees materially is discarded and
// named rather than averaged in.
package sources

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/shopspring/decimal"

	"github.com/usezoracle/tapp/api/internal/rates"
)

// JSONSource reads a rate from an HTTP endpoint returning JSON.
//
// One type rather than one per provider, because the providers differ only in
// their URL and where in the response the number sits. A provider needing more
// than that gets its own file; a provider needing less does not need a
// bespoke client to prove it.
type JSONSource struct {
	// ID names this provider in a Rate's provenance.
	ID string
	// URL is a template with {base}, {quote} and {amount} placeholders.
	URL string
	// Path is a dotted path to the number in the response, e.g. "data.rate".
	Path string
	// Client is injectable so tests do not reach the network.
	Client *http.Client
	// Invert reports the rate as quote-per-base when the provider publishes
	// base-per-quote.
	Invert bool
}

func (s *JSONSource) Name() string { return s.ID }

func (s *JSONSource) Rate(ctx context.Context, p rates.Pair) (decimal.Decimal, error) {
	url := strings.NewReplacer(
		"{base}", string(p.Base),
		"{quote}", string(p.Quote),
		"{amount}", "1",
	).Replace(s.URL)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return decimal.Zero, err
	}
	req.Header.Set("Accept", "application/json")

	client := s.Client
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return decimal.Zero, fmt.Errorf("%s: %w", s.ID, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return decimal.Zero, fmt.Errorf("%s: HTTP %d", s.ID, resp.StatusCode)
	}

	var body any
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return decimal.Zero, fmt.Errorf("%s: %w", s.ID, err)
	}

	raw, err := dig(body, strings.Split(s.Path, "."))
	if err != nil {
		return decimal.Zero, fmt.Errorf("%s: %w", s.ID, err)
	}

	rate, err := toDecimal(raw)
	if err != nil {
		return decimal.Zero, fmt.Errorf("%s: %w", s.ID, err)
	}
	if !rate.IsPositive() {
		return decimal.Zero, fmt.Errorf("%s: reported a rate of %s", s.ID, rate)
	}
	if s.Invert {
		rate = decimal.NewFromInt(1).Div(rate)
	}
	return rate, nil
}

// dig walks a dotted path into decoded JSON.
func dig(v any, path []string) (any, error) {
	for _, key := range path {
		if key == "" {
			continue
		}
		obj, ok := v.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("no value at %q", strings.Join(path, "."))
		}
		v, ok = obj[key]
		if !ok {
			return nil, fmt.Errorf("no value at %q", strings.Join(path, "."))
		}
	}
	return v, nil
}

// toDecimal accepts a number or a numeric string, because providers publish
// both and a rate parsed from a float has already lost precision.
func toDecimal(v any) (decimal.Decimal, error) {
	switch t := v.(type) {
	case string:
		return decimal.NewFromString(strings.TrimSpace(t))
	case float64:
		return decimal.NewFromFloat(t), nil
	case json.Number:
		return decimal.NewFromString(t.String())
	default:
		return decimal.Zero, fmt.Errorf("rate is a %T, not a number", v)
	}
}
