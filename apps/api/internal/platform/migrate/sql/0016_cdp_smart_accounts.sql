-- Deposit addresses that are CDP Smart Accounts.
--
-- Until now every deposit address was an EOA derived from BASE_DEPOSIT_SEED at
-- a BIP-32 index. A Smart Account is different in the two ways that matter
-- here: its key never touches this process (it lives in CDP's TEE), and a
-- paymaster can pay its gas, so sweeping it needs no ETH anywhere.
--
-- This is additive and touches no existing row. The derived addresses already
-- issued keep working exactly as before -- they are swept with a permit, they
-- carry funds, and people have them saved as payees. Changing them would be a
-- migration of live money, and this is not that.

BEGIN;

ALTER TABLE base_deposit_addresses
    -- Which mechanism produced the address, and therefore how it is swept.
    -- Defaulted so the fourteen rows that already exist are labelled truthfully
    -- without being rewritten.
    ADD COLUMN provider      text NOT NULL DEFAULT 'derived',

    -- The CDP EVM account that owns the Smart Account and signs for it. Kept
    -- so an operator can trace a Smart Account back to its owner in the CDP
    -- console without this service holding any key material.
    ADD COLUMN owner_address text,

    -- The name the Smart Account was created under. CDP guarantees names are
    -- unique per project, which makes them the recovery key: a run that
    -- created the account but failed before this row was written can find it
    -- again by name rather than creating a second one.
    ADD COLUMN account_name  text;

-- A Smart Account has no BIP-32 index. It was never derived from anything.
ALTER TABLE base_deposit_addresses ALTER COLUMN index DROP NOT NULL;

ALTER TABLE base_deposit_addresses
    ADD CONSTRAINT base_deposit_addresses_provider
        CHECK (provider IN ('derived', 'cdp')),

    -- The two shapes are mutually exclusive. A derived row has an index and no
    -- owner; a cdp row has an owner and a name and no index. Anything else is
    -- a row that half-belongs to each mechanism and can be swept by neither.
    ADD CONSTRAINT base_deposit_addresses_shape CHECK (
        (provider = 'derived' AND index IS NOT NULL
            AND owner_address IS NULL AND account_name IS NULL)
     OR (provider = 'cdp' AND index IS NULL
            AND owner_address ~ '^0x[0-9a-fA-F]{40}$' AND account_name <> '')
    ),

    -- Names are the recovery key, so two rows must never claim one.
    ADD CONSTRAINT base_deposit_addresses_account_name UNIQUE (account_name);

COMMIT;
