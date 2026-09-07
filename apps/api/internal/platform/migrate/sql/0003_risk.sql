-- The record of what the risk engine decided and why.
--
-- Kept because a decision nobody can review is a decision nobody can improve.
-- Thresholds should be tuned against what actually happened -- how many of the
-- refusals turned out to be fraud, how many were a market trader having a busy
-- Tuesday -- and that is only possible if the signals behind each one survive.

BEGIN;

CREATE TABLE risk_assessments (
    id           uuid PRIMARY KEY,

    -- What was being assessed: 'pledge', 'tap', 'payout', 'withdrawal'.
    subject_kind text NOT NULL,
    user_id      uuid NOT NULL,

    currency     currency,
    amount_minor bigint,

    decision     text NOT NULL CHECK (decision IN ('allow', 'step_up', 'review', 'deny')),
    score        int  NOT NULL CHECK (score BETWEEN 0 AND 100),

    -- Every signal, including the ones that moved nothing. What an
    -- investigator wants six weeks later was usually Info at the time.
    signals      jsonb NOT NULL DEFAULT '[]'::jsonb,

    -- Checks that could not run. A failed check has not cleared anybody, and
    -- an assessment made without one should be visibly different from one made
    -- with it.
    failed       text[] NOT NULL DEFAULT '{}',

    device       text,
    lat          double precision,
    lng          double precision,

    at           timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX risk_assessments_user     ON risk_assessments (user_id, at DESC);
CREATE INDEX risk_assessments_decision ON risk_assessments (decision, at DESC)
    WHERE decision <> 'allow';
CREATE INDEX risk_assessments_device   ON risk_assessments (device, at DESC)
    WHERE device IS NOT NULL;

-- ---------------------------------------------------------------- locations

-- Where each action was taken, so "could this person have got there" can be
-- asked at all.
--
-- Separate from risk_assessments because it is written for every action that
-- reports a location, and read as a small ordered series per user -- a
-- different access pattern from the assessment record, and one that should
-- stay fast as assessments accumulate.
CREATE TABLE risk_locations (
    id      bigserial PRIMARY KEY,
    user_id uuid NOT NULL,
    lat     double precision NOT NULL,
    lng     double precision NOT NULL,
    at      timestamptz NOT NULL
);

CREATE INDEX risk_locations_user ON risk_locations (user_id, at DESC);

COMMIT;
