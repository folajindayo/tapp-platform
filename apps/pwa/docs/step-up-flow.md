# Step-up flow — biometric grant for large debits

Status: **DESIGN, AWAITING IMPLEMENTATION SIGN-OFF**
Last updated: 2026-05-22

For Tap Card debits above the step-up threshold (default `₦15,000`),
PIN-on-merchant-device isn't enough — we want a second factor that
proves the cardholder is physically present and unimpaired. WebAuthn
platform authenticator (Face ID / Touch ID / Android biometric)
gives us that without enrolling the cardholder in anything new
(modern phones already have a registered platform credential).

The PWA shows nothing while the cardholder is at the merchant —
they're not interacting with the PWA. The merchant device renders a
QR with the step-up URL. The cardholder scans it with their own
phone's camera (every modern OS has built-in QR scanning), which
opens this page in their browser.

---

## Sequence

```
Merchant       Tapp App     Merchant Phone         Cardholder Phone (PWA)        Rails
   │              │                │                       │                       │
   │ tap card     │                │                       │                       │
   │ (₦20,000)    │                │                       │                       │
   │─────────────▶│                │                       │                       │
   │              │ GET /tap-card/nonce ──────────────────────────────────────────▶│ tier=step_up
   │              │ ◀────{ tier: "step_up", server_nonce }───────────────────────  │
   │              │                │                       │                       │
   │              │ submit debit   │                       │                       │
   │              │ POST /tap-card  ────────────────────────────────────────────── ▶│
   │              │                │                       │                       │
   │              │ ◀──402 { step_up_required, step_up_token, qr_url } ───────────│
   │              │                │                       │                       │
   │              │ show QR        │                       │                       │
   │              │ (qr_url)       │                       │                       │
   │              │                │ render QR             │                       │
   │              │                │   on screen           │                       │
   │              │                │                       │                       │
   │ "Scan with your phone"        │                       │                       │
   │              │                │ ◀──QR scanned─────────│                       │
   │              │                │                       │ /cards/step-up?       │
   │              │                │                       │   token=step_up_token │
   │              │                │                       │                       │
   │              │                │                       │ if not signed in:     │
   │              │                │                       │   Google + zkLogin    │
   │              │                │                       │                       │
   │              │                │                       │ verify token belongs  │
   │              │                │                       │ to this user's card   │
   │              │                │                       │ ────────────────────▶ │
   │              │                │                       │ ◀────────────────────│
   │              │                │                       │                       │
   │              │                │                       │ WebAuthn:             │
   │              │                │                       │ navigator.credentials │
   │              │                │                       │   .get({ publicKey }) │
   │              │                │                       │ → Face ID / Touch ID  │
   │              │                │                       │                       │
   │              │                │                       │ POST /cards/step-up/  │
   │              │                │                       │  grant                │
   │              │                │                       │   { token, assertion }│
   │              │                │                       │ ────────────────────▶ │ verify
   │              │                │                       │ ◀──{ granted: true }─│ flip flag
   │              │                │                       │                       │
   │              │ polling GET /tap-card/step-up?token=…                          │ 
   │              │ ──────────────────────────────────────────────────────────────▶│
   │              │ ◀──200 OK ──────────────────────────────────────────────────── │
   │              │                │                       │                       │
   │              │ re-submit debit with step_up_token ───────────────────────────▶│ skip tier check
   │              │                │                       │                       │ → debit
   │              │ ◀──200 settled ───────────────────────────────────────────────  │
   │              │                │                       │                       │
   │ ✓ confirm    │ "Payment       │                       │ "Verified ✓"          │
   │              │  received"     │                       │                       │
   │◀─────────────│                │                       │                       │
```

