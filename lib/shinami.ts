// Shinami client — sole zkLogin provider for testnet + mainnet.
//
// Calls our /api/shinami/* proxies (server-side), never Shinami
// directly:
//   * Shinami Wallet Services don't support CORS in the browser.
//   * The Shinami access key is server-only (wallet + signing rights).
//
// The proxies hold SHINAMI_API_KEY, call Shinami, and return either
// the result or a mapped ShinamiErrorPayload that the UI can render.
//
// Why one provider instead of branching by network: parallel code
// paths for testnet/mainnet doubled the maintenance surface for no
// benefit. Shinami's prover and wallet work identically on both
// (Shinami docs: "currently works with Testnet and Mainnet").

import { type ShinamiErrorPayload } from "./shinami-errors";
import { withRetry } from "./retry";

const NETWORK = (process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet") as
  | "testnet"
  | "mainnet"
  | "devnet";

// Public RPC URL for the Sui Node client. The optional, frontend-
// safe NEXT_PUBLIC_SHINAMI_NODE_KEY enables Shinami's Node Service
// as the primary mainnet RPC — see sui-client.ts. Unset = use public
// fullnode only.
export const SHINAMI_NODE_URL =
  process.env.NEXT_PUBLIC_SHINAMI_NODE_URL ??
  "https://api.us1.shinami.com/sui/node/v1";

export const SHINAMI_NODE_KEY =
  process.env.NEXT_PUBLIC_SHINAMI_NODE_KEY ?? "";

export function shinamiNodeEnabled(): boolean {
  return NETWORK === "mainnet" && SHINAMI_NODE_KEY.length > 0;
}

// ---------------------------------------------------------------------------
// Error class — wraps the server's mapped payload so callers can branch
// on `.sessionExpired` / `.retryable` without parsing strings.
// ---------------------------------------------------------------------------

export class ShinamiClientError extends Error {
  public readonly payload: ShinamiErrorPayload;
  constructor(payload: ShinamiErrorPayload) {
    super(payload.userMessage);
    this.name = "ShinamiClientError";
    this.payload = payload;
  }
}

interface ProxyOptions {
  /** Caller's Rails JWT — required to authorize the proxy. */
  bearerToken: string;
}

async function callProxy<T>(
  path: string,
  body: unknown,
  opts: ProxyOptions,
): Promise<T> {
  return withRetry(
    async () => {
      const res = await fetch(path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.bearerToken}`,
        },
        body: JSON.stringify(body),
      });
      let json: { error?: ShinamiErrorPayload } & Record<string, unknown>;
      try {
        json = (await res.json()) as typeof json;
      } catch {
        throw new ShinamiClientError({
          httpStatus: res.status,
          userMessage:
            "Wallet service returned an unexpected response. Please retry.",
          retryable: true,
          sessionExpired: false,
        });
      }
      if (!res.ok || json.error) {
        throw new ShinamiClientError(
          json.error ?? {
            httpStatus: res.status,
            userMessage:
              "Wallet service error. Please retry, or contact support.",
            retryable: res.status >= 500,
            sessionExpired: res.status === 401,
          },
        );
      }
      return json as T;
    },
    {
      attempts: 3,
      baseDelayMs: 300,
      maxDelayMs: 2500,
      shouldRetry: (err) =>
        err instanceof ShinamiClientError && err.payload.retryable,
    },
  );
}

// ---------------------------------------------------------------------------
// zkLogin wallet — salt + address (via /api/shinami/wallet)
// ---------------------------------------------------------------------------

export interface ShinamiWallet {
  iss: string;
  aud: string;
  /** OpenID sub claim (e.g. Google user id). */
  sub: string;
  subWallet: number;
  /**
   * Salt as a base-10 BigInt string — already normalized from Shinami's
   * over-the-wire Base64 by our proxy. Pass straight into genAddressSeed.
   */
  salt: string;
  /** Hex Sui address with 0x prefix. */
  address: string;
}

export async function shinamiGetOrCreateWallet(args: {
  jwt: string;
  bearerToken: string;
  /** 0+; pick a stable per-app id for multiple wallets per Google account. */
  subWallet?: number;
}): Promise<ShinamiWallet> {
  return callProxy<ShinamiWallet>(
    "/api/shinami/wallet",
    { jwt: args.jwt, subWallet: args.subWallet ?? 0 },
    { bearerToken: args.bearerToken },
  );
}

// ---------------------------------------------------------------------------
// zkLogin prover — Groth16 proof (via /api/shinami/prover)
// ---------------------------------------------------------------------------

export interface ShinamiProofResult {
  proofPoints: { a: string[]; b: string[][]; c: string[] };
  issBase64Details: { value: string; indexMod4: number };
  headerBase64: string;
}

export async function shinamiCreateProof(args: {
  jwt: string;
  maxEpoch: number;
  extendedEphemeralPublicKey: string;
  jwtRandomness: string;
  /** Base-10 BigInt string (already normalized by the wallet proxy). */
  salt: string;
  bearerToken: string;
}): Promise<ShinamiProofResult> {
  return callProxy<ShinamiProofResult>(
    "/api/shinami/prover",
    {
      jwt: args.jwt,
      maxEpoch: args.maxEpoch,
      extendedEphemeralPublicKey: args.extendedEphemeralPublicKey,
      jwtRandomness: args.jwtRandomness,
      salt: args.salt,
    },
    { bearerToken: args.bearerToken },
  );
}

// ---------------------------------------------------------------------------
// Salt format conversion — kept here so the proxy boundary owns the
// normalization. Shinami returns salt as Base64 in REST; we convert
// to a BigInt-string once and the rest of the code sees only that.
// ---------------------------------------------------------------------------

/**
 * Convert a salt that may arrive as either a base-10 BigInt string or
 * a Base64-encoded 16-byte big-endian unsigned integer into a `bigint`.
 * The wallet proxy normalizes to BigInt-string at its boundary so the
 * client only sees that — but this helper exists for the proxy and
 * for callers consuming raw Shinami responses (tests, scripts).
 */
export function saltToBigInt(salt: string): bigint {
  if (/^\d+$/.test(salt)) return BigInt(salt);
  const bin =
    typeof atob !== "undefined"
      ? atob(salt)
      : Buffer.from(salt, "base64").toString("binary");
  let hex = "";
  for (let i = 0; i < bin.length; i++) {
    hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex.length === 0 ? BigInt(0) : BigInt("0x" + hex);
}

export { NETWORK };
