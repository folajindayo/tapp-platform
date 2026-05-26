"use client";

/**
 * Wallet API client.
 *
 * Mock mode (`NEXT_PUBLIC_WALLET_MOCK=1`, the default while Rails
 * wallet endpoints are still landing) returns deterministic seeded
 * data so the UI looks coherent across reloads. Switch the flag off
 * once `/v1/wallet/*` is live on the backend.
 */

import { useQuery } from "@tanstack/react-query";
import { useSession } from "./auth";
import {
  fetchUsdcSubunit,
  fetchSuiMist,
  fetchOnchainActivity,
  USDC_COIN_TYPE,
  SUI_COIN_TYPE,
} from "./sui-client";
import { PaymentPlan } from "./payment-plan";
import { clientLogger } from "./client-logger";

export const WALLET_MOCK = process.env.NEXT_PUBLIC_WALLET_MOCK !== "0";

interface LiveRates {
  ngn_per_usdc: number;
  usdc_per_sui: number;
}

/**
 * Fetch live rates from /api/rates (Paycrest NGN/USDC + LiFi
 * SUI/USDC). Throws on any failure — we deliberately do NOT fall
 * back to zero/placeholder rates because that would silently show
 * the user wrong numbers (₦0 equivalent, missing SUI value in the
 * headline). Callers are expected to surface the error as an
 * explicit "rates unavailable, retry" UI state instead.
 */
async function fetchLiveRates(): Promise<LiveRates> {
  const res = await fetch("/api/rates", {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`/api/rates http ${res.status}: ${txt.slice(0, 200)}`);
  }
  const j = (await res.json()) as {
    ngn_per_usdc?: number;
    usdc_per_sui?: number;
  };
  if (
    typeof j.ngn_per_usdc !== "number" ||
    typeof j.usdc_per_sui !== "number" ||
    j.ngn_per_usdc <= 0 ||
    j.usdc_per_sui <= 0
  ) {
    throw new Error(
      `/api/rates returned malformed body (ngn=${j.ngn_per_usdc}, sui=${j.usdc_per_sui})`,
    );
  }
  return { ngn_per_usdc: j.ngn_per_usdc, usdc_per_sui: j.usdc_per_sui };
}

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export interface WalletState {
  sui_address: string;
  usdc_subunit: number;        // 10⁶ subunits per 1 USDC
  sui_mist:    number;         // 10⁹ MIST per 1 SUI (native)
  ngn_rate: number;            // NGN per USDC
  sui_usdc_rate: number;       // USDC per 1 SUI — folds SUI into the headline balance
  has_linked_card: boolean;
  card_needs_resync: boolean;
  card_id: string | null;
  card: CardSnapshot | null;
}

/**
 * Fold a native-SUI balance into a USDC-denominated subunit total —
 * used by the wallet hero so users see a single "Balance" number that
 * reflects everything they hold, not just USDC.
 *
 * Inputs are integer subunits; result is integer USDC subunits.
 */
export function combinedUsdcSubunit(
  usdcSubunit: number,
  suiMist: number,
  suiUsdcRate: number,
): number {
  if (!suiMist || !suiUsdcRate) return usdcSubunit;
  // (mist / 1e9) * rate  → USDC float; * 1e6 → USDC subunit
  const suiAsUsdcSubunit = Math.round((suiMist / 1_000_000_000) * suiUsdcRate * 1_000_000);
  return usdcSubunit + suiAsUsdcSubunit;
}

/** Snapshot of the linked card's on-chain spending cap + today's spend. */
export interface CardSnapshot {
  daily_limit_subunit:       number;  // NGN subunit (kobo)
  per_tap_limit_subunit:     number;
  step_up_threshold_subunit: number;
  spent_today_subunit:       number;
  pin_attempts_remaining:    number;
}

export type ActivityKind = "pay" | "deposit" | "topup" | "refund";
export type ActivityStatus = "success" | "pending" | "declined";

export interface ActivityEvent {
  digest: string;
  kind: ActivityKind;
  amount_subunit: number;      // signed: + inflow, − outflow
  merchant: string | null;
  reference: string | null;
  status: ActivityStatus;
  at: number;                  // unix ms
  asset?: "USDC" | "SUI";
}

