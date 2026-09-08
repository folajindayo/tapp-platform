-- A cardholder's own bank account number, for funding a balance by NGN
-- transfer.
--
-- The third funding route named in the README, alongside cash handed to an
-- agent and USDC on Base. Deposits by transfer land in the platform's pooled
-- account at the rail; this table is what says whose they were.
--
-- The rail opens a customer wallet per person and reports credits against it,
-- but this ledger -- not the rail's balance -- is what says what somebody has.
-- A rail balance is a second source of truth that can drift from the entries
-- that produced it, which is the same reason ledger_balances is a view.
--
-- The inbound webhook naming this account number is how a credit finds its
-- owner, which is why the row must outlive any rail switch.

BEGIN;

CREATE TABLE ngn_deposit_accounts (
    -- One account per person. A second would be a second thing to reconcile
    -- and a second answer to "where do I send my money".
    user_id        uuid PRIMARY KEY,

    -- Stored per row rather than read from configuration at lookup time.
    -- services.CurrentFloatRail() can be switched at runtime, and an account
    -- issued under the previous rail must still credit after the switch --
    -- somebody has it saved as a payee.
    rail           text NOT NULL CHECK (rail <> ''),

    account_number text NOT NULL CHECK (account_number <> ''),
    bank_name      text NOT NULL,
    account_name   text NOT NULL,

    -- The rail's own id for this account, for support and reconciliation.
    rail_ref       text NOT NULL,

    created_at     timestamptz NOT NULL DEFAULT now(),

    -- Two people must never share an account number on the same rail, or an
    -- inbound credit has two owners and the webhook has to guess. Scoped by
    -- rail because numbers are only unique within a provider.
    CONSTRAINT ngn_deposit_accounts_unique UNIQUE (rail, account_number)
);

-- The webhook looks up by account number alone: an inbound event names the
-- account that was credited, not the person.
CREATE INDEX ngn_deposit_accounts_number ON ngn_deposit_accounts (account_number);

COMMIT;
