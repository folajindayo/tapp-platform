// Server-side proxy for Shinami's zkLogin wallet API.
//
// Hardened with:
//   * Zod schema validation on the request body
//   * Rails JWT verification on the caller (no anonymous use)
//   * Per-user rate limit (token bucket)
//   * Cache of (jwt, subWallet) → wallet (Shinami's response is
//     deterministic, so this avoids burning their monthly wallet
//     creation quota on benign repeats)
//   * Structured logging with per-request correlation IDs
//   * Salt normalized from Shinami's Base64 → BigInt-string at the
//     proxy boundary so the rest of the app sees one shape

import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "crypto";
import { mapShinamiError, type ShinamiErrorPayload } from "@/lib/shinami-errors";
import { saltToBigInt } from "@/lib/shinami";
import { TtlCache } from "@/lib/shinami-cache";
import {
  verifyRailsBearer,
  checkRateLimit,
  AuthError,
} from "@/lib/rails-auth";
import { logger, newRequestContext } from "@/lib/logger";

const ZKWALLET_URL =
  process.env.SHINAMI_ZKWALLET_URL ??
  "https://api.us1.shinami.com/sui/zkwallet/v1";

// Shinami keys are per-network. Pick the one matching the active
// network at request time so toggling NEXT_PUBLIC_SUI_NETWORK in the
// .env file automatically routes to the right Shinami project — no
// code change required.
function activeShinamiKey(): string | undefined {
  const net = process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet";
  if (net === "mainnet") {
    return process.env.SHINAMI_API_KEY_MAINNET ?? process.env.SHINAMI_API_KEY;
  }
  return process.env.SHINAMI_API_KEY_TESTNET ?? process.env.SHINAMI_API_KEY;
}

const BodySchema = z.object({
  jwt: z.string().min(20, "JWT looks too short"),
  subWallet: z.number().int().min(0).max(2 ** 31 - 1).optional().default(0),
});

interface CachedWallet {
  iss: string;
  aud: string;
  sub: string;
  subWallet: number;
  /** Already normalized to base-10 BigInt string. */
  salt: string;
  address: string;
}

// 15-minute TTL. JWTs typically live an hour; this is short enough
// that a revoked-and-rebound JWT recovers quickly while still
// absorbing the bulk of page-mount/refresh repeats.
const walletCache = new TtlCache<CachedWallet>(5000, 15 * 60_000);

// Per-user limit: 30 wallet calls / 60s. Generous for normal use
// (page mount, retries, multi-tab); tight enough to stop a runaway
// loop from draining Shinami quota.
const RATE_LIMIT = { capacity: 30, refillMs: 60_000 };

function cacheKey(jwt: string, subWallet: number): string {
  return createHash("sha256")
    .update(`${jwt}:${subWallet}`)
    .digest("hex");
}

function errorJson(err: ShinamiErrorPayload, status: number, reqId: string): Response {
  const res = NextResponse.json({ error: err, reqId }, { status });
  res.headers.set("x-request-id", reqId);
  return res;
}

