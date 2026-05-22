# Tapp Merchant — Architecture

## What this app is

The Android-side companion to Tapp's phone-to-phone tap-to-pay. A merchant opens this app, types in an NGN amount, and the phone becomes an NFC NDEF beacon broadcasting a Zoracle checkout URL. The payer taps their phone against the merchant's, their phone reads the NDEF URL and auto-opens the Zoracle checkout web in a browser, the payer signs in via Google (zkLogin), the Rails backend settles via Route B (Sui-LP) or Route A (LiFi bridge), and fiat lands in the merchant's bank account.

This repo contains **only** the merchant-side Android app. Three sibling concerns:

- **Rails backend** (`/Users/mac/rails`, `github.com/usezoracle/rails-sui`) — shipped. We add one entity + 3 endpoints in Phase 1 to support merchants.
- **Zoracle checkout web** — separate repo, not yet built. Hosts the payer's zkLogin signing flow. The merchant app only needs to know its URL pattern: `https://checkout.zoracle.com/order/<order_id>`.
- **BaaS partner** (NGN payouts) — TBD. The Rails backend orchestrates payouts; the merchant app just shows the result.

## Hard platform constraints

- **Merchant phone MUST be Android.** Apple does not let third-party apps perform NFC HCE (Host Card Emulation); CoreNFC is read-only for non-Apple-Pay flows. There is no signal that this will change. v1 is Android-only. An iOS fallback for v2 would be displaying a QR code as a non-NFC alternative.
- **Payer phone can be anything modern.** iOS 14+ auto-opens NDEF URI tags from the lock screen without any app installed. Android does the same via the default browser. The payer needs nothing pre-installed.
- **NDEF payload is one URI record** (TNF=0x01, type=`U`, prefix byte `0x04` for `https://`). Anything richer (custom MIME, app links) hurts tap reliability across the payer device population.

## Stack

