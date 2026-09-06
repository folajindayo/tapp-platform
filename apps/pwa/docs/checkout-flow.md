# Checkout flow — phone-to-phone payer side

Status: **DESIGN, AWAITING IMPLEMENTATION SIGN-OFF**
Last updated: 2026-05-22

The cardholder is paying a merchant by tapping their phone (or
scanning a QR on iOS). The merchant's app has already created a
`PaymentOrder` in Rails and is broadcasting the URL
`https://api.usetapp.xyz/order/<id>` via NFC HCE or QR. The payer's
phone opens it — and lands here.

No app required on the payer side. Just a web page that opens via
the OS's native NDEF/QR handlers.

---

## Sequence

```
Payer                  PWA                            Rails           Sui
 │  taps merchant       │                              │               │
 │  ─OS opens URL──────▶│ /order/abc-123               │               │
 │                      │                              │               │
 │                      │ GET /v1/orders/abc-123       │               │
 │                      │─────────────────────────────▶│ load order    │
 │                      │ ◀──{ amount, token, network, │               │
 │                      │     recipient, expires_at }──│               │
 │                      │                              │               │
 │ "₦2,500 to Ada Café" │                              │               │
 │                      │                              │               │
 │ tap "Pay with Google"│                              │               │
 │ ───────────────────▶│                              │               │
 │                      │ Google OAuth → zkLogin       │               │
 │                      │ ephemeral KP + JWT           │               │
 │                      │ derive Sui address           │               │
 │                      │                              │               │
 │                      │ build PTB:                   │               │
 │                      │   gateway::create_order(     │               │
 │                      │     coin: USDC, amount,      │               │
 │                      │     rate, institution_code,  │               │
 │                      │     message_hash: enc(       │               │
 │                      │       recipient + ref))      │               │
 │                      │                              │               │
 │ "Confirm payment"    │ show summary + zkLogin sign  │               │
 │ tap confirm          │                              │               │
 │ ───────────────────▶│ sui.executeTransactionBlock──▶│              ▶ Move:
 │                      │                              │               │ create_order
 │                      │                              │ ◀─tx_digest──│
 │                      │                              │               │
 │                      │ poll GET /v1/orders/abc-123  │               │
 │                      │ until status=deposited       │               │
 │ "Payment received"   │                              │               │
 │ (animated success)   │                              │               │
 │◀─────────────────────│                              │               │
 │                      │                              │               │
 │                      │                  (in parallel: Rails indexer │
 │                      │                   sees OrderCreated, runs    │
 │                      │                   Route A or B → settles to  │
 │                      │                   merchant's NGN bank.       │
 │                      │                   Merchant's SSE stream sees │
 │                      │                   payment.settled & shows    │
 │                      │                   "Payment received" on his  │
 │                      │                   own device.)               │
```

---

## Routes

```
app/order/[id]/page.tsx     — main checkout
app/order/[id]/expired.tsx  — fallback when expires_at has passed
app/order/[id]/error.tsx    — load failure, unsupported coin, etc.
```

---

## Screens

### `/order/:id` — Initial load

```
┌──────────────────────────────────────────┐
│  ←                                  ⓘ    │
│                                          │
│           Pay Ada's Café                 │
│                                          │
│             ₦ 2,500                      │
│         (~1.55 USDC)                     │
│                                          │
│  ⏱ Order expires in 2:47                 │
│                                          │
│      ┌──────────────────────────┐        │
│      │   Pay with Google        │        │
│      └──────────────────────────┘        │
│                                          │
│   Powered by Zoracle                     │
└──────────────────────────────────────────┘
```

- Amount shown both in fiat and in the underlying crypto (USDC).
- Live countdown to `expires_at`. At 0:00, route to `/expired.tsx`.
- "Pay with Google" kicks off zkLogin via Google as the OIDC
  provider. v1 is Google-only (Apple Sign-In ops painful; revisit
  for v1.5).
- Merchant name shown is the SenderProfile's display name, not the
  bank account name (privacy).

### `/order/:id` — After zkLogin, confirm screen

