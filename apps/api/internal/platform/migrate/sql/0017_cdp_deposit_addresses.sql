-- Deposit addresses come from CDP. The seed-derived ones are retired, not
-- deleted.
--
-- # Why retired and not replaced
--
-- A deposit address is not ours to withdraw once somebody has it. People save
-- them as payees, paste them into exchanges, and hand them to whoever is
-- paying them. The watcher builds its log filter from THIS TABLE, so a row
-- that disappears is an address that stops being watched -- and a transfer to
-- an unwatched address produces no row, no log line and no alert. The money
-- arrives, leaves the sender's account, and this system never hears about it.
--
-- So a retired address keeps its row. It is still watched, still credited, and
-- still sweepable with the seed. What retiring changes is only which address
-- is handed out NEXT.
--
-- # Why one row per user had to go
--
-- The old primary key was user_id, which made "one address per person" a
-- schema fact. Reissuing needs a person to have exactly one CURRENT address
-- and any number of retired ones, so the key moves to the address itself --
-- which is what the rest of the system actually looks things up by -- and a
-- partial unique index carries the one-current-per-user rule instead.

BEGIN;

ALTER TABLE base_deposit_addresses
    ADD COLUMN retired_at timestamptz;

COMMENT ON COLUMN base_deposit_addresses.retired_at IS
    'When this address stopped being handed out. Still watched and still swept; NULL means current.';

-- The address is the natural key: every lookup that matters -- the webhook,
-- the sweeper, the watcher's ownership check -- arrives holding an address and
-- asks who it belongs to.
ALTER TABLE base_deposit_addresses DROP CONSTRAINT base_deposit_addresses_pkey;
ALTER TABLE base_deposit_addresses DROP CONSTRAINT base_deposit_addresses_address_key;
ALTER TABLE base_deposit_addresses ADD PRIMARY KEY (address);

-- Exactly one current address per person. Retired rows are unconstrained:
-- somebody who has been reissued twice has two of them.
CREATE UNIQUE INDEX base_deposit_addresses_current
    ON base_deposit_addresses (user_id) WHERE retired_at IS NULL;

-- The lookup the sweeper and the reissue path both do.
CREATE INDEX base_deposit_addresses_user ON base_deposit_addresses (user_id);

-- Retire every seed-derived address. The next read of /v1/deposits/address
-- issues a CDP Smart Account in its place.
--
-- Done here rather than left to the code so the database states the intent
-- plainly: after this migration no derived address is current anywhere, and a
-- deployment cannot drift back by accident. The code retires stragglers on
-- read anyway, which makes this a head start rather than a requirement.
UPDATE base_deposit_addresses
   SET retired_at = now()
 WHERE provider = 'derived' AND retired_at IS NULL;

COMMIT;
