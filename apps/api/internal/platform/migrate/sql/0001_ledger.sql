-- The ledger: the one place value moves, and the only record that decides
-- whether it did.
--
-- Every movement is a set of signed entries sharing a tx_id, and every set
-- must sum to exactly zero WITHIN EACH CURRENCY. The database enforces that
-- with a deferred constraint trigger, so an unbalanced write cannot be
-- committed even by a bug, a race, or a future refactor that forgets.
--
-- All amounts are integer minor units (kobo for NGN, cents for USD). Never
-- floats, never decimals in transit.

BEGIN;

-- ---------------------------------------------------------------- currencies

CREATE TYPE currency AS ENUM ('NGN', 'USD');

-- Who an account belongs to. Kept separate from the id so a system account can
-- have no owner without owner_id being overloaded to mean two things.
CREATE TYPE owner_kind AS ENUM ('user', 'agent', 'merchant', 'system');

-- Sign convention, and the whole vocabulary of the ledger:
--
--   user available     positive = spendable balance
--   user escrow        positive = locked, pending a physical handover
--   user obligation    NEGATIVE = the user owes the platform this much
--   agent_float        positive = capital an agent can hand out as cash
--   merchant_payable   positive = earned by a merchant, not yet paid to their bank
--   treasury           positive = platform capital available to settle with
--   fx_position        the platform's exposure between two currencies
--   revenue            positive = fees earned
--   loss_reserve       NEGATIVE = losses absorbed
--   payable            positive = owed to the outside world, not yet delivered
--   external           the world outside this system; the mirror of everything held inside
CREATE TYPE account_kind AS ENUM (
    'available', 'escrow', 'obligation',
    'agent_float',
    'merchant_payable',
    'treasury', 'fx_position', 'revenue', 'loss_reserve', 'payable', 'external'
);

-- ---------------------------------------------------------------- accounts

CREATE TABLE ledger_accounts (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Null for system accounts. Not a foreign key: users, agents and merchants
    -- live in ent-owned tables, and a ledger row must never be deleted by a
    -- cascade from one of them. An account with entries is a permanent record
    -- even if the party is gone.
    owner_id   uuid,
    owner_kind owner_kind   NOT NULL,
    kind       account_kind NOT NULL,
    currency   currency     NOT NULL,

    created_at timestamptz NOT NULL DEFAULT now(),

    -- A party has exactly one account of each kind per currency. NULLS NOT
    -- DISTINCT so the system accounts (owner_id IS NULL) are also unique.
    CONSTRAINT ledger_accounts_unique UNIQUE NULLS NOT DISTINCT (owner_id, kind, currency),

    -- The target of the composite foreign key from ledger_entries, which is
    -- what stops an entry being denominated differently from its account.
    CONSTRAINT ledger_accounts_id_currency UNIQUE (id, currency),

    -- System accounts have no owner; everything else has one. Getting this
    -- wrong would let a user's balance masquerade as platform capital.
    CONSTRAINT owner_matches_kind CHECK (
        (owner_kind = 'system' AND owner_id IS NULL
            AND kind IN ('treasury','fx_position','revenue','loss_reserve','payable','external'))
        OR
        (owner_kind = 'user' AND owner_id IS NOT NULL
            AND kind IN ('available','escrow','obligation'))
        OR
        (owner_kind = 'agent' AND owner_id IS NOT NULL
            AND kind IN ('agent_float','available'))
        OR
        (owner_kind = 'merchant' AND owner_id IS NOT NULL
            AND kind IN ('merchant_payable','available'))
    )
);

CREATE INDEX ledger_accounts_owner ON ledger_accounts (owner_id, currency)
    WHERE owner_id IS NOT NULL;

-- ---------------------------------------------------------------- transactions

