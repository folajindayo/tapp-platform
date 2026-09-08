-- Seed the NGN provision buckets. Ported unchanged from
-- ent/migrate/migrations/20260901030000.
--
-- Every currency's *_institutions.sql seeds three provision buckets alongside
-- its banks — except NGN, whose seed predates that pattern. The gap is not
-- cosmetic: the matching engine looks the bucket up by (amount, currency) and
-- carries on with a nil bucket, and priority_queue.go then reads
-- order.ProvisionBucket.Edges.Currency.Code with no nil guard. A missing
-- bucket is a nil-pointer panic, not a skipped match.
--
-- Ranges mirror every other currency (0-1000 / 1001-5000 / 5001-50000).
-- These are naira, so the top of the range is ~₦50,000; orders above that
-- find no bucket until the ranges are widened.
--
-- ids are explicit, continuing from the current MAX, and stay well below the
-- table's identity START WITH (ent's global-unique-ID range).

DO $$
DECLARE
    ngn_currency_id UUID;
    last_bucket_id  BIGINT;
BEGIN
    SELECT "id" INTO ngn_currency_id
    FROM "fiat_currencies"
    WHERE "code" = 'NGN';

    IF ngn_currency_id IS NULL THEN
        RAISE EXCEPTION 'NGN fiat currency missing — 0017_seed_ngn_currency.sql must run first';
    END IF;

    -- Already seeded? Nothing to do.
    IF EXISTS (
        SELECT 1 FROM "provision_buckets"
        WHERE "fiat_currency_provision_buckets" = ngn_currency_id
    ) THEN
        RETURN;
    END IF;

    SELECT COALESCE(MAX("id"), 0) INTO last_bucket_id FROM "provision_buckets";

    INSERT INTO "provision_buckets" ("id", "min_amount", "max_amount", "created_at", "fiat_currency_provision_buckets")
    VALUES
        (last_bucket_id + 1, 0,    1000,  now(), ngn_currency_id),
        (last_bucket_id + 2, 1001, 5000,  now(), ngn_currency_id),
        (last_bucket_id + 3, 5001, 50000, now(), ngn_currency_id);
END$$;
