package rates

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/shopspring/decimal"

	"github.com/usezoracle/tapp/api/internal/money"
)

// QuoteTTL is how long an offered price stands.
//
// Short, because the platform carries the market risk for exactly this long:
// every second a quote is honourable is a second the rate can move against us.
// Long enough that somebody can read the number and decide.
const QuoteTTL = 60 * time.Second

var (
	// ErrQuoteExpired means the price is no longer offered.
	ErrQuoteExpired = errors.New("rates: this price has expired")
	// ErrQuoteUsed means it has already been acted on. A quote is single-use:
	// two conversions at one locked price is a free option against us.
	ErrQuoteUsed = errors.New("rates: this price has already been used")
	// ErrQuoteUnknown means no such quote.
	ErrQuoteUnknown = errors.New("rates: no such price")
)

// Spread is the platform's margin on a conversion, in basis points.
//
// Configured per pair, because the cost of holding a position differs by
// currency, and booked to revenue as its own ledger entry. It replaces a
// constant of 100 basis points applied inside a card handler that bundled a
// fee with drift headroom and made neither visible.
type Spread map[string]int

// For returns the spread for a pair. A pair with no configured spread cannot
// be quoted -- a default here would be the platform guessing at its own
// margin, which is not a thing to guess at.
func (s Spread) For(p Pair) (int, error) {
	bps, ok := s[p.String()]
	if !ok {
		return 0, fmt.Errorf("rates: no spread configured for %s", p)
	}
	if bps < 0 || bps > 10_000 {
		return 0, fmt.Errorf("rates: spread for %s is %d basis points, which is not a margin", p, bps)
	}
	return bps, nil
}

// Quote is a price offered for a specific amount, which somebody can accept.
type Quote struct {
	ID   uuid.UUID `json:"id"`
	Pair Pair      `json:"-"`

	// Sell is what the customer gives up; Buy is what they receive, already
	// net of the spread.
	Sell money.Amount `json:"-"`
	Buy  money.Amount `json:"-"`
	// Fee is the platform's margin, in the bought currency. Buy + Fee is the
	// full value of Sell at the market rate.
	Fee money.Amount `json:"-"`

	// MarketRate is the mid the quote was struck from, and SpreadBPS the
	// margin applied. Both are recorded so a customer can be shown exactly
	// what they were charged and why.
	MarketRate decimal.Decimal `json:"marketRate"`
	SpreadBPS  int             `json:"spreadBps"`

	ExpiresAt time.Time `json:"expiresAt"`
}

// Quoter issues and redeems quotes.
type Quoter struct {
	Engine *Engine
	Spread Spread
	Pool   *pgxpool.Pool
	Now    func() time.Time
}

func (q *Quoter) now() time.Time {
	if q.Now != nil {
		return q.Now()
	}
	return time.Now()
}

