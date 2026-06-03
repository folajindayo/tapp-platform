import { NextResponse } from "next/server";
import { z } from "zod";
import { getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import {
  AuthError,
  checkRateLimit,
  verifyRailsBearer,
} from "@/lib/rails-auth";
import { logger, newRequestContext } from "@/lib/logger";

const NODE_URL =
  process.env.SHINAMI_NODE_URL ??
  process.env.NEXT_PUBLIC_SHINAMI_NODE_URL ??
  "https://api.us1.shinami.com/sui/node/v1";

function activeNetwork() {
  return (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as
    | "mainnet"
    | "testnet"
    | "devnet";
}

function activeShinamiKey(): string | undefined {
  const net = activeNetwork();
  if (net === "mainnet") {
    return process.env.SHINAMI_API_KEY_MAINNET ?? process.env.SHINAMI_API_KEY;
  }
  return process.env.SHINAMI_API_KEY_TESTNET ?? process.env.SHINAMI_API_KEY;
}

const BodySchema = z.object({
  txBytes: z.string().min(1),
  signatures: z.array(z.string().min(1)).min(1).max(2),
});

const RATE_LIMIT = { capacity: 20, refillMs: 60_000 };

function jsonError(message: string, status: number, reqId: string): Response {
  const res = NextResponse.json({ error: message, reqId }, { status });
  res.headers.set("x-request-id", reqId);
  return res;
}

async function readResponseBody(res: globalThis.Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

type ExecOutcome =
  | { kind: "ok"; result: { digest?: string } }
  | { kind: "provider_unavailable"; detail: string; httpStatus?: number; upstream?: unknown }
  | { kind: "rpc_reject"; code: number; message: string; data: unknown }
  | { kind: "malformed"; upstream: unknown };

async function executeOnce(
  url: string,
  apiKey: string | undefined,
  body: { txBytes: string; signatures: string[] },
  reqId: string,
): Promise<ExecOutcome> {
  let upstreamRes: globalThis.Response;
  let upstreamBody: unknown;
  try {
    upstreamRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "X-API-Key": apiKey } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: reqId,
        method: "sui_executeTransactionBlock",
        params: [
          body.txBytes,
          body.signatures,
          {
            showEffects: true,
            showEvents: true,
            showObjectChanges: true,
            showBalanceChanges: true,
          },
        ],
      }),
    });
    upstreamBody = await readResponseBody(upstreamRes);
  } catch (err) {
    return {
      kind: "provider_unavailable",
      detail: `network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!upstreamRes.ok) {
    return {
      kind: "provider_unavailable",
      detail: `HTTP ${upstreamRes.status}`,
      httpStatus: upstreamRes.status,
      upstream: upstreamBody,
    };
  }

  const rpcBody = upstreamBody as {
    result?: { digest?: string };
    error?: { code?: number; message?: string; data?: unknown };
  } | null;

  if (rpcBody?.error) {
    const code = rpcBody.error.code ?? -1;
    const message = rpcBody.error.message ?? "unknown rpc error";
    const data = rpcBody.error.data;
    // -32603 with no `data` is the opaque-provider symptom we've seen when the
    // Shinami backend is degraded — fall back. RPC errors with `data` are real
    // Sui-level rejects that any provider would return identically.
    if (code === -32603 && data === undefined) {
      return {
        kind: "provider_unavailable",
        detail: "rpc -32603 Internal error (no data)",
        upstream: rpcBody,
      };
    }
    return { kind: "rpc_reject", code, message, data };
  }

  if (!rpcBody?.result) {
    return { kind: "malformed", upstream: upstreamBody };
  }
  return { kind: "ok", result: rpcBody.result };
}

export async function POST(req: Request): Promise<Response> {
  const ctx = newRequestContext();
  const t0 = Date.now();

  let userId: string;
  try {
    const auth = await verifyRailsBearer(req);
    userId = auth.userId;
    ctx.userId = userId;
  } catch (err) {
    if (err instanceof AuthError) {
      logger.warn("sui.execute.auth_failed", ctx, { status: err.status });
      return jsonError("Please sign in again to continue.", err.status, ctx.reqId);
    }
    logger.error("sui.execute.auth_error", ctx, { err: String(err) });
    return jsonError("Auth service is unavailable.", 502, ctx.reqId);
  }

  const rl = checkRateLimit(`sui.execute:${userId}`, RATE_LIMIT);
  if (!rl.ok) {
    const res = jsonError("Too many submit attempts. Please retry shortly.", 429, ctx.reqId);
    res.headers.set("retry-after", String(Math.ceil(rl.retryAfterMs / 1000)));
    return res;
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    logger.warn("sui.execute.bad_request", ctx, { err: String(err) });
    return jsonError("Bad transaction submit request.", 400, ctx.reqId);
  }

  const apiKey = activeShinamiKey();
  const network = activeNetwork();
  const publicUrl = getJsonRpcFullnodeUrl(network);

  let provider: "shinami" | "public" | "public_fallback" = apiKey ? "shinami" : "public";
  let outcome = await executeOnce(apiKey ? NODE_URL : publicUrl, apiKey, body, ctx.reqId);

  if (apiKey && outcome.kind === "provider_unavailable") {
    logger.warn("sui.execute.shinami_unavailable_falling_back", ctx, {
      detail: outcome.detail,
      httpStatus: outcome.httpStatus,
      durationMs: Date.now() - t0,
    });
    provider = "public_fallback";
    outcome = await executeOnce(publicUrl, undefined, body, ctx.reqId);
  }

  switch (outcome.kind) {
    case "ok": {
      logger.info("sui.execute.ok", ctx, {
        digest: outcome.result.digest,
        durationMs: Date.now() - t0,
        provider,
      });
      const res = NextResponse.json(outcome.result);
      res.headers.set("x-request-id", ctx.reqId);
      return res;
    }
    case "rpc_reject": {
      logger.error("sui.execute.upstream_rpc_error", ctx, {
        code: outcome.code,
        message: outcome.message,
        data: outcome.data,
        durationMs: Date.now() - t0,
        provider,
      });
      const res = NextResponse.json(
        {
          error: outcome.message,
          code: outcome.code,
          data: outcome.data,
          provider,
          reqId: ctx.reqId,
        },
        { status: 502 },
      );
      res.headers.set("x-request-id", ctx.reqId);
      return res;
    }
    case "malformed": {
      logger.error("sui.execute.malformed_upstream_response", ctx, {
        body: outcome.upstream,
        durationMs: Date.now() - t0,
        provider,
      });
      const res = NextResponse.json(
        {
          error: "Malformed Sui execute RPC response",
          upstream: outcome.upstream,
          provider,
          reqId: ctx.reqId,
        },
        { status: 502 },
      );
      res.headers.set("x-request-id", ctx.reqId);
      return res;
    }
    case "provider_unavailable": {
      logger.error("sui.execute.provider_unavailable", ctx, {
        detail: outcome.detail,
        httpStatus: outcome.httpStatus,
        upstream: outcome.upstream,
        durationMs: Date.now() - t0,
        provider,
      });
      const res = NextResponse.json(
        {
          error: "Sui RPC provider unavailable",
          detail: outcome.detail,
          upstream: outcome.upstream,
          provider,
          reqId: ctx.reqId,
        },
        { status: 502 },
      );
      res.headers.set("x-request-id", ctx.reqId);
      return res;
    }
  }
}