- **Expo SDK 50+** with dev client (Expo Go can't load native modules — NFC HCE requires native code).
- **TypeScript** throughout.
- **expo-router** for file-based navigation.
- **TanStack Query** for server state, **zustand** for local state.
- **react-native-mmkv** for JWT + auth state persistence.
- **react-hook-form + zod** for forms + validation.
- **NativeWind** (Tailwind for RN) for styling.
- **Native Android module** (Kotlin) for the HCE service. Wrapped behind an Expo config plugin (`plugins/withNfcHce/`).

## High-level architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Tapp Merchant (Android, RN + Expo dev client)               │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────────┐ │
│  │ Auth + JWT │  │ Onboarding │  │ Tap flow                │ │
│  │ (mmkv)     │  │ (KYB +     │  │ - amount entry          │ │
│  │            │  │  bank acct)│  │ - broadcast (HCE)       │ │
│  └────────────┘  └────────────┘  │ - real-time status (WS) │ │
│                                  └─────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Native HCE Service (Kotlin)                            │  │
│  │ - HostApduService extends Android NFC framework        │  │
│  │ - NDEF Type-4 tag emulation                            │  │
│  │ - Foreground service notification (Android 12+)        │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────┬───────────────────────────────────────┘
                       │ HTTPS (JWT) + WebSocket
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  Rails backend (Sui-native, shipped)                         │
│  - Existing /v1/auth/*, /v1/kyc/*, /v1/sender/orders         │
│  - NEW /v1/sender/me/bank-account                            │
│  - NEW /v1/sender/me/tap (creates PaymentOrder + returns URL)│
│  - NEW /ws/sender/me/payments (push status updates)          │
└──────────────────────┬───────────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        ▼                             ▼
┌────────────────────┐        ┌────────────────────┐
│ Sui chain          │        │ BaaS partner (NGN) │
│ - Move Gateway     │        │ Fiat payout to     │
│ - Order escrow     │        │ merchant bank      │
└────────────────────┘        └────────────────────┘
```

## End-to-end sequences

### Signup → onboarding → live

```
Merchant phone                    Rails backend
    │                                  │
    │ open app (first launch)          │
    │ tap "Sign up"                    │
    │                                  │
    │ POST /v1/auth/register           │
    │  { email, password }             │
    │─────────────────────────────────▶│
    │                       JWT token  │
    │◀─────────────────────────────────│
    │ persist JWT (mmkv)               │
    │ navigate (onboarding) → KYB      │
    │                                  │
    │ POST /v1/kyc                     │
    │  { wallet_address, signature,    │
    │    nonce }                       │
    │─────────────────────────────────▶│
    │              { url, expiresAt }  │
    │◀─────────────────────────────────│
    │ open Smile Identity hosted page  │
    │ merchant completes selfie + ID   │
    │                                  │
    │ (poll GET /v1/kyc/:wallet)       │
    │─────────────────────────────────▶│
    │              { status: success } │
    │◀─────────────────────────────────│
    │                                  │
    │ navigate → Bank account screen   │
    │ POST /v1/verify-account          │
    │  { institution, account_id }     │
    │─────────────────────────────────▶│
    │            { account_name }      │
    │◀─────────────────────────────────│
    │ show resolved name; merchant     │
    │ confirms                         │
    │                                  │
    │ POST /v1/sender/me/bank-account  │
    │  { currency: "NGN", bank_code,   │
    │    account_number,               │
    │    account_name }                │
    │─────────────────────────────────▶│
    │            { id, verified_at }   │
    │◀─────────────────────────────────│
    │ navigate → dashboard (live)      │
```

### Tap-to-pay

```
Merchant phone               Rails backend           Payer phone (any)
    │                            │                       │
    │ Dashboard → "New payment"  │                       │
    │ enter amount: ₦5,000       │                       │
    │ tap "Tap to take"          │                       │
    │                            │                       │
    │ POST /v1/sender/me/tap     │                       │
    │  { amount: 5000,           │                       │
    │    currency: "NGN" }       │                       │
    │───────────────────────────▶│                       │
    │   { order_id, checkout_url,│                       │
    │     expires_at }           │                       │
    │◀───────────────────────────│                       │
    │                            │                       │
    │ navigate → Broadcast screen│                       │
    │ start HCE service          │                       │
    │ emit NDEF URI record:      │                       │
    │  https://checkout.zoracle  │                       │
    │  .com/order/<id>           │                       │
    │                            │                       │
    │ WS connect                 │                       │
    │ /ws/sender/me/payments     │                       │
    │───────────────────────────▶│                       │
    │     { subscribed: true }   │                       │
    │◀───────────────────────────│                       │
    │                            │                       │
    │ ←──── NFC tap ────────────────────────────────────── tap
    │       (Android HCE responds with NDEF URI)         │
    │                            │                       │
    │                            │   Payer phone reads   │
    │                            │   NDEF, auto-opens    │
    │                            │   checkout_url in     │
    │                            │   default browser     │
    │                            │                       │
    │                            │ ←─── Checkout web ─── browser
    │                            │      (zkLogin →       │
    │                            │       create_order    │
    │                            │       PTB → submit)   │
    │                            │                       │
    │                            │   Sui OrderCreated    │
    │                            │   event arrives       │
    │                            │   (existing indexer)  │
    │                            │                       │
    │                            │   matching/routing →  │
    │                            │   settled             │
    │                            │                       │
    │  event: payment.settled    │                       │
    │◀───────────────────────────│                       │
    │ stop HCE                   │                       │
    │ navigate → "Payment        │                       │
    │   received ₦5,000"         │                       │
```

### Cancel / expiry

If the merchant backs out of the broadcast screen, or `expires_at` passes without a tap, the app calls `POST /v1/sender/orders/:id/cancel` (existing) and stops the HCE service. The order transitions to `cancelled` in Rails.

## Data model

### Merchant entity (Rails-side)

Reused: `SenderProfile` (existing). Adds one one-to-one edge to a new entity `MerchantBankAccount`:

```
MerchantBankAccount {
  id              uuid
  currency        string         // "NGN"
  bank_code       string         // institution code (joins Institution.code)
  account_number  string
  account_name    string
  verified_at     timestamp
  created_at, updated_at
  edge: From("sender_profile").Ref("merchant_bank_account").Unique()
}
```

One per SenderProfile. Set once at onboarding, can be updated via the same endpoint.

### Per-tap payment

Reused: `PaymentOrder` + `PaymentOrderRecipient` (existing). The new `POST /v1/sender/me/tap` endpoint copies the saved `MerchantBankAccount` fields into a fresh `PaymentOrderRecipient` and creates the `PaymentOrder` in the usual way. No new tables.

### App-side state

- **Persisted (mmkv):** JWT access + refresh tokens, merchant ID, merchant email (for display).
- **Server state (TanStack Query):** all API responses, with key prefixes per endpoint (`['merchant', 'me']`, `['merchant', 'bank-account']`, `['payments', orderId]`, etc.).
- **Ephemeral (zustand):** current tap session — amount entered, current order ID, HCE running state, broadcast expiry countdown.

## Trust & threat model

- **JWT theft on the device:** mitigated by storing in `react-native-mmkv` with encryption flag. Acceptable for v1; consider Android Keystore-backed wrapping for v2.
- **Tap intercepted (someone else's phone reads the NDEF):** the NDEF only contains a checkout URL with a short-lived order ID. Reading it doesn't grant payment authority — the payer still needs to sign in with their own Google account and pay from their own Sui wallet. Replay risk is low.
- **Payer pays the wrong merchant:** the order ID in the URL ties payment to a specific merchant's bank account. As long as the merchant phone's HCE service is broadcasting that specific order's URL, payment can only land on that merchant.
- **Merchant cancels mid-broadcast after a tap but before payment lands:** the cancel endpoint flips the order's status; if a payment then arrives, the Rails indexer refunds (existing flow).
- **Network drop on merchant phone after broadcast starts:** HCE keeps broadcasting locally. Payer still pays. Merchant's WS reconnects on app foreground; if the payment landed during the offline window, the dashboard's next refresh shows it.

## Out of scope (v1)

- iOS merchant app (Apple HCE restriction).
- Multi-currency (KES, IDR) — locked NGN-only in the Rails plan.
- Multi-merchant under one account (each merchant = one SenderProfile).
- Tap Card / physical NFC cards (PRD Part 2.2) — separate flow, separate spec when prioritized.
- Offline tap recovery (if payer can't reach the internet to load checkout) — flag for v2.
- Merchant payout history → bank reconciliation views beyond a flat transaction list.

## References

- Rails handoff: `/Users/mac/rails/docs/handoff-2026-05-21.md`
- Rails B2B API spec: `/Users/mac/rails/docs/b2b-api-spec.md`
- PRD (Tapp Part 2): conversation history (`docs/PRD.md` not yet committed)
- Android HCE official docs: <https://developer.android.com/develop/connectivity/nfc/hce>
- NDEF URI Record Type Definition: <https://nfc-forum.org/uploads/specifications/24-NFCForum-TS-RTD_URI_1.0.pdf>
