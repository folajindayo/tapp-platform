"use client";

// One-off recovery page for funds stranded on a pre-Shinami zkLogin
// address. Walks the user through:
//
//   1. Google OAuth with a fresh ephemeral keypair + nonce
//   2. Recompute the legacy salt locally via /api/legacy-salt —
//      sha256("tapp.dev.salt.v1:" + sub), first 16 bytes → BigInt.
//      This mirrors the original devSalt() in the deleted lib/auth.tsx
//      which is what actually minted these addresses (the old code's
//      Mysten round-trip always failed and fell back to this).
//   3. Re-derive the address — confirm it matches what we're trying
//      to recover (otherwise the user signed in with the wrong Google
//      account and we abort to prevent moving the wrong wallet)
//   4. Ask Shinami's prover to mint a proof using the legacy salt
//      explicitly (Shinami accepts arbitrary salts; Enoki doesn't —
//      Enoki only proves for its own managed salts)
//   5. Build a PTB that sweeps all SUI + USDC to the destination,
//      sign with ephemeral key + zkLogin signature, submit
//
// DELETE THIS FILE after the sweep completes. It bypasses the normal
// auth/session flow and is only meaningful for this one address.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import {
  generateNonce,
  generateRandomness,
  getExtendedEphemeralPublicKey,
  jwtToAddress,
  genAddressSeed,
  getZkLoginSignature,
  type ZkLoginSignatureInputs,
} from "@mysten/sui/zklogin";
import { decodeJwt } from "jose";
import { suiReadClient } from "@/lib/sui-client";
import { buildGoogleAuthUrl, parseGoogleAuthFragment } from "@/lib/google-oauth";
import { shinamiCreateProof, saltToBigInt, ShinamiClientError } from "@/lib/shinami";

// ============================================================================
// CONSTANTS — edit if recovering a different address
// ============================================================================
const LEGACY_SOURCE =
  "0xb20bb1e2bfd3b39443c37cd6c9f9ab307f4b5c5cae754d7e2eba584a440de40d";
const DESTINATION =
  "0x75fb42b6b4afa4a6e4b156e51db8373611861d31522031fb7164a74f40b47075";
const USDC_TYPE =
  "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC";
// Server-side route that recomputes the legacy devSalt from the JWT's
// sub. Server-side just so the derivation lives in one place; the
// math is non-secret and could equally run in the browser.
const SALT_URL = "/api/legacy-salt";

// Storage key — separate from the main zkLogin session so this flow
// doesn't trample tapp.zklogin.v1 (the user's normal Shinami session).
const STORAGE_KEY = "tapp.recover.legacy.v1";

// ============================================================================
// Recovery session (lives in sessionStorage so it survives OAuth redirect)
// ============================================================================

interface RecoverSession {
  ephemeralPrivateKey: string;
  randomness: string;
  maxEpoch: number;
  nonce: string;
}

function saveSession(s: RecoverSession) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}
function readSession(): RecoverSession | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as RecoverSession) : null;
}
function clearSession() {
  sessionStorage.removeItem(STORAGE_KEY);
}

// ============================================================================
// Page
// ============================================================================

type Phase =
  | "idle"
  | "redirecting"
  | "exchanging"
  | "ready"
  | "signing"
  | "submitting"
  | "done"
  | "error";

