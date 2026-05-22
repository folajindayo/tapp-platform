# Tap Card — Tiered auth flow (merchant device)

Status: **DESIGN, AWAITING IMPLEMENTATION SIGN-OFF**
Last updated: 2026-05-22 (rev 2 — three-tier auth, HMAC PIN, in-the-moment write rescue)

Companion to `rails/docs/tapp-card-spec.md`. This doc covers only the
merchant-app surface: tier branching, PIN UI, HMAC PIN math on-device,
NFC write-back, step-up QR, and the "tap again to finalize" rescue.
The backend protocol, Move contract, and linking flow live in the
Rails spec.

---

## Three-tier auth

After the NFC read, the app calls `GET /v1/sender/me/tap-card/nonce`
with `{ amount, card_uid_hash }`. The server returns a single-use
`server_nonce` and the **tier** the amount falls into:

| Amount band (NGN, default)   | `tier`     | UI                         |
| ---------------------------- | ---------- | -------------------------- |
| `< ₦2,000`                   | `none`     | No prompt; submit immediately |
| `₦2,000 – ₦15,000`           | `pin`      | PIN pad screen             |
| `> ₦15,000`                  | `step_up`  | QR screen → PWA biometric  |

Thresholds are per-card (cardholder can lower in their PWA), with
hard daily-cap backstop. Defaults are the v1 cut listed in the Rails
spec.

---

## Sequence (PIN tier)

```
Merchant           Tapp App                       Rails             Sui
   │                  │                             │                │
   │ enter amount     │                             │                │
   │─────────────────▶│                             │                │
   │ tap "Tap Card"   │                             │                │
   │─────────────────▶│                             │                │
   │                  │ NFC reader session opens    │                │
   │                  │ (cardholder taps card)      │                │
   │                  │ read UID + K + current_token│                │
   │                  │                             │                │
   │                  │ GET /tap-card/nonce ────────▶│ resolve tier  │
   │                  │ ◀──{ tier=pin, server_nonce }│               │
   │                  │                             │                │
   │                  │ show PIN pad                │                │
   │ enter 4-digit PIN│                             │                │
   │─────────────────▶│                             │                │
   │                  │ K_prime = HMAC(K, PIN)      │                │
   │                  │ anchor  = HMAC(K_prime,     │                │
   │                  │           "linking-anchor")  │                │
   │                  │ pin_response =              │                │
   │                  │   HMAC(anchor, server_nonce)│                │
   │                  │ (zero K, K_prime, PIN now)  │                │
   │                  │                             │                │
   │                  │ POST /v1/sender/me/tap-card │                │
   │                  │   { current_token_ct,       │                │
   │                  │     server_nonce,           │                │
   │                  │     pin_response, amount }  │                │
   │                  │─────────────────────────────▶│ strict state  │
   │                  │                             │ machine:       │
   │                  │                             │  nonce ok →    │
   │                  │                             │  token ok →    │
   │                  │                             │  PIN ok →      │
   │                  │                             │  limits ok →   │
   │                  │                             │ submit debit ──▶ Move
   │                  │                             │ ◀──────────────│ CardDebited
   │                  │                             │ rotate token   │
   │                  │ ← 200 { status: "settled",  │                │
   │                  │     new_card_token,         │                │
   │                  │     card_password, ... }    │                │
   │                  │                             │                │
   │                  │ NTAG215 PWD_AUTH(card_pw)   │                │
   │                  │ write new_card_token        │                │
   │                  │   to card sector            │                │
   │                  │                             │                │
   │                  │ POST /token-ack written:true│                │
   │                  │ show "Payment received"     │                │
   │ ✓ confirm        │ (animated check)            │                │
   │◀─────────────────│                             │                │
```

Rejection paths:
- `403 token_invalid_resync_required` → "Card needs to resync. Ask
  cardholder to open Zoracle on their phone." (terminal, no retry).
  Friendly copy explaining what happened.
- `403 pin_invalid` → "Wrong PIN. {N} attempts left." (re-enter PIN,
  card stays in field if possible). On 0 left, show "Card locked for
  24h" terminal.
- `402 step_up_required` → render QR (see below), poll `/step-up`, on
  grant re-submit transparently with the granted `step_up_token`.
- `402 daily_limit_exceeded` → "Daily limit reached. Try phone-to-phone
  instead." Terminal.

