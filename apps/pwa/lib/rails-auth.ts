// Rails JWT verification for Tapp's backend proxy routes.
//
// Our /api/shinami/* routes forward to Shinami using a high-privilege
// access key. Without auth on the proxy, anyone could spam the
// endpoint to drain our Shinami wallet quota or rate-limit budget.
//
// We verify by calling Rails' /v1/me with the user's bearer token.
// Remote verification avoids needing Rails' JWT signing key in Tapp's
// env (no shared-secret drift), at the cost of an extra HTTP hop per
// proxied request. We cache verify results for 60s per token so the
// hop happens at most once per minute per user.

import { TtlCache } from "./shinami-cache";

const RAILS_BASE =
  process.env.RAILS_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE_URL ??
  "";

interface MeResponse {
  data?: {
    id?: string | number;
    email?: string;
    scope?: string;
  };
  status?: string;
}

// 60s TTL — JWT could be revoked but a one-minute staleness window
// is acceptable for proxy auth (the alternative is one extra Rails
// roundtrip on every Shinami call).
const verifyCache = new TtlCache<{ userId: string }>(1000, 60_000);

/**
 * Verify the bearer token in `Authorization` against Rails. Returns
 * the user id on success, throws AuthError on failure.
 */
export async function verifyRailsBearer(req: Request): Promise<{ userId: string }> {
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  if (!match) throw new AuthError(401, "Missing Authorization header");
  const token = match[1];

  const cached = verifyCache.get(token);
  if (cached) return cached;

  const res = await fetch(`${RAILS_BASE}/v1/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "ngrok-skip-browser-warning": "1",
    },
  });
  if (res.status === 401) throw new AuthError(401, "Invalid or expired session");
  if (!res.ok) throw new AuthError(502, `Rails /v1/me ${res.status}`);
  const body = (await res.json()) as MeResponse;
  const userId = body.data?.id != null ? String(body.data.id) : body.data?.email;
  if (!userId) throw new AuthError(502, "Rails /v1/me returned no id");
  const resolved = { userId };
  verifyCache.set(token, resolved);
  return resolved;
}

export class AuthError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

// ---------------------------------------------------------------------------
// Per-user rate limit (token bucket, in-memory).
//
// Bounds how often a single signed-in user can hit the proxy. Cheap
// defense against a compromised account or a buggy client looping the
// endpoint. Per-IP would be better behind a real edge (Cloudflare,
// Vercel WAF); per-user is what we can do at this layer.
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

export interface RateLimitOptions {
  /** Tokens per refill window. */
  capacity: number;
  /** Window length in ms. Tokens refill linearly across it. */
  refillMs: number;
}

export function checkRateLimit(
  key: string,
  opts: RateLimitOptions,
): { ok: boolean; retryAfterMs: number } {
  const now = Date.now();
  const b = buckets.get(key) ?? { tokens: opts.capacity, lastRefill: now };
  const elapsed = now - b.lastRefill;
  const refilled = Math.min(
    opts.capacity,
    b.tokens + (elapsed / opts.refillMs) * opts.capacity,
  );
  if (refilled < 1) {
    buckets.set(key, { tokens: refilled, lastRefill: now });
    return { ok: false, retryAfterMs: Math.ceil(((1 - refilled) * opts.refillMs) / opts.capacity) };
  }
  buckets.set(key, { tokens: refilled - 1, lastRefill: now });
  return { ok: true, retryAfterMs: 0 };
}
