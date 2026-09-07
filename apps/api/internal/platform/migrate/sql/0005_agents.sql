-- The agent network: the people and shopfronts market traders hand cash to.
--
-- Generalises tender's `venues`. The design decision it carries forward is
-- that a handover happens at FIXED, PUBLICLY KNOWN PREMISES with somebody
-- accountable for them -- never at a coordinate one party typed in for one
-- transaction.
--
-- That is not a convenience. Escrow is a financial control: it can guarantee
-- nobody loses money on paper, and it is powerless against somebody who takes
-- the notes and simply never confirms. Before venues existed that attack was
-- not merely possible but free -- the match expired, the attacker's escrow
-- came back, and they kept the cash. What closes it is that the counterparty
-- is an accountable operator at a known address.

BEGIN;

CREATE TYPE agent_kind AS ENUM ('agent', 'bank', 'filling_station', 'market_office', 'pharmacy', 'supermarket');

CREATE TABLE agents (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- The person accountable for these premises. Not a foreign key to the
    -- ent-owned users table for the same reason ledger accounts are not: an
    -- agent's history must outlive the account that registered it.
    operator_id uuid NOT NULL,

    name        text NOT NULL CHECK (name <> ''),
    kind        agent_kind NOT NULL DEFAULT 'agent',
    address     text NOT NULL CHECK (address <> ''),
    phone       text,

    -- Bounded to Nigeria. A coordinate outside it is a client bug or somebody
    -- probing, and either way is not a shopfront a trader can walk to.
    lat         double precision NOT NULL CHECK (lat BETWEEN 4 AND 14),
    lng         double precision NOT NULL CHECK (lng BETWEEN 2 AND 15),

    -- Handovers happen while premises are staffed and busy.
    opens_at    time NOT NULL DEFAULT '08:00',
    closes_at   time NOT NULL DEFAULT '18:00',
    CHECK (opens_at < closes_at),

    -- An agent is not usable until somebody has confirmed the premises exist.
    -- Registration is open; verification is not.
    verified    boolean NOT NULL DEFAULT false,
    verified_at timestamptz,
    active      boolean NOT NULL DEFAULT true,

    -- Reputation, maintained from completed and disputed handovers.
    settled_count  int NOT NULL DEFAULT 0,
    disputed_count int NOT NULL DEFAULT 0,

    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- One agent per operator per address: registering the same shopfront twice
-- would split its reputation and its float across two rows.
CREATE UNIQUE INDEX agents_operator_address ON agents (operator_id, lower(address));

-- The nearby query filters on these before measuring distance.
CREATE INDEX agents_usable ON agents (active, verified, lat, lng)
    WHERE active AND verified;

COMMIT;
