"use client";

/**
 * Read-side Sui client for the wallet surface. Queries balances and
 * tx history straight from a fullnode — no Rails round-trip. We
 * stick to the user's own address; merchant flows still go through
 * the Rails API.
 *
 * Coin types are env-driven so we can switch networks without
 * recompiling. Required:
 *
 *   NEXT_PUBLIC_SUI_NETWORK       = mainnet | testnet | devnet (default testnet)
 *   NEXT_PUBLIC_USDC_COIN_TYPE    = full type tag for the USDC coin on
 *                                   the current network (no default —
 *                                   testnet and mainnet packages differ)
 *   NEXT_PUBLIC_SUI_EXECUTE_RPC_URL = optional transaction-submit RPC.
 *                                     If unset, uses the read client.
 *   NEXT_PUBLIC_WALLET_MOCK       = "0" to disable the mock and hit Sui
 */

import {
  SuiJsonRpcClient as SuiClient,
  JsonRpcHTTPTransport,
  getJsonRpcFullnodeUrl as getFullnodeUrl,
} from "@mysten/sui/jsonRpc";
import {
  SHINAMI_NODE_KEY,
  SHINAMI_NODE_URL,
  shinamiNodeEnabled,
} from "./shinami";

const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as
  | "testnet"
  | "mainnet"
  | "devnet";
const EXECUTE_RPC_URL = process.env.NEXT_PUBLIC_SUI_EXECUTE_RPC_URL ?? "";

export const SUI_COIN_TYPE = "0x2::sui::SUI";

// USDC is network-specific (testnet/mainnet have different packages).
// Fail loud at module-init if not configured rather than silently
// querying for an undefined coin type at runtime.
const usdcType = process.env.NEXT_PUBLIC_USDC_COIN_TYPE;
if (!usdcType) {
  throw new Error(
    "NEXT_PUBLIC_USDC_COIN_TYPE is not set. Pick the testnet or mainnet block in .env.local.",
  );
}
export const USDC_COIN_TYPE = usdcType;

const SUI_DECIMALS  = 9;
const USDC_DECIMALS = 6;

// Errors that should trigger fallback to the public RPC. We deliberately
// don't fall back on tx-level errors (e.g. "insufficient gas", "object
// not found at version") — those are deterministic and would just fail
// the same way on the fallback. Transport-level failures are what we
// want to route around.
function isRetryableRpcError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /429|too many requests|rate.?limit|5\d{2}\b|-32603|internalerror|internal error|fetch failed|network|timeout|ECONNRESET|ETIMEDOUT/i.test(
    err.message,
  );
}

/**
 * Wraps a primary SuiClient so any method call that throws a retryable
 * transport error transparently retries on the fallback client. Used to
 * route around Shinami rate limits / outages onto the public fullnode
 * without changing call sites.
 */
function withRpcFallback(primary: SuiClient, fallback: SuiClient): SuiClient {
  return new Proxy(primary, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return async (...args: unknown[]) => {
        try {
          return await (value as (...a: unknown[]) => Promise<unknown>).apply(
            target,
            args,
          );
        } catch (err) {
          if (!isRetryableRpcError(err)) throw err;
          if (typeof console !== "undefined") {
            console.warn(
              `[sui-client] primary RPC failed on ${String(prop)} — falling back`,
              err,
            );
          }
          const fb = Reflect.get(fallback, prop, fallback) as (
            ...a: unknown[]
          ) => Promise<unknown>;
          return await fb.apply(fallback, args);
        }
      };
    },
  });
}

let _client: SuiClient | null = null;
let _executeClient: SuiClient | null = null;
let _publicClient: SuiClient | null = null;

function suiPublicClient(): SuiClient {
  if (_publicClient) return _publicClient;
  _publicClient = new SuiClient({
    network: NETWORK,
    url: getFullnodeUrl(NETWORK),
  });
  return _publicClient;
}

export function suiReadClient(): SuiClient {
  if (_client) return _client;

  const publicClient = suiPublicClient();

  // Only opt into Shinami's Node Service as the primary RPC when a
  // dedicated, frontend-safe Node-only key is configured. This is
  // distinct from SHINAMI_API_KEY (server-only, has wallet+prover
  // rights). Shipping a wallet-capable key in the browser bundle would
  // let anyone with devtools create wallets / sign for users.
  if (!shinamiNodeEnabled()) {
    _client = publicClient;
    return _client;
  }

  const shinamiClient = new SuiClient({
    network: NETWORK,
    transport: new JsonRpcHTTPTransport({
      url: SHINAMI_NODE_URL,
      rpc: { headers: { "X-API-Key": SHINAMI_NODE_KEY } },
    }),
  });
  _client = withRpcFallback(shinamiClient, publicClient);
  return _client;
}

