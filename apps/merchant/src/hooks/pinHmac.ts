// On-device HMAC PIN protocol — see rails/docs/tapp-card-spec.md
// Appendix A and docs/tap-card-pin-flow.md "PIN math on-device".
//
// The server never sees K (the card secret), K' (PIN-derived intermediate),
// the linking anchor, or the PIN itself. It only sees the response, which
// is bound to a single-use server_nonce, so capture-and-replay attacks die
// at the nonce check.
//
//   K_prime = HMAC-SHA256(K, utf8(PIN))
//   anchor  = HMAC-SHA256(K_prime, "linking-anchor-v1")
//   pin_response = HMAC-SHA256(anchor, server_nonce)
//
// We zero the intermediate buffers immediately after use. JS doesn't truly
// erase memory, but overwriting before GC at least prevents trivial heap-
// dump recovery.

import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';

const ANCHOR_INFO = utf8('linking-anchor-v1');

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    // bytes[i] is always defined inside `i < bytes.length`; the
    // assertion silences noUncheckedIndexedAccess without runtime cost.
    out += bytes[i]!.toString(16).padStart(2, '0');
  }
  return out;
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error('hex string has odd length');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/**
 * Compute the PIN response the backend expects.
 *
 * Caller MUST pass `K` already read from the card sector during the
 * same NFC session — we don't persist it. After this returns, `K` and
 * the PIN string in caller-land should be zeroed/discarded.
 *
 * Returns the hex string the API expects in `pin_response`.
 */
export function computePinResponse(
  K: Uint8Array,
  pin: string,
  serverNonce: Uint8Array,
): string {
  const pinBytes = utf8(pin);
  const kPrime = hmac(sha256, K, pinBytes);
  const anchor = hmac(sha256, kPrime, ANCHOR_INFO);
  const response = hmac(sha256, anchor, serverNonce);

  // Best-effort wipe of intermediates. The PIN string itself lives in
  // caller scope — caller should overwrite/null it after this returns.
  pinBytes.fill(0);
  kPrime.fill(0);
  anchor.fill(0);

  return bytesToHex(response);
}
