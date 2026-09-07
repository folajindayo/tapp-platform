// Package rates prices one currency in another, and turns a price into a
// commitment.
//
// Two things live here and they are not the same. A RATE is what the market
// says right now, gathered from several independent sources and reduced to one
// number. A QUOTE is a rate offered to a particular person for a particular
// amount, with a spread applied and an expiry attached -- a price somebody can
// accept.
//
// The distinction matters because the predecessor had only the first. A card
// debit read a market_rate column at the moment the code ran and multiplied by
// a constant buffer, so the price a customer paid was whatever the rate
// happened to be at that instant, was never recorded against the transaction,
// and could not be reconciled afterwards. Nobody agreed to it because nobody
// was ever shown it.
package rates

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"time"

	"github.com/shopspring/decimal"

	"github.com/usezoracle/tapp/api/internal/money"
)

// Pair is a currency pair, priced as "how much Quote for one Base".
type Pair struct {
	Base  money.Currency
	Quote money.Currency
}

func (p Pair) String() string { return string(p.Base) + "/" + string(p.Quote) }

// ErrNoRate means no source could price the pair.
//
// There is deliberately no fallback. A seeded or last-known-good rate used
// when every source is down means quoting a price nobody can honour, and the
// loss lands on whichever side of the trade the stale number favours. A quote
// that cannot be priced is refused.
var ErrNoRate = errors.New("rates: no live rate available")

// ErrStale means a rate was found but is too old to price with.
var ErrStale = errors.New("rates: the last rate is too old to use")

// Source prices a pair. Each is an independent provider.
type Source interface {
	Name() string
	Rate(ctx context.Context, p Pair) (decimal.Decimal, error)
}

// Engine reduces several sources to one rate.
type Engine struct {
	Sources []Source
	// Timeout bounds a single source. One slow provider must not hold up a
	// quote when the others have already answered.
	Timeout time.Duration
	// MaxDeviation is how far a source may sit from the median before it is
	// discarded, as a fraction. A provider printing a wildly different number
	// is broken, and averaging it in spreads its error to every customer.
	MaxDeviation decimal.Decimal
}

// Rate is a priced pair with its provenance.
type Rate struct {
	Pair Pair
	// Mid is the market price: the median across the sources that answered.
	Mid decimal.Decimal
	// Sources names the providers that contributed, so a suspect price can be
	// traced to whoever printed it.
	Sources []string
	// Discarded names providers whose answers were too far from the median.
	Discarded []string
	At        time.Time
}

// Market gathers a live rate.
//
// The median rather than the mean: a single provider printing a broken number
// moves a mean and does not move a median, and providers do print broken
// numbers. Sources too far from the median are named and dropped, so a
// two-source disagreement is visible rather than silently split.
func (e *Engine) Market(ctx context.Context, p Pair) (*Rate, error) {
	if len(e.Sources) == 0 {
		return nil, fmt.Errorf("%w: no sources configured for %s", ErrNoRate, p)
	}

	type answer struct {
		name string
		rate decimal.Decimal
	}
	results := make(chan answer, len(e.Sources))

	timeout := e.Timeout
	if timeout <= 0 {
		timeout = 10 * time.Second
	}

	for _, src := range e.Sources {
		go func(s Source) {
			c, cancel := context.WithTimeout(ctx, timeout)
			defer cancel()

			r, err := s.Rate(c, p)
			if err != nil || !r.IsPositive() {
				results <- answer{name: s.Name()}
				return
			}
			results <- answer{name: s.Name(), rate: r}
		}(src)
	}

	var got []answer
	for range e.Sources {
		if a := <-results; a.rate.IsPositive() {
			got = append(got, a)
		}
	}
	if len(got) == 0 {
		return nil, fmt.Errorf("%w for %s", ErrNoRate, p)
	}

	sort.Slice(got, func(i, j int) bool { return got[i].rate.LessThan(got[j].rate) })
	median := got[len(got)/2].rate
	if len(got)%2 == 0 {
		median = got[len(got)/2-1].rate.Add(got[len(got)/2].rate).Div(decimal.NewFromInt(2))
	}

	rate := &Rate{Pair: p, At: time.Now()}
	kept := make([]decimal.Decimal, 0, len(got))
	for _, a := range got {
		if e.MaxDeviation.IsPositive() && median.IsPositive() {
			deviation := a.rate.Sub(median).Abs().Div(median)
			if deviation.GreaterThan(e.MaxDeviation) {
				rate.Discarded = append(rate.Discarded, a.name)
				continue
			}
		}
		kept = append(kept, a.rate)
		rate.Sources = append(rate.Sources, a.name)
	}
	if len(kept) == 0 {
		return nil, fmt.Errorf("%w for %s: every source disagreed with the median", ErrNoRate, p)
	}

	// Re-take the median over what survived.
	sort.Slice(kept, func(i, j int) bool { return kept[i].LessThan(kept[j]) })
	rate.Mid = kept[len(kept)/2]
	if len(kept)%2 == 0 {
		rate.Mid = kept[len(kept)/2-1].Add(kept[len(kept)/2]).Div(decimal.NewFromInt(2))
	}
	return rate, nil
}
