# Resync flow — recover from a torn write

Status: **DESIGN, AWAITING IMPLEMENTATION SIGN-OFF**
Last updated: 2026-05-22

A torn write happens when a Tap Card debit succeeds on the backend +
chain, but the merchant app fails to write the new token back to the
card before the customer pulls the card away. The card is now stuck
on the *previous* token; the server has rotated to the new one. Every
future tap of the card fails with `403 token_invalid_resync_required`
until the cardholder runs this flow.

The merchant app surfaces this immediately when it happens: "Please
tap once more to finalize." If the card is still in the field, that
second tap retries the write and recovers in-the-moment. Only when
the customer has already left does the cardholder need to come here.

iOS gap: this flow needs Web NFC, which Chrome on Android has and iOS
Safari does not. iOS cardholders cannot self-serve a resync in v1 —
see "iOS escape hatch" at the bottom.

---

## Sequence

```
User                    PWA                          Rails           Card
 │                       │                            │              │
 │ "card failed at       │                            │              │
 │  next merchant"       │                            │              │
 │ opens PWA             │                            │              │
 │ ─────────────────────▶│ /dashboard/cards/:id       │              │
 │                       │ shows "Card needs resync"  │              │
 │                       │ banner (server's GET /me   │              │
 │                       │ returned needs_resync=true)│              │
 │ tap "Resync"          │                            │              │
 │ ─────────────────────▶│ /cards/resync              │              │
 │                       │                            │              │
 │                       │ POST /v1/cards/me/resync   │              │
 │                       │────────────────────────────▶│ generate    │
 │                       │                            │ resync_nonce │
 │                       │ ◀──{ current_token_ct,     │              │
 │                       │     card_password,         │              │
 │                       │     resync_nonce }─────────│              │
 │                       │                            │              │
 │ "Tap card to back     │                            │              │
 │ of your phone"        │                            │              │
 │◀──────────────────────│                            │              │
 │ taps card             │                            │              │
 │ ─────────────────────▶│ navigator.nfc.write:       │              │
 │                       │   PWD_AUTH(card_password)  │              │
 │                       │   write(current_token_ct)  │             ▶│ update
 │                       │                            │              │ NDEF
 │                       │                            │              │ sector
 │                       │                            │              │
 │                       │ POST /v1/cards/me/resync/  │              │
 │                       │  complete                  │              │
 │                       │   { resync_nonce }         │              │
 │                       │────────────────────────────▶│ consume     │
 │                       │                            │ nonce; clear │
 │                       │                            │ needs_resync │
 │                       │ ◀──────────────────────────│              │
 │ "Card is back in sync"│                            │              │
 │◀──────────────────────│                            │              │
```

`resync_nonce` is one-shot: a captured response from the first POST
can't be replayed later by anyone who somehow snags the cardholder's
device — without the matching write actually landing on the card and
the cardholder posting `/complete` within the nonce TTL (5 minutes),
nothing happens server-side. After 5 minutes the nonce expires and
the cardholder runs the flow again.

---

## Screens

### `/cards/resync` — initial state

```
┌──────────────────────────────────────────┐
│  ←  Resync your card                     │
│                                          │
│   Your card got out of sync with         │
│   Zoracle. Usually that's because        │
│   the last tap got interrupted.          │
│                                          │
│   This takes 3 seconds and only          │
│   needs you to tap the card to your      │
│   phone.                                 │
│                                          │
│         ┌──────────────────────┐         │
│         │  Start resync        │         │
│         └──────────────────────┘         │
│                                          │
│   Lost the card instead?                 │
│   → Revoke it                            │
└──────────────────────────────────────────┘
```

### `/cards/resync` — waiting for tap

```
┌──────────────────────────────────────────┐
│                                          │
│              📱                          │
│                                          │
│        Tap your card                     │
│      to the back of your phone           │
│                                          │
│            (waiting...)                  │
│                                          │
│           [ Cancel ]                     │
└──────────────────────────────────────────┘
```