export interface OrderDetails {
  id: string;
  merchant_name: string;
  merchant_logo_url?: string;
  amount_subunit: number;      // positive USDC subunits owed
  ngn_rate: number;
  reference?: string;
  expires_at: number;          // unix ms
  step_up_required: boolean;
  // On-chain deposit target. Populated by Rails from the merchant's
  // SuiReceiveAddress row. The customer's wallet sends `amount_subunit`
  // of `coin_type` here; Rails' Sui event indexer picks the deposit up
  // and advances the order state (SSE emits payment.deposited).
  receive_address?: string;
  coin_type?: string;
}

// -----------------------------------------------------------------------------
// Mock data
// -----------------------------------------------------------------------------

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h);
}

function suiAddressFor(seed: string): string {
  return (
    "0x" +
    Array.from(seed)
      .map((c) => c.charCodeAt(0).toString(16))
      .join("")
      .slice(0, 40)
      .padEnd(40, "0")
  );
}

const MOCK_MERCHANTS = [
  "Ada Café",
  "Uber",
  "Netflix",
  "Spotify",
  "Bolt",
  "Domino's Pizza",
  "Starbucks",
  "Shoprite",
  "Konga",
  "MTN airtime",
];

/**
 * The mock honours a localStorage override so demos can toggle
 * between the "linked card" and "no card yet" states without
 * re-signing in:
 *
 *   localStorage.setItem("tapp.mock.has_card", "0"); location.reload();
 *
 * Default = true (the realistic state for an onboarded user).
 */
function mockHasLinkedCard(): boolean {
  if (typeof window === "undefined") return true;
  const flag = window.localStorage.getItem("tapp.mock.has_card");
  if (flag === "0") return false;
  return true;
}

async function mockWalletState(
  seed: string,
  suiAddress?: string,
): Promise<WalletState> {
  const h = hashCode(seed);
  const hasCard = mockHasLinkedCard();
  // Even in mock mode, fetch real rates — the mock-ness is just the
  // balances. Real rates here keep the hero accurate while the
  // backend / on-chain hookup is being built.
  const rates = await fetchLiveRates();
  return {
    sui_address:        suiAddress || suiAddressFor(seed),
    usdc_subunit:       72_500_000 + (h % 100_000_000),
    sui_mist:           (h % 5) * 1_000_000_000, // 0..4 SUI mock
    ngn_rate:           rates.ngn_per_usdc,
    sui_usdc_rate:      rates.usdc_per_sui,
    has_linked_card:    hasCard,
    card_needs_resync:  false,
    card_id:            hasCard ? "card_" + seed.slice(0, 8) : null,
    card:               hasCard
      ? {
          daily_limit_subunit:       40_000 * 100,         // ₦40k
          per_tap_limit_subunit:     2_000  * 100,         // ₦2k
          step_up_threshold_subunit: 15_000 * 100,         // ₦15k
          spent_today_subunit:       (h % 18_000) * 100,
          pin_attempts_remaining:    3,
        }
      : null,
  };
}

async function onchainWalletState(suiAddress: string): Promise<WalletState> {
  const [usdc, sui, rates] = await Promise.all([
    fetchUsdcSubunit(suiAddress),
    fetchSuiMist(suiAddress),
    fetchLiveRates(),
  ]);
  return {
    sui_address:       suiAddress,
    usdc_subunit:      usdc,
    sui_mist:          sui,
    ngn_rate:          rates.ngn_per_usdc,
    sui_usdc_rate:     rates.usdc_per_sui,
    // Card linkage isn't on-chain in v1 — Rails owns that mapping. For
    // direct-RPC mode we default to "no card linked" until the wallet
    // page is wired to ALSO read /v1/cards/me alongside.
    has_linked_card:   false,
    card_needs_resync: false,
    card_id:           null,
    card:              null,
  };
}

async function onchainActivity(suiAddress: string): Promise<ActivityEvent[]> {
  const txs = await fetchOnchainActivity(suiAddress);
  return txs
    .map((tx): ActivityEvent | null => {
      // Prefer USDC over SUI when both move in the same tx (most likely
      // the SUI delta is just gas).
      const isUsdc = tx.amountUsdc !== null;
      const amount = isUsdc ? tx.amountUsdc! : tx.amountSui;
      if (amount === null || amount === 0) return null;
      const inflow = amount > 0;
      return {
        digest:         tx.digest,
        kind:           inflow ? "deposit" : "pay",
        amount_subunit: isUsdc
          ? amount                                  // already USDC subunits
          : Math.round((amount / 1_000_000_000) * 1_000_000), // SUI MIST → USDC-equivalent floor; visual only
        merchant:       null,
        reference:      tx.counterparty,
        status:         "success",
        at:             tx.timestampMs,
        asset:          isUsdc ? "USDC" : "SUI",
      };
    })
    .filter((x): x is ActivityEvent => x !== null);
}

