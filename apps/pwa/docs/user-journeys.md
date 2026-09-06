# Tapp — User Journeys

Status: **DRAFT — awaiting go-ahead before any code lands**
Last updated: 2026-05-22

## 0. North star

> **Tapp is a Sui wallet that pays merchants. Everything else is an
> extra.**

Every screen in the app should defend that sentence. If a UI element
doesn't help the user with one of the four wallet primitives, it
belongs in Settings — not the primary surface.

The four primitives (in priority order, copied from the user brief):

| # | Primitive | What it answers |
|---|-----------|-----------------|
| 1 | **Balance** | "Do I have enough right now?" |
| 2 | **Pay** (withdraw) | "How do I spend it?" |
| 3 | **Deposit** | "How do I add more?" |
| 4 | **History** | "Where did my money go?" |

Everything currently in the codebase that isn't one of those four
collapses into Settings: linked Tapp Card, limits, PIN, revoke,
resync, step-up, network info, address, ID, etc.

---

## 1. Information architecture (target)

```
Tapp PWA (after sign-in)
│
├── /              landing (signed out only)
├── /sign-in       Google → zkLogin
│
├── /wallet        ◆ PRIMARY SURFACE
│                  ┌──────────────────────────────────┐
│                  │  Balance (USDC + ≈ NGN)          │
│                  │  ┌────────┐  ┌────────┐          │
│                  │  │  Pay   │  │ Deposit│          │
│                  │  └────────┘  └────────┘          │
│                  │  ─── Recent activity ───         │
│                  │  • Ada Café        −2,400 ₦      │
│                  │  • Top up          +50.00 USDC   │
│                  │  …                               │
│                  └──────────────────────────────────┘
│
├── /pay           in-PWA QR scanner (full screen)
├── /deposit       address + QR + copy
├── /history       full transaction list
├── /tx/[digest]   single transaction receipt
│
├── /order/[id]    ◆ PAY-MERCHANT REVIEW
│                  opened by NFC tap from merchant
│                  OR by /pay scanning the merchant QR
│
└── /settings      ◆ EVERYTHING ELSE
    ├── /settings/card     linked Tapp Card status + actions
    │   (→ /cards/top-up, /cards/revoke, /cards/resync, /cards/step-up)
    ├── /settings/limits   edit daily / per-tap / step-up
    └── /settings/security PIN change, sign out
```

Existing routes that survive but get demoted:
- `/dashboard` → 308-redirects to `/wallet` (preserve any external links).
- `/dashboard/cards/[id]` → merged into `/settings/card`.
- `/link`, `/link/configure`, `/link/write`, `/link/sign` → kept as the
  *physical card linking* sub-flow; entry point moves into
  `/settings/card` ("Link a Tapp Card") instead of being prompted on
  the wallet glance view.
- `/cards/{top-up,revoke,resync,unavailable}` → kept as
  destinations, but reached from `/settings/card` not from the
  primary surface.

New routes to add: `/wallet`, `/pay`, `/deposit`, `/history`,
`/tx/[digest]`, `/order/[id]`, `/settings`, `/settings/card`,
`/settings/limits`, `/settings/security`, `/cards/step-up`.

---

## 2. Five user journeys

For each journey: the user's thought → the screen → the data the
screen reads → the action(s) → the next state.

### J1 — Onboard (first run)

> "I have a fresh Google login. Get me to a working wallet."

| Step | Screen | What user sees | Data | Action |
|------|--------|----------------|------|--------|
| 1 | `/` | "Tap, pay, done." + Sign in | — | tap **Get started** |
| 2 | `/sign-in` | Google button | — | Google OAuth → zkLogin |
| 3 | `/wallet` | Zero balance, **Pay** disabled, **Deposit** highlighted, empty history with "No activity yet — deposit USDC to start" | `GET /v1/wallet/me` | tap **Deposit** |
| 4 | `/deposit` | QR + address + copy | derived from session | copy & share / done |
| 5 | `/wallet` | Balance updated after first deposit lands (poll or SSE) | `GET /v1/wallet/me` (5s poll until first balance > 0) | — |

