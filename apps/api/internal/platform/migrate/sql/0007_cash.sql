-- Cash pledges: a photograph of banknotes, and what became of them.
--
-- The photograph is EVIDENCE, never collateral. It cannot secure value and is
-- not treated as though it does. Anyone can photograph a stranger's cash, a
-- shop's till, or a picture off the internet, so any design where the image
-- moves money collapses under the first hostile question.
--
-- What actually settles a pledge is a physical handover to an accountable
-- agent at known premises, confirmed by both sides. Recognition is a
-- pre-filter: it catches wrong amounts and obvious replays so people do not
-- waste a trip.

BEGIN;

-- An agent's float is locked into escrow while a trader walks to them, so
-- agents need an escrow account. The original constraint listed only
-- agent_float and available, because at the time nothing locked an agent's
-- capital -- the lock is what makes an offered handover a real commitment
-- rather than a hope.
ALTER TABLE ledger_accounts DROP CONSTRAINT owner_matches_kind;
ALTER TABLE ledger_accounts ADD CONSTRAINT owner_matches_kind CHECK (
    (owner_kind = 'system' AND owner_id IS NULL
        AND kind IN ('treasury','fx_position','revenue','loss_reserve','payable','external'))
    OR
    (owner_kind = 'user' AND owner_id IS NOT NULL
        AND kind IN ('available','escrow','obligation'))
    OR
    (owner_kind = 'agent' AND owner_id IS NOT NULL
        AND kind IN ('agent_float','available','escrow'))
    OR
    (owner_kind = 'merchant' AND owner_id IS NOT NULL
        AND kind IN ('merchant_payable','available'))
);

CREATE TYPE pledge_state AS ENUM (
    'screening',   -- photograph accepted, being assessed
    'open',        -- assessed and awaiting an agent
    'matched',     -- an agent has accepted; their float is locked
    'handed_over', -- one side has confirmed the physical handover
    'settled',     -- both confirmed; the trader has been credited
    'expired',     -- nobody came; the agent's float was released
    'refused',     -- screening or an agent rejected the notes
    'disputed'     -- somebody reported a problem; funds are held
);

CREATE TABLE cash_pledges (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Human-facing reference, so somebody can quote it over a phone.
    ref           bigserial NOT NULL UNIQUE,

    trader_id     uuid NOT NULL,

    currency      currency NOT NULL,
    -- What the trader said they were pledging, and what recognition counted.
    -- Kept apart on purpose: a disagreement is the single most useful signal
    -- there is, and averaging them away would destroy it.
    declared_minor bigint NOT NULL CHECK (declared_minor > 0),
    counted_minor  bigint,

    state         pledge_state NOT NULL DEFAULT 'screening',

    -- Where the trader was, so an agent can be found near them.
    lat           double precision NOT NULL CHECK (lat BETWEEN 4 AND 14),
    lng           double precision NOT NULL CHECK (lng BETWEEN 2 AND 15),

    -- The photograph's identity, not the photograph. Storing every image of
    -- somebody's cash forever is not a trade worth making; the hash is enough
    -- to recognise the same one again.
    image_sha256  text NOT NULL,
    image_dhash   text NOT NULL,

    -- What the risk engine concluded.
    risk_id       uuid,
    risk_score    int CHECK (risk_score BETWEEN 0 AND 100),
    refused_reason text,

    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    expires_at    timestamptz NOT NULL,
    settled_at    timestamptz
);

CREATE INDEX cash_pledges_trader ON cash_pledges (trader_id, created_at DESC);
CREATE INDEX cash_pledges_open ON cash_pledges (state, expires_at)
    WHERE state IN ('open', 'matched', 'handed_over');

-- The same photograph cannot open two pledges at once.
CREATE UNIQUE INDEX cash_pledges_image_live ON cash_pledges (image_sha256)
    WHERE state IN ('screening', 'open', 'matched', 'handed_over');

-- ---------------------------------------------------------------- note registry

-- Individual banknotes claimed by a pledge.
--
-- While a note is claimed it cannot appear in another live pledge. This one
-- constraint is the double-spend guard: photographing the same cash twice is
-- the most obvious attack on this product, and it is refused by the database
-- rather than by a check somebody might forget to write.
CREATE TABLE pledged_notes (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pledge_id      uuid NOT NULL REFERENCES cash_pledges (id) ON DELETE CASCADE,

    currency       currency NOT NULL,
    denomination_minor bigint NOT NULL CHECK (denomination_minor > 0),

    -- The serial when it could be read. Often it cannot: a phone photograph of
    -- notes on a table rarely resolves them.
    serial         text,
    serial_confidence real NOT NULL DEFAULT 0,

    -- Which is why the perceptual hash exists alongside. A re-uploaded
    -- photograph is caught even when no serial was legible.
    note_phash     text NOT NULL,

    -- Released when the pledge closes, freeing the note to be pledged again --
    -- which is correct: the trader still has it, or the agent now does.
    released       boolean NOT NULL DEFAULT false,
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pledged_notes_pledge ON pledged_notes (pledge_id);

-- A legible serial is the strong identifier.
CREATE UNIQUE INDEX pledged_notes_serial_live ON pledged_notes (serial)
    WHERE NOT released AND serial IS NOT NULL;

-- The perceptual hash catches replays where no serial could be read.
CREATE UNIQUE INDEX pledged_notes_phash_live ON pledged_notes (note_phash)
    WHERE NOT released;

-- ---------------------------------------------------------------- handovers

CREATE TYPE handover_state AS ENUM (
    'proposed', 'trader_confirmed', 'agent_confirmed', 'completed', 'expired', 'refused', 'disputed'
);

CREATE TABLE cash_handovers (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pledge_id    uuid NOT NULL REFERENCES cash_pledges (id) ON DELETE CASCADE,
    agent_id     uuid NOT NULL,

    currency     currency NOT NULL,
    amount_minor bigint   NOT NULL CHECK (amount_minor > 0),

    -- Spoken aloud at the counter. Six digits: long enough not to be guessed
    -- inside the window, short enough to read off a screen and say once.
    code         text NOT NULL,

    distance_m   int NOT NULL DEFAULT 0,
    state        handover_state NOT NULL DEFAULT 'proposed',

    trader_confirmed_at timestamptz,
    agent_confirmed_at  timestamptz,
    refused_reason      text,

    -- The ledger transaction that locked the agent's float, and the one that
    -- settled or released it.
    lock_tx_id   uuid REFERENCES ledger_transactions (id),
    settle_tx_id uuid REFERENCES ledger_transactions (id),

    expires_at   timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- A pledge can only have one live handover at a time.
CREATE UNIQUE INDEX cash_handovers_live ON cash_handovers (pledge_id)
    WHERE state IN ('proposed', 'trader_confirmed', 'agent_confirmed');

CREATE INDEX cash_handovers_agent ON cash_handovers (agent_id, state);
CREATE INDEX cash_handovers_expiry ON cash_handovers (expires_at)
    WHERE state IN ('proposed', 'trader_confirmed', 'agent_confirmed');

COMMIT;
