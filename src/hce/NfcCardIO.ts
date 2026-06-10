// Card-side NFC operations the Tap Card flow needs beyond the basic
// reader session (which lives in `useTapCard.ts`):
//
//   - readCardSecret:  read K (32 bytes) from a fixed user-memory page
//                      range on an authenticated NTAG215 sector
//   - writeRotation:   PWD_AUTH + write the new ciphertext token to
//                      NDEF storage
//
// NTAG215 layout (NXP datasheet):
//   - Pages 0-3:   manufacturer/serial + lock bytes (read-only)
//   - Pages 4-129: user memory (504 bytes), writable
//   - Pages 130+:  config (PWD, PACK, AUTH0, ACCESS)
//
// Our convention (locked during PWA linking — see tapp/docs/linking-
// flow.md):
//   - K (32 bytes) lives at pages 4-11 (32 bytes), read-protected by
//     PWD_AUTH (AUTH0 set so any access requires authentication)
//   - The rotation token + NDEF wrapper lives at pages 12 onward,
//     also write-protected by PWD_AUTH
//
// Commands used:
//   - PWD_AUTH (0x1B + 4-byte PWD)  → returns 2-byte PACK on success
//   - READ      (0x30 + page)        → returns 16 bytes (4 pages)
//   - WRITE     (0xA2 + page + 4 b)  → ack
//
// We expose typed helpers so the screens don't have to know NTAG
// protocol details. The actual NfcManager calls live behind
// `react-native-nfc-manager`'s transceive API.

import NfcManager, { NfcTech, Ndef } from "react-native-nfc-manager";
import { hexToBytes } from "@/hooks/pinHmac";

// NDEF external-record TNF code per the NFC Forum NDEF spec.
const TNF_EXTERNAL_TYPE = 0x04;

const PAGE_K_START = 4; // K = 32 bytes = pages 4..11
const PAGE_TOKEN_START = 12; // rotation token lives starting here

/**
 * Authenticate to the card with the per-tap password the server
 * returned in the previous debit response. Returns the 2-byte PACK
 * the card responded with so the caller can sanity-check it matched
 * (the server side knows the expected PACK from linking-time setup).
 */
async function pwdAuth(passwordHex: string): Promise<Uint8Array> {
  const pwd = hexToBytes(passwordHex);
  if (pwd.length !== 4) {
    throw new Error(`PWD must be exactly 4 bytes; got ${pwd.length}`);
  }
  const resp = await NfcManager.transceive([0x1b, ...pwd]);
  const pack = Uint8Array.from(resp);
  if (pack.length < 2) {
    throw new Error("PWD_AUTH returned no PACK — wrong password?");
  }
  return pack;
}

/**
 * Read 32 bytes of K from pages 4-11. Caller MUST hold an active NFC
 * session via NfcManager.requestTechnology(NfcTech.NfcA). PWD_AUTH
 * must have been performed first (see `readSecretWithAuth`).
 *
 * Each READ command returns 16 bytes (4 pages); we issue two reads
 * and concatenate.
 */
async function readSecretPages(): Promise<Uint8Array> {
  const a = await NfcManager.transceive([0x30, PAGE_K_START]);
  const b = await NfcManager.transceive([0x30, PAGE_K_START + 4]);
  const out = new Uint8Array(32);
  out.set(Uint8Array.from(a).subarray(0, 16), 0);
  out.set(Uint8Array.from(b).subarray(0, 16), 16);
  return out;
}

/**
 * High-level: open a raw NfcA session, authenticate with the supplied
 * one-time password, read K, close the session.
 *
 * Use this only during the linking *test* flow — in real transactions
 * K is read inside the same session that does the debit + write-back
 * (see `useTapCard.ts`) to avoid prompting the user to tap twice.
 */
export async function readSecretWithAuth(
  passwordHex: string,
): Promise<Uint8Array> {
  try {
    await NfcManager.requestTechnology(NfcTech.NfcA);
    await pwdAuth(passwordHex);
    return await readSecretPages();
  } finally {
    await NfcManager.cancelTechnologyRequest().catch(() => undefined);
  }
}

/**
 * Read the full card payload (the single NDEF external record the PWA wrote:
 * K(32) ‖ rotationToken(32) = 64 bytes). Returns the raw payload bytes; the
 * caller splits K from the token. NDEF-only, no PWD_AUTH.
 */
export async function readCardPayload(): Promise<Uint8Array> {
  const tag = await NfcManager.getTag();
  if (!tag?.ndefMessage?.length) {
    throw new Error("Card has no NDEF message — needs re-linking");
  }
  const first = tag.ndefMessage[0];
  if (!first?.payload) throw new Error("Empty NDEF payload");
  return Uint8Array.from(first.payload);
}

// The single external NDEF type the cardholder PWA writes and the merchant
// reads/writes. MUST match tapp/lib/webnfc.ts ZORACLE_NDEF_TYPE exactly.
export const TAPP_EXTERNAL_TYPE = "usetapp.xyz:tapp-card";

/**
 * Write the canonical 64-byte card payload (K ‖ rotationToken) back to the
 * card as a single NDEF external record.
 *
 * NDEF-only, NO PWD_AUTH: v1 cards are provisioned by the PWA over Web NFC,
 * which cannot set an NTAG password — so the card has none, and a PWD_AUTH
 * here would simply fail. Anti-replay is carried by the rotating token + the
 * single-use server nonce, not by on-card password protection.
 */
export async function writeCardPayload(payload: Uint8Array): Promise<void> {
  const record = Ndef.record(
    TNF_EXTERNAL_TYPE,
    TAPP_EXTERNAL_TYPE,
    [],
    Array.from(payload),
  );
  const bytes = Ndef.encodeMessage([record]);
  if (!bytes) throw new Error("NDEF encode failed");
  await NfcManager.ndefHandler.writeNdefMessage(bytes);
}
