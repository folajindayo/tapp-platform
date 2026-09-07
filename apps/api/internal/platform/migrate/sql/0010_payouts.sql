-- Money leaving for somebody's bank account.
--
-- The ledger says what is owed; this table tracks the attempt to deliver it.
-- They are separate because delivery is the part that can fail halfway: a
-- request that timed out may or may not have moved money, and a ledger with no
-- room to say "we asked, we do not yet know" would have to guess.

BEGIN;

CREATE TYPE payout_state AS ENUM (
    'pending',    -- owed, nothing sent to the provider yet
    'submitting', -- a request is in flight; nothing else may send this one
    'unknown',    -- the request timed out; it may or may not have moved money
    'sent',       -- the provider accepted it, the bank has not confirmed
    'confirmed',  -- the money reached the account
    'failed'      -- the provider refused on the merits; no money moved
);

CREATE TABLE payouts (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Who is being paid, and on whose behalf.
    beneficiary_kind text NOT NULL CHECK (beneficiary_kind IN ('merchant', 'user')),
    beneficiary_id   uuid NOT NULL,

    currency     currency NOT NULL,
    amount_minor bigint   NOT NULL CHECK (amount_minor > 0),

    bank_code      text NOT NULL,
    account_number text NOT NULL,
    -- What the BANK returned for the number, never what anybody typed. It is
    -- the thing a person checks before money moves.
    account_name   text NOT NULL,
    narration      text,

    state        payout_state NOT NULL DEFAULT 'pending',

    -- The provider's identifiers. Both unique when present, so a redelivered
    -- webhook cannot be mistaken for a second payout.
    provider          text,
    provider_ref      text,
    provider_session  text,

    attempts     int  NOT NULL DEFAULT 0,
    last_error   text,

    -- The ledger movement that put this value into `payable`, and the one that
    -- discharged it.
    reserve_tx_id uuid REFERENCES ledger_transactions (id),
    settle_tx_id  uuid REFERENCES ledger_transactions (id),

    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    submitted_at timestamptz,
    settled_at   timestamptz
);

CREATE UNIQUE INDEX payouts_provider_ref     ON payouts (provider, provider_ref)     WHERE provider_ref IS NOT NULL;
CREATE UNIQUE INDEX payouts_provider_session ON payouts (provider, provider_session) WHERE provider_session IS NOT NULL;

-- The worker's queue: anything not yet in a final state.
CREATE INDEX payouts_needing_attention ON payouts (state, updated_at)
    WHERE state IN ('pending', 'submitting', 'unknown', 'sent');

-- Provider events are recorded before they are acted on, and the provider's
-- own reference is unique, so a redelivery is recognised rather than applied
-- twice. Providers retry for days; redelivery is normal, not exceptional.
CREATE TABLE provider_events (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    provider     text NOT NULL,
    event_type   text NOT NULL,
    reference    text NOT NULL,
    payload      jsonb NOT NULL,
    received_at  timestamptz NOT NULL DEFAULT now(),
    processed_at timestamptz,
    error        text,
    UNIQUE (provider, event_type, reference)
);

CREATE INDEX provider_events_unprocessed ON provider_events (received_at)
    WHERE processed_at IS NULL;

COMMIT;
