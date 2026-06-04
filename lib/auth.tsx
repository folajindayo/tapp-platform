"use client";

/**
 * Auth for the Tapp PWA.
 *
 * Cardholder sign-in goes through Google OAuth: the PWA gets a Google
 * ID token via @react-oauth/google, POSTs it to Rails
 * `/v1/auth/google`, which verifies against Google's JWKS, finds or
 * creates the User, and returns a Rails JWT pair.
 *
 * v1.x lift: stack the Mysten zkLogin proof on top of the Google ID
 * token before exchanging — same surface here, the swap happens in
 * `signInWithGoogleCredential` below.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { decodeJwt } from "jose";
import { sha256 } from "@noble/hashes/sha2.js";
import { jwtToAddress } from "@mysten/sui/zklogin";
import {
  completeZkLoginSession,
  readSession as readZkLoginSession,
  isZkLoginSessionExpired,
} from "./zklogin";

export interface Session {
  jwt: string;
  refreshJwt: string;
  email: string;
  scope: string;
  /**
   * Sui address bound to this session.
   *
   *   - If `zkLoginReady === true`: this address was derived through
   *     the proper zkLogin pipeline (nonce-bound JWT + real Mysten
   *     salt) and CAN be used to sign on-chain txs via
   *     `executeZkLoginTx` (lib/zklogin.ts).
   *   - If `zkLoginReady === false`: the address came from the
   *     `devSalt` fallback. Real-shape and stable per-user, but the
   *     prover will reject signatures until the user signs in again
   *     through the full OAuth+nonce flow.
   *
   * Empty string if derivation failed entirely.
   */
  suiAddress: string;

  /**
   * True when the address was produced by the full zkLogin pipeline.
   * Components that need to sign Sui txs should gate on this flag and
   * surface a "complete sign-in for on-chain signing" CTA otherwise.
   */
  zkLoginReady: boolean;
}

/**
 * Deterministic per-user dev salt. `sub` is the Google account id;
 * we hash it with a fixed app-scoped string and truncate to 16 bytes
 * (the size zkLogin expects for the user salt). Production swap-in:
 * call the real salt service (lib/zklogin.ts `fetchSalt`).
 */
function devSalt(sub: string): string {
  const hash = sha256(new TextEncoder().encode("tapp.dev.salt.v1:" + sub));
  let n = BigInt(0);
  const eight = BigInt(8);
  for (let i = 0; i < 16; i++) n = (n << eight) | BigInt(hash[i]);
  return n.toString();
}

function deriveSuiAddress(idToken: string): string {
  try {
    const claims = decodeJwt(idToken);
    const sub = typeof claims.sub === "string" ? claims.sub : null;
    if (!sub) return "";
    return jwtToAddress(idToken, devSalt(sub), false);
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn("zkLogin address derivation failed:", err);
    }
    return "";
  }
}

const STORAGE_KEY = "tapp.session.v1";
const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

interface GoogleAuthResponse {
  access_token: string;
  refresh_token: string;
  email: string;
  scope: string;
  is_new_user: boolean;
}

interface RailsEnvelope<T> {
  status: "success" | "error";
  message: string;
  data?: T;
}

/**
 * Full sign-in completion. Used by the OAuth callback in
 * `app/sign-in/page.tsx`. Two things in sequence:
 *
 *   1. Complete the in-flight zkLogin session — verifies the JWT's
 *      `nonce` matches the ephemeral pubkey we generated before the
 *      redirect, fetches the user's salt from Mysten's salt service,
 *      and derives the *real* Sui address.
 *   2. Exchange the same Google ID token with Rails for the cardholder
 *      API JWT (this is what /v1/cards/* and /v1/wallet/* expect).
 *
 * If zkLogin completion fails (no in-flight session, nonce mismatch,
 * salt service down), we fall back to the dev-grade derivation so
 * sign-in still works — but the resulting address won't be signable
 * for on-chain operations. The caller can see this by checking
 * `Session.zkLoginReady`.
 */
export async function completeAuth(idToken: string): Promise<Session> {
  // Rails sign-in first — we need its JWT to authorize the Shinami
  // wallet/proof proxies in the next step. Without this ordering,
  // completeZkLoginSession would have no bearer token to send.
  const railsSession = await signInWithGoogleCredential(idToken);

  let zkAddress: string | null = null;
  try {
    const zk = await completeZkLoginSession(idToken, railsSession.jwt);
    zkAddress = zk.suiAddress ?? null;
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn(
        "zkLogin completion failed — sign-in continues with dev-grade address. " +
          "On-chain signing will be blocked until this is resolved.",
        err,
      );
    }
  }

  if (!zkAddress) return railsSession;

  // Re-persist the session with the proper zkLogin-derived address.
  const upgraded: Session = {
    ...railsSession,
    suiAddress: zkAddress,
    zkLoginReady: true,
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(upgraded));
  }
  return upgraded;
}

/**
 * Exchange a Google ID-token credential for a Rails session JWT.
 * `presetAddress` lets the caller plug in a zkLogin-derived address
 * (proper) instead of the dev-salt fallback.
 */
export async function signInWithGoogleCredential(
  idToken: string,
  presetAddress?: string | null,
): Promise<Session> {
  const res = await fetch(`${API_BASE}/v1/auth/google`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Client-Type": "web",
      "ngrok-skip-browser-warning": "1",
    },
    body: JSON.stringify({ id_token: idToken }),
  });
  const body = (await res.json()) as RailsEnvelope<GoogleAuthResponse>;
  if (!res.ok || body.status !== "success" || !body.data) {
    throw new Error(body.message || `Google sign-in failed (${res.status})`);
  }

  const session: Session = {
    jwt: body.data.access_token,
    refreshJwt: body.data.refresh_token,
    email: body.data.email,
    scope: body.data.scope,
    suiAddress: presetAddress || deriveSuiAddress(idToken),
    zkLoginReady: !!presetAddress,
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }
  return session;
}

export function signOut(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

function readSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    
    // Check if the underlying zkLogin session is valid and not expired.
    const zk = readZkLoginSession();
    const zkValid = zk && !isZkLoginSessionExpired(zk) && zk.suiAddress === parsed.suiAddress;
    
    parsed.zkLoginReady = !!zkValid;
    return parsed;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/*  Shared session context                                            */
/* ------------------------------------------------------------------ */

interface SessionCtx {
  session: Session | null;
  hydrated: boolean;
  refresh: () => void;
  clear: () => void;
  login: (session: Session) => void;
}

const SessionContext = createContext<SessionCtx | null>(null);

/**
 * Wrap the app in `<SessionProvider>` so every `useSession()` call
 * shares a single session state. When any component calls `refresh()`
 * or `clear()`, every consumer re-renders with the new value.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setSession(readSession());
    setHydrated(true);
  }, []);

  const refresh = useCallback(() => setSession(readSession()), []);

  const clear = useCallback(() => {
    signOut();
    setSession(null);
  }, []);

  const login = useCallback((newSession: Session) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(newSession));
    }
    setSession(newSession);
  }, []);

  return (
    <SessionContext.Provider value={{ session, hydrated, refresh, clear, login }}>
      {children}
    </SessionContext.Provider>
  );
}

/**
 * Reactive session hook. Must be used inside a `<SessionProvider>`.
 * All consumers share the same state — calling `refresh()` in one
 * component immediately updates the BottomNav, Navbar, etc.
 */
export function useSession(): SessionCtx {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error("useSession() must be used inside <SessionProvider>");
  }
  return ctx;
}
