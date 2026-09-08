-- Seed the 32 NGN banks, linked to the NGN currency seeded by 0017. Ported from
-- ent/migrate/migrations/20240613143010; there, no earlier migration had
-- inserted the currency, so every bank landed unlinked and the payout bank
-- picker showed "No banks found". Here the currency exists first.
-- ON CONFLICT (code) makes this safe against a database that already has them.

DO $$
DECLARE
    fiat_currency_institutions UUID;
BEGIN
    SELECT "id" INTO fiat_currency_institutions
    FROM "fiat_currencies"
    WHERE "code" = 'NGN';

    IF fiat_currency_institutions IS NULL THEN
        RAISE EXCEPTION 'NGN fiat currency missing — 0017_seed_ngn_currency.sql must run first';
    END IF;

    WITH institutions (code, name, type, updated_at, created_at) AS (
        VALUES
            ('ABNGNGLA', 'Access Bank', 'bank', now(), now()),
            ('DBLNNGLA', 'Diamond Bank', 'bank', now(), now()),
            ('FIDTNGLA', 'Fidelity Bank', 'bank', now(), now()),
            ('FCMBNGLA', 'FCMB', 'bank', now(), now()),
            ('FBNINGLA', 'First Bank Of Nigeria', 'bank', now(), now()),
            ('GTBINGLA', 'Guaranty Trust Bank', 'bank', now(), now()),
            ('PRDTNGLA', 'Polaris Bank', 'bank', now(), now()),
            ('UBNINGLA', 'Union Bank', 'bank', now(), now()),
            ('UNAFNGLA', 'United Bank for Africa', 'bank', now(), now()),
            ('CITINGLA', 'Citibank', 'bank', now(), now()),
            ('ECOCNGLA', 'Ecobank Bank', 'bank', now(), now()),
            ('HBCLNGLA', 'Heritage', 'bank', now(), now()),
            ('PLNINGLA', 'Keystone Bank', 'bank', now(), now()),
            ('SBICNGLA', 'Stanbic IBTC Bank', 'bank', now(), now()),
            ('SCBLNGLA', 'Standard Chartered Bank', 'bank', now(), now()),
            ('NAMENGLA', 'Sterling Bank', 'bank', now(), now()),
            ('ICITNGLA', 'Unity Bank', 'bank', now(), now()),
            ('SUTGNGLA', 'Suntrust Bank', 'bank', now(), now()),
            ('PROVNGLA', 'Providus Bank', 'bank', now(), now()),
            ('KDHLNGLA', 'FBNQuest Merchant Bank', 'bank', now(), now()),
            ('GMBLNGLA', 'Greenwich Merchant Bank', 'bank', now(), now()),
            ('FSDHNGLA', 'FSDH Merchant Bank', 'bank', now(), now()),
            ('FIRNNGLA', 'Rand Merchant Bank', 'bank', now(), now()),
            ('JAIZNGLA', 'Jaiz Bank', 'bank', now(), now()),
            ('ZEIBNGLA', 'Zenith Bank', 'bank', now(), now()),
            ('WEMANGLA', 'Wema Bank', 'bank', now(), now()),
            ('KUDANGPC', 'Kuda Microfinance Bank', 'bank', now(), now()),
            ('OPAYNGPC', 'OPay', 'bank', now(), now()),
            ('MONINGPC', 'Moniepoint Microfinance Bank', 'bank', now(), now()),
            ('PALMNGPC', 'PalmPay', 'bank', now(), now()),
            ('SAHVNGPC', 'Safehaven Microfinance Bank', 'bank', now(), now()),
            ('PAYTNGPC', 'Paystack-Titan MFB', 'bank', now(), now())
    )
    INSERT INTO "institutions" ("code", "name", "fiat_currency_institutions", "type", "updated_at", "created_at")
    SELECT "code", "name", fiat_currency_institutions, "type", "updated_at", "created_at"
    FROM institutions
    ON CONFLICT ("code") DO NOTHING;
END$$;