function mockActivity(seed: string, n = 20): ActivityEvent[] {
  const h = hashCode(seed);
  const now = Date.now();
  const out: ActivityEvent[] = [];
  for (let i = 0; i < n; i++) {
    const r = hashCode(seed + ":" + i);
    const kindIdx = (r >> 3) % 10;
    const kind: ActivityKind =
      kindIdx < 6 ? "pay" : kindIdx < 8 ? "deposit" : kindIdx === 8 ? "topup" : "refund";
    const merchant =
      kind === "pay" ? MOCK_MERCHANTS[r % MOCK_MERCHANTS.length] : null;
    const usdcAmount =
      kind === "pay"
        ? -((r % 4000) / 100 + 0.5)
        : kind === "refund"
          ? (r % 1500) / 100
          : (r % 8000) / 100 + 5;
    const status: ActivityStatus =
      i === 0 && kind === "pay" && (h & 1)
        ? "pending"
        : (r >> 5) % 30 === 0
          ? "declined"
          : "success";
    out.push({
      digest:         "0x" + (h ^ r).toString(16).padStart(8, "0").slice(0, 8) + "…",
      kind,
      amount_subunit: Math.round(usdcAmount * 1_000_000),
      merchant,
      reference:      kind === "pay" ? `ref-${(r % 10_000).toString().padStart(4, "0")}` : null,
      status,
      at:             now - i * 1000 * 60 * (10 + (r % 300)),
      asset:          kind === "deposit" ? (i % 2 === 0 ? "USDC" : "SUI") : undefined,
    });
  }
  return out;
}

async function mockOrder(id: string): Promise<OrderDetails> {
  const h = hashCode(id);
  const merchant = MOCK_MERCHANTS[h % MOCK_MERCHANTS.length];
  // Default 2-minute expiry from "now" (mock orders never actually expire on
  // backend — the timer is purely a UI urgency cue).
  const expires_at = Date.now() + 2 * 60_000;
  // Amount tied to merchant for repeatability.
  const usdc = ((h % 4500) / 100 + 1.25).toFixed(2);
  const rates = await fetchLiveRates();
  return {
    id,
    merchant_name:     merchant,
    amount_subunit:    Math.round(parseFloat(usdc) * 1_000_000),
    ngn_rate:          rates.ngn_per_usdc,
    reference:         `Order #${(h % 100_000).toString().padStart(5, "0")}`,
    expires_at,
    step_up_required:  (h % 7) === 0,
  };
}

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

async function realGet<T>(path: string, jwt: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${jwt}`,
      "ngrok-skip-browser-warning": "1",
    },
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  const json = (await res.json()) as { data: T };
  return json.data;
}

async function realPost<T>(path: string, body: unknown, jwt?: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "1",
  };
  if (jwt) headers.Authorization = `Bearer ${jwt}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method:  "POST",
    headers,
    body:    JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  const json = (await res.json()) as { data: T };
  return json.data;
}