If the user instead arrived by tapping a physical card (URL opens
`/link?token=…`), the existing linking flow runs and lands them on
`/wallet` with a linked-card badge in Settings.

### J2 — Glance (every-day open)

> "What's my balance? Did my last tap go through?"

`/wallet` answers in one screen, no scroll required for the top half:

```
┌──────────────────────────────────────────┐
│  Balance                                  │
│  72.50 USDC                               │
│  ≈ ₦108,750                               │
│                                           │
│  ┌──── Pay ────┐  ┌── Deposit ──┐          │
│                                           │
│  Recent activity                          │
│  ──────────────────────────                │
│  Ada Café             −2,400 ₦   2m ago   │
│  Uber                 −3,800 ₦  18m ago   │
│  Top up              +50.00 USDC  1h ago  │
│  View all activity →                      │
└──────────────────────────────────────────┘
```

- Balance: primary `text-3xl font-medium tabular-nums`, NGN
  equivalent in `text-sm text-gray-500`.
- Pay/Deposit: equal-width primary/secondary buttons.
- Recent activity: 5 most recent rows. Tap a row →
  `/tx/[digest]`. "View all" → `/history`.
- Banners (above activity, only when actionable):
  - "Card needs resync" → `/cards/resync`.
  - "Step-up required for ₦18,000 to Ada Café" → `/cards/step-up?token=…` (when a merchant requested step-up via QR).
  - "Low balance — top up" only if balance < per-tap-limit and a card is linked.

### J3 — Pay a merchant (the headline)

> "Merchant just said ₦2,500. I want to pay."

Two entry paths, same review screen:

**Path A — Phone-to-phone NFC tap.** Payer holds phone near merchant
phone; merchant's HCE broadcasts the URL `https://app.zoracle.com/order/[id]`;
OS opens it directly in the PWA. No "scan" step.

**Path B — QR scan from `/pay`.** Payer taps **Pay** on `/wallet` →
`/pay` opens the in-PWA scanner (full-screen camera). Scanner reads
the same URL and routes to `/order/[id]`.

| Step | Screen | What user sees | Data | Action |
|------|--------|----------------|------|--------|
| 1 | `/pay` (path B only) | Camera viewfinder, "Aim at the merchant's QR" hint, **Cancel** | — | scan a QR |
| 2 | `/order/[id]` | Merchant logo/name, amount **USDC + ≈ NGN**, reference/note, **Expires in 1:48** | `GET /v1/orders/[id]` | tap **Confirm & pay** OR **Cancel** |
| 3 | (same page, in-flight) | "Signing…" → "Submitting…" with `.loader` | zkLogin sign on Sui, then `POST /v1/orders/[id]/confirm` | — |
| 4 | (same page, success) | Full-screen success: green check, "₦2,500 to Ada Café", **Done**, secondary **View receipt** | — | tap **Done** → back to `/wallet` |
| 5 | `/wallet` | Balance reduced, new row at top of history, slide-in animation | refetch `/v1/wallet/me` | — |

**Decline/error states inside `/order/[id]`:**
- Insufficient balance → block confirm, show "Top up to pay" CTA → `/deposit`.
- Order expired → show "This order expired" + **Back to wallet**.
- Step-up required → mid-flow, swap CTA to "**Confirm with Face ID**", trigger WebAuthn, then resubmit.
- Sign cancelled → return to ready state, no charge.
- Submit failed (network) → show inline `InputError`, retry button.

### J4 — Deposit

> "Friend wants to send me USDC. I need my address."

| Step | Screen | What user sees | Data | Action |
|------|--------|----------------|------|--------|
| 1 | `/wallet` | tap **Deposit** | — | — |
| 2 | `/deposit` | QR (Sui address), address mono-text, **Copy address**, **Share**, warning chip "Sui · USDC only" | `session.suiAddress` | copy/share/done |
| 3 | `/wallet` | When balance changes (poll/SSE), toast: "+25.00 USDC received" and a new row appears in history | — | — |

`/deposit` is the route version of the current `FundCardModal`. Kept
as a full route (not a modal) so it's deep-linkable and feels like a
real wallet "Receive" screen.

