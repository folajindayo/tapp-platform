// Server-side Base JSON-RPC proxy.
//
// The browser must never hold the RPC provider key. A previous revision put
// an Ankr key literally in lib/ankr-base.ts as the default for
// NEXT_PUBLIC_BASE_RPC_URL, which shipped it to every visitor and committed it
// to the repository -- rotating that key without moving the call server-side
// would only reset the clock on the same leak.
//
// So the key lives here, in BASE_RPC_URL (no NEXT_PUBLIC_ prefix), and the
// browser calls this route instead. Same shape as the existing
// /api/shinami/* proxies: verify the caller against Rails, rate-limit per
// user, forward, return.
//
// The method allowlist is the point of the route, not decoration: an open
// proxy to a paid RPC endpoint is a billing liability and an abuse vector, so
// only the two read calls the wallet screen actually makes are permitted.

import { NextResponse } from "next/server";
import { AuthError, checkRateLimit, verifyRailsBearer } from "@/lib/rails-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RPC_URL = process.env.BASE_RPC_URL ?? "";

/** Read-only calls the wallet screen makes. Nothing else is forwarded. */
const ALLOWED_METHODS = new Set(["eth_call", "eth_getBalance", "eth_blockNumber"]);

/** A batch is two calls today (USDC balanceOf + native balance). */
const MAX_BATCH = 8;

interface RpcCall {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  params?: unknown;
}

export async function POST(req: Request) {
  // Fail loudly rather than silently falling back to a public endpoint. A
  // deployment with no RPC configured should be obvious the first time
  // somebody opens the wallet, not a mystery about why balances read zero.
  if (!RPC_URL) {
    return NextResponse.json(
      { error: "BASE_RPC_URL is not configured" },
      { status: 503 },
    );
  }

  let userId: string;
  try {
    ({ userId } = await verifyRailsBearer(req));
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    const message = err instanceof Error ? err.message : "Authentication failed";
    return NextResponse.json({ error: message }, { status });
  }

  const limit = checkRateLimit(`base-rpc:${userId}`, { capacity: 60, refillMs: 60_000 });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Body is not valid JSON" }, { status: 400 });
  }

  const calls: RpcCall[] = Array.isArray(body) ? body : [body as RpcCall];
  if (calls.length === 0 || calls.length > MAX_BATCH) {
    return NextResponse.json(
      { error: `A batch must carry between 1 and ${MAX_BATCH} calls` },
      { status: 400 },
    );
  }
  for (const call of calls) {
    if (typeof call?.method !== "string" || !ALLOWED_METHODS.has(call.method)) {
      return NextResponse.json(
        { error: `Method not permitted: ${String(call?.method)}` },
        { status: 403 },
      );
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "RPC unreachable";
    return NextResponse.json({ error: `Base RPC unreachable: ${message}` }, { status: 502 });
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Base RPC returned ${upstream.status}` },
      { status: 502 },
    );
  }

  return NextResponse.json(await upstream.json());
}