Web NFC call:
```ts
const ndef = new NDEFReader();
const ctrl = new AbortController();

await ndef.scan({ signal: ctrl.signal });
ndef.onreading = async (event) => {
  ctrl.abort();
  // PWD_AUTH + write happen via a separate transceive path; see
  // implementation notes below.
  await writeCard(event.serialNumber, currentTokenCt, cardPassword);
  await api.resyncComplete(resyncNonce);
  router.push('/cards/resync/done');
};
```

### `/cards/resync/done` — success

```
┌──────────────────────────────────────────┐
│                                          │
│             ✓                            │
│                                          │
│       Card is back in sync               │
│                                          │
│   Try tapping at the merchant            │
│   again — it should work now.            │
│                                          │
│        ┌──────────────────────┐          │
│        │  Done                │          │
│        └──────────────────────┘          │
└──────────────────────────────────────────┘
```

---

## Failure modes

- **Web NFC unsupported (iOS, or browser without permission).** Show
  the iOS escape-hatch page (see below).
- **Wrong card tapped.** Detect via card UID hash mismatch (PWA
  computes sha256 of the tapped UID, compares to the card row's
  stored hash). Show "That's a different card. Tap the one that
  needs resync." Don't issue the write.
- **PWD_AUTH fails.** Card's password got out of sync (very rare).
  Show "Couldn't authenticate to the card. Contact support to
  recover." This is the *real* dead-card case — only admin recovery
  can fix it (a password mismatch means the on-card PWD has drifted
  from the server-side record, which shouldn't be possible unless
  someone manually wrote to the card).
- **Write succeeds but `/complete` POST fails.** Server still has
  `needs_resync=true`; next refresh of `/dashboard/cards/:id` will
  see it and offer the flow again. The cardholder taps once more,
  the write is idempotent (same token + same password), and the
  second `/complete` lands.
- **Nonce expired** (>5 min between POST and `/complete`). Server
  rejects 410; PWA shows "Resync timed out, try again."

---

## iOS escape hatch

iOS Safari doesn't expose `navigator.nfc`. An iOS cardholder whose
card desyncs will see this when they try to resync:

```
┌──────────────────────────────────────────┐
│  ←  Resync on iOS                        │
│                                          │
│   Apple's Safari can't write to NFC      │
│   cards — only Chrome on Android can.    │
│                                          │
│   Two options:                           │
│                                          │
│   1. Borrow an Android phone with        │
│      Chrome, sign in there, and run      │
│      the resync flow. ✓                  │
│                                          │
│   2. Contact us for a remote recovery.   │
│      We'll email you a code and reset    │
│      the card for you.                   │
│                                          │
│        ┌──────────────────────┐          │
│        │  Email support       │          │
│        └──────────────────────┘          │
│                                          │
│   We're working on a native iOS app      │
│   so you won't need to do this. (~v1.5)  │
└──────────────────────────────────────────┘
```

The "remote recovery" path hits `POST /v1/admin/cards/:id/recovery`
on the support side — emails a 6-digit code, support reads it back
over a call, manual reset paired with an Android staff device for
the actual tap-and-write. Operational, slow, but covers the gap.

v1.5 plan: tiny native iOS Zoracle Wallet app that only does linking
and resync. The transaction flow doesn't need it (Tap Card debits
happen on the merchant device).

---

## API endpoints used

| Method | Path                              | Body          | When |
| ------ | --------------------------------- | ------------- | --- |
| POST   | `/v1/cards/me/resync`             | —             | Issue + nonce |
| POST   | `/v1/cards/me/resync/complete`    | `{ resync_nonce }` | After successful card write |
| POST   | `/v1/admin/cards/:id/recovery`    | `{ user_email }` | Support-side iOS fallback |

All cardholder calls require `Authorization: Bearer <zkLoginJWT>`.
Admin call requires the `X-Admin-Token` header.