### J5 — Manage (settings, extras)

> "I want to change my daily limit / link a card / sign out."

| Surface | Lives | What it shows |
|---------|-------|---------------|
| `/settings` | Index | Linked-card row, Limits row, Security row, Network/help/sign-out row |
| `/settings/card` | If a card is linked | Status chip, balance, limits summary, **Top up · Resync · Revoke**, "Link another" if 0 |
| `/settings/limits` | If a card is linked | Three range fields (Daily, Per-tap, Step-up), **Save** |
| `/settings/security` | Always | Change PIN, sign out |

Extras that are not journeys of their own — they're sub-flows
reached from `/settings/card`:
- `/cards/top-up` — already exists.
- `/cards/revoke` — already exists.
- `/cards/resync` — already exists.
- `/cards/step-up` — **NEW**. Reached from a merchant QR or from the
  in-app banner during a `/order/[id]` flow.
- `/link/*` — already exists. Entry point moves from "tap a card now"
  (current dashboard prompt) to a **"Link a Tapp Card"** row inside
  `/settings/card`.

---

## 3. Component & data primitives

New shared components to add (matches the Zap class-string playbook
already in place):

1. **`<BalanceHero amountSubunit ngnEquivalent />`** — the big number
   block at the top of `/wallet`. USDC primary, NGN secondary in
   `text-gray-500`.
2. **`<DualCtaRow primary secondary />`** — the Pay/Deposit duo. Just
   a flex wrapper that takes two `<Button>` slots; standardizes spacing.
3. **`<ActivityRow tx />`** — single history entry. Merchant left,
   amount right (red for outflow, green for inflow), time below.
4. **`<ActivityList items emptyState />`** — vertical list with the
   dashed `divide-y divide-dashed divide-gray-200` separator from Zap.
5. **`<QRScanner onResult onClose />`** — wraps `html5-qrcode` (small,
   no React dep). Full-screen camera + viewfinder.
6. **`<CountdownPill expiresAt />`** — "1:48" pill that ticks down,
   used in `/order/[id]`.
7. **`<ReceiptCard tx />`** — `/tx/[digest]` body and the success card
   in `/order/[id]`. Detail rows in the Zap "TransactionPreview"
   style: label-left, value-right, dashed `<hr>` between sections.

New API surface needed from Rails (mostly already implied by the
architecture doc, listing here so the spec is complete):

- `GET /v1/wallet/me` → `{ sui_address, usdc_subunit, ngn_rate, has_linked_card }`
- `GET /v1/wallet/history?limit=N&before=cursor` → list of activity events
- `GET /v1/orders/[id]` → merchant + amount + expires_at + step_up_required
- `POST /v1/orders/[id]/confirm` (body: `{ tx_digest }`) → settlement ack
- `GET /v1/wallet/tx/[digest]` → receipt detail (or read from cached history row)

Existing endpoints (`/v1/cards/*`) stay as-is — they back
`/settings/card`.

---

## 4. What to add / change / delete vs current code

### Add (new files)
- `app/wallet/page.tsx` — primary surface.
- `app/pay/page.tsx` — full-screen scanner.
- `app/deposit/page.tsx` — replaces `FundCardModal` as a route.
- `app/history/page.tsx` — full list with cursor pagination.
- `app/tx/[digest]/page.tsx` — receipt.
- `app/order/[id]/page.tsx` — pay-merchant review.
- `app/settings/page.tsx` + `/card/page.tsx` + `/limits/page.tsx` + `/security/page.tsx`.
- `app/cards/step-up/page.tsx` — WebAuthn biometric confirm.
- `components/ui/BalanceHero.tsx`, `DualCtaRow.tsx`, `ActivityRow.tsx`,
  `ActivityList.tsx`, `QRScanner.tsx`, `CountdownPill.tsx`, `ReceiptCard.tsx`.
- `lib/wallet.ts` — wallet API client (mirror `lib/api.ts` shape).
- `lib/scanner.ts` — thin wrapper around `html5-qrcode`.
- `lib/webauthn.ts` — wraps `@simplewebauthn/browser` for step-up.

