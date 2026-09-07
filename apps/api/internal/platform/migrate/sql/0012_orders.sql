-- Integrator payment orders: value in, fiat out to somebody's bank.
--
-- This is the offramp business, rebuilt on the ledger. It used to be a
-- pipeline: deposit to a one-time Sui address, bridge to Base, hand to an
-- aggregator, wait for a liquidity provider to fill it. Every stage was a
-- place to get stuck, and the order's true state lived across four tables and
-- a bridge provider's API.
--
-- Now it is a composition of three things that already exist: a balance (the
-- ledger), a price (a quote), and a delivery (a payout). The order row records
-- which three.

BEGIN;

CREATE TYPE order_state AS ENUM (
    'pending',    -- created, not yet funded from the sender's balance
    'converting', -- an FX leg is being applied
    'paying',     -- a payout is in flight
    'settled',    -- the recipient's bank confirmed
    'refunded',   -- could not be delivered; value returned to the sender
    'cancelled'
);

CREATE TABLE orders (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id uuid NOT NULL,

    -- What the sender parts with, and what the recipient receives. Different
    -- currencies when an FX leg applies.
    sold_currency  currency NOT NULL,
    sold_minor     bigint   NOT NULL CHECK (sold_minor > 0),
    payout_currency currency NOT NULL,
    payout_minor    bigint  NOT NULL CHECK (payout_minor > 0),

    -- The quote that priced it, when a conversion was involved. Recorded so a
    -- settled order can be reconciled against the price the sender was shown.
    quote_id uuid REFERENCES fx_quotes (id),

    bank_code      text NOT NULL,
    account_number text NOT NULL,
    account_name   text NOT NULL,
    narration      text,

    state      order_state NOT NULL DEFAULT 'pending',
    payout_id  uuid REFERENCES payouts (id),
    failure    text,

    -- The integrator's own key. Their request times out, they retry, and the
    -- same key must return the same order rather than paying somebody twice.
    idem_key   text,

    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    settled_at timestamptz
);

CREATE UNIQUE INDEX orders_idem ON orders (sender_id, idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX orders_sender ON orders (sender_id, created_at DESC);
CREATE INDEX orders_open ON orders (state, updated_at)
    WHERE state IN ('pending', 'converting', 'paying');

COMMIT;
