-- Identity verification: which tier somebody has reached, and every attempt.
--
-- The BVN itself is deliberately absent. It is a national identifier and the
-- most sensitive thing a Nigerian fintech can hold. What the platform needs is
-- that one was verified, not what it was -- so only the last four digits are
-- kept, which let a person recognise which of their numbers was used and are
-- useless to whoever steals the table.

BEGIN;

CREATE TABLE kyc_status (
    user_id      uuid PRIMARY KEY,

    -- 0 none, 1 bvn, 2 selfie, 3 document.
    tier         int NOT NULL DEFAULT 0 CHECK (tier BETWEEN 0 AND 3),

    first_name   text,
    last_name    text,
    date_of_birth text,
    phone        text,
    bvn_last4    text CHECK (bvn_last4 IS NULL OR bvn_last4 ~ '^[0-9]{4}$'),

    tier_reached_at timestamptz,
    updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kyc_checks (
    id           uuid PRIMARY KEY,
    user_id      uuid NOT NULL,

    -- The tier this check would establish.
    tier         int  NOT NULL CHECK (tier BETWEEN 1 AND 3),
    provider     text NOT NULL,
    provider_ref text,

    -- 'failed' is deliberately distinct from 'rejected'. "We could not reach
    -- the provider" must never be recorded as "this person is not who they
    -- say", and a queue of failures is an operational problem while a queue of
    -- rejections is a product one.
    status       text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'failed')),
    reason       text,

    submitted_at timestamptz NOT NULL DEFAULT now(),
    settled_at   timestamptz
);

CREATE INDEX kyc_checks_user ON kyc_checks (user_id, submitted_at DESC);
-- Callbacks arrive keyed by the provider's own reference.
CREATE UNIQUE INDEX kyc_checks_provider_ref ON kyc_checks (provider, provider_ref)
    WHERE provider_ref IS NOT NULL;
CREATE INDEX kyc_checks_open ON kyc_checks (status, submitted_at) WHERE status = 'pending';

COMMIT;
