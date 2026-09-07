-- Card linking as one resumable session.
--
-- Linking used to be four screens each POSTing to a different endpoint, with
-- the server holding no state between them. Any dropped connection meant
-- starting the whole ceremony again -- and the ceremony includes generating a
-- secret, writing it to a chip over NFC, and committing a PIN proof, so
-- restarting it is not free.
--
-- One session row makes the flow idempotent and resumable: the client can ask
-- where it got to, and each step is a transition that either happened or did
-- not.

BEGIN;

CREATE TYPE link_state AS ENUM (
    'started',      -- the card is claimed by this user, nothing written yet
    'provisioned',  -- the client has committed its proofs; the card may be written
    'activated',    -- the write was confirmed and read back; the card is live
    'abandoned',    -- expired or replaced by a newer session
    'failed'        -- a step could not be completed
);

CREATE TABLE card_link_sessions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    card_id     uuid NOT NULL,
    user_id     uuid NOT NULL,

    state       link_state NOT NULL DEFAULT 'started',

    -- The token the client must write to the chip. Issued at provisioning so
    -- that a client which loses its connection mid-write can ask for it again
    -- rather than starting over with a different one.
    write_token bytea,

    failure     text,

    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    expires_at  timestamptz NOT NULL
);

-- One live session per card. Two concurrent ceremonies on one chip would race
-- to write different secrets to it, and whichever lost would leave a card its
-- holder believes is linked and the server does not recognise.
CREATE UNIQUE INDEX card_link_sessions_live ON card_link_sessions (card_id)
    WHERE state IN ('started', 'provisioned');

CREATE INDEX card_link_sessions_user ON card_link_sessions (user_id, created_at DESC);
CREATE INDEX card_link_sessions_expiry ON card_link_sessions (expires_at)
    WHERE state IN ('started', 'provisioned');

COMMIT;