export default function RecoverLegacyPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{
    derivedAddress: string;
    salt: string;
    jwt: string;
    sui: string;
    usdc: string;
  } | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  // Guard against React Strict Mode double-invocation in dev.
  const handledRef = useRef(false);

  // On mount: if there's an id_token in the URL hash, we just came back
  // from Google. Process it.
  useEffect(() => {
    if (handledRef.current) return;
    const hash = typeof window !== "undefined" ? window.location.hash : "";
    const { idToken, error: oauthError } = parseGoogleAuthFragment(hash);
    if (oauthError) {
      setError(`Google OAuth error: ${oauthError}`);
      setPhase("error");
      handledRef.current = true;
      return;
    }
    if (idToken) {
      handledRef.current = true;
      // Clear the hash from the URL bar so refresh doesn't re-process.
      window.history.replaceState(null, "", window.location.pathname);
      void exchangeJwt(idToken);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function exchangeJwt(idToken: string) {
    setPhase("exchanging");
    setError(null);
    try {
      const session = readSession();
      if (!session) {
        throw new Error(
          "Recovery session not found — please click Start Recovery again.",
        );
      }

      // Verify the JWT's nonce matches the one we generated before
      // redirecting. If not, this isn't our OAuth round.
      const claims = decodeJwt(idToken);
      if (claims.nonce !== session.nonce) {
        throw new Error(
          "Nonce mismatch — JWT wasn't issued for this recovery session.",
        );
      }
      if (!claims.sub || !claims.aud) {
        throw new Error("JWT missing sub or aud claim.");
      }

      // Recompute the legacy devSalt from the JWT sub.
      const saltRes = await fetch(SALT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: idToken }),
      });
      if (!saltRes.ok) {
        const txt = await saltRes.text().catch(() => "(no body)");
        throw new Error(
          `Salt derivation ${saltRes.status}: ${txt.slice(0, 200)}`,
        );
      }
      const saltJson = (await saltRes.json()) as { salt?: string };
      if (!saltJson.salt) throw new Error("Salt derivation returned no salt");
      const legacySalt = saltJson.salt;

      // Derive the address from (JWT, legacySalt). Confirm it matches
      // the address we're trying to recover — otherwise the user signed
      // in with the wrong Google account and we'd sweep nothing.
      const derived = jwtToAddress(idToken, legacySalt, false);
      if (derived.toLowerCase() !== LEGACY_SOURCE.toLowerCase()) {
        throw new Error(
          `Derived address ${derived} ≠ legacy source ${LEGACY_SOURCE}. ` +
            `Are you signed in with the same Google account that originally used this wallet?`,
        );
      }

      // Read on-chain balances so the user sees what's about to move.
      const balances = await suiReadClient().getAllBalances({ owner: LEGACY_SOURCE });
      const sui = balances.find((b) => b.coinType === "0x2::sui::SUI")?.totalBalance ?? "0";
      const usdc = balances.find((b) => b.coinType === USDC_TYPE)?.totalBalance ?? "0";

      setInfo({ derivedAddress: derived, salt: legacySalt, jwt: idToken, sui, usdc });
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  async function startRecovery() {
    setError(null);
    try {
      const client = suiReadClient();
      const { epoch } = await client.getLatestSuiSystemState();
      const maxEpoch = Number(epoch) + 2;
      const kp = new Ed25519Keypair();
      const randomness = generateRandomness();
      const nonce = generateNonce(kp.getPublicKey(), maxEpoch, randomness);
      saveSession({
        ephemeralPrivateKey: kp.getSecretKey(),
        randomness,
        maxEpoch,
        nonce,
      });

      const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID ?? "";
      if (!clientId) throw new Error("NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID not set");
      const redirectUri = `${window.location.origin}/recover-legacy`;
      const url = buildGoogleAuthUrl({ clientId, redirectUri, nonce });
      setPhase("redirecting");
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  async function sweep() {
    if (!info) return;
    setPhase("signing");
    setError(null);
    try {
      const session = readSession();
      if (!session) throw new Error("Recovery session lost");
      const ephemeralKp = Ed25519Keypair.fromSecretKey(session.ephemeralPrivateKey);

      // The /api/shinami/prover proxy requires a Rails bearer token —
      // grab it from the user's existing app session.
      const rails = JSON.parse(
        window.localStorage.getItem("tapp.session.v1") ?? "null",
      ) as { jwt?: string } | null;
      if (!rails?.jwt) {
        throw new Error(
          "Please sign in to Tapp first (/sign-in) so we can authorize the prover call.",
        );
      }

      // Inventory coins on the legacy address.
      const sui = suiReadClient();
      const [suiCoinsResp, usdcCoinsResp] = await Promise.all([
        sui.getCoins({ owner: LEGACY_SOURCE, coinType: "0x2::sui::SUI" }),
        sui.getCoins({ owner: LEGACY_SOURCE, coinType: USDC_TYPE }),
      ]);
      if (suiCoinsResp.data.length === 0) {
        throw new Error(
          "Legacy address has no SUI — needs ~0.01 SUI to pay gas. Send some in first.",
        );
      }

      // Build the sweep PTB.
      const tx = new Transaction();
      tx.setSender(LEGACY_SOURCE);

      // USDC: merge all into the first coin, transfer first to dest.
      if (usdcCoinsResp.data.length > 0) {
        const usdcRefs = usdcCoinsResp.data.map((c) => tx.object(c.coinObjectId));
        const primary = usdcRefs[0];
        if (usdcRefs.length > 1) tx.mergeCoins(primary, usdcRefs.slice(1));
        tx.transferObjects([primary], tx.pure.address(DESTINATION));
      }

      // SUI: merge any non-gas SUI coins into the gas coin, then
      // transfer the gas coin (Sui consumes gas from it first, the
      // remainder flows to dest).
      if (suiCoinsResp.data.length > 1) {
        const extras = suiCoinsResp.data.slice(1).map((c) => tx.object(c.coinObjectId));
        tx.mergeCoins(tx.gas, extras);
      }
      tx.transferObjects([tx.gas], tx.pure.address(DESTINATION));

      // Build the FULL tx (not just the kind) — no sponsor, source
      // pays its own gas from its existing SUI.
      const txBytes = await tx.build({ client: sui });

      // Get the proof from Shinami's prover with the LEGACY salt.
      let zkProof;
      try {
        zkProof = await shinamiCreateProof({
          jwt: info.jwt,
          maxEpoch: session.maxEpoch,
          extendedEphemeralPublicKey: getExtendedEphemeralPublicKey(
            ephemeralKp.getPublicKey(),
          ),
          jwtRandomness: session.randomness,
          salt: info.salt,
          bearerToken: rails.jwt,
        });
      } catch (err) {
        if (err instanceof ShinamiClientError) {
          throw new Error(`Prover error: ${err.payload.userMessage}`);
        }
        throw err;
      }

      // Compose the zkLogin signature. addressSeed is derived from
      // the LEGACY salt — that's what makes Sui's verifier accept the
      // signature as being for 0xb20bb…
      const claims = decodeJwt(info.jwt);
      const aud = Array.isArray(claims.aud) ? claims.aud[0] : claims.aud;
      const addressSeed = genAddressSeed(
        saltToBigInt(info.salt),
        "sub",
        claims.sub!,
        aud!,
      ).toString();
      const proofInputs: Pick<
        ZkLoginSignatureInputs,
        "proofPoints" | "issBase64Details" | "headerBase64" | "addressSeed"
      > = { ...zkProof, addressSeed };

      const { signature: ephemeralSig } = await ephemeralKp.signTransaction(txBytes);
      const zkLoginSignature = getZkLoginSignature({
        inputs: proofInputs,
        maxEpoch: session.maxEpoch,
        userSignature: ephemeralSig,
      });

      setPhase("submitting");
      const result = await sui.executeTransactionBlock({
        transactionBlock: txBytes,
        signature: zkLoginSignature,
        options: { showEffects: true },
      });
      setDigest(result.digest);
      clearSession();
      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 p-6">
      <div className="mx-auto max-w-xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Recover legacy zkLogin wallet</h1>
          <p className="mt-2 text-sm text-neutral-400">
            One-off sweep of funds stranded on a pre-Shinami zkLogin
            address. Sign in with the SAME Google account you originally
            used; everything moves to your current Shinami wallet.
          </p>
        </header>

        <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-sm">
          <div className="grid grid-cols-[6rem_1fr] gap-y-2">
            <span className="text-neutral-500">From:</span>
            <span className="font-mono break-all">{LEGACY_SOURCE}</span>
            <span className="text-neutral-500">To:</span>
            <span className="font-mono break-all">{DESTINATION}</span>
          </div>
        </section>

        {phase === "idle" && (
          <button
            onClick={startRecovery}
            className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium hover:bg-blue-500"
          >
            Start recovery — sign in with Google
          </button>
        )}

        {phase === "redirecting" && (
          <p className="text-sm text-neutral-400">Redirecting to Google…</p>
        )}

        {phase === "exchanging" && (
          <p className="text-sm text-neutral-400">
            Fetching legacy salt, deriving address…
          </p>
        )}

        {phase === "ready" && info && (
          <section className="space-y-4">
            <div className="rounded-lg border border-green-700/50 bg-green-900/20 p-4 text-sm">
              <p className="font-medium text-green-300">Match confirmed</p>
              <p className="mt-1 text-neutral-300">
                Derived address matches the legacy source.
              </p>
              <div className="mt-3 space-y-1 text-xs">
                <div>
                  SUI on-chain: {(Number(info.sui) / 1e9).toFixed(9)} SUI
                </div>
                <div>USDC on-chain: {(Number(info.usdc) / 1e6).toFixed(6)} USDC</div>
              </div>
            </div>
            <button
              onClick={sweep}
              disabled={Number(info.sui) === 0 && Number(info.usdc) === 0}
              className="w-full rounded-lg bg-red-600 px-4 py-3 font-medium hover:bg-red-500 disabled:opacity-40"
            >
              Sweep all funds to destination
            </button>
          </section>
        )}

        {(phase === "signing" || phase === "submitting") && (
          <p className="text-sm text-neutral-400">
            {phase === "signing"
              ? "Generating proof + signing…"
              : "Submitting to Sui mainnet…"}
          </p>
        )}

        {phase === "done" && digest && (
          <section className="rounded-lg border border-green-700/50 bg-green-900/20 p-4 text-sm">
            <p className="font-medium text-green-300">Sweep submitted</p>
            <p className="mt-2 font-mono text-xs break-all">{digest}</p>
            <a
              href={`https://suiscan.xyz/mainnet/tx/${digest}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-blue-400 underline"
            >
              View on Suiscan →
            </a>
            <p className="mt-3 text-xs text-neutral-400">
              Once you confirm the digest succeeded, delete{" "}
              <code>app/recover-legacy/</code> from this repo.
            </p>
          </section>
        )}

        {phase === "error" && error && (
          <section className="rounded-lg border border-red-700/50 bg-red-900/20 p-4 text-sm">
            <p className="font-medium text-red-300">Something went wrong</p>
            <p className="mt-2 break-words text-neutral-300">{error}</p>
            <button
              onClick={() => {
                clearSession();
                setError(null);
                setPhase("idle");
                router.replace("/recover-legacy");
              }}
              className="mt-3 rounded border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
            >
              Reset
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