export const walletApi = {
  me: async (
    jwt: string,
    seed: string,
    suiAddress?: string,
  ): Promise<WalletState> => {
    if (WALLET_MOCK) return mockWalletState(seed, suiAddress);
    if (suiAddress) return onchainWalletState(suiAddress);
    // Backend may not yet emit the rate fields — fall back to the
    // live /api/rates source if either is missing, so the wallet
    // hero math always has something to chew on.
    const w = await realGet<WalletState>("/v1/wallet/me", jwt);
    if (w.ngn_rate != null && w.sui_usdc_rate != null) return w;
    const rates = await fetchLiveRates();
    return {
      ...w,
      ngn_rate: w.ngn_rate ?? rates.ngn_per_usdc,
      sui_usdc_rate: w.sui_usdc_rate ?? rates.usdc_per_sui,
    };
  },
  history: async (
    jwt: string,
    seed: string,
    suiAddress?: string,
  ): Promise<ActivityEvent[]> => {
    if (WALLET_MOCK) return mockActivity(seed);
    if (suiAddress) return onchainActivity(suiAddress);
    return realGet<ActivityEvent[]>("/v1/wallet/history", jwt);
  },
  tx: async (
    jwt: string,
    seed: string,
    digest: string,
    suiAddress?: string,
  ): Promise<ActivityEvent | null> => {
    if (WALLET_MOCK) {
      return mockActivity(seed).find((t) => t.digest === digest) ?? null;
    }
    if (suiAddress) {
      return (await onchainActivity(suiAddress)).find((t) => t.digest === digest) ?? null;
    }
    return realGet<ActivityEvent>(`/v1/wallet/tx/${digest}`, jwt);
  },
  order: async (jwt: string, id: string): Promise<OrderDetails> => {
    if (WALLET_MOCK) return await mockOrder(id);
    return realGet<OrderDetails>(`/v1/orders/${id}`, jwt);
  },
  /**
   * Pay an order by sending USDC from the customer's zkLogin wallet to
   * the merchant's receive_address. Rails' Sui event indexer picks up
   * the deposit and advances the order state — clients observe progress
   * via the existing SSE stream (payment.deposited → settled).
   *
   * Returns the on-chain tx digest so the UI can deep-link to it. In
   * mock mode, fabricates a digest after a short delay.
   *
   * Caller responsibilities:
   *   • Pre-check insufficient balance (cleaner UX than the chain
   *     reverting on transferObjects).
   *   • Subscribe to the order's SSE stream and route to the success
   *     screen on `payment.deposited` / `payment.settled` rather than
   *     waiting on this call alone — the chain confirmation here is
   *     necessary but not sufficient for end-to-end settlement.
   */
  confirmOrder: async (
    _jwt: string,
    order: OrderDetails,
    session: { suiAddress: string; zkLoginReady: boolean },
    paymentPlan?: PaymentPlan,
  ): Promise<{ acknowledged: true; digest: string }> => {
    clientLogger.info("confirm-order", "starting order confirmation", {
      orderId: order.id,
      paymentPath: paymentPlan?.path ?? "usdc",
      amountSubunit: order.amount_subunit,
      zkLoginReady: session.zkLoginReady,
    });

    if (WALLET_MOCK) {
      clientLogger.info("confirm-order", "running in mock mode, simulating delay");
      await new Promise((r) => setTimeout(r, 800));
      const fakeDigest = "0xtx_mock_" + Date.now().toString(36);
      clientLogger.info("confirm-order", "generated mock digest", { fakeDigest });
      
      // Even in mock mode, fire-and-forget the confirm so the merchant's
      // mock-mode SSE consumers advance (no-op when Rails is offline).
      void realPost(`/v1/orders/${order.id}/confirm`, { txDigest: fakeDigest }).catch((err) => {
        clientLogger.warn("confirm-order", "mock confirm post failed", { err });
      });
      return { acknowledged: true, digest: fakeDigest };
    }

    if (!session.zkLoginReady) {
      clientLogger.error("confirm-order", "zkLogin not ready");
      throw new Error(
        "Your sign-in didn't complete the full zkLogin handshake — sign out and back in to enable on-chain payments.",
      );
    }
    if (!order.receive_address) {
      clientLogger.error("confirm-order", "order missing receive address");
      throw new Error(
        "This order is missing a receive address. Ask the merchant to regenerate it.",
      );
    }
    if (order.amount_subunit <= 0) {
      clientLogger.error("confirm-order", "order amount is zero or negative", { amount: order.amount_subunit });
      throw new Error("Order amount must be greater than zero.");
    }

    // Dynamic import — keep the heavy Sui + zkLogin code out of the
    // initial bundle. Matches the pattern in /send/page.tsx.
    const { executeZkLoginTx } = await import("@/lib/zklogin");
    const { Transaction } = await import("@mysten/sui/transactions");
    const { suiReadClient } = await import("@/lib/sui-client");

    const coinType = order.coin_type ?? USDC_COIN_TYPE;
    const recipient = order.receive_address;
    const amountSubunit = order.amount_subunit;

    let result;
    
    if (paymentPlan && paymentPlan.path === "combined") {
      clientLogger.info("confirm-order", "executing combined SUI + USDC payment path");
      
      // Initialize Cetus CLMM SDK for mainnet
      clientLogger.debug("confirm-order", "initializing Cetus SDK");
      const { CetusClmmSDK, clmmMainnet } = await import("@cetusprotocol/sui-clmm-sdk");
      const sdk = new CetusClmmSDK(clmmMainnet);
      sdk.setSenderAddress(session.suiAddress);

      clientLogger.debug("confirm-order", "calling createSwapWithoutTransferCoinsPayload", {
        pool_id: "0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105",
        suiNeededMist: paymentPlan.suiNeededMist,
        shortfallUsdcSubunit: paymentPlan.shortfallUsdcSubunit,
      });

      const swapRes = await sdk.Swap.createSwapWithoutTransferCoinsPayload({
        pool_id: "0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105", // SUI/USDC 0.25% pool
        a2b: false, // B to A swap (SUI -> USDC)
        by_amount_in: true,
        amount: paymentPlan.suiNeededMist.toString(),
        amount_limit: paymentPlan.shortfallUsdcSubunit.toString(),
        coin_type_a: USDC_COIN_TYPE,
        coin_type_b: SUI_COIN_TYPE,
      });

      const tx = swapRes.tx;
      const coin_ab_s = swapRes.coin_ab_s; // coin_ab_s[0] is Coin A (USDC), coin_ab_s[1] is Coin B (SUI)

      clientLogger.debug("confirm-order", "returned swap transaction and coin arguments", {
        coinsCount: coin_ab_s.length,
      });

      // Transfer remaining SUI from the swap back to the user's wallet
      clientLogger.debug("confirm-order", "transferring unspent swap SUI back to sender", {
        recipient: session.suiAddress,
      });
      tx.transferObjects([coin_ab_s[1]], tx.pure.address(session.suiAddress));

      // Fetch user's existing USDC coins
      const client = suiReadClient();
      clientLogger.debug("confirm-order", "fetching existing USDC coins in wallet");
      const coins = await client.getCoins({
        owner: session.suiAddress,
        coinType: USDC_COIN_TYPE,
      });

      let primaryUsdc: any = null;
      if (coins.data.length > 0) {
        const inputs = coins.data.map((c) => tx.object(c.coinObjectId));
        primaryUsdc = inputs[0];
        if (inputs.length > 1) {
          clientLogger.debug("confirm-order", "merging multiple USDC coin inputs into primary", {
            inputsCount: inputs.length,
          });
          tx.mergeCoins(primaryUsdc, inputs.slice(1));
        }
        clientLogger.debug("confirm-order", "merging swapped USDC coin into primary USDC coin");
        tx.mergeCoins(primaryUsdc, [coin_ab_s[0]]);
      } else {
        clientLogger.info("confirm-order", "no existing USDC coins, using swapped USDC directly as primary");
        primaryUsdc = coin_ab_s[0];
      }

      // Split the exact amount owed to the merchant
      clientLogger.debug("confirm-order", "splitting merchant payment from primary USDC coin", {
        amountSubunit,
      });
      const [out] = tx.splitCoins(primaryUsdc, [tx.pure.u64(BigInt(amountSubunit))]);
      
      clientLogger.debug("confirm-order", "transferring payment coin to merchant", {
        recipient,
      });
      tx.transferObjects([out], tx.pure.address(recipient));

      // If user had no existing USDC coins, the swapped USDC coin was the primary coin.
      // We must transfer the remaining change on primaryUsdc back to the sender.
      if (coins.data.length === 0) {
        clientLogger.debug("confirm-order", "transferring remaining USDC change back to sender", {
          recipient: session.suiAddress,
        });
        tx.transferObjects([primaryUsdc], tx.pure.address(session.suiAddress));
      }

      clientLogger.info("confirm-order", "submitting self-sponsored combined swap transaction block via zkLogin");
      result = await executeZkLoginTx(tx, { selfSponsor: true });
    } else {
      clientLogger.info("confirm-order", "executing pure USDC payment path");
      
      result = await executeZkLoginTx(async (tx: InstanceType<typeof Transaction>) => {
        const client = suiReadClient();
        clientLogger.debug("confirm-order", "fetching existing USDC coins in wallet");
        const coins = await client.getCoins({
          owner:    session.suiAddress,
          coinType,
        });
        if (coins.data.length === 0) {
          clientLogger.error("confirm-order", "no USDC coins found in wallet");
          throw new Error("No USDC coin objects found in this wallet. Top up first.");
        }
        
        const inputs = coins.data.map((c) => tx.object(c.coinObjectId));
        const primary = inputs[0];
        if (inputs.length > 1) {
          clientLogger.debug("confirm-order", "merging multiple USDC coin inputs into primary", {
            inputsCount: inputs.length,
          });
          tx.mergeCoins(primary, inputs.slice(1));
        }
        
        clientLogger.debug("confirm-order", "splitting merchant payment from primary USDC coin", {
          amountSubunit,
        });
        const [out] = tx.splitCoins(primary, [tx.pure.u64(BigInt(amountSubunit))]);
        
        clientLogger.debug("confirm-order", "transferring payment coin to merchant", {
          recipient,
        });
        tx.transferObjects([out], tx.pure.address(recipient));
      });
    }

    clientLogger.info("confirm-order", "transaction execution complete, notifying backend", {
      digest: result.digest,
    });

    // Best-effort ack so Rails pre-emits payment.deposited and the
    // merchant's SSE advances without waiting on the Sui indexer's
    // poll interval. Indexer remains authoritative — if this POST
    // fails the deposit still settles, just a few seconds slower.
    void realPost(`/v1/orders/${order.id}/confirm`, { txDigest: result.digest })
      .then(() => {
        clientLogger.info("confirm-order", "notified backend of transaction confirmation successfully");
      })
      .catch((err) => {
        clientLogger.warn("confirm-order", "order confirm ack failed:", { err });
      });

    return { acknowledged: true, digest: result.digest };
  },
};

