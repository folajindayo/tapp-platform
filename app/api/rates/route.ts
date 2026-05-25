// Live FX + crypto rates for the wallet hero.
//
//   ngn_per_usdc — Paycrest sell quote at a small reference amount.
//                  Same source we use for Route A order rate locking.
//   usdc_per_sui — LiFi quote for bridging 1 SUI (Sui mainnet) →
//                  USDC on Base. This is the realizable rate (after
//                  bridge fees + slippage), which is the honest
//                  number to display as the SUI value of a balance.
//
// Cached in-memory for 60s — rates don't move fast enough to need a
// per-request fetch, and both upstreams have rate limits we don't
// want to hammer. The cache survives across requests in the same
// Next.js server process; it's lost on cold start which is fine
// (next request just refetches).
//
// If an upstream fails, we fall back to the last good cached value
// (even if past TTL) so the wallet hero never goes blank. If we have
// no cache and both fail, we return 503.

import { NextResponse } from "next/server";

const CACHE_TTL_MS = 60_000;

interface Rates {
  ngn_per_usdc: number;
  usdc_per_sui: number;
  fetched_at: number;
}

let cache: { data: Rates; expiresAt: number } | null = null;

const PAYCREST_BASE = "https://api.paycrest.io";
const LIFI_BASE = "https://li.quest/v1";

// Mainnet constants.
const SUI_CHAIN_ID = "9270000000000000";
const BASE_CHAIN_ID = "8453";
const SUI_NATIVE = "0x2::sui::SUI";
const BASE_USDC_MAINNET = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
// LiFi /quote needs a sender for routing decisions; it doesn't
// balance-check for the quote itself. This is a valid-format Sui
// address (Sui framework upgrade cap holder) used purely as a
// stand-in so the quote endpoint accepts the request.
const QUOTE_SENDER_SUI =
  "0x0000000000000000000000000000000000000000000000000000000000000001";
const QUOTE_RECIPIENT_BASE = "0x000000000000000000000000000000000000dead";

export async function GET(): Promise<Response> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) {
    return NextResponse.json(cache.data);
  }

  const [ngn, sui] = await Promise.allSettled([
    fetchNgnPerUsdc(),
    fetchUsdcPerSui(),
  ]);

  // Build a fresh value, falling back per-field to the cached value
  // when the upstream fetch failed. This way a Paycrest outage
  // doesn't hide the SUI rate, and vice versa.
  const next: Partial<Rates> = {
    ngn_per_usdc:
      ngn.status === "fulfilled" ? ngn.value : cache?.data.ngn_per_usdc,
    usdc_per_sui:
      sui.status === "fulfilled" ? sui.value : cache?.data.usdc_per_sui,
  };

  if (next.ngn_per_usdc == null || next.usdc_per_sui == null) {
    return NextResponse.json(
      {
        error: "Rate sources unavailable",
        ngn_status: ngn.status,
        sui_status: sui.status,
      },
      { status: 503 },
    );
  }

  const data: Rates = {
    ngn_per_usdc: next.ngn_per_usdc,
    usdc_per_sui: next.usdc_per_sui,
    fetched_at: now,
  };
  cache = { data, expiresAt: now + CACHE_TTL_MS };
  return NextResponse.json(data);
}

async function fetchNgnPerUsdc(): Promise<number> {
  // Paycrest's amount-sensitive /v2/rates endpoint. We quote a small
  // reference amount (100 USDC) — for display purposes the rate is
  // effectively flat across small amounts; the per-order quote at
  // checkout uses the actual order amount.
  const url = `${PAYCREST_BASE}/v2/rates/base/USDC/100/NGN?side=sell`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Paycrest ${res.status}`);
  const json = (await res.json()) as {
    status: string;
    data: { sell: { rate: string } };
  };
  if (json.status !== "success" || !json.data?.sell?.rate) {
    throw new Error("Paycrest: malformed response");
  }
  const rate = parseFloat(json.data.sell.rate);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(`Paycrest: invalid rate ${json.data.sell.rate}`);
  }
  return rate;
}

async function fetchUsdcPerSui(): Promise<number> {
  // 1 SUI = 1e9 MIST → /quote returns toAmount in USDC subunits (6
  // decimals on Base USDC). Divide by 1e6 to get USDC per 1 SUI.
  const params = new URLSearchParams({
    fromChain: SUI_CHAIN_ID,
    toChain: BASE_CHAIN_ID,
    fromToken: SUI_NATIVE,
    toToken: BASE_USDC_MAINNET,
    fromAmount: "1000000000",
    fromAddress: QUOTE_SENDER_SUI,
    toAddress: QUOTE_RECIPIENT_BASE,
    slippage: "0.005",
  });
  const url = `${LIFI_BASE}/quote?${params.toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`LiFi ${res.status}`);
  const json = (await res.json()) as {
    estimate?: { toAmount?: string };
  };
  const toAmount = json.estimate?.toAmount;
  if (!toAmount) throw new Error("LiFi: missing estimate.toAmount");
  const usdcSubunit = parseInt(toAmount, 10);
  if (!Number.isFinite(usdcSubunit) || usdcSubunit <= 0) {
    throw new Error(`LiFi: invalid toAmount ${toAmount}`);
  }
  return usdcSubunit / 1_000_000;
}