export function suiExecuteClient(): SuiClient {
  if (_executeClient) return _executeClient;
  if (!EXECUTE_RPC_URL) {
    _executeClient = suiReadClient();
    return _executeClient;
  }

  const executeClient = new SuiClient({
    network: NETWORK,
    url: EXECUTE_RPC_URL,
  });
  _executeClient = withRpcFallback(executeClient, suiReadClient());
  return _executeClient;
}

/** USDC balance in 10⁶ subunits — matches our internal `usdc_subunit`. */
export async function fetchUsdcSubunit(address: string): Promise<number> {
  try {
    const b = await suiReadClient().getBalance({
      owner:    address,
      coinType: USDC_COIN_TYPE,
    });
    return Number(b.totalBalance);
  } catch {
    return 0;
  }
}

/** Native SUI balance in MIST (10⁹ subunits per 1 SUI). */
export async function fetchSuiMist(address: string): Promise<number> {
  try {
    const b = await suiReadClient().getBalance({
      owner:    address,
      coinType: SUI_COIN_TYPE,
    });
    return Number(b.totalBalance);
  } catch {
    return 0;
  }
}

/**
 * Fetch all coin objects for a given type, paginated. Used by the send
 * flow to select coins for transactions. If the Sui fullnode's coin
 * index lags behind the balance index, this may temporarily return
 * fewer coins than `getBalance` reports — callers should retry.
 */
export async function fetchAllCoins(
  address: string,
  coinType: string,
): Promise<{ coinObjectId: string; version: string; digest: string; balance: string; coinType: string }[]> {
  const client = suiReadClient();
  const all = await fetchAllCoinsFromClient(client, address, coinType);
  const objectTotal = all.reduce(
    (sum, coin) => sum + BigInt(coin.balance),
    BigInt(0),
  );
  const balance = await client.getBalance({ owner: address, coinType });
  let indexedTotal = BigInt(balance.totalBalance);
  const publicClient = suiPublicClient();
  let publicBalanceCheckFailed = false;
  if (client !== publicClient) {
    try {
      const publicBalance = await publicClient.getBalance({ owner: address, coinType });
      const publicIndexedTotal = BigInt(publicBalance.totalBalance);
      if (publicIndexedTotal > indexedTotal) indexedTotal = publicIndexedTotal;
    } catch {
      publicBalanceCheckFailed = true;
    }
  }
  if (objectTotal >= indexedTotal) {
    if (publicBalanceCheckFailed) {
      const apiCoins = await fetchPublicCoinsViaApi(address, coinType).catch(() => null);
      if (apiCoins && coinTotal(apiCoins.coins) > objectTotal) return apiCoins.coins;
    }
    return all;
  }

  const publicAll = await fetchAllCoinsFromClient(publicClient, address, coinType).catch(
    () => null,
  );
  if (!publicAll) {
    const apiCoins = await fetchPublicCoinsViaApi(address, coinType).catch(() => null);
    if (apiCoins && coinTotal(apiCoins.coins) > objectTotal) return apiCoins.coins;
    return all;
  }
  const publicTotal = publicAll.reduce(
    (sum, coin) => sum + BigInt(coin.balance),
    BigInt(0),
  );
  if (publicTotal > objectTotal) return publicAll;
  return all;
}

function coinTotal(
  coins: { balance: string }[],
): bigint {
  return coins.reduce((sum, coin) => sum + BigInt(coin.balance), BigInt(0));
}

async function fetchPublicCoinsViaApi(
  address: string,
  coinType: string,
): Promise<{
  totalBalance: string;
  coins: {
    coinObjectId: string;
    version: string;
    digest: string;
    balance: string;
    coinType: string;
  }[];
}> {
  if (typeof window === "undefined") {
    throw new Error("same-origin coin fallback is only available in the browser");
  }
  const res = await fetch(
    `/api/sui/coins?owner=${encodeURIComponent(address)}&coinType=${encodeURIComponent(coinType)}`,
    { headers: { Accept: "application/json" } },
  );
  const json = (await res.json()) as {
    data?: {
      totalBalance: string;
      coins: {
        coinObjectId: string;
        version: string;
        digest: string;
        balance: string;
        coinType: string;
      }[];
    };
    error?: string;
  };
  if (!res.ok || !json.data) {
    throw new Error(json.error ?? "Could not fetch public Sui coins");
  }
  return json.data;
}

