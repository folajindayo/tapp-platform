// Server-side proxy for the provider's token-transfer history API.
//
// Separate from /api/base/rpc because this is not standard JSON-RPC: it is the
// provider's Advanced API on a different endpoint, with a different method
// vocabulary. Keeping them apart means the RPC route's allowlist stays a list
// of real Ethereum methods rather than a mix.
//
// Same reasoning otherwise: the provider key lives here, never in the browser.

import { NextResponse } from "next/server";
import { AuthError, checkRateLimit, verifyRailsBearer } from "@/lib/rails-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRANSFERS_URL = process.env.BASE_TRANSFERS_API_URL ?? "";

const MAX_PAGE_SIZE = 100;

export async function POST(req: Request) {
  if (!TRANSFERS_URL) {
    return NextResponse.json(
      { error: "BASE_TRANSFERS_API_URL is not configured" },
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

  const limit = checkRateLimit(`base-transfers:${userId}`, { capacity: 30, refillMs: 60_000 });
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  let body: { address?: unknown; pageSize?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Body is not valid JSON" }, { status: 400 });
  }

  const address = typeof body.address === "string" ? body.address : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: "address must be a 20-byte hex address" }, { status: 400 });
  }

  const requested = Number(body.pageSize ?? 20);
  const pageSize =
    Number.isFinite(requested) && requested > 0 ? Math.min(Math.trunc(requested), MAX_PAGE_SIZE) : 20;

  let upstream: Response;
  try {
    upstream = await fetch(TRANSFERS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "ankr_getTokenTransfers",
        params: { address, blockchain: ["base"], descOrder: true, pageSize },
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unreachable";
    return NextResponse.json({ error: `Transfer history unreachable: ${message}` }, { status: 502 });
  }

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Transfer history returned ${upstream.status}` },
      { status: 502 },
    );
  }

  return NextResponse.json(await upstream.json());
}