-- A transaction is the unit that must balance, so it is a row rather than a
-- bare column repeated on every entry.
--
-- This is also the only correct home for idempotency. Attaching a key to a leg
-- would mean a two-leg payout needed two keys, and would leave "has this
-- movement happened" answerable only by convention about which leg to check.
CREATE TABLE ledger_transactions (
    id         uuid PRIMARY KEY,

    -- What in the outside world caused this: a tap, a transfer, a payout, a
    -- deposit. Deliberately a loose pair rather than a foreign key per kind,
    -- so a new movement type is traceable without a schema change.
    ref_type   text,
    ref_id     uuid,

    -- Set when this movement must happen at most once. A retried webhook, a
    -- replayed payout confirmation, or a reconciliation run twice by a nervous
    -- operator all present the same key and the second one is refused.
    --
    -- Null means "no idempotency guarantee needed" -- an ordinary transfer that
    -- the caller is not retrying. It is explicit and nullable rather than
    -- inferred from the text of a reason, because a reason that happened to
    -- contain a separator would otherwise become a silent, permanent
    -- uniqueness constraint on a human-readable string.
    idem_key   text UNIQUE,

    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ledger_transactions_ref ON ledger_transactions (ref_type, ref_id)
    WHERE ref_id IS NOT NULL;

-- ---------------------------------------------------------------- entries

CREATE TABLE ledger_entries (
    id           bigserial PRIMARY KEY,

    tx_id        uuid     NOT NULL REFERENCES ledger_transactions (id),

    account_id   uuid     NOT NULL,
    currency     currency NOT NULL,

    -- Positive credits the account, negative debits it. A zero-amount entry is
    -- not a movement and is rejected rather than stored as noise.
    amount_minor bigint   NOT NULL CHECK (amount_minor <> 0),

    -- What this leg was for, in a stable vocabulary: 'tap.debit', 'fx.spread',
    -- 'escrow.lock'. Read by the audit view and by humans reconciling; never
    -- parsed for control flow.
    reason       text     NOT NULL CHECK (reason <> ''),

    created_at   timestamptz NOT NULL DEFAULT now(),

    -- Denormalising the currency onto the entry is what makes the per-currency
    -- balance check cheap. This composite key is what keeps it honest: an
    -- entry cannot claim a currency its account does not hold.
    CONSTRAINT entry_currency_matches_account
        FOREIGN KEY (account_id, currency) REFERENCES ledger_accounts (id, currency)
);

CREATE INDEX ledger_entries_tx      ON ledger_entries (tx_id);
CREATE INDEX ledger_entries_account ON ledger_entries (account_id, created_at DESC);

-- ---------------------------------------------------------------- the invariant

-- Enforced by the database rather than by convention, and deferred so a
-- multi-statement transaction can build up all its legs before being judged.
--
-- The GROUP BY carries currency, which is the entire multi-currency change: a
-- conversion is ONE transaction with two currency legs, and each leg must sum
-- to zero on its own. A transaction that balanced only in total would let
-- dollars be created by destroying naira.
CREATE OR REPLACE FUNCTION assert_ledger_balanced() RETURNS trigger AS $fn$
DECLARE
    offending_currency currency;
    delta              bigint;
BEGIN
    SELECT e.currency, SUM(e.amount_minor)
      INTO offending_currency, delta
      FROM ledger_entries e
     WHERE e.tx_id = NEW.tx_id
     GROUP BY e.currency
    HAVING SUM(e.amount_minor) <> 0
     LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION
            'unbalanced ledger transaction %: % entries sum to % minor units, must be 0',
            NEW.tx_id, offending_currency, delta;
    END IF;
    RETURN NULL;
END;
$fn$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER ledger_must_balance
    AFTER INSERT ON ledger_entries
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION assert_ledger_balanced();

-- ---------------------------------------------------------------- balances

-- A VIEW, not a table. A materialised balance is a second source of truth that
-- can drift from the entries that produced it; this one cannot, by
-- construction. Where the read cost matters, it is paid at query time against
-- an index rather than at write time against correctness.
CREATE VIEW ledger_balances AS
    SELECT a.id AS account_id,
           a.owner_id,
           a.owner_kind,
           a.kind,
           a.currency,
           COALESCE(SUM(e.amount_minor), 0)::bigint AS balance_minor
      FROM ledger_accounts a
      LEFT JOIN ledger_entries e ON e.account_id = a.id
     GROUP BY a.id, a.owner_id, a.owner_kind, a.kind, a.currency;

COMMIT;
