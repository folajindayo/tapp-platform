/**
 * Typed Rails API client. Talks to tapp/rails-sui.
 *
 * Auth model:
 *   - Cardholder endpoints (`/v1/cards/...`) authenticate with the
 *     user's zkLogin-derived JWT, sent as `Authorization: Bearer`.
 *   - The public token redirect (`/c/:token`) is browser-native — we
 *     don't call it from JS; the URL just opens in the address bar.
 */

import { refreshAccessToken, formatApiErrorMessage } from "./auth";

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
    const rawMsg = formatApiErrorMessage(json, `Request failed (${res.status})`);
    throw new ApiError(
      res.status,
      rawMsg,
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

export interface CardRelinkRequest {
  card_uid_hash:    string; // hex sha256 of factory UID — must match the live card
  linking_proof:    string; // hex(HMAC(K', "linking-anchor-v1")) — fresh K
  pin_verifier:     string; // hex(HMAC(K,  "tapp-card-verifier-v1"))
  card_password:    string; // hex of 4-byte NTAG215 PWD
  current_token_ct: string; // hex of the fresh rotation token
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
  on_chain_balance?: string;
}

export interface ReclaimableCap {
  card_id: string;
  cap_object_id: string;
  coin_type: string;
  on_chain_balance: string;
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

export interface LinkSession {
  id: string;
  cardId: string;
  state: "started" | "provisioned" | "activated" | "abandoned" | "failed";
  /**
   * Hex token to write to the chip. Present once provisioned, and returned
   * again on every read of the session -- a client that lost its connection
   * mid-write resumes with the SAME value. Two different tokens written to
   * one chip is how a card ends up out of sync before it has ever been used.
   */
  writeToken?: string;
  failure?: string;
  expiresAt: string;
}

/**
 * Card linking, as one resumable session.
 *
 * Replaces the old claim/complete pair, which were two of four unrelated
 * endpoints with no state between them: any dropped connection meant repeating
 * a ceremony that generates a secret, writes it to a chip over NFC, and
 * commits a PIN proof. Every call here is idempotent, and `get` tells the
 * client where it got to.
 */
export const linkApi = {
  /** Claim a card by its activation token and open a session. */
  start: (activationToken: string, jwt: string) =>
    request<LinkSession>("POST", "/v1/cards/link/sessions", {
      body: { activation_token: activationToken },
      token: jwt,
    }),

  /** Where did this session get to? Safe to call at any point. */
  get: (sessionId: string, jwt: string) =>
    request<LinkSession>("GET", `/v1/cards/link/sessions/${sessionId}`, {
      token: jwt,
    }),

  /**
   * Commit the PIN proof and the chosen limits; receive the token to write.
   *
   * `pin_anchor` is HMAC(HMAC(K, PIN), "linking-anchor-v1"), computed here.
   * The server never sees K or the PIN, so a stolen database yields no ability
   * to impersonate a cardholder.
   */
  provision: (
    sessionId: string,
    body: {
      pin_anchor: string;
      per_tap_limit: string;
      step_up_limit: string;
      daily_limit: string;
    },
    jwt: string,
  ) =>
    request<LinkSession>(
      "POST",
      `/v1/cards/link/sessions/${sessionId}/provision`,
      { body, token: jwt },
    ),

  /**
   * Finish, presenting what was actually read back off the chip.
   *
   * The read-back is not a formality: an NFC write that reports success
   * without landing is common, and a card that goes live without holding its
   * token fails at a checkout counter instead of here.
   */
  activate: (
    sessionId: string,
    body: { card_uid_hash: string; read_back: string },
    jwt: string,
  ) =>
    request<LinkSession>(
      "POST",
      `/v1/cards/link/sessions/${sessionId}/activate`,
      { body, token: jwt },
    ),
};

export const cardsApi = {
  /**
   * Re-provision the SAME physical card after a torn write destroyed
   * its NDEF payload (resync can't run without K from the card). Runs
   * the full ceremony again — fresh K/PIN/token/password — but the
   * on-chain cap and its balance are untouched. The server accepts it
   * only when the chip's UID hash matches the live card's.
   */
  relink: (body: CardRelinkRequest, jwt: string) =>
    request<{ card_id: string }>("POST", "/v1/cards/me/relink", {
      body,
      token: jwt,
    }),

  /** Dashboard summary for the signed-in cardholder. */
  me: (jwt: string) =>
    request<CardSummary>("GET", "/v1/cards/me", { token: jwt }),

  /** Caps the holder owns — sign destroy_and_reclaim on each before reset. */
  reclaimable: (jwt: string) =>
    request<{ caps: ReclaimableCap[] }>("GET", "/v1/cards/reclaimable", { token: jwt }),

  /** Delete all the holder's card rows (refused while a cap still holds funds). */
  reset: (jwt: string) =>
    request<{ deleted: number }>("POST", "/v1/cards/reset", { token: jwt }),

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
