-- Seed the NGN fiat currency. Ported from ent/migrate/migrations/20260901020000
-- so a database built by ent's auto-migration gets the same row; the banks and
-- provision buckets that follow look it up by code, and the Tap-card flows query
-- fiatcurrency.CodeEQ("NGN") + IsEnabledEQ(true).
--
-- market_rate is a placeholder only. ComputeMarketRate overwrites it on the
-- next cron tick from live sources, for enabled currencies.

INSERT INTO "fiat_currencies" (
    "id", "code", "short_name", "decimals", "symbol", "name",
    "market_rate", "is_enabled", "created_at", "updated_at"
)
SELECT gen_random_uuid(), 'NGN', 'Naira', 2, '₦', 'Nigerian Naira', 1500.00, true, now(), now()
WHERE NOT EXISTS (SELECT 1 FROM "fiat_currencies" WHERE "code" = 'NGN');