async function fetchAllCoinsFromClient(
  client: SuiClient,
  address: string,
  coinType: string,
): Promise<{ coinObjectId: string; version: string; digest: string; balance: string; coinType: string }[]> {
  const all: { coinObjectId: string; version: string; digest: string; balance: string; coinType: string }[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    const page = await client.getCoins({
      owner: address,
      coinType,
      ...(cursor ? { cursor } : {}),
    });
    all.push(...page.data);
    cursor = page.hasNextPage ? page.nextCursor : null;
  } while (cursor);
  return all;
}

export interface OnchainTx {
  digest:      string;
  timestampMs: number;
  /**
   * Signed amount in our internal "subunit" for the coin type we care
   * about (USDC subunits for USDC, MIST for SUI). Positive = inflow
   * to the queried address, negative = outflow.
   */
  amountUsdc:  number | null;
  amountSui:   number | null;
  /** First non-self counterparty address if we can identify one. */
  counterparty: string | null;
}

/**
 * Recent activity touching the address. We query both directions
 * (FromAddress + ToAddress), dedupe by digest, and project each tx
 * down to the user-facing fields we render.
 *
 * For now we only surface USDC and SUI movements — other coin types
 * are ignored (they show up as zero-amount entries client-side which
 * we filter out below).
 */
export async function fetchOnchainActivity(
  address: string,
  limit = 25,
): Promise<OnchainTx[]> {
  const client = suiReadClient();
  const opts = {
    showBalanceChanges: true,
    showInput:          true,
    showEffects:        false,
    showEvents:         false,
  } as const;

  const [outgoing, incoming] = await Promise.all([
    client
      .queryTransactionBlocks({
        filter: { FromAddress: address },
        options: opts,
        limit,
        order: "descending",
      })
      .catch(() => ({ data: [] as unknown[] })),
    client
      .queryTransactionBlocks({
        filter: { ToAddress: address },
        options: opts,
        limit,
        order: "descending",
      })
      .catch(() => ({ data: [] as unknown[] })),
  ]);

  type BalanceChange = {
    owner: { AddressOwner?: string } | string;
    coinType: string;
    amount: string;
  };
  type Block = {
    digest: string;
    timestampMs?: string | number | null;
    balanceChanges?: BalanceChange[];
  };

  const merged = [...(outgoing.data as Block[]), ...(incoming.data as Block[])];
  const seen = new Set<string>();
  const unique = merged.filter((tx) => {
    if (seen.has(tx.digest)) return false;
    seen.add(tx.digest);
    return true;
  });

  unique.sort(
    (a, b) =>
      Number(b.timestampMs ?? 0) - Number(a.timestampMs ?? 0),
  );

  const ownerOf = (o: BalanceChange["owner"]): string | null => {
    if (typeof o === "string") return o;
    return o?.AddressOwner ?? null;
  };

  return unique.slice(0, limit).map((tx) => {
    const changes = tx.balanceChanges ?? [];
    let amountUsdc: number | null = null;
    let amountSui: number | null = null;
    let counterparty: string | null = null;

    for (const c of changes) {
      const owner = ownerOf(c.owner);
      const amt = Number(c.amount);
      if (owner === address) {
        if (c.coinType === USDC_COIN_TYPE) amountUsdc = amt;
        else if (c.coinType === SUI_COIN_TYPE) amountSui = amt;
      } else if (!counterparty && owner) {
        counterparty = owner;
      }
    }

    return {
      digest:       tx.digest,
      timestampMs:  Number(tx.timestampMs ?? 0),
      amountUsdc,
      amountSui,
      counterparty,
    };
  });
}

/** Convert USDC subunit → display USDC float. */
export function usdcFromSubunit(subunit: number): number {
  return subunit / 10 ** USDC_DECIMALS;
}

/** Convert SUI MIST → display SUI float. */
export function suiFromMist(mist: number): number {
  return mist / 10 ** SUI_DECIMALS;
}
