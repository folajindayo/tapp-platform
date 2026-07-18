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
import { Transaction, TransactionDataBuilder } from "@mysten/sui/transactions";
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

export function isZkLoginSessionExpired(session: ZkLoginSession | null): boolean {
  if (!session) {
    if (typeof window !== "undefined") console.warn("[zkLogin] session is null");
    return true;
  }
  if (!session.jwt) {
    if (typeof window !== "undefined") console.warn("[zkLogin] session.jwt is missing");
    return true;
  }
  try {
    const claims = decodeJwt(session.jwt);
    if (claims.exp) {
      const now = Date.now() / 1000;
      const isExpired = now >= claims.exp - 300;
      if (isExpired) {
        console.warn(`[zkLogin] JWT token expired: now=${now}, exp=${claims.exp}, diff=${claims.exp - now}`);
      }
      return isExpired;
    } else {
      if (typeof window !== "undefined") console.warn("[zkLogin] JWT claims.exp is missing");
    }
  } catch (err) {
    if (typeof window !== "undefined") console.error("[zkLogin] failed to decode JWT:", err);
    return true;
  }
  return false;
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
export interface ExecuteZkLoginOptions {
  /**
   * When true, skip the Rails gas-station sponsorship and pay gas
   * from the user's own SUI balance. Requires the wallet to hold
   * enough SUI to cover the transaction gas (~0.01 SUI is plenty).
   *
   * Use this as a fallback when the sponsor service is unhappy, or
   * for power users who'd rather not depend on our hot wallet.
   */
  selfSponsor?: boolean;
}

export async function executeZkLoginTx(
  buildTx: ((tx: Transaction) => void | Promise<void>) | Transaction,
  opts: ExecuteZkLoginOptions = {},
): Promise<{ digest: string; effects?: unknown }> {
  // Tag each major step so a bare "Cannot read properties of undefined"
  // from a minified SDK frame still tells us which leg crashed. Remove
  // this scaffolding once the withdraw-error investigation is closed.
  const tag = async <T>(step: string, fn: () => Promise<T> | T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      // Re-throw with a step prefix but preserve `cause` so the
      // original stack survives for DevTools.
      const msg = err instanceof Error ? err.message : String(err);
      const wrapped = new Error(`[zkLogin step:${step}] ${msg}`, { cause: err });
      if (err instanceof Error && err.stack) wrapped.stack = err.stack;
      throw wrapped;
    }
  };

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

  const tx = await tag("init-tx", async () => {
    if (buildTx instanceof Transaction) {
      buildTx.setSender(session.suiAddress!);
      return buildTx;
    }
    const t = new Transaction();
    t.setSender(session.suiAddress!);
    await buildTx(t);
    return t;
  });

  const client = suiClient();
  const ephemeralKp = await tag("restore-keypair", () => restoreKeypair(session));

  // Two paths:
  //
  // - Sponsored (default): kind-only build → POST to Rails → Rails
  //   wraps it with its own gas coin + sponsor signature → we sign
  //   the wrapped bytes with the ephemeral key + zkLogin proof, and
  //   submit with BOTH signatures.
  //
  // - Self-sponsor: full build (the SDK auto-picks a gas coin from
  //   the user's own SUI), sign once with ephemeral+zkLogin, submit
  //   with just that signature.
  let finalTxBytes: Uint8Array;
  let sponsorSignature: string | null = null;

  if (opts.selfSponsor) {
    finalTxBytes = await tag("tx-build-full", () => tx.build({ client }));
  } else {
    const kindBytes = await tag("tx-build-kind", () =>
      tx.build({ client, onlyTransactionKind: true }),
    );
    const kindB64 = Buffer.from(kindBytes).toString("base64");
    const sponsored = await tag("sponsor-fetch", async () => {
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
      return (await sponsorRes.json()) as {
        sponsoredTxBytes: string;
        sponsorSignature: string;
      };
    });
    finalTxBytes = Uint8Array.from(Buffer.from(sponsored.sponsoredTxBytes, "base64"));
    sponsorSignature = sponsored.sponsorSignature;
  }

  await tag("dry-run", async () => {
    const dryRun = await client.dryRunTransactionBlock({
      transactionBlock: finalTxBytes,
    });
    const status = dryRun.effects.status;
    const details = {
      status: status.status,
      error: status.error,
      gasUsed: dryRun.effects.gasUsed,
    };
    console.log("[zkLogin] dry-run result", details);
    if (status.status !== "success") {
      throw new Error(
        `dry-run failed: ${status.error ?? "unknown Sui execution error"} ${JSON.stringify(details)}`,
      );
    }
  });

  const { signature: ephemeralSig } = await tag("sign-ephemeral", () =>
    ephemeralKp.signTransaction(finalTxBytes),
  );

  // Shinami doesn't return `addressSeed` — compute locally from the
  // salt the wallet API gave us + JWT claims.
  const zkProof = await tag("shinami-prove", async () => {
    try {
      return await shinamiCreateProof({
        jwt: session.jwt!,
        maxEpoch: session.maxEpoch,
        extendedEphemeralPublicKey: getExtendedEphemeralPublicKey(
          ephemeralKp.getPublicKey(),
        ),
        jwtRandomness: session.randomness,
        salt: session.salt!,
        bearerToken: railsToken,
      });
    } catch (err) {
      if (err instanceof ShinamiClientError && err.payload.sessionExpired) {
        throw new SessionExpiredError(err.payload.userMessage);
      }
      throw err;
    }
  });

  const zkLoginSignature = await tag("compose-zklogin-sig", () => {
    const claims = decodeJwt(session.jwt!);
    if (!claims.sub || !claims.aud) {
      throw new Error("Invalid JWT: missing sub or aud claim");
    }
    const aud = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
    const addressSeed = genAddressSeed(
      saltToBigInt(session.salt!),
      "sub",
      claims.sub,
      aud,
    ).toString();

    // Validate the Shinami-supplied proof shape up-front so a missing
    // sub-field surfaces as a meaningful error rather than a BCS
    // "reading 'a' of undefined" three frames deep. Mirror the
    // ZkLoginSignatureInputs schema the SDK serializes.
    const pp = (zkProof as { proofPoints?: { a?: unknown; b?: unknown; c?: unknown } })
      .proofPoints;
    const iss = (zkProof as { issBase64Details?: { value?: unknown; indexMod4?: unknown } })
      .issBase64Details;
    const hdr = (zkProof as { headerBase64?: unknown }).headerBase64;
    // Dump the structural keys (NOT the values — proof points are
    // secret-ish and shouldn't be logged in full).
    console.log("[zkLogin] proof shape", {
      topLevel: Object.keys(zkProof ?? {}),
      hasProofPoints: !!pp,
      proofPointsKeys: pp ? Object.keys(pp) : null,
      proofPointsA: Array.isArray(pp?.a) ? `array[${pp.a.length}]` : typeof pp?.a,
      proofPointsB: Array.isArray(pp?.b)
        ? `array[${pp.b.length}] of ${Array.isArray((pp.b as unknown[])[0]) ? `array[${((pp.b as unknown[])[0] as unknown[])?.length}]` : typeof (pp.b as unknown[])[0]}`
        : typeof pp?.b,
      proofPointsC: Array.isArray(pp?.c) ? `array[${pp.c.length}]` : typeof pp?.c,
      hasIss: !!iss,
      issKeys: iss ? Object.keys(iss) : null,
      hasHeader: typeof hdr === "string",
      addressSeedLen: addressSeed.length,
    });

    const missing: string[] = [];
    if (!pp) missing.push("proofPoints");
    else {
      if (!Array.isArray(pp.a)) missing.push("proofPoints.a");
      if (!Array.isArray(pp.b)) missing.push("proofPoints.b");
      if (!Array.isArray(pp.c)) missing.push("proofPoints.c");
    }
    if (!iss) missing.push("issBase64Details");
    else {
      if (typeof iss.value !== "string") missing.push("issBase64Details.value");
      if (typeof iss.indexMod4 !== "number") missing.push("issBase64Details.indexMod4");
    }
    if (typeof hdr !== "string") missing.push("headerBase64");
    if (missing.length > 0) {
      throw new Error(
        `Shinami proof is missing required fields: ${missing.join(", ")}. ` +
          `Got top-level keys: [${Object.keys(zkProof ?? {}).join(", ")}].`,
      );
    }

    const proof: Pick<
      ZkLoginSignatureInputs,
      "proofPoints" | "issBase64Details" | "headerBase64" | "addressSeed"
    > = { ...zkProof, addressSeed };

    return getZkLoginSignature({
      inputs: proof,
      maxEpoch: session.maxEpoch,
      userSignature: ephemeralSig,
    });
  });

  const txBytesB64 = Buffer.from(finalTxBytes).toString("base64");

  await tag("verify-zklogin-sig", async () => {
    const verification = await client.verifyZkLoginSignature({
      bytes: txBytesB64,
      signature: zkLoginSignature,
      intentScope: "TransactionData",
      author: session.suiAddress!,
    });
    console.log("[zkLogin] signature verification result", verification);
    if (!verification.success) {
      throw new Error(
        `zkLogin signature verification failed: ${JSON.stringify(verification)}`,
      );
    }
  });

  const result = await tag("submit", async () => {
    const signature = sponsorSignature
      ? [zkLoginSignature, sponsorSignature]
      : zkLoginSignature;
    const expectedDigest = TransactionDataBuilder.getDigestFromBytes(finalTxBytes);
    let lastErr: unknown = null;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      console.log("[zkLogin] submit details", {
        txBytesLen: finalTxBytes.length,
        hasSponsor: !!sponsorSignature,
        zkLoginSigLen: zkLoginSignature.length,
        zkLoginSigPrefix: zkLoginSignature.slice(0, 20),
        sponsorSigLen: sponsorSignature?.length,
        sponsorSigPrefix: sponsorSignature?.slice(0, 20),
        expectedDigest,
        attempt,
      });

      let upstreamRefused = false;
      try {
        const submitRes = await fetch("/api/sui/execute", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${railsToken}`,
          },
          body: JSON.stringify({
            txBytes: txBytesB64,
            signatures: Array.isArray(signature) ? signature : [signature],
          }),
        });
        if (!submitRes.ok) {
          const errorText = await submitRes.text();
          if (submitRes.status === 401) {
            throw new SessionExpiredError();
          }
          // The relay reached its providers and gave us a structured
          // refusal. Sui execution is deterministic on the same tx
          // bytes, so retrying yields the same answer. Worse: every
          // resubmit risks the validators seeing a new vote for the
          // same owned gas coin → equivocation → 24h lock.
          upstreamRefused = true;
          throw new Error(`execute relay failed http ${submitRes.status}: ${errorText}`);
        }
        return await submitRes.json();
      } catch (err) {
        lastErr = err;
        console.error("[zkLogin] submit failed", { err, expectedDigest, attempt });
        if (isZkLoginVerifyError(err)) {
          throw new SessionExpiredError(
            "Your sign-in needs to be refreshed. Please sign in again to continue.",
          );
        }

        try {
          const landed = await client.getTransactionBlock({
            digest: expectedDigest,
            options: { showEffects: true },
          });
          console.warn("[zkLogin] submit RPC errored, but transaction landed", {
            digest: expectedDigest,
            attempt,
          });
          return landed;
        } catch {
          // Not indexed/available yet, or the submit did not reach validators.
        }

        if (upstreamRefused) {
          break;
        }

        if (attempt < 3) {
          await sleep(attempt * 800);
        }
      }
    }

    // Serialize full error payload for UI display
    let errMsg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    if (lastErr && typeof lastErr === "object") {
      try {
        const keys = Object.keys(lastErr);
        const detailObj: Record<string, any> = {};
        for (const k of keys) {
          detailObj[k] = (lastErr as any)[k];
        }
        if (keys.length > 0) {
          errMsg += " | Struct: " + JSON.stringify(detailObj);
        }
      } catch {
        // ignore serialization failure
      }
    }
    errMsg += ` | Digest: ${expectedDigest}`;
    throw new Error(errMsg);
  });
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
