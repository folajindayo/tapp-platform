"use client";

/**
 * Manual Google OAuth implicit-flow helpers.
 *
 * Why we don't use `@react-oauth/google`'s `<GoogleLogin>` widget: the
 * widget hides the OIDC `nonce` parameter, so we can't bind the JWT
 * to our zkLogin ephemeral keypair. Without that binding, the Mysten
 * prover rejects any zkLogin signature — meaning no on-chain signing
 * is possible. We do the redirect ourselves so the nonce travels.
 *
 * Flow:
 *   1. `startZkLoginSession()` → produces `nonce`.
 *   2. `buildGoogleAuthUrl({ ..., nonce })` → redirect URL.
 *   3. window.location.assign(url) → Google.
 *   4. User picks an account → Google redirects to `redirectUri#id_token=...`.
 *   5. `parseGoogleAuthFragment(window.location.hash)` → idToken.
 *   6. `completeZkLoginSession(idToken)` (from `lib/zklogin.ts`) →
 *      verifies the nonce matches, fetches the user salt, derives
 *      the real Sui address.
 *
 * Setup note: the `redirect_uri` we send to Google MUST be registered
 * as an Authorized redirect URI in Google Cloud Console for this
 * OAuth client. For local dev: `http://localhost:3000/sign-in`.
 * For prod: `https://app.zoracle.com/sign-in` (or wherever the PWA
 * is hosted).
 */

const GOOGLE_AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";

export interface BuildAuthUrlParams {
  clientId:    string;
  redirectUri: string;
  nonce:       string;
  /** Optional CSRF state param. We're already bound by nonce; state is bonus. */
  state?: string;
  prompt?: string;
  loginHint?: string;
}

export function buildGoogleAuthUrl({
  clientId,
  redirectUri,
  nonce,
  state,
  prompt,
  loginHint,
}: BuildAuthUrlParams): string {
  const params = new URLSearchParams({
    client_id:     clientId,
    redirect_uri:  redirectUri,
    response_type: "id_token",
    scope:         "openid email profile",
    nonce,
  });
  
  // If prompt is explicitly passed, use it. Otherwise, default to "select_account"
  // ONLY if loginHint is not provided. If loginHint is provided, omit prompt to allow
  // seamless automatic account authentication without prompting.
  const activePrompt = prompt !== undefined ? prompt : (loginHint ? "" : "select_account");
  if (activePrompt) {
    params.set("prompt", activePrompt);
  }
  if (loginHint) {
    params.set("login_hint", loginHint);
  }
  if (state) params.set("state", state);
  return `${GOOGLE_AUTH_BASE}?${params.toString()}`;
}

export interface ParsedFragment {
  idToken: string | null;
  state:   string | null;
  /** Google reports errors here when the user cancels or scopes are denied. */
  error:   string | null;
}

export function parseGoogleAuthFragment(hash: string): ParsedFragment {
  if (!hash || hash === "#") {
    return { idToken: null, state: null, error: null };
  }
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  const params = new URLSearchParams(trimmed);
  return {
    idToken: params.get("id_token"),
    state:   params.get("state"),
    error:   params.get("error_description") ?? params.get("error"),
  };
}

/** Reasonable default redirect URI for the running browser. */
export function defaultRedirectUri(): string {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}/sign-in`;
}