### Change
- `app/page.tsx` — landing copy stays, but the CTA reads "Open
  wallet" if signed in.
- `app/dashboard/page.tsx` — replaced by a 308 redirect to `/wallet`
  (keep the file so external links don't 404).
- `app/dashboard/cards/[id]/page.tsx` — delete; content moves into
  `/settings/card`.
- `components/Navbar.tsx` — link the logo to `/wallet` when signed in
  (currently goes to `/dashboard`).
- `FundCardModal.tsx` — keep as-is for now; once `/deposit` ships,
  remove the modal trigger from any consumer and delete the modal.

### Delete
- `app/dashboard/cards/[id]/page.tsx` (after move).
- `components/ui/FundCardModal.tsx` (after `/deposit` ships).

### Keep untouched
- All Zap-shape primitives (`Button`, `StatusChip`, `InfoBanner`, etc.).
- Linking flow (`/link/*`, `lib/cardCrypto`, `lib/webnfc`, `lib/cardLinkStore`).
- Existing card sub-flows (`/cards/top-up`, `/cards/revoke`,
  `/cards/resync`, `/cards/unavailable`).
- `lib/auth.ts`, `lib/api.ts`, providers, service worker, root layout.

---

## 5. Build order (recommendation)

Sequenced so each step ships a real user benefit, not a half-done UI:

1. **Wallet shell first.** Build `/wallet` with mock data, behind a
   `NEXT_PUBLIC_WALLET_MOCK=1` flag. Use `GET /v1/cards/me` as a stand-in
   for `GET /v1/wallet/me` until the real endpoint exists. This alone
   replaces the dashboard noise.
2. **Deposit.** Trivial — promote `FundCardModal` markup into
   `app/deposit/page.tsx`. Sui address comes from the session.
3. **Pay (scanner + order review).** Adds `html5-qrcode`, ships
   `/pay`, ships `/order/[id]` with a `?mock=1` mode that fakes the
   merchant + amount until Rails exposes `/v1/orders/[id]`.
4. **History + receipts.** `/history` and `/tx/[digest]` with the
   same mock-data switch.
5. **Settings.** `/settings` + `/settings/card` (move existing card
   detail content here) + `/settings/limits` + `/settings/security`.
6. **Step-up + WebAuthn.** `/cards/step-up` and the mid-flow biometric
   inside `/order/[id]`.
7. **Glue real APIs.** Swap mocks for live Rails endpoints when
   they're ready. No UI churn.
8. **Verify + screenshot every journey** in mobile-emulation Chrome,
   then build.

---

## 6. Open questions

| # | Question | Recommend |
|---|----------|-----------|
| Q1 | Show NGN equivalent on every USDC amount, or only on balance? | **Both** — balance + every history row + the order-review amount. Cardholders think in fiat. |
| Q2 | Where does the FX rate come from? | Backend (Rails caches a rate per minute and serves it in `/v1/wallet/me`). Avoids per-client API key + inconsistent display. |
| Q3 | Polling vs SSE for balance + new-activity push? | **Poll** every 15s on `/wallet` (cheap, no infra). SSE is a v1.5 lift. |
| Q4 | iOS lacks Web NFC. Path B (QR) works on both; path A (NFC tap) is Android-only. Acknowledge in copy? | **Yes** — on iOS, the scanner is the primary path; merchant-tap is greyed out with "Android only" in `/settings`. |
| Q5 | Apple Wallet / Google Wallet pass for the linked card? | **Not v1.** Park for v2. |
| Q6 | Send-to-arbitrary-Sui-address (true on-chain withdraw)? | **Not v1.** Architecture doc explicitly excludes it. Tapp pays merchants; that's the only outflow. |
| Q7 | Push notifications on a successful tap-pay? | **Not v1.** Service worker isn't doing push yet; in-app toast + history row is enough for v1. Park. |
| Q8 | Multiple cards per user? | **Not v1** — single linked card. Settings shows a single linked-card row. The data model already supports multi-card, the UI just doesn't expose it yet. |
