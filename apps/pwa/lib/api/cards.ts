/**
 * Cards: linking a physical card, and living with one afterwards.
 */

import { request } from "./http";
import type { Money } from "./money";

// -----------------------------------------------------------------------------
// Cards (cardholder-scope) — see rails/docs/tapp-card-spec.md
// -----------------------------------------------------------------------------

export interface CardClaimResponse {
  card_id: string;
  status: "claimed" | "live";
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
  daily_limit_subunit: number;
  per_tap_limit_subunit: number;
  step_up_threshold_subunit: number;
  spent_today_subunit: number;
  /**
   * What the card can actually spend: the holder's ledger balance.
   *
   * Its predecessor was an on-chain "cap balance" read over RPC that answered
   * "0" whenever the node was unreachable -- so a node outage and an empty
   * card looked identical on this screen.
   */
  spendable: Money;
  needs_resync: boolean;
  pin_attempts_remaining: number;
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

  /** Delete the holder's card rows so they can link again from scratch. */
  reset: (jwt: string) =>
    request<{ deleted: number }>("POST", "/v1/cards/reset", { token: jwt }),

  /**
   * Stop the card. A revoked card is refused inside the debit transaction,
   * which is the only place a refusal counts.
   */
  revoke: (jwt: string) =>
    request<{ card_id: string; status: string }>("POST", "/v1/cards/revoke", {
      token: jwt,
    }),

  /** Save new spend limits. They are enforced from these values at debit. */
  updateLimits: (
    body: {
      daily_limit_subunit: number;
      per_tap_limit_subunit: number;
      step_up_threshold_subunit: number;
    },
    jwt: string,
  ) =>
    request<{
      daily_limit_subunit: number;
      per_tap_limit_subunit: number;
      step_up_threshold_subunit: number;
    }>("POST", "/v1/cards/me/limits", { body, token: jwt }),

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
