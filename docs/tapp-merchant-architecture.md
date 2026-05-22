# Tapp Merchant — Architecture

## What this app is

A cross-platform (Android + iOS) merchant app for Tapp's tap-to-pay. The merchant enters an NGN amount and the app exposes **two payment input methods** the merchant can choose between per transaction:

1. **Phone-to-phone:** the payer's phone communicates directly with the merchant's phone.
   - On Android merchants: via NFC HCE (the merchant phone broadcasts an NDEF URI tag the payer's phone reads on tap).
   - On iOS merchants: via QR code (the app displays a QR encoding the same checkout URL; the payer scans with their camera). Apple does not allow third-party apps to perform NFC HCE, so QR is the iOS equivalent surface.
2. **Tap Card (NTAG215):** the payer carries a physical NFC card pre-linked to their Sui balance. The merchant phone reads the card's UID; backend deducts from the linked balance. Works on **both** Android and iOS — both expose NFC reader APIs (Android `NfcAdapter`, iOS `CoreNFC`).

In both methods, the downstream flow is the same: Rails backend creates a `PaymentOrder`, routes via Route B (Sui-LP) or Route A (LiFi bridge), settles fiat to the merchant's saved bank account.

This repo contains **only** the merchant-side app. Three sibling concerns:

- **Rails backend** (`/Users/mac/rails`, `github.com/usezoracle/rails-sui`) — shipped. We add one entity + 4 endpoints (3 for the merchant + 1 for Tap Card payments) in Phase 1.
- **Zoracle checkout web** — separate repo, not yet built. Hosts both the payer's phone-to-phone zkLogin signing flow AND the Tap Card linking flow (where a user binds a blank NTAG215 to their Sui zkLogin balance).
- **BaaS partner** (NGN payouts) — TBD. The Rails backend orchestrates payouts.

## Platform / method matrix

|              | **Phone-to-phone**                          | **Tap Card (NTAG215)**             |
|--------------|---------------------------------------------|------------------------------------|
| **Android**  | NFC HCE (active NDEF broadcast)             | NfcAdapter reader mode             |
| **iOS**      | QR code display (no HCE allowed)            | CoreNFC reader session             |

Per-platform notes:

- **Android merchant device:** must have NFC hardware (every mid-tier Android since ~2014). The phone-to-phone path additionally requires `android.hardware.nfc.hce`; almost universal but explicitly required in the manifest so the Play Store filters unsupported devices.
- **iOS merchant device:** iPhone 7 or later (CoreNFC required for the Tap Card reader). iPhone 7 through iPhone XR can only do reader mode in foreground via NFCNDEFReaderSession; iPhone XS+ can do NFCTagReaderSession with more control (we use NDEF reader for compatibility).
- **Payer device:** anything modern with a camera + the ability to scan QR (every smartphone) or read an NDEF tag (iOS 14+, all NFC Android). Payer needs no app on phone-to-phone; for Tap Card the payer just needs the physical card.

## Payment payload

- **Phone-to-phone (both HCE and QR variants):** a Zoracle checkout URL `https://checkout.zoracle.com/order/<order_id>` carrying the new order's ID. The payer's device opens it in a browser, where checkout web handles zkLogin signing + PTB submission. URL is intentionally the only payload — adding app links, custom MIME, or richer encoding kills cross-device tap/scan reliability.
- **Tap Card:** the merchant app reads the card's UID (7 bytes for NTAG215). The app POSTs `{ order_id, card_uid, amount }` to the backend, which looks up the card's linked Sui zkLogin balance and performs the deduction. No payer interaction at the time of payment.

## Stack

- **Expo SDK 50+** with dev client (Expo Go can't load native modules — both NFC HCE and CoreNFC entitlements need native code).
- **TypeScript** throughout.
- **expo-router** for file-based navigation.
- **TanStack Query** for server state, **zustand** for local state.
- **react-native-mmkv** for JWT + auth state persistence.
- **react-hook-form + zod** for forms + validation.
- **NativeWind** (Tailwind for RN) for styling.
- **`react-native-nfc-manager`** for cross-platform NFC reader mode (Tap Card flow on both Android + iOS). Mature, well-maintained, wraps `NfcAdapter` on Android and `NFCNDEFReaderSession`/`NFCTagReaderSession` on iOS.
- **Custom native Android module** for HCE (Android-only). Wrapped behind an Expo config plugin (`plugins/withNfcHce/`). Reason for not using a community HCE lib: Android 14 foreground-service policy changes; thin in-house module (~250 LoC Kotlin) is less risk than the upstream surface (see `nfc-hce-spec.md`).
- **`react-native-qrcode-svg`** for the iOS phone-to-phone QR code display.
- **Expo config plugins** for iOS CoreNFC entitlements + Info.plist (`NFCReaderUsageDescription`, `com.apple.developer.nfc.readersession.formats`).

## High-level architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Tapp Merchant (Android + iOS, RN + Expo dev client)               │
│                                                                    │
│  ┌────────────┐  ┌────────────┐  ┌─────────────────────────────┐  │
│  │ Auth + JWT │  │ Onboarding │  │ Tap flow                    │  │
│  │ (mmkv)     │  │ (KYB +     │  │ - amount entry              │  │
│  │            │  │  bank acct)│  │ - method picker:            │  │
│  └────────────┘  └────────────┘  │     phone-to-phone | card   │  │
│                                  │ - broadcast / scan / read   │  │
│                                  │ - real-time status (WS)     │  │
│                                  └─────────────────────────────┘  │
│                                                                    │
│  ┌──────────────────────────┐  ┌───────────────────────────────┐  │
│  │ Phone-to-phone           │  │ Tap Card (NTAG215)            │  │
│  │ - Android: HCE (Kotlin   │  │ - Both: react-native-nfc-     │  │
│  │   HostApduService)       │  │   manager (cross-platform     │  │
│  │ - iOS: QR display        │  │   NDEF reader)                │  │
│  │   (react-native-qrcode-  │  │ - iOS entitlement +           │  │
│  │   svg)                   │  │   Info.plist via config       │  │
│  └──────────────────────────┘  │   plugin                      │  │
│                                └───────────────────────────────┘  │
└──────────────────────┬─────────────────────────────────────────────┘
                       │ HTTPS (JWT) + SSE
                       ▼
┌────────────────────────────────────────────────────────────────────┐
│  Rails backend (Sui-native, shipped)                               │
│  - Existing /v1/auth/*, /v1/kyc/*, /v1/sender/orders               │
│  - NEW /v1/sender/me/bank-account                                  │
│  - NEW /v1/sender/me/tap (phone-to-phone — PaymentOrder + URL)     │
│  - NEW /v1/sender/me/tap-card (Tap Card — debit linked balance)    │
│  - NEW /v1/sender/me/payments/stream (push status updates)                │
└──────────────────────┬─────────────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────────┐
        ▼              ▼                  ▼
┌────────────────┐  ┌──────────────┐  ┌──────────────────┐
│ Sui chain      │  │ BaaS (NGN)   │  │ Card-linking     │
│ - Move Gateway │  │ Fiat payout  │  │ (checkout web,   │
│ - Order escrow │  │ to merchant  │  │  separate repo)  │
│ - Card debit   │  │ bank         │  │                  │
│   authority    │  │              │  │                  │
└────────────────┘  └──────────────┘  └──────────────────┘

Payer-side flows (out of scope this repo):
  Phone-to-phone: payer device (NDEF/QR) → checkout.zoracle.com → zkLogin → Sui PTB
  Tap Card:       no payer interaction at tx time; card was linked once via checkout web
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
    │ /v1/sender/me/payments/stream     │                       │
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

### Tap Card payment (NTAG215)

```
Merchant phone                Rails backend            Sui chain
    │                              │                       │
    │ Dashboard → "New payment"    │                       │
    │ enter amount: ₦5,000         │                       │
    │ method picker → "Tap Card"   │                       │
    │                              │                       │
    │ Start NFC reader session     │                       │
    │ (Android: NfcAdapter;        │                       │
    │  iOS: NFCNDEFReaderSession)  │                       │
    │                              │                       │
    │ ← payer presents NTAG215     │                       │
    │   card to back of phone      │                       │
    │ read 7-byte UID              │                       │
    │                              │                       │
    │ POST /v1/sender/me/tap-card  │                       │
    │  { amount: 5000,             │                       │
    │    card_uid: "04A3B2C1..." } │                       │
    │─────────────────────────────▶│                       │
    │                  resolve card_uid → linked Sui addr  │
    │                  check linked balance ≥ coin_amount  │
    │                  build settle PTB using card-debit   │
    │                  authority (Move package)            │
    │                              │──────────────────────▶│
    │                              │   tx: card_debit      │
    │                              │   → settle to LP or   │
    │                              │   bridge wallet       │
    │                              │◀──────────────────────│
    │                              │   OrderSettled event  │
    │   { order_id, status:        │                       │
    │     "settled", fiat_amount } │                       │
    │◀─────────────────────────────│                       │
    │                              │                       │
    │ navigate → "Payment received │                       │
    │   ₦5,000"                    │                       │
```

The Tap Card flow is **synchronous from the merchant's perspective**: the read + backend round-trip resolve in one screen, no waiting for an off-device signing step. The backend uses a pre-authorized debit capability granted by the user at card-linking time (handled by the checkout web, not this app) so no user interaction is needed at transaction time.

### Cancel / expiry

If the merchant backs out of the broadcast screen, or `expires_at` passes without a tap (phone-to-phone), the app calls `POST /v1/sender/orders/:id/cancel` (existing) and stops the HCE/QR display. The order transitions to `cancelled` in Rails. Tap Card transactions are synchronous and have no cancel/expiry — they either settle in the single round-trip or fail outright.

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
- **Network drop on merchant phone after broadcast starts:** HCE keeps broadcasting locally. Payer still pays. Merchant's SSE reconnects (with `Last-Event-ID`) on app foreground; if the payment landed during the offline window, the missed events are replayed from the server's ring buffer.

## Out of scope (v1)

- Multi-currency (KES, IDR) — locked NGN-only in the Rails plan.
- Multi-merchant under one account (each merchant = one SenderProfile).
- The card-linking flow itself (lives on the checkout web; merchant app only reads cards that are already linked).
- The Move-package debit-authority contract changes required for Tap Card on-chain — separate Rails/contracts workstream. The merchant app's Tap Card flow targets the eventual `/v1/sender/me/tap-card` endpoint regardless of whether the backend currently stubs or fully implements it.
- Offline tap recovery (if payer can't reach the internet to load checkout for phone-to-phone) — flag for v2.
- Merchant payout history → bank reconciliation views beyond a flat transaction list.

## References

- Rails handoff: `/Users/mac/rails/docs/handoff-2026-05-21.md`
- Rails B2B API spec: `/Users/mac/rails/docs/b2b-api-spec.md`
- PRD (Tapp Part 2): conversation history (`docs/PRD.md` not yet committed)
- Android HCE official docs: <https://developer.android.com/develop/connectivity/nfc/hce>
- NDEF URI Record Type Definition: <https://nfc-forum.org/uploads/specifications/24-NFCForum-TS-RTD_URI_1.0.pdf>
