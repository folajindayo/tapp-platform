# Tapp PWA — Architecture

Status: **DESIGN, AWAITING IMPLEMENTATION SIGN-OFF**
Last updated: 2026-05-22

The Tapp PWA is the cardholder-side web app for the Zoracle ecosystem.
It is **not the merchant app** (that's `usezoracle/tapp-merchant`, an
Expo app for shop owners). The PWA is what a regular consumer opens
on their phone when:

1. They tap a fresh Tapp Card and the OS opens the activation URL.
2. They tap a merchant's phone for a phone-to-phone payment and the
   OS opens the checkout URL.
3. They want to manage a card they've already linked (top up, view
   activity, resync after a torn write, revoke).
4. They need to complete a step-up biometric check for a large Tap
   Card debit.

Crucially, the PWA is the *only* place anything cardholder-side
touches a private key. The merchant app never sees zkLogin auth, never
sees PINs, never sees `K` (the on-card secret) — keeps the trust
boundaries clean.

---

## Position in the Zoracle stack

```
┌─────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐
│  Tapp Merchant      │     │  Tapp PWA            │     │  NFC Tools (PoC)     │
│  (Expo, iOS+Android)│     │  (browser, mobile)   │     │  (3rd-party app)     │
│                     │     │                      │     │                      │
│  shop owner side    │     │  cardholder side     │     │  one-time card-write │
│  - take payments    │     │  - link / top-up /   │     │  for PoC hand-tests  │
│  - HCE / QR / Tap   │     │    revoke cards      │     │                      │
│    Card reader      │     │  - phone-to-phone    │     └──────────────────────┘
│  - PIN pad UI       │     │    checkout (zkLogin)│
│  - SSE for status   │     │  - step-up biometric │
└──────────┬──────────┘     │  - torn-write resync │
           │                └──────────┬───────────┘
           │ HTTPS (JWT)               │ HTTPS (zkLogin session)
           │ + SSE                     │
           ▼                           ▼
┌────────────────────────────────────────────────────┐
│  Rails backend (usezoracle/rails-sui)              │
│  Sui Move contracts + Go services                  │
│  - PaymentOrder lifecycle                          │
│  - TappCard + CardSpendingCap                      │
│  - Route A (bridge) / Route B (LP) settlement      │
└────────────────────────────────────────────────────┘
```

The PWA shares no code with the merchant app. They speak the same
Rails API but live in different repos, different stacks, with
different trust models (PWA = personal auth + on-device key material;
merchant app = business auth + no key material beyond ephemeral
per-tap derivations).

---

## Stack

Recommendation (open to debate before scaffolding):

| Concern             | Pick                                    | Why |
| ------------------- | --------------------------------------- | --- |
| Framework           | **Next.js 15 (App Router)**             | First-class PWA support, server actions for the small bits of server-side glue, easy Vercel deploy. |
| Runtime             | **React 19**                            | Goes with Next 15, concurrent rendering helps the NFC-busy linking screen feel responsive. |
| Styling             | **Tailwind + design tokens from users-app** | Matches the visual style already locked across users-app + tapp-merchant. |
| zkLogin             | **`@mysten/zklogin` + `@mysten/sui.js`**| Mysten's reference path. Google as the OIDC provider in v1. |
| Web NFC             | **Native `navigator.nfc`**              | Standard API in Chrome on Android. No library needed. iOS gap is real (see below). |
| WebAuthn            | **`@simplewebauthn/browser`**           | Wraps platform authenticator (Touch ID / Face ID / Android biometric) for step-up. |
| State               | **TanStack Query**                      | Same as merchant app; cache invalidation patterns transfer. |
| Forms               | **react-hook-form + zod**               | Same as merchant app. |
| Icons               | **Lucide + brand icons ported from users-app** | Same `Icons.*` set we already use. |
| PWA manifest        | **`next-pwa` or hand-rolled service worker** | Installable "Add to Home Screen" on both platforms. |