// Offer prices a conversion of a specific amount and records the offer.
//
// The amount is part of the quote, not applied afterwards, because a price
// that does not know the size is not a price -- and because binding the two
// together is what stops somebody taking a quote for a small trade and
// executing a large one at the same rate.
func (q *Quoter) Offer(ctx context.Context, sell money.Amount, buy money.Currency) (*Quote, error) {
	if !sell.IsPositive() {
		return nil, fmt.Errorf("rates: cannot quote a sale of %s", sell)
	}
	if sell.Currency() == buy {
		return nil, fmt.Errorf("rates: %s to %s is not a conversion", sell.Currency(), buy)
	}
	if err := buy.Valid(); err != nil {
		return nil, err
	}

	pair := Pair{Base: sell.Currency(), Quote: buy}
	bps, err := q.Spread.For(pair)
	if err != nil {
		return nil, err
	}

	market, err := q.Engine.Market(ctx, pair)
	if err != nil {
		return nil, err
	}

	// Gross: what the sold amount is worth at the market rate, in the bought
	// currency's minor units.
	gross := decimal.NewFromInt(sell.Minor()).
		Div(decimal.NewFromInt(sell.Currency().Scale())).
		Mul(market.Mid).
		Mul(decimal.NewFromInt(buy.Scale()))

	grossMinor := gross.Round(0).IntPart()
	if grossMinor <= 0 {
		return nil, fmt.Errorf("rates: %s is too small to convert to %s", sell, buy)
	}

	grossAmount := money.New(grossMinor, buy)
	fee := money.FeeFor(grossAmount, bps)
	net, err := grossAmount.Sub(fee)
	if err != nil {
		return nil, err
	}
	if !net.IsPositive() {
		return nil, fmt.Errorf("rates: after a %d basis point spread, %s converts to nothing", bps, sell)
	}

	quote := &Quote{
		ID: uuid.New(), Pair: pair,
		Sell: sell, Buy: net, Fee: fee,
		MarketRate: market.Mid, SpreadBPS: bps,
		ExpiresAt: q.now().Add(QuoteTTL),
	}

	if _, err := q.Pool.Exec(ctx, `
		INSERT INTO fx_quotes
			(id, base_currency, quote_currency, sell_minor, buy_minor, fee_minor,
			 market_rate, spread_bps, sources, expires_at)
		VALUES ($1, $2::currency, $3::currency, $4, $5, $6, $7, $8, $9, $10)`,
		quote.ID, string(pair.Base), string(pair.Quote),
		sell.Minor(), net.Minor(), fee.Minor(),
		market.Mid.String(), bps, market.Sources, quote.ExpiresAt); err != nil {
		return nil, fmt.Errorf("rates: record quote: %w", err)
	}
	return quote, nil
}

// Redeem claims a quote for execution, exactly once.
//
// The UPDATE ... WHERE used_at IS NULL RETURNING is the mechanism, the same
// one the card nonce uses: the database decides which caller wins rather than
// the application. Two conversions at one locked price would be a free option
// against the platform, and free options get exercised.
//
// It takes the caller's transaction so redeeming the quote and posting the
// ledger entries commit together.
func (q *Quoter) Redeem(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*Quote, error) {
	var (
		quote                         Quote
		base, quoteCur                string
		sellMinor, buyMinor, feeMinor int64
		rateText                      string
	)
	err := tx.QueryRow(ctx, `
		UPDATE fx_quotes SET used_at = now()
		 WHERE id = $1 AND used_at IS NULL AND expires_at > now()
		RETURNING id, base_currency, quote_currency, sell_minor, buy_minor, fee_minor,
		          market_rate, spread_bps, expires_at`, id).
		Scan(&quote.ID, &base, &quoteCur, &sellMinor, &buyMinor, &feeMinor,
			&rateText, &quote.SpreadBPS, &quote.ExpiresAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, q.explainRedemptionFailure(ctx, tx, id)
	}
	if err != nil {
		return nil, fmt.Errorf("rates: redeem quote: %w", err)
	}

	quote.Pair = Pair{Base: money.Currency(base), Quote: money.Currency(quoteCur)}
	quote.Sell = money.New(sellMinor, quote.Pair.Base)
	quote.Buy = money.New(buyMinor, quote.Pair.Quote)
	quote.Fee = money.New(feeMinor, quote.Pair.Quote)
	quote.MarketRate, _ = decimal.NewFromString(rateText)
	return &quote, nil
}

// explainRedemptionFailure says which of the three reasons applied.
//
// Worth the extra query: "this price expired, here is a new one" and "this
// payment already went through" lead somewhere different, and reporting them
// identically sends people to support for a problem they could have resolved
// by looking at the screen.
func (q *Quoter) explainRedemptionFailure(ctx context.Context, tx pgx.Tx, id uuid.UUID) error {
	var used *time.Time
	var expires time.Time
	if err := tx.QueryRow(ctx,
		`SELECT used_at, expires_at FROM fx_quotes WHERE id = $1`, id).Scan(&used, &expires); err != nil {
		return ErrQuoteUnknown
	}
	if used != nil {
		return ErrQuoteUsed
	}
	return fmt.Errorf("%w at %s", ErrQuoteExpired, expires.Format(time.RFC3339))
}