**In-the-moment write rescue:** if `writeNdefMessage` fails *after* a
successful debit (200 returned), show "Please tap once more to
finalize." If the card is still nearby, the second tap retries the
write under the same order. After ~10 seconds with no recovery tap,
gracefully fail-soft — the order was paid, the merchant got the
money, but the cardholder needs to PWA-resync before their next tap
elsewhere. POST `/token-ack { written: false }` so the server knows.

---

## Screen spec

### PIN pad — `app/(app)/tap-card-pin.tsx` (new)

Rendered as a full-screen modal over the existing Tap Card screen
when the NFC reader returns a successful read.

```
┌───────────────────────────────────────┐
│ ←   Tap Card           Cancel         │
│                                       │
│        Enter Zoracle PIN              │
│                                       │
│           ●  ●  ●  ○                  │   (mask of typed digits)
│                                       │
│     ┌────┐  ┌────┐  ┌────┐            │
│     │ 1  │  │ 2  │  │ 3  │            │
│     └────┘  └────┘  └────┘            │
│     ┌────┐  ┌────┐  ┌────┐            │
│     │ 4  │  │ 5  │  │ 6  │            │
│     └────┘  └────┘  └────┘            │
│     ┌────┐  ┌────┐  ┌────┐            │
│     │ 7  │  │ 8  │  │ 9  │            │
│     └────┘  └────┘  └────┘            │
│             ┌────┐  ┌────┐            │
│             │ 0  │  │ ⌫  │            │
│             └────┘  └────┘            │
│                                       │
│       Charging ₦ 2,500                │   (live amount)
└───────────────────────────────────────┘
```

Implementation notes:
- Auto-submit on the 4th digit (no "Confirm" button — speed first).
- Android: set `FLAG_SECURE` on the activity for the duration of this
  screen so the keypad doesn't show up in recent-apps screenshots or
  screen-record overlays. Use the Expo plugin
  `react-native-prevent-screenshot` or a small custom native call.
- Backspace is `⌫`; long-press clears all.
- Visible error chip slides in from below on bad PIN: "Wrong PIN.
  2 attempts left." Resets the masked dots to empty.
- "Cancel" returns the merchant to the amount screen without
  consuming the card session.

### Step-up QR — `app/(app)/tap-card-step-up.tsx` (new)

Rendered when the backend returns `402 step_up_required`. Full-screen
QR + copy:

```
┌───────────────────────────────────────┐
│        Verify on your phone           │
│                                       │
│           ███▀█▀█▀▀█                  │
│           ▀█▀▄ █▄█▀                   │   (QR code, 280px)
│           █▀█ ▀▄█▀█                   │
│           ███▄▀▄▄▄█                   │
│                                       │
│   Scan this with your phone           │
│   to confirm with Face ID             │
│                                       │
│           Waiting for OK…             │   (animated dots)
│                                       │
│           [ Cancel ]                  │
└───────────────────────────────────────┘
```

Implementation:
- QR payload = the `step_up_token` URL the backend returned (PWA
  knows how to open it).
- Poll `GET /v1/sender/me/tap-card/step-up?token={step_up_token}`
  every 1.5s. On 200, dismiss this screen and re-submit the original
  debit (now with `step_up_token` echoed back in the body so the
  backend skips the limit check).
- Timeout after 90s → "Verification timed out. Try a smaller amount
  or ask the cardholder to use phone-to-phone."

---

## PIN math on-device (TypeScript)

The merchant device never holds anything long-lived. It reads `K` off
the card sector for the duration of the NFC session, computes the
HMAC response, ships it, and zeroes everything.

`src/hooks/useTapCard.ts` adds:

```ts
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { utf8ToBytes, hexToBytes, bytesToHex, concatBytes } from '@noble/hashes/utils';

const LINKING_ANCHOR = utf8ToBytes('linking-anchor-v1');

function computePinResponse(
  K: Uint8Array,            // read from card (32 bytes)
  pin: string,              // typed by cardholder
  serverNonce: Uint8Array,  // from GET /tap-card/nonce
): Uint8Array {
  const kPrime = hmac(sha256, K, utf8ToBytes(pin));
  const anchor = hmac(sha256, kPrime, LINKING_ANCHOR);
  const response = hmac(sha256, anchor, serverNonce);
  // Best-effort wipe — JS doesn't truly zero memory, but overwriting
  // before GC at least prevents trivial heap-dump recovery.
  kPrime.fill(0);
  anchor.fill(0);
  return response;
}
```

