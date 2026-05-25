// Server-side proxy for Shinami's zkLogin prover API.
//
// Hardened with:
//   * Zod schema validation
//   * Rails JWT verification (no anonymous access)
//   * Per-user rate limit — tighter than wallet because Shinami caps
//     proof generation at 2 per address per minute
//   * Structured logging with per-request correlation IDs
//
// We deliberately don't cache proofs: the inputs (ephemeral pubkey,
// randomness, maxEpoch, salt) define a one-shot signing session
// that's bound to a single tx. Caching wouldn't be reusable.

import { NextResponse } from "next/server";
import { z } from "zod";
import { mapShinamiError, type ShinamiErrorPayload } from "@/lib/shinami-errors";
import {
  verifyRailsBearer,
  checkRateLimit,
  AuthError,
} from "@/lib/rails-auth";
import { logger, newRequestContext } from "@/lib/logger";

const ZKPROVER_URL =
  process.env.SHINAMI_ZKPROVER_URL ??
  "https://api.us1.shinami.com/sui/zkprover/v1";

function activeShinamiKey(): string | undefined {
  const net = process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet";
  if (net === "mainnet") {
    return process.env.SHINAMI_API_KEY_MAINNET ?? process.env.SHINAMI_API_KEY;
  }
  return process.env.SHINAMI_API_KEY_TESTNET ?? process.env.SHINAMI_API_KEY;
}

const BodySchema = z.object({
  jwt: z.string().min(20, "JWT looks too short"),
  maxEpoch: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),
  extendedEphemeralPublicKey: z.string().min(1),
  jwtRandomness: z.string().min(1),
  salt: z.string().min(1),
});

// Per-user: 4 calls / 60s. Shinami's own cap is 2 proofs per address
// per minute; we leave a touch of headroom for genuine multi-tab use.
const RATE_LIMIT = { capacity: 4, refillMs: 60_000 };

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
    logger.error("shinami.prover.misconfigured", ctx);
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

  let userId: string;
  try {
    const auth = await verifyRailsBearer(req);
    userId = auth.userId;
    ctx.userId = userId;
  } catch (err) {
    if (err instanceof AuthError) {
      logger.warn("shinami.prover.auth_failed", ctx, { status: err.status });
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
    logger.error("shinami.prover.auth_error", ctx, { err: String(err) });
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

  const rl = checkRateLimit(`shinami.prover:${userId}`, RATE_LIMIT);
  if (!rl.ok) {
    logger.warn("shinami.prover.rate_limited", ctx, { retryAfterMs: rl.retryAfterMs });
    const res = errorJson(
      {
        httpStatus: 429,
        userMessage:
          "Too many sign attempts in a short window. Please wait about a minute and try again.",
        retryable: true,
        sessionExpired: false,
      },
      429,
      ctx.reqId,
    );
    res.headers.set("retry-after", String(Math.ceil(rl.retryAfterMs / 1000)));
    return res;
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    logger.warn("shinami.prover.bad_request", ctx, { err: String(err) });
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

  const upstream = await fetch(ZKPROVER_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "shinami_zkp_createZkLoginProof",
      params: [
        body.jwt,
        String(body.maxEpoch),
        body.extendedEphemeralPublicKey,
        body.jwtRandomness,
        body.salt,
      ],
    }),
  }).catch((err) => {
    logger.error("shinami.prover.upstream_network", ctx, { err: String(err) });
    return new Response(null, { status: 502 });
  });

  if (!upstream.ok) {
    const e = mapShinamiError({ httpStatus: upstream.status, context: "prover" });
    logger.warn("shinami.prover.upstream_http_error", ctx, {
      status: upstream.status,
      durationMs: Date.now() - t0,
    });
    return errorJson(e, e.httpStatus, ctx.reqId);
  }

  const json = (await upstream.json()) as {
    result?: {
      proofPoints: { a: string[]; b: string[][]; c: string[] };
      issBase64Details: { value: string; indexMod4: number };
      headerBase64: string;
    };
    error?: { code: number; message: string };
  };

  if (json.error) {
    const e = mapShinamiError({
      httpStatus: 200,
      rpcError: json.error,
      context: "prover",
    });
    logger.warn("shinami.prover.upstream_rpc_error", ctx, {
      code: json.error.code,
      durationMs: Date.now() - t0,
    });
    const status = e.sessionExpired ? 401 : e.retryable ? 503 : 400;
    return errorJson(e, status, ctx.reqId);
  }

  if (!json.result) {
    logger.error("shinami.prover.upstream_no_result", ctx);
    return errorJson(
      mapShinamiError({ httpStatus: 502, context: "prover" }),
      502,
      ctx.reqId,
    );
  }

  logger.info("shinami.prover.ok", ctx, { durationMs: Date.now() - t0 });

  const res = NextResponse.json(json.result);
  res.headers.set("x-request-id", ctx.reqId);
  return res;
}
