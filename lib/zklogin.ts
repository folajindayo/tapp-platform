// zkLogin scaffolding for the Tapp PWA — Shinami-backed.
//
// One provider for both testnet and mainnet. Calls go through our
// own /api/shinami/* backend proxies (Shinami doesn't support CORS,
// and the access key has signing rights that must stay server-side).
//
// Layering:
//
//   * /api/shinami/*  — proxies, hold SHINAMI_API_KEY, do Zod input
//                       validation, auth via Rails JWT, rate-limit,
//                       cache wallet lookups, log structured events.
//   * lib/shinami.ts  — client; talks to the proxies; retries on
//                       retryable errors with full-jitter backoff.
//   * lib/zklogin.ts  — this file; orchestrates the full flow
//                       (ephemeral kp + Shinami wallet + Rails
//                       sponsor + Shinami proof + Sui submit).
//
// Gas sponsorship still flows through Rails' /v1/gas-station/sponsor
// — Rails owns the aggregator wallet and order-context auth. Could
// migrate to Shinami's gas station later; out of scope here.

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  generateNonce,
  generateRandomness,
  getExtendedEphemeralPublicKey,
  genAddressSeed,
  getZkLoginSignature,
  type ZkLoginSignatureInputs,
} from "@mysten/sui/zklogin";
import { decodeJwt } from "jose";
import { suiReadClient } from "./sui-client";
import {
  shinamiCreateProof,
  shinamiGetOrCreateWallet,
  saltToBigInt,
  ShinamiClientError,
} from "./shinami";

const STORAGE_KEY = "tapp.zklogin.v1";

// Thrown when the session can't be used to authorize a payment and the
// only recovery is signing out + back in. Covers:
//
//   1. Rails JWT (gas-station sponsor) rejects with 401 / expired.
//   2. Shinami flags the JWT as expired / nonce-mismatched.
//   3. Sui rejects the zkLogin signature with "Groth16 proof verify
//      failed" — session's salt/maxEpoch/ephemeral key drifted, or
//      maxEpoch passed.
export class SessionExpiredError extends Error {
  constructor(message = "Your session has expired. Please sign in again.") {
    super(message);
    this.name = "SessionExpiredError";
  }
}

function isZkLoginVerifyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /Groth16 proof verify failed|Invalid user signature|zkLogin|signature is not valid/i.test(
    err.message,
  );
}

export interface ZkLoginSession {
  ephemeralPrivateKey: string;     // bech32 suiprivkey1…
  ephemeralPublicKey: string;      // Sui pubkey string (flag + bytes, base64)
  randomness: string;              // BigInt string used as JWT nonce input
  maxEpoch: number;                // proof expiry — typically currentEpoch + 2
  nonce: string;
  /** Sub-wallet id; lets one Google account have multiple wallets per app. */
  subWallet: number;
  /** Set once the Google JWT comes back. */
  jwt?: string;
  /** Salt normalized to base-10 BigInt string (Shinami's Base64 → BigInt). */
  salt?: string;
  /** Derived Sui address — must match the addressSeed in proofs. */
  suiAddress?: string;
}

export function suiClient() {
  return suiReadClient();
}

// -----------------------------------------------------------------------------
// Session bootstrap
// -----------------------------------------------------------------------------

/**
 * Initialize a fresh zkLogin session: ephemeral keypair, randomness,
 * maxEpoch (currentEpoch + 2 → ~24-48h validity), nonce. Persist for
 * the OAuth callback to pick up. `subWallet` lets the same Google
 * account address-derive to N independent wallets per app (default 0).
 */
export async function startZkLoginSession(opts: { subWallet?: number } = {}): Promise<ZkLoginSession> {
  const kp = new Ed25519Keypair();
  const ephemeralPublicKey = kp.getPublicKey().toSuiPublicKey();

  const { epoch } = await suiReadClient().getLatestSuiSystemState();
  const maxEpoch = Number(epoch) + 2;
  const randomness = generateRandomness();
  const nonce = generateNonce(kp.getPublicKey(), maxEpoch, randomness);

  const session: ZkLoginSession = {
    ephemeralPrivateKey: kp.getSecretKey(),
    ephemeralPublicKey,
    randomness,
    maxEpoch,
    nonce,
    subWallet: opts.subWallet ?? 0,
  };
  persistSession(session);
  return session;
}

/**
 * Complete the session given the JWT Google handed back. Looks up the
 * Shinami-managed salt + derived Sui address. Idempotent — same JWT
 * always returns the same address (per subWallet).
 *
 * Requires the caller's Rails JWT (`bearerToken`) so the proxy can
 * authorize the request and rate-limit per user.
 */
export async function completeZkLoginSession(
  jwt: string,
  bearerToken: string,
): Promise<ZkLoginSession> {
  const session = readSession();
  if (!session) throw new Error("No zkLogin session in progress");

  let wallet;
  try {
    wallet = await shinamiGetOrCreateWallet({
      jwt,
      bearerToken,
      subWallet: session.subWallet,
    });
  } catch (err) {
    if (err instanceof ShinamiClientError && err.payload.sessionExpired) {
      throw new SessionExpiredError(err.payload.userMessage);
    }
    throw err;
  }

  const suiAddress = wallet.address.startsWith("0x")
    ? wallet.address
    : "0x" + wallet.address;

  const updated: ZkLoginSession = {
    ...session,
    jwt,
    salt: wallet.salt,
    suiAddress,
  };
  persistSession(updated);
  return updated;
}

// -----------------------------------------------------------------------------
// PTB execution
// -----------------------------------------------------------------------------