`K` is wiped from app memory after use; the PIN string is held in a
ref that's overwritten on submit. No `K` or PIN ever leaves the
device. The PIN response is single-use because it's bound to
`server_nonce`, which the server consumes atomically.

---

## NFC write-back (rotation)

After `200 settled`, write the new token to the card. Card is still
in the field (the reader session was kept open through the PIN
prompt — see `useTapCard.ts` lifecycle).

```ts
import NfcManager, { NfcTech, Ndef } from 'react-native-nfc-manager';

async function writeRotation(newTokenCt: Uint8Array, cardPassword: Uint8Array) {
  await NfcManager.requestTechnology(NfcTech.Ndef);
  // NTAG215 PWD_AUTH — auth before write so the password-locked
  // sector is writable. card_password is short-lived (server reissues
  // per-tap, single-use).
  await NfcManager.transceive([0x1B, ...cardPassword]);
  const message = Ndef.encodeMessage([
    Ndef.externalRecord('zoracle.com:tapp-card', newTokenCt),
  ]);
  await NfcManager.ndefHandler.writeNdefMessage(message);
}
```

NTAG215 user memory is pages 4–129 (504 bytes). The password lock was
set during PWA linking. The `card_password` value comes back in the
`200 settled` body and is consumed once — server rotates it per debit
so a captured per-tap password can't be reused for a future write.

Failure modes:
- **Card moved out of field mid-write** → show "Please tap once more
  to finalize." If retap within ~10s, retry the write under the same
  `order_id` (same token, same password). After timeout, POST
  `/token-ack { written: false }` — the order is paid, the cardholder
  needs PWA resync.
- **PWD_AUTH fails** → terminal error: "Card locked or password
  mismatch. Cardholder should re-link in Zoracle." Server marks the
  card `locked` pending admin recovery.

---

## Telemetry

Each Tap Card transaction logs (Sentry breadcrumbs, not
PII-bearing):
- `tap_card.read_ok` / `tap_card.read_fail`
- `tap_card.pin_attempts` (count, never the digits)
- `tap_card.step_up_required` / `tap_card.step_up_granted`
- `tap_card.token_write_ok` / `tap_card.token_write_fail`
- `tap_card.duration_ms` (read open → settled)

Used to drive the target metric: **< 6 seconds** from card tap to
"Payment received" screen on a good-network android device.

---

## Files this spec adds / changes

| File | Change |
| --- | --- |
| `app/(app)/tap-card.tsx` | After NFC read, call `GET /tap-card/nonce` and branch on `tier`. |
| `app/(app)/tap-card-pin.tsx` | **NEW.** PIN pad + on-device HMAC compute + submit. |
| `app/(app)/tap-card-step-up.tsx` | **NEW.** QR + poll + re-submit. |
| `src/hooks/useTapCard.ts` | Adds tier branching, K/PIN handling (wipe-on-use), HMAC math, write-back with PWD_AUTH, in-the-moment rescue, step-up retry loop. |
| `src/api/endpoints.ts` | `tapCardApi.nonce()`, updated `tapCardApi.debit()` shape, new `tapCardApi.stepUpPoll()`, `tapCardApi.tokenAck()`. |
| `src/api/types.ts` | `TapCardNonceResponse` (with `tier`), `TapCardDebitRequest`, `TapCardDebitResponse`, `StepUpRequired`, `TokenAck`. |
| `package.json` | Add `@noble/hashes` (small, audited). No need for `@noble/curves` or `@noble/ciphers` in the rev-2 design — pure HMAC-SHA256 is enough. |

No native module changes needed beyond what
`react-native-nfc-manager` + `@noble/hashes` already cover. Android
`FLAG_SECURE` (so the PIN pad screen doesn't show in recents /
screenshots) is a tiny config plugin — ~20 LOC.

---

## What's intentionally NOT in this doc

- **Linking flow** — lives entirely in the PWA (`tapp/docs/linking-flow.md`,
  separate session). The merchant app never participates in linking.
- **Resync flow** — cardholder-side, also PWA (`tapp/docs/resync-flow.md`).
  Merchant app only surfaces a friendly "resync needed" message on the
  relevant 403 response.
- **PoC card-issue flow** — uses NFC Tools to write URLs, no merchant
  app involvement. PoC is purely about validating the tap-to-open UX
  before the full security model lands.
