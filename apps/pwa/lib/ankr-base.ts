/**
 * Base mainnet balance and history reads for the wallet screen.
 *
 * These call this app's own server routes (/api/base/*), never a provider
 * endpoint directly. The provider key stays server-side: an earlier revision
 * of this file carried an Ankr key as the literal default for
 * NEXT_PUBLIC_BASE_RPC_URL, which shipped it to every visitor.
 *
 * Efficiency measures kept from that revision, because they are the reason
 * this file exists rather than a plain fetch:
 *   - one batched JSON-RPC request for USDC balanceOf + native balance
 *   - in-flight deduplication, so concurrent callers share one network hop
 *   - a short TTL cache, which absorbs the wallet screen's poll and refocus
 *
 * What is deliberately NOT here is a fallback. A read that fails throws. The
 * previous behaviour returned a zero balance when every RPC attempt failed,
 * which showed the cardholder an empty wallet instead of telling them the
 * network was unreachable -- indistinguishable, on screen, from having been
 * robbed.
 */

export const BASE_USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/** Same-origin proxies. The provider and its key are chosen server-side. */
const BASE_RPC_PROXY = "/api/base/rpc";
const BASE_TRANSFERS_PROXY = "/api/base/transfers";

/**
 * The proxies require the caller's Rails session, so reads take a JWT. It is
 * a required argument rather than an optional one: making it optional would
 * let a caller silently produce an unauthenticated request that always 401s.
 */
export type Jwt = string;

export interface BaseBalanceResult {
  usdcSubunit: number; // 6 decimals (1 USDC = 1_000_000)
  usdcFormatted: string; // e.g. "12.50"
  ethWei: bigint;
  ethFormatted: string;
}

export interface BaseTransactionEvent {
  digest: string;
  kind: "deposit" | "pay";
  amount_subunit: number;
  merchant: string | null;
  reference: string | null;
  status: "success" | "pending" | "declined";
  at: number; // ms timestamp
  asset: "USDC" | "ETH";
}

// -----------------------------------------------------------------------------
// In-Memory Cache & In-Flight Request Deduplication
// -----------------------------------------------------------------------------

const BALANCE_TTL_MS = 4_000; // 4 seconds (deduplicates within a render, instant on poll/focus)
const TX_TTL_MS = 15_000; // 15 seconds

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const balanceCache = new Map<string, CacheEntry<BaseBalanceResult>>();
const inFlightBalance = new Map<string, Promise<BaseBalanceResult>>();

const txCache = new Map<string, CacheEntry<BaseTransactionEvent[]>>();
const inFlightTx = new Map<string, Promise<BaseTransactionEvent[]>>();

/**
 * Fetch Base USDC and native balance in one batched request.
 *
 * Throws when the read cannot be completed. Callers must surface that as an
 * error state, never as a zero balance.
 */
export async function fetchBaseWalletBalance(
  address: string,
  jwt: Jwt,
  forceRefresh = false,
): Promise<BaseBalanceResult> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`Not a Base address: ${address}`);
  }

  // Cache and dedupe per (address, session): two signed-in users on one device
  // must never read each other's balance out of a shared entry.
  const key = `${address.toLowerCase()}:${jwt.slice(-16)}`;
  const now = Date.now();

  if (!forceRefresh) {
    const cached = balanceCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }
  }

  const pending = inFlightBalance.get(key);
  if (pending) {
    return pending;
  }

  const fetchPromise = (async () => {
    try {
      return await executeBatchBalance(address, jwt);
    } finally {
      inFlightBalance.delete(key);
    }
  })();

  inFlightBalance.set(key, fetchPromise);
  const result = await fetchPromise;

  balanceCache.set(key, { data: result, expiresAt: Date.now() + BALANCE_TTL_MS });
  return result;
}

/**
 * Parse a JSON-RPC hex quantity. An absent or unparseable value throws rather
 * than defaulting, so a broken read can never be mistaken for a zero balance.
 * "0x" is the one exception the RPC spec allows for an empty return, and it
 * genuinely means zero.
 */
function parseHexQuantity(raw: string | undefined, what: string): bigint {
  if (raw === undefined || raw === null) {
    throw new Error(`${what}: no result in the RPC response`);
  }
  if (raw === "0x") return BigInt(0);
  try {
    return BigInt(raw);
  } catch {
    throw new Error(`${what}: unparseable result ${raw}`);
  }
}

function parseHexAmount(raw: string | undefined, what: string): number {
  return Number(parseHexQuantity(raw, what));
}

/**
 * Execute batch JSON-RPC request for USDC balanceOf + eth_getBalance.
 */
