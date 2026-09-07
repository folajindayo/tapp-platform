-- USDC deposits on Base.
--
-- Each user gets their own derived address so a payment can be attributed on
-- chain without asking anybody to quote a reference. The funds are swept into
-- one pooled treasury, so there is ONE key to protect rather than one per
-- account.
--
-- Addresses are DERIVED, not stored as keys. Only the index is kept: given the
-- master seed, the address and its key are reproducible, so nothing needs
-- backing up except the seed and losing this table does not lose anybody's
-- money. The predecessor generated a secp256k1 key per signup and sealed each
-- one with a master key that was a literal in the source.

BEGIN;

CREATE TABLE base_deposit_addresses (
    user_id     uuid PRIMARY KEY,

    -- The BIP-32 index this user's address is derived at. Monotonic and never
    -- reused: two users at one index would share an address and their
    -- deposits would be indistinguishable.
    index       bigint NOT NULL UNIQUE CHECK (index >= 0),

    -- Cached so a lookup does not have to re-derive, and so an operator can
    -- read the table without the seed. Checked against the derivation on use.
    address     text NOT NULL UNIQUE CHECK (address ~ '^0x[0-9a-fA-F]{40}$'),

    created_at  timestamptz NOT NULL DEFAULT now()
);

-- The allocator takes the next index under a lock. A sequence would be simpler
-- and would also skip numbers on rollback, and a skipped index is an address
-- somebody might already have been shown.
CREATE TABLE base_deposit_counter (
    id        boolean PRIMARY KEY DEFAULT true CHECK (id),
    next_index bigint NOT NULL DEFAULT 0
);
INSERT INTO base_deposit_counter (id, next_index) VALUES (true, 0);

-- ---------------------------------------------------------------- observed deposits

CREATE TYPE base_deposit_state AS ENUM (
    'seen',      -- a transfer log was observed, not yet confirmed enough
    'credited',  -- confirmed and posted to the ledger
    'swept',     -- moved from the derived address into the treasury
    'failed'     -- the sweep could not be completed; needs an operator
);

CREATE TABLE base_deposits (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid NOT NULL,

    -- The chain's own identity for this transfer. Unique, and it is what makes
    -- a restarted watcher safe: re-scanning a block it already processed finds
    -- the row and does nothing rather than crediting twice.
    tx_hash       text   NOT NULL,
    log_index     bigint NOT NULL,
    UNIQUE (tx_hash, log_index),

    from_address  text   NOT NULL,
    to_address    text   NOT NULL,
    -- USDC has six decimals; the ledger's USD minor unit has two. The
    -- conversion happens once, here, at credit time.
    amount_micro  bigint NOT NULL CHECK (amount_micro > 0),

    block_number  bigint NOT NULL,
    state         base_deposit_state NOT NULL DEFAULT 'seen',

    ledger_tx_id  uuid REFERENCES ledger_transactions (id),
    sweep_tx_hash text,
    last_error    text,

    seen_at       timestamptz NOT NULL DEFAULT now(),
    credited_at   timestamptz,
    swept_at      timestamptz
);

CREATE INDEX base_deposits_user ON base_deposits (user_id, seen_at DESC);
CREATE INDEX base_deposits_pending ON base_deposits (state, block_number)
    WHERE state IN ('seen', 'credited');

-- Where the watcher has read up to. One row.
CREATE TABLE base_watcher_state (
    id           boolean PRIMARY KEY DEFAULT true CHECK (id),
    last_block   bigint NOT NULL DEFAULT 0,
    updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO base_watcher_state (id, last_block) VALUES (true, 0);

COMMIT;