// SSE URL the customer checkout PWA connects to after submitting an
// on-chain payment. Public — order id is the auth (unguessable v4
// UUID). Server only forwards events whose payload.order_id matches
// the URL param, so subscribers see ONLY their own order's lifecycle.
export function orderStreamURL(orderID: string): string {
  return `/api/orders/${encodeURIComponent(orderID)}/stream`;
}

// -----------------------------------------------------------------------------
// Hooks
// -----------------------------------------------------------------------------

/** Glanceable wallet state — polls every 15s for incoming deposits. */
export function useWallet() {
  const { session, hydrated } = useSession();
  const seed = session?.email ?? "anon";
  const addr = session?.suiAddress || undefined;
  return useQuery({
    queryKey:           ["wallet", "me", seed, addr ?? ""],
    enabled:            hydrated && !!session,
    queryFn:            () => walletApi.me(session!.jwt, seed, addr),
    refetchInterval:    15_000,
    refetchOnWindowFocus: true,
  });
}

export function useWalletHistory() {
  const { session, hydrated } = useSession();
  const seed = session?.email ?? "anon";
  const addr = session?.suiAddress || undefined;
  return useQuery({
    queryKey:        ["wallet", "history", seed, addr ?? ""],
    enabled:         hydrated && !!session,
    queryFn:         () => walletApi.history(session!.jwt, seed, addr),
    refetchInterval: 30_000,
  });
}

