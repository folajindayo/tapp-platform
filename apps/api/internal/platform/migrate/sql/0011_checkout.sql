-- Phone-to-phone payments: a merchant asks for an amount, a payer approves it.
--
-- The same movement as a card tap, initiated differently. A card is present
-- and authenticates itself; here the payer is holding their own phone and
-- authenticates as themselves, which is stronger. What both share is that the
-- ledger decides, in one transaction, and settlement follows on its own clock.
--
-- The predecessor created a Sui receive address per request and waited for an
-- on-chain deposit to a one-time address, then bridged it to Base and settled
-- through an aggregator. Deposits land on Base directly now and balances live
-- in the ledger, so a payer with a balance simply pays from it.

BEGIN;

CREATE TYPE checkout_state AS ENUM (
    'open',      -- broadcast, waiting for somebody to pay
    'paid',      -- a payer approved it; the merchant is owed
    'expired',   -- nobody paid in time
    'cancelled'  -- the merchant withdrew it
);

CREATE TABLE checkouts (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id uuid NOT NULL,

    currency     currency NOT NULL,
    amount_minor bigint   NOT NULL CHECK (amount_minor > 0),
    fee_minor    bigint   NOT NULL DEFAULT 0 CHECK (fee_minor >= 0),
    narration    text,

    state       checkout_state NOT NULL DEFAULT 'open',

    -- Who paid, once somebody has.
    payer_id     uuid,
    ledger_tx_id uuid REFERENCES ledger_transactions (id),

    -- The merchant app supplies this so a lost response cannot become a second
    -- charge: it broadcasts a request, the response is dropped, it retries,
    -- and the same key returns the same checkout rather than opening another.
    idem_key    text,

    expires_at  timestamptz NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    paid_at     timestamptz
);

CREATE UNIQUE INDEX checkouts_idem ON checkouts (merchant_id, idem_key)
    WHERE idem_key IS NOT NULL;
CREATE INDEX checkouts_merchant ON checkouts (merchant_id, created_at DESC);
CREATE INDEX checkouts_open ON checkouts (state, expires_at) WHERE state = 'open';

COMMIT;