The cardholder never enters a PIN here — the step-up *replaces* the
PIN tier (it's stronger), it doesn't add to it. PIN is the
middle-tier; step-up is the high-tier.

---

## Routes

```
app/cards/step-up/page.tsx       — landing for the scanned QR
app/cards/step-up/granted.tsx    — success state
app/cards/step-up/denied.tsx     — user declined or biometric failed
```

---

## Screens

### `/cards/step-up?token=…` — landing

If not signed in:
```
┌──────────────────────────────────────────┐
│              ZORACLE                     │
│                                          │
│         Approve large payment            │
│                                          │
│   You're paying ₦20,000 to Ada's Café    │
│   using your Tapp Card.                  │
│                                          │
│   Sign in to confirm with Face ID.       │
│                                          │
│        ┌──────────────────────┐          │
│        │ Continue with Google │          │
│        └──────────────────────┘          │
└──────────────────────────────────────────┘
```

The `step_up_token` carries the amount + merchant name + card id,
all signed server-side so the PWA can display it without an extra
round-trip. After zkLogin sign-in, server verifies the token belongs
to this user.

If signed in:
```
┌──────────────────────────────────────────┐
│  ←  Approve large payment                │
│                                          │
│   Pay  Ada's Café                        │
│   ₦ 20,000  (12.34 USDC)                 │
│                                          │
│   Card  •••• 2K9P                        │
│                                          │
│        ┌──────────────────────┐          │
│        │  Confirm with        │          │
│        │  Face ID 👤          │          │
│        └──────────────────────┘          │
│                                          │
│        [ Deny ]                          │
└──────────────────────────────────────────┘
```

Confirm tap fires `navigator.credentials.get(...)` with the
platform-auth challenge the server issued. Browser/OS handles the
biometric prompt natively.

### `/cards/step-up/granted` — success

```
┌──────────────────────────────────────────┐
│                                          │
│             ✓                            │
│                                          │
│       Payment approved                   │
│                                          │
│   Ada's Café will see this completes     │
│   in their app shortly.                  │
│                                          │
│        ┌──────────────────────┐          │
│        │  Done                │          │
│        └──────────────────────┘          │
└──────────────────────────────────────────┘
```

### `/cards/step-up/denied` — user declined

```
┌──────────────────────────────────────────┐
│                                          │
│             ✕                            │
│                                          │
│       Payment denied                     │
│                                          │
│   The merchant will see this and can     │
│   try a smaller amount.                  │
│                                          │
│        ┌──────────────────────┐          │
│        │  Done                │          │
│        └──────────────────────┘          │
└──────────────────────────────────────────┘
```

Merchant-side polling sees the denial (the `/step-up` GET returns
`409 denied` instead of `200`) and surfaces "Customer declined the
charge."

---

## WebAuthn details

- **Credential type:** platform authenticator only
  (`authenticatorAttachment: 'platform'`), so external security keys
  aren't accepted. The whole point is to bind the approval to the
  cardholder's phone.
- **Enrollment:** lazy on first step-up. PWA checks
  `PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()`,
  and if no credential exists for this user, registers one via
  `navigator.credentials.create(...)` before grant. Adds ~3s to the
  first step-up of a given user; zero overhead afterward.
- **RP ID:** `tapp.zoracle.com` (or wherever the PWA is hosted).
  Hardcoded — credentials are bound to origin.
- **User verification:** `required`. No silent unlock.

If the cardholder's phone has no platform authenticator (rare on
modern phones, but possible on basic Android), fallback path:
require a 6-digit PIN re-entry server-side (different from the card
PIN — this is a long PIN stored as argon2id, separately, used only
for biometric-unavailable step-up). Out of scope for v1.

---

## Token shape

The `step_up_token` issued by `/tap-card/nonce` is a server-signed
opaque blob (HMAC-SHA256 with a Rails-held server key). It encodes:

```
{
  card_id:       uuid,
  amount:        subunit u64,
  currency:      "NGN",
  merchant_name: "Ada's Café",  // for display only
  order_id:      uuid,           // the to-be-created PaymentOrder
  expires_at:    unix_sec        // 5 minutes from issue
}
```

The PWA `/step-up` page receives the token, calls
`POST /v1/cards/me/step-up/parse { token }` which returns the
decoded fields if the HMAC checks out and the token is still valid.
That parse call is rate-limited per token (max 5 hits) so a leaked
token URL doesn't enable DoS.

---

## API endpoints used

| Method | Path                                     | Caller          | Body | When |
| ------ | ---------------------------------------- | --------------- | ---- | --- |
| POST   | `/v1/cards/me/step-up/parse`             | PWA (cardholder)| `{ token }` | Page load, to display amount + merchant. |
| POST   | `/v1/cards/me/step-up/grant`             | PWA (cardholder)| `{ token, webauthn_assertion }` | After biometric success. |
| GET    | `/v1/sender/me/tap-card/step-up?token=…` | Merchant app    | —    | Poll until 200 (granted) or 409 (denied) or 410 (timeout). |

---

## Edge cases

- **QR scanned by a phone signed in to a different account.** Server
  rejects the parse call with "this approval doesn't belong to you."
  PWA shows "This payment is for a different Zoracle account."
- **Token expired (>5 min).** Merchant polling gets 410; the
  merchant app surfaces "Approval timed out. Try again." and the
  cardholder gets a fresh QR.
- **Cardholder approves but the underlying debit then fails on-chain
  (Move aborts).** Rare — the off-chain pre-check should have caught
  any limit violation before issuing the step-up. If it happens, the
  cardholder still sees "Payment approved" on their phone, but the
  merchant sees the on-chain failure and surfaces a separate error.
  Acceptable; the alternative is making the cardholder wait through
  the on-chain confirmation, which is bad UX.
- **Multiple cards.** v1 = 1 card per user, so the step-up token's
  `card_id` is always the user's only card. v2 will need a "which
  card?" picker if we relax 1:1.
