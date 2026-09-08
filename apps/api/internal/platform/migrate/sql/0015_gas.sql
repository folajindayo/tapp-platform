-- Gas: what on-chain work costs, and keeping the wallet that pays for it fed.
--
-- Every transaction this platform submits costs ETH. That cost is real, it is
-- ours, and until now it was invisible: nothing recorded it and nothing
-- watched the balance it came out of.
--
-- Two things are deliberately kept apart here.
--
-- The EXACT cost is in wei, taken from the receipt. It needs no price feed and
-- cannot drift: gas_used x effective_gas_price is what the chain charged, and
-- it is the same number in a year.
--
-- The LEDGER cost is in USD and needs an ETH price. There is no ETH price
-- source configured today, so a row can be recorded exactly and posted later.
-- The alternative -- converting at a guessed rate so the ledger looks complete
-- -- would put a number in the books that nothing can reproduce.

BEGIN;

-- ---------------------------------------------------------------- spend

CREATE TABLE gas_transactions (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- What this gas bought, in the same loose pair the ledger uses for its own
    -- provenance: a new kind of on-chain work is traceable without a schema
    -- change. e.g. ('sweep', <deposit id>), ('withdrawal', <withdrawal id>).
    ref_type      text NOT NULL CHECK (ref_type <> ''),
    ref_id        uuid,

    tx_hash       text NOT NULL,
    chain_id      bigint NOT NULL,

    -- The chain's own numbers. gas_used and effective_gas_price are read from
    -- the receipt, never estimated: an estimate is what we expected to pay and
    -- this column is what we did pay.
    gas_used            bigint NOT NULL CHECK (gas_used > 0),
    effective_gas_price numeric(78,0) NOT NULL CHECK (effective_gas_price > 0),
    cost_wei            numeric(78,0) NOT NULL CHECK (cost_wei > 0),

    -- Set once the cost has been posted to the ledger. NULL means "recorded
    -- exactly, not yet priced" -- a normal state, not a failure.
    ledger_tx_id  uuid,
    cost_usd_minor bigint,
    eth_usd_rate  numeric(38,18),

    -- Whether the transaction the gas paid for actually succeeded. Gas is
    -- charged either way, and a reverted transaction we paid for is exactly
    -- the thing worth being able to count.
    succeeded     boolean NOT NULL,

    created_at    timestamptz NOT NULL DEFAULT now(),

    -- One row per transaction. A receipt read twice must not bill us twice.
    CONSTRAINT gas_transactions_unique UNIQUE (chain_id, tx_hash),

    -- Either fully posted or not posted at all. A row with a ledger id but no
    -- amount, or an amount with no rate, is a half-truth nobody can audit.
    CONSTRAINT gas_posted_together CHECK (
        (ledger_tx_id IS NULL AND cost_usd_minor IS NULL AND eth_usd_rate IS NULL)
     OR (ledger_tx_id IS NOT NULL AND cost_usd_minor IS NOT NULL AND eth_usd_rate IS NOT NULL)
    )
);

CREATE INDEX gas_transactions_ref     ON gas_transactions (ref_type, ref_id);
CREATE INDEX gas_transactions_unposted ON gas_transactions (created_at)
    WHERE ledger_tx_id IS NULL;

-- ---------------------------------------------------------------- refills

-- Every top-up of a gas wallet, and what it cost.
--
-- The row exists to be counted. Automated replenishment without a rate limit
-- is a drain loop: force spend, trigger refill, repeat, and the only thing
-- that stops it is somebody noticing the bill. Counting rows in a window is
-- what makes "at most N refills a day" enforceable rather than aspirational.
CREATE TABLE gas_wallet_refills (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet      text NOT NULL CHECK (wallet <> ''),
    chain_id    bigint NOT NULL,
    amount_wei  numeric(78,0) NOT NULL CHECK (amount_wei > 0),
    tx_hash     text,
    reason      text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX gas_wallet_refills_window ON gas_wallet_refills (wallet, created_at DESC);

-- ---------------------------------------------------------------- limits

-- Per-party sponsorship allowance, in a rolling window.
--
-- In Postgres rather than in process memory, which is the whole point. A cap
-- held in a map is enforced once per replica: ten instances enforce ten times
-- the limit it was written to impose, and a restart returns everybody to
-- zero. Here the claim is an UPDATE with the cap in its WHERE clause, so the
-- database refuses the overspend under concurrency and every instance shares
-- one answer.
CREATE TABLE gas_sponsorship_limits (
    owner_id     uuid PRIMARY KEY,
    window_start timestamptz NOT NULL DEFAULT now(),
    spent_minor  bigint      NOT NULL DEFAULT 0 CHECK (spent_minor >= 0),
    currency     currency    NOT NULL
);

COMMIT;