Storage: nothing sensitive in `localStorage`. zkLogin ephemeral keys
live in `IndexedDB` per Mysten guidance (encrypted with a Web Crypto
derived key). `K` (the on-card secret) NEVER persists — read fresh
from card on every Web NFC interaction, wiped from memory after use.

---

## Routes

```
app/
├── (auth)/
│   └── sign-in/page.tsx              # zkLogin (Google) entry
├── (cardholder)/
│   ├── dashboard/page.tsx            # overview: balance, recent activity
│   ├── dashboard/cards/[id]/page.tsx # one card: status, limits, recent debits
│   ├── link/page.tsx                 # claim a tapped activation URL
│   ├── cards/
│   │   ├── top-up/page.tsx           # add USDC to a CardSpendingCap
│   │   ├── revoke/page.tsx           # kill switch
│   │   ├── resync/page.tsx           # torn-write recovery
│   │   ├── step-up/page.tsx          # biometric grant for large debit
│   │   └── unavailable/page.tsx      # status-page for revoked/locked/wrong-user
├── order/
│   └── [id]/page.tsx                 # phone-to-phone payer checkout (zkLogin)
└── layout.tsx                        # root layout, PWA manifest, service worker
```

Anything under `(cardholder)/` requires a live zkLogin session.
`/order/[id]` allows zero-state entry (the payer arrived via NFC tap;
they log in inside the flow).

---

## Five user-facing flows (each gets its own doc)

| Flow              | Doc                          | Trigger |
| ----------------- | ---------------------------- | --- |
| **Linking**       | `docs/linking-flow.md`       | First tap of a fresh card opens `/c/:token` → 302 → `/link?token=…`. |
| **Checkout**      | `docs/checkout-flow.md`      | Payer's phone taps a merchant phone (or scans QR on iOS) → opens `/order/:id` from NDEF URL. |
| **Resync**        | `docs/resync-flow.md`        | Cardholder gets "card needs resync" at a merchant → opens PWA → resync from dashboard. |
| **Step-up**       | `docs/step-up-flow.md`       | Merchant shows a QR for a large debit → cardholder scans → `/cards/step-up?token=…`. |
| **Top-up / revoke** | (covered as a section in `linking-flow.md`) | User-initiated from dashboard. |

---

## What the PWA does NOT do

- **Holds long-lived secret material.** zkLogin ephemeral key rotates
  per Mysten's recommended lifetime; nothing else persists.
- **Sees PINs.** PIN is typed on the merchant device during a Tap Card
  debit. The PWA never touches it.
- **Settles fiat.** Rails owns the fiat rail. The PWA only shows
  cardholder-side state (balance, limits, activity).
- **Drives transactions.** All txns are merchant-initiated or
  payer-initiated via zkLogin signing — there's no "send money to
  X" surface in v1.

---

## Open architectural questions (flag before scaffolding)

1. **Hosting.** Vercel (zero-config Next.js) or Cloudflare Pages? Both
   work. Cloudflare gives slightly cheaper edge runtime; Vercel gives
   better Next.js DX. Default: Vercel for v1.
2. **Service worker scope.** Full PWA-installable with offline shell,
   or just "Add to Home Screen" with online-only UX? Default: latter
   for v1 — offline support is complex when the whole flow needs a
   live backend round-trip.
3. **zkLogin OIDC providers.** Google only in v1, or Google + Apple +
   Facebook? Apple Sign-In is operationally painful (Apple Developer
   account + Services ID + private key file). Default: Google only for
   v1; revisit before public launch.
4. **PWA-side analytics.** Mixpanel? Plausible? None until the first
   100 users? Default: none until we know what we want to measure.
5. **Currency display.** USDC subunit math everywhere or local-currency
   display (NGN equivalent) shown alongside? Default: dual display
   (USDC primary, NGN secondary) since cardholders think in fiat.
6. **iOS resync gap.** Acknowledged in `resync-flow.md`. Confirm v1
   stance is "admin-recovery for iOS users" until native iOS Zoracle
   Wallet ships in v1.5.
