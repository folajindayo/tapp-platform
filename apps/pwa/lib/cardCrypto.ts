// On-device crypto for the Tapp Card linking + resync flows.
//
// Mirrors `rails/docs/tapp-card-spec.md` Appendix A: the server
// never sees K (the on-card secret) or the PIN. The PWA computes the
// verifier values once at linking and ships them to Rails, which
// stores them and uses them later to validate per-debit PIN responses
// the merchant app produces from its own read of K + the cardholder's
// PIN entry.
//
// Math:
//   K              = random(32)
//   K'             = HMAC-SHA256(K, utf8(PIN))
//   linking_proof  = HMAC-SHA256(K', utf8("linking-anchor-v1"))
//   pin_verifier   = HMAC-SHA256(K, utf8("tapp-card-verifier-v1"))
//   rotation_token = random(32)
//   card_password  = random(4)   // NTAG215 PWD (defense in depth)
//
// Intermediates (K', anchor) wiped after use. JS can't truly zero
// memory but overwriting before GC raises the bar.

// Noble v2 exposes its modules with explicit `.js` extensions in
// package exports — keep them here for bundler resolution.
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";

const LINKING_ANCHOR = utf8("linking-anchor-v1");
const VERIFIER_LABEL = utf8("tapp-card-verifier-v1");

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i]!.toString(16).padStart(2, "0");
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("hex string has odd length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

export interface LinkingProofs {
  /** Server-stored. Used at every debit to verify pin_response. */
  linkingProof: Uint8Array;
  /** Server-stored. Auxiliary verifier for state distinguishing. */
  pinVerifier: Uint8Array;
}

/**
 * Compute the two HMAC values the PWA sends to Rails at link time.
 * Caller is responsible for wiping `K` and `pin` from its own scope
 * after this returns; we wipe our internal intermediates.
 */
export function deriveLinkingProofs(K: Uint8Array, pin: string): LinkingProofs {
  const pinBytes = utf8(pin);
  const kPrime = hmac(sha256, K, pinBytes);
  const linkingProof = hmac(sha256, kPrime, LINKING_ANCHOR);
  const pinVerifier = hmac(sha256, K, VERIFIER_LABEL);

  // Wipe what we own.
  pinBytes.fill(0);
  kPrime.fill(0);

  return { linkingProof, pinVerifier };
}

/**
 * sha256 of a card's factory UID (read off the chip via Web NFC's
 * `serialNumber`). The same hash the merchant app computes from its
 * read; binds the on-chain `CardSpendingCap` to one physical card.
 */
export function uidHash(uid: Uint8Array): Uint8Array {
  return sha256(uid);
}

/** Generate a fresh 32-byte rotation token (opaque random bytes). */
export function newRotationToken(): Uint8Array {
  return randomBytes(32);
}

/** Generate a fresh NTAG215 password (4 bytes). */
export function newCardPassword(): Uint8Array {
  return randomBytes(4);
}