async function executeBatchBalance(address: string, jwt: Jwt): Promise<BaseBalanceResult> {
  // Method signature for balanceOf(address): 0x70a08231
  const cleanAddr = address.toLowerCase().replace("0x", "").padStart(64, "0");
  const data = `0x70a08231${cleanAddr}`;

  const payload = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: BASE_USDC_CONTRACT, data }, "latest"],
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "eth_getBalance",
      params: [address, "latest"],
    },
  ];

  const res = await fetch(BASE_RPC_PROXY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(
      `Base RPC failed (${res.status})${detail?.error ? `: ${detail.error}` : ""}`,
    );
  }

  const json = (await res.json()) as Array<{ id: number; result?: string; error?: { message: string } }>;
  if (!Array.isArray(json)) {
    throw new Error("Invalid batch JSON-RPC response");
  }

  const usdcRes = json.find((item) => item.id === 1);
  const ethRes = json.find((item) => item.id === 2);

  if (usdcRes?.error) throw new Error(`USDC balanceOf: ${usdcRes.error.message}`);
  if (ethRes?.error) throw new Error(`eth_getBalance: ${ethRes.error.message}`);

  // A result we cannot parse is a broken read. Coercing it to zero here is
  // what made an RPC fault look like an empty wallet.
  const usdcSubunit = parseHexAmount(usdcRes?.result, "USDC balance");
  const ethWei = parseHexQuantity(ethRes?.result, "native balance");

  if (usdcSubunit > Number.MAX_SAFE_INTEGER) {
    throw new Error("USDC balance exceeds the safe integer range");
  }

  const usdcFormatted = (usdcSubunit / 1_000_000).toFixed(2);
  const ethFormatted = (Number(ethWei) / 1e18).toFixed(4);

  return {
    usdcSubunit,
    usdcFormatted,
    ethWei,
    ethFormatted,
  };
}

/**
 * Fetch Base token-transfer history.
 *
 * Throws on failure. An empty list means "this address has no transfers",
 * which is a different claim from "we could not reach the provider", and the
 * activity screen needs to be able to tell them apart.
 */
export async function fetchBaseTransactions(
  address: string,
  jwt: Jwt,
  pageSize = 20,
  forceRefresh = false,
): Promise<BaseTransactionEvent[]> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    throw new Error(`Not a Base address: ${address}`);
  }

  const key = `${address.toLowerCase()}:${pageSize}:${jwt.slice(-16)}`;
  const now = Date.now();

  if (!forceRefresh) {
    const cached = txCache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.data;
    }
  }

  const pending = inFlightTx.get(key);
  if (pending) {
    return pending;
  }

  const fetchPromise = (async () => {
    try {
      const res = await fetch(BASE_TRANSFERS_PROXY, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ address, pageSize }),
      });

      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(
          `Transfer history failed (${res.status})${detail?.error ? `: ${detail.error}` : ""}`,
        );
      }

      const json = await res.json();
      if (json?.error) {
        throw new Error(`Transfer history: ${json.error.message ?? "provider error"}`);
      }

      return parseTransfers(json?.result?.transfers ?? [], address);
    } finally {
      inFlightTx.delete(key);
    }
  })();

  inFlightTx.set(key, fetchPromise);
  const result = await fetchPromise;

  txCache.set(key, { data: result, expiresAt: Date.now() + TX_TTL_MS });
  return result;
}

/** Map the provider's transfer rows onto the shape the activity list renders. */
function parseTransfers(rows: any[], address: string): BaseTransactionEvent[] {
  const userLower = address.toLowerCase();

  return rows.map((t): BaseTransactionEvent => {
    const to = t.toAddress || "";
    const from = t.fromAddress || "";
    const isDeposit = t.direction === "in" || to.toLowerCase() === userLower;

    // valueRawInteger is the authoritative subunit amount. The float parse of
    // `value` that used to back it up rounded, so it is not a substitute --
    // a row without a raw integer is reported as unparseable rather than
    // silently re-derived at lower precision.
    let amountSubunit: number;
    try {
      amountSubunit = Number(BigInt(t.valueRawInteger ?? ""));
    } catch {
      throw new Error(`Transfer ${t.transactionHash}: missing or unparseable amount`);
    }

    return {
      digest: t.transactionHash || "",
      kind: isDeposit ? "deposit" : "pay",
      amount_subunit: amountSubunit,
      merchant: null,
      reference: isDeposit ? from : to,
      status: "success",
      at: t.timestamp ? Number(t.timestamp) * 1000 : Date.now(),
      asset: "USDC",
    };
  });
}