/**
 * Build, sign with zkLogin, and submit a Sui transaction.
 *
 * `buildTx` populates a `Transaction` (caller's MoveCall, splits,
 * transfers, etc.). We add gas + signer + submit; the zkLogin proof
 * comes from Shinami.
 */
export async function executeZkLoginTx(
  buildTx: (tx: Transaction) => void | Promise<void>,
): Promise<{ digest: string; effects?: unknown }> {
  const session = readSession();
  if (!session?.jwt || !session.salt || !session.suiAddress) {
    throw new Error("zkLogin session not ready");
  }

  // The Rails JWT lives in the auth-layer's storage. We need it both
  // for /api/gas-station/sponsor and as the bearer for /api/shinami/*.
  const railsToken = readRailsToken();
  if (!railsToken) {
    throw new SessionExpiredError(
      "Please sign in again to authorize this transaction.",
    );
  }

  const tx = new Transaction();
  tx.setSender(session.suiAddress);
  await buildTx(tx);

  const client = suiClient();
  const ephemeralKp = restoreKeypair(session);

  const kindBytes = await tx.build({ client, onlyTransactionKind: true });
  const kindB64 = Buffer.from(kindBytes).toString("base64");

  // Rails-side gas sponsorship.
  const sponsorRes = await fetch("/api/gas-station/sponsor", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${railsToken}`,
    },
    body: JSON.stringify({ txBytes: kindB64, sender: session.suiAddress }),
  });
  if (!sponsorRes.ok) {
    const errorText = await sponsorRes.text();
    if (
      sponsorRes.status === 401 ||
      /invalid or expired token|token is expired/i.test(errorText)
    ) {
      throw new SessionExpiredError();
    }
    throw new Error(`Gas sponsorship failed: ${errorText}`);
  }
  const { sponsoredTxBytes, sponsorSignature } = (await sponsorRes.json()) as {
    sponsoredTxBytes: string;
    sponsorSignature: string;
  };

  const finalTxBytes = Uint8Array.from(Buffer.from(sponsoredTxBytes, "base64"));
  const { signature: ephemeralSig } = await ephemeralKp.signTransaction(finalTxBytes);

  // Shinami doesn't return `addressSeed` — compute locally from the
  // salt the wallet API gave us + JWT claims.
  let zkProof;
  try {
    zkProof = await shinamiCreateProof({
      jwt: session.jwt,
      maxEpoch: session.maxEpoch,
      extendedEphemeralPublicKey: getExtendedEphemeralPublicKey(
        ephemeralKp.getPublicKey(),
      ),
      jwtRandomness: session.randomness,
      salt: session.salt,
      bearerToken: railsToken,
    });
  } catch (err) {
    if (err instanceof ShinamiClientError && err.payload.sessionExpired) {
      throw new SessionExpiredError(err.payload.userMessage);
    }
    throw err;
  }

  const claims = decodeJwt(session.jwt);
  if (!claims.sub || !claims.aud) {
    throw new Error("Invalid JWT: missing sub or aud claim");
  }
  const aud = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
  const addressSeed = genAddressSeed(
    saltToBigInt(session.salt),
    "sub",
    claims.sub,
    aud,
  ).toString();

  const proof: Pick<
    ZkLoginSignatureInputs,
    "proofPoints" | "issBase64Details" | "headerBase64" | "addressSeed"
  > = { ...zkProof, addressSeed };

  const zkLoginSignature = getZkLoginSignature({
    inputs: proof,
    maxEpoch: session.maxEpoch,
    userSignature: ephemeralSig,
  });

  let result;
  try {
    result = await client.executeTransactionBlock({
      transactionBlock: finalTxBytes,
      signature: [zkLoginSignature, sponsorSignature],
      options: { showEffects: true },
    });
  } catch (err) {
    if (isZkLoginVerifyError(err)) {
      throw new SessionExpiredError(
        "Your sign-in needs to be refreshed. Please sign in again to continue.",
      );
    }
    throw err;
  }
  return { digest: result.digest, effects: result.effects };
}

// -----------------------------------------------------------------------------
// Storage helpers (browser-only)
// -----------------------------------------------------------------------------

function persistSession(s: ZkLoginSession): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function readSession(): ZkLoginSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as ZkLoginSession) : null;
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}

function readRailsToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem("tapp.session.v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { jwt?: string };
    return parsed.jwt ?? null;
  } catch {
    return null;
  }
}

function restoreKeypair(s: ZkLoginSession): Ed25519Keypair {
  const keyStr = s.ephemeralPrivateKey;

  if (keyStr.startsWith("suiprivkey")) {
    return Ed25519Keypair.fromSecretKey(keyStr);
  }

  let decoded: Uint8Array;
  try {
    decoded = b64ToBytes(keyStr);
  } catch {
    throw new Error(
      "Ephemeral key is corrupt — sign out and back in to create a fresh zkLogin session.",
    );
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
    if (text.startsWith("suiprivkey")) {
      return Ed25519Keypair.fromSecretKey(text);
    }
  } catch {
    /* fall through */
  }

  if (decoded.length === 32) return Ed25519Keypair.fromSecretKey(decoded);
  if (decoded.length === 64) return Ed25519Keypair.fromSecretKey(decoded.slice(0, 32));

  throw new Error(
    "Ephemeral key format is unrecognised — sign out and back in to create a fresh zkLogin session.",
  );
}

function b64ToBytes(s: string): Uint8Array {
  if (typeof atob !== "undefined") {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return Uint8Array.from(Buffer.from(s, "base64"));
}
