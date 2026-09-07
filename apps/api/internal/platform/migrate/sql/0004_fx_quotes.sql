-- Prices that were actually offered.
--
-- A quote is a commitment: for as long as it stands, the platform carries the
-- market risk between the rate it was struck at and the rate when it is
-- executed. That obligation has to be a row somewhere, with an expiry the
-- database enforces and a single-use flag, or "the price I was shown" becomes
-- a matter of opinion.
--
-- The predecessor had no such record. A conversion was priced by reading a
-- market_rate column at whatever instant the code ran and multiplying by a
-- constant, so the customer was never shown a price, never agreed to one, and
-- no reconciliation afterwards could say what they should have received.

BEGIN;

CREATE TABLE fx_quotes (
    id             uuid PRIMARY KEY,

    base_currency  currency NOT NULL,
    quote_currency currency NOT NULL,
    CHECK (base_currency <> quote_currency),

    -- The amounts are fixed at quote time. A price that does not know the size
    -- is not a price, and binding them together is what stops a quote taken
    -- for a small trade being executed on a large one.
    sell_minor     bigint NOT NULL CHECK (sell_minor > 0),
    buy_minor      bigint NOT NULL CHECK (buy_minor > 0),
    fee_minor      bigint NOT NULL CHECK (fee_minor >= 0),

    -- What it was struck from, kept so a customer can be shown exactly what
    -- they were charged and why. Text rather than a float: this is a price,
    -- and a float cannot hold one exactly.
    market_rate    text NOT NULL,
    spread_bps     int  NOT NULL CHECK (spread_bps BETWEEN 0 AND 10000),

    -- Which providers contributed. A suspect price traces to whoever printed it.
    sources        text[] NOT NULL DEFAULT '{}',

    expires_at     timestamptz NOT NULL,
    -- Single use. Two conversions at one locked price is a free option against
    -- the platform, and free options get exercised.
    used_at        timestamptz,

    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX fx_quotes_live ON fx_quotes (expires_at) WHERE used_at IS NULL;

COMMIT;