export async function POST(req: Request): Promise<Response> {
  const ctx = newRequestContext();
  const t0 = Date.now();

  const apiKey = activeShinamiKey();
  if (!apiKey) {
    logger.error("shinami.wallet.misconfigured", ctx);
    return errorJson(
      {
        httpStatus: 500,
        userMessage: "Wallet service is not configured. Please contact support.",
        retryable: false,
        sessionExpired: false,
      },
      500,
      ctx.reqId,
    );
  }

  // 1. Authenticate the caller against Rails.
  let userId: string;
  try {
    const auth = await verifyRailsBearer(req);
    userId = auth.userId;
    ctx.userId = userId;
  } catch (err) {
    if (err instanceof AuthError) {
      logger.warn("shinami.wallet.auth_failed", ctx, { status: err.status });
      return errorJson(
        {
          httpStatus: err.status,
          userMessage: "Please sign in again to continue.",
          retryable: false,
          sessionExpired: true,
        },
        err.status,
        ctx.reqId,
      );
    }
    logger.error("shinami.wallet.auth_error", ctx, { err: String(err) });
    return errorJson(
      {
        httpStatus: 502,
        userMessage: "Auth service is unavailable. Please retry shortly.",
        retryable: true,
        sessionExpired: false,
      },
      502,
      ctx.reqId,
    );
  }

  // 2. Per-user rate limit.
  const rl = checkRateLimit(`shinami.wallet:${userId}`, RATE_LIMIT);
  if (!rl.ok) {
    logger.warn("shinami.wallet.rate_limited", ctx, { retryAfterMs: rl.retryAfterMs });
    const res = errorJson(
      {
        httpStatus: 429,
        userMessage: "You're going too fast. Please wait a moment and retry.",
        retryable: true,
        sessionExpired: false,
      },
      429,
      ctx.reqId,
    );
    res.headers.set("retry-after", String(Math.ceil(rl.retryAfterMs / 1000)));
    return res;
  }

  // 3. Validate input.
  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    logger.warn("shinami.wallet.bad_request", ctx, { err: String(err) });
    return errorJson(
      {
        httpStatus: 400,
        userMessage: "Bad request to wallet service.",
        retryable: false,
        sessionExpired: false,
      },
      400,
      ctx.reqId,
    );
  }

  // 4. Cache lookup.
  const key = cacheKey(body.jwt, body.subWallet);
  const cached = walletCache.get(key);
  if (cached) {
    logger.info("shinami.wallet.cache_hit", ctx, { durationMs: Date.now() - t0 });
    const res = NextResponse.json(cached);
    res.headers.set("x-request-id", ctx.reqId);
    res.headers.set("x-cache", "HIT");
    return res;
  }

  // 5. Forward to Shinami.
  const upstream = await fetch(ZKWALLET_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "shinami_zkw_getOrCreateZkLoginWallet",
      params: body.subWallet === 0 ? [body.jwt] : [body.jwt, "sub", body.subWallet],
    }),
  }).catch((err) => {
    logger.error("shinami.wallet.upstream_network", ctx, { err: String(err) });
    return new Response(null, { status: 502 });
  });

  if (!upstream.ok) {
    const e = mapShinamiError({ httpStatus: upstream.status, context: "wallet" });
    logger.warn("shinami.wallet.upstream_http_error", ctx, {
      status: upstream.status,
      durationMs: Date.now() - t0,
    });
    return errorJson(e, e.httpStatus, ctx.reqId);
  }

  const json = (await upstream.json()) as {
    result?: {
      userId: { iss: string; aud: string; keyClaimName: string; keyClaimValue: string };
      subWallet: number;
      salt: string;
      address: string;
    };
    error?: { code: number; message: string };
  };

  if (json.error) {
    const e = mapShinamiError({
      httpStatus: 200,
      rpcError: json.error,
      context: "wallet",
    });
    logger.warn("shinami.wallet.upstream_rpc_error", ctx, {
      code: json.error.code,
      durationMs: Date.now() - t0,
    });
    const status = e.sessionExpired ? 401 : e.retryable ? 503 : 400;
    return errorJson(e, status, ctx.reqId);
  }

  if (!json.result) {
    logger.error("shinami.wallet.upstream_no_result", ctx);
    return errorJson(
      mapShinamiError({ httpStatus: 502, context: "wallet" }),
      502,
      ctx.reqId,
    );
  }

  // 6. Normalize + cache + return.
  const out: CachedWallet = {
    iss: json.result.userId.iss,
    aud: json.result.userId.aud,
    sub: json.result.userId.keyClaimValue,
    subWallet: json.result.subWallet,
    salt: saltToBigInt(json.result.salt).toString(),
    address: json.result.address.startsWith("0x")
      ? json.result.address
      : "0x" + json.result.address,
  };
  walletCache.set(key, out);

  logger.info("shinami.wallet.ok", ctx, {
    sub: out.sub,
    addr: out.address.slice(0, 10) + "…",
    durationMs: Date.now() - t0,
  });

  const res = NextResponse.json(out);
  res.headers.set("x-request-id", ctx.reqId);
  res.headers.set("x-cache", "MISS");
  return res;
}