export function useOrder(id: string | null) {
  const { session, hydrated } = useSession();
  return useQuery({
    queryKey: ["orders", id],
    enabled:  hydrated && !!session && !!id,
    queryFn:  () => walletApi.order(session!.jwt, id!),
    retry:    false,
  });
}

export function useTransaction(digest: string | null) {
  const { session, hydrated } = useSession();
  const seed = session?.email ?? "anon";
  const addr = session?.suiAddress || undefined;
  return useQuery({
    queryKey: ["wallet", "tx", digest, addr ?? ""],
    enabled:  hydrated && !!session && !!digest,
    queryFn:  () => walletApi.tx(session!.jwt, seed, digest!, addr),
  });
}

// Re-export coin types so callers don't have to learn a second module.
export { USDC_COIN_TYPE, SUI_COIN_TYPE };

// -----------------------------------------------------------------------------
// Formatters
// -----------------------------------------------------------------------------

const usdcFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const ngnFmt = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  currencyDisplay: "symbol",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** 72_500_000 → "72.50" */
export function formatUsdc(subunit: number): string {
  return usdcFmt.format(subunit / 1_000_000);
}

/** Signed USDC: 72_500_000 → "+72.50", -1_200_000 → "−1.20" */
export function formatUsdcSigned(subunit: number): string {
  const usdc = subunit / 1_000_000;
  if (usdc >= 0) return "+" + usdcFmt.format(usdc);
  return "−" + usdcFmt.format(Math.abs(usdc));
}

/** Convert USDC subunit + NGN rate → "₦108,750" */
export function formatNgnFromUsdc(subunit: number, rate: number): string {
  const ngn = (Math.abs(subunit) / 1_000_000) * rate;
  return ngnFmt.format(ngn);
}

/** Short address: 0xabc…1234 */
export function shortenAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Friendly "2m ago" / "1h ago" / "May 18". */
export function formatTimeAgo(at: number): string {
  const diff = Math.max(0, Date.now() - at);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(at).toLocaleDateString("en", { month: "short", day: "numeric" });
}
