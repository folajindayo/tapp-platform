-- USDC leaving the treasury for a user's own address.
--
-- The ledger is debited first, in its own transaction, before anything is sent
-- on chain. That ordering is the safe one: a debit with no send is money we
-- still hold and can return, whereas a send with no debit is money gone that
-- nobody paid for. A failed send reverses the debit.

BEGIN;

CREATE TYPE base_withdrawal_state AS ENUM ('pending', 'sending', 'sent', 'failed');

CREATE TABLE base_withdrawals (
    id           uuid PRIMARY KEY,
    user_id      uuid NOT NULL,

    amount_micro bigint NOT NULL CHECK (amount_micro > 0),
    to_address   text   NOT NULL CHECK (to_address ~ '^0x[0-9a-fA-F]{40}$'),

    state        base_withdrawal_state NOT NULL DEFAULT 'pending',
    tx_hash      text,
    last_error   text,

    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    sent_at      timestamptz
);

CREATE INDEX base_withdrawals_user ON base_withdrawals (user_id, created_at DESC);
CREATE INDEX base_withdrawals_queue ON base_withdrawals (state, created_at)
    WHERE state IN ('pending', 'sending');

COMMIT;
