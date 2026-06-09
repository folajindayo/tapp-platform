/**
 * Typed Rails API client. Talks to tapp/rails-sui.
 *
 * Auth model:
 *   - Cardholder endpoints (`/v1/cards/...`) authenticate with the
 *     user's zkLogin-derived JWT, sent as `Authorization: Bearer`.
 *   - The public token redirect (`/c/:token`) is browser-native — we
 *     don't call it from JS; the URL just opens in the address bar.
 */

import { refreshAccessToken } from "./auth";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly data?: unknown;

  constructor(status: number, message: string, code?: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

interface RailsEnvelope<T> {
  status: "success" | "error";
  message: string;
  data?: T;
}

interface RequestOptions {
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
}

async function request<T>(
  method: string,
  path: string,
  { body, token, signal }: RequestOptions = {},
  retried = false,
): Promise<T> {
  const headers: Record<string, string> = {
    "ngrok-skip-browser-warning": "1",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  const json = (await res.json().catch(() => ({}))) as RailsEnvelope<T>;

  if (!res.ok || json.status === "error") {
    // The rails access JWT lives ~15 min. On a 401, silently refresh it
    // (rotating the refresh token) and retry the request once with the
    // fresh token, so an expired access token never surfaces to the user.
    if (res.status === 401 && token && !retried && !path.startsWith("/v1/auth/")) {
      const fresh = await refreshAccessToken(token);
      if (fresh) {
        return request<T>(method, path, { body, token: fresh, signal }, true);
      }
    }
    throw new ApiError(
      res.status,
      json.message ?? `Request failed (${res.status})`,
      typeof json.data === "object" && json.data !== null && "code" in (json.data as Record<string, unknown>)
        ? String((json.data as Record<string, unknown>).code)
        : undefined,
      json.data,
    );
  }

  return json.data as T;
}

// -----------------------------------------------------------------------------
// Cards (cardholder-scope) — see rails/docs/tapp-card-spec.md
// -----------------------------------------------------------------------------

export interface CardClaimResponse {
  card_id: string;
  status: "claimed" | "live";
}

export interface CardLinkCompleteRequest {
  card_uid_hash:               string; // hex sha256 of factory UID
  cap_object_id:               string; // Sui object id from create_cap tx
  coin_type:                   string; // e.g. "0x...::usdc::USDC"
  linking_proof:               string; // hex(HMAC(K', "linking-anchor-v1"))
  pin_verifier:                string; // hex(HMAC(K,  "tapp-card-verifier-v1"))
  card_password:               string; // hex of 4-byte NTAG215 PWD
  current_token_ct:            string; // hex of initial rotation token
  tx_digest:                   string; // Sui digest of create_cap
  daily_limit_subunit:         number;
  per_tap_limit_subunit:       number;
  step_up_threshold_subunit:   number;
}

export interface CardSummary {
  id: string;
  status: "issued" | "claimed" | "live" | "revoked" | "locked";
  cap_object_id?: string;
  coin_type?: string;
  daily_limit_subunit: number;
  per_tap_limit_subunit: number;
  step_up_threshold_subunit: number;
  spent_today_subunit: number;
  needs_resync: boolean;
  pin_attempts_remaining: number;
}

export interface PtbSkeleton {
  package_id: string;
  module: string;
  function: string;
  type_args: string[];
  args: unknown[];
  note?: string;
}

export interface ResyncPayload {
  current_token_ct: string;
  card_password: string;
  resync_nonce: string;
}

export const cardsApi = {
  /** Claim a freshly-issued card by its activation token (Act 1). */
  claim: (token: string, jwt: string) =>
    request<CardClaimResponse>("POST", "/v1/cards/link/claim", {
      body: { token },
      token: jwt,
    }),

  /**
   * Complete linking after PWA: writes K to card, builds + signs
   * create_cap PTB, and POSTs all the verifier bytes here so the
   * server can validate per-debit PIN responses later.
   */
  linkComplete: (body: CardLinkCompleteRequest, jwt: string) =>
    request<{ card_id: string; status: "live" }>(
      "POST",
      "/v1/cards/link/complete",
      { body, token: jwt },
    ),

  /** Dashboard summary for the signed-in cardholder. */
  me: (jwt: string) =>
    request<CardSummary>("GET", "/v1/cards/me", { token: jwt }),

  /** Returns the PTB skeleton the PWA signs to add USDC to the cap. */
  topUp: (amount_subunit: number, jwt: string) =>
    request<PtbSkeleton>("POST", "/v1/cards/top-up", {
      body: { amount_subunit },
      token: jwt,
    }),

  /** Returns the PTB skeleton the PWA signs to flip set_revoked(true). */
  revoke: (jwt: string) =>
    request<PtbSkeleton>("POST", "/v1/cards/revoke", { token: jwt }),

  /**
   * Persists new spend limits to the off-chain mirror (read back via `me`)
   * and returns the `update_limits` PTB skeleton for on-chain enforcement.
   */
  updateLimits: (
    body: {
      daily_limit_subunit: number;
      per_tap_limit_subunit: number;
      step_up_threshold_subunit: number;
    },
    jwt: string,
  ) =>
    request<PtbSkeleton>("POST", "/v1/cards/me/limits", { body, token: jwt }),

  /** Issues the canonical rotation token + a one-shot nonce. */
  resync: (jwt: string) =>
    request<ResyncPayload>("POST", "/v1/cards/me/resync", { token: jwt }),

  /** Confirms the cardholder wrote the token back to the card. */
  resyncComplete: (resync_nonce: string, jwt: string) =>
    request<{ acknowledged: true }>(
      "POST",
      "/v1/cards/me/resync/complete",
      { body: { resync_nonce }, token: jwt },
    ),

  /** Parse a step-up token to display merchant & payment details. */
  stepUpParse: (token: string, jwt: string) =>
    request<StepUpDetails>("POST", "/v1/cards/me/step-up/parse", {
      body: { token },
      token: jwt,
    }),

  /** Grant a step-up token using a WebAuthn biometric assertion. */
  stepUpGrant: (token: string, webauthnAssertion: any, jwt: string) =>
    request<StepUpGrantResponse>("POST", "/v1/cards/me/step-up/grant", {
      body: { token, webauthn_assertion: webauthnAssertion },
      token: jwt,
    }),
};

export interface StepUpDetails {
  amount: string;
  currency: string;
  expires_at: string;
  card_id: string;
  merchant_name: string;
}

export interface StepUpGrantResponse {
  acknowledged: boolean;
}