```
┌──────────────────────────────────────────┐
│  ←  Confirm payment                      │
│                                          │
│   Pay  Ada's Café                        │
│   ₦ 2,500  (1.55 USDC)                   │
│                                          │
│   From  ada.alice@gmail.com              │
│         0x7a3b…d8c1 (your Sui address)   │
│                                          │
│   Network  Sui                           │
│   Fee      ~0.005 USDC                   │
│                                          │
│      ┌──────────────────────────┐        │
│      │     Confirm & sign       │        │
│      └──────────────────────────┘        │
└──────────────────────────────────────────┘
```

- "Confirm & sign" triggers zkLogin signature over the PTB.
- Show fees transparently (network fee, Rails protocol fee if
  applicable).

### `/order/:id` — Submitting

Full-screen pending state with progress copy that updates as the
status moves through `pending → deposited → processing → settled`.

Polls `GET /v1/orders/:id` every 2s. Stops polling on terminal
states. Backs off after 30s to once per 5s.

### `/order/:id` — Success

```
┌──────────────────────────────────────────┐
│                                          │
│              ✓                           │
│                                          │
│        Payment received                  │
│           ₦ 2,500                        │
│                                          │
│   Ada's Café will see this in their app. │
│                                          │
│   Receipt: zoracle.com/r/abc-123         │
│   ┌────────────────────────────┐         │
│   │  Save receipt              │         │
│   └────────────────────────────┘         │
│                                          │
│   ┌────────────────────────────┐         │
│   │  Done                      │         │
│   └────────────────────────────┘         │
└──────────────────────────────────────────┘
```

- "Save receipt" copies the receipt URL or shares via the Web Share
  API. The receipt page is read-only and doesn't require auth (the
  URL is sufficient capability).
- "Done" closes the tab if opened by NDEF; routes to `/` otherwise.

### `/order/:id` — Expired or unavailable

Clear copy: "This order expired. Ask the merchant to try again."
No partial-payment recovery in v1 — Rails refunds any deposit that
arrives after expiry to the receive-address-derived refund path.

---

## Edge cases

- **Insufficient USDC balance.** zkLogin signing fails with a Sui
  error. PWA catches and shows "Not enough USDC. Top up your wallet
  and try again." Doesn't offer an in-PWA top-up in v1 — refers to
  the user's exchange/wallet of choice.
- **Already-settled order (cardholder taps the same NFC URL twice).**
  PWA sees `status: settled` on initial load and goes straight to
  the success screen.
- **Cardholder is logged in to PWA already.** Skip Google sign-in,
  go straight to confirm screen.
- **Network is slow during PTB submit.** Show a recoverable spinner
  ("Confirming on Sui — this can take 10s"). After 30s, show
  "Still working… [Cancel]" so the user isn't stranded.

---

## API endpoints used (PWA → Rails)

| Method | Path                  | Body          | When |
| ------ | --------------------- | ------------- | --- |
| GET    | `/v1/orders/:id`      | —             | Load + poll. Returns `{ status, amount, token, network, recipient, expires_at, ... }`. |
| GET    | `/v1/orders/:id/build-ptb` | —        | Helper: server-side PTB build for the PWA to sign. Saves the PWA from carrying full Move SDK. |
| GET    | `/v1/aggregator-pubkey` | —           | RSA pubkey for sealing recipient bank details in the PTB's `message_hash`. |

The signing itself happens client-side via `@mysten/sui.js`
`signAndExecuteTransactionBlock`. zkLogin proof is constructed and
appended per Mysten's reference flow.

---

## What if the payer has a Tap Card?

They could in theory pay with their card balance via the merchant
side, but in *this* flow they're paying with their connected zkLogin
wallet directly. The two flows are independent — Tap Card debits a
`CardSpendingCap`, phone-to-phone debits the user's main wallet
balance. v1 doesn't try to merge them; each is a clean primitive.

A nice v2: cardholders could mark "use card balance first" on their
profile, and the PWA would route phone-to-phone through the card's
cap when balance is sufficient. Not designed yet.
