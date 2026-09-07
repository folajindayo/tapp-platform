-- A record of every card payment, written in the same transaction as the
-- ledger entries it accompanies.
--
-- This exists so the daily limit can be DERIVED rather than counted. The
-- predecessor kept `spent_today_subunit` on the card row: a number incremented
-- after each debit, outside any transaction, and compared against the cap
-- before it. Two concurrent taps therefore read the same figure, both found
-- room, and both charged. Its companion `day_index` was written but never
-- compared, so the counter never reset -- a card that reached its daily limit
-- stayed there permanently.
--
-- Summing this table instead cannot drift from the ledger, because a row here
-- and the entries it references commit together or not at all, and it cannot
-- be raced, because the same transaction holds the lock on the account being
-- spent.

BEGIN;

CREATE TABLE card_taps (
    id            uuid PRIMARY KEY,

    -- Not foreign keys to the ent-owned tables. A tap is a financial record
    -- and must outlive the card that made it, the merchant that took it and
    -- the account it was charged to -- the same reason ledger_accounts.owner_id
    -- is not one.
    card_id       uuid NOT NULL,
    cardholder_id uuid NOT NULL,
    merchant_id   uuid NOT NULL,

    currency      currency NOT NULL,
    amount_minor  bigint   NOT NULL CHECK (amount_minor > 0),
    fee_minor     bigint   NOT NULL CHECK (fee_minor >= 0),

    -- Which authentication the amount required, recorded as resolved at the
    -- time. Limits change; what a given tap was held to should not.
    tier          text NOT NULL CHECK (tier IN ('none', 'pin', 'step_up')),

    -- The movement this tap caused. The join back to the money.
    ledger_tx_id  uuid NOT NULL REFERENCES ledger_transactions (id),

    -- The nonce this tap consumed, so a disputed charge can be traced back to
    -- the specific challenge the cardholder answered.
    nonce         bytea,

    created_at    timestamptz NOT NULL DEFAULT now()
);

-- The daily-spend query: everything on one card since the start of the day.
CREATE INDEX card_taps_daily ON card_taps (card_id, created_at DESC);
CREATE INDEX card_taps_merchant ON card_taps (merchant_id, created_at DESC);
CREATE UNIQUE INDEX card_taps_ledger_tx ON card_taps (ledger_tx_id);

-- ---------------------------------------------------------------- reversals

CREATE TABLE card_tap_reversals (
    id           uuid PRIMARY KEY,
    -- One reversal per tap. A tap cannot be refunded twice, and this is where
    -- that is enforced rather than in whichever handler happens to run.
    tap_id       uuid NOT NULL UNIQUE REFERENCES card_taps (id),
    reason       text NOT NULL CHECK (reason <> ''),
    ledger_tx_id uuid NOT NULL REFERENCES ledger_transactions (id),
    created_at   timestamptz NOT NULL DEFAULT now()
);

COMMIT;
