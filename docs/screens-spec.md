# Tapp Merchant — Screens & Navigation Spec

Navigation is `expo-router` (file-based). Top-level uses **route groups** (`(auth)`, `(onboarding)`, `(app)`) to split layouts. The root `_layout.tsx` runs the auth guard + onboarding-step resolver (see `onboarding-spec.md` §"State resolution at app launch") and redirects on every mount.

## Route tree

```
app/
  _layout.tsx                        # root: providers + guard
  +not-found.tsx

  (auth)/
    _layout.tsx                      # stack, no header
    sign-in.tsx
    sign-up.tsx
    verify-email.tsx
    forgot-password.tsx              # v1.1, deferred

  (onboarding)/
    _layout.tsx                      # stack with step indicator header
    kyb.tsx
    bank-account.tsx

  (app)/
    _layout.tsx                      # bottom tabs
    index.tsx                        # Dashboard tab (= /)
    new-payment.tsx                  # modal-presentation route
    broadcast.tsx                    # full-screen, no tabs
    transactions/
      _layout.tsx                    # stack
      index.tsx                      # list
      [id].tsx                       # detail
    settings.tsx                     # Settings tab
```

## Tab bar (`(app)/_layout.tsx`)

Three tabs:

```
┌──────────────────────────────────────────────────────┐
│                                                      │
│                                                      │
│              [ Screen content ]                      │
│                                                      │
│                                                      │
├──────────────────────────────────────────────────────┤
│   ●        ◌                                ◌       │
│  Home    Transactions                    Settings    │
└──────────────────────────────────────────────────────┘
```

The headline "New payment" CTA is a **floating action button on Home**, not a tab — single-purpose primary action, surfaced one level up from a tab.

`broadcast.tsx` opts out of the tab bar via `tabBarStyle: { display: 'none' }` because it's a full-attention screen.

---

## Screen-by-screen

### `(auth)/sign-up.tsx`

```
┌──────────────────────────────────────────────────────┐
│  ←                                                   │
│                                                      │
│  Create your Tapp account                            │
│  Receive crypto, get NGN in your bank.               │
│                                                      │
│  Email                                               │
│  ┌────────────────────────────────────────────────┐  │
│  │ jane@example.com                               │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Password                                            │
│  ┌────────────────────────────────────────────────┐  │
│  │ ••••••••                                       │  │
│  └────────────────────────────────────────────────┘  │
│  8+ characters, 1 number, 1 letter                   │
│                                                      │
│  By signing up you agree to our Terms.               │
│                                                      │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │                 Sign up                        │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Already have an account?  Sign in                   │
└──────────────────────────────────────────────────────┘
```

### `(auth)/sign-in.tsx`

Same shape, email + password fields, primary CTA = "Sign in." Footer links to sign-up + forgot-password.

### `(auth)/verify-email.tsx`

```
┌──────────────────────────────────────────────────────┐
│  ←                                                   │
│                                                      │
│  Check your email                                    │
│  We sent a 6-digit code to jane@example.com.         │
│                                                      │
│       ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐            │
│       │ 4 │ │ 7 │ │ 2 │ │ _ │ │   │ │   │            │
│       └───┘ └───┘ └───┘ └───┘ └───┘ └───┘            │
│                                                      │
│  Didn't get the code?  Resend (60s)                  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

Submits automatically when 6 digits are entered. No explicit "submit" button.

### `(onboarding)/kyb.tsx`

```
┌──────────────────────────────────────────────────────┐
│  Step 3 of 4                                         │
│  ━━━━━━━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━○              │
│                                                      │
│  Verify your identity                                │
│  We use your BVN to confirm your identity.           │
│  Takes about 30 seconds.                             │
│                                                      │
│  • Your BVN is never stored on our servers           │
│  • You won't be charged                              │
│  • Required to enable bank payouts                   │
│                                                      │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │             Start verification                 │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

Tapping the CTA opens Smile Identity in an in-app browser tab (`expo-web-browser`). On return, a loading state polls every 5s for up to 5 min, then either advances or surfaces the failure with a retry.

### `(onboarding)/bank-account.tsx`

```
┌──────────────────────────────────────────────────────┐
│  Step 4 of 4                                         │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━●              │
│                                                      │
│  Where should we send your money?                    │
│                                                      │
│  Bank                                                │
│  ┌────────────────────────────────────────────────┐  │
│  │ Guaranty Trust Bank                          ⌄ │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Account number                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │ 0123456789                                     │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  ✓ JANE DOE                                          │
│                                                      │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │                  Save                          │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

The resolved name shows below the account-number field after the debounce + verify-account call. Save is disabled until the name resolves.

### `(app)/index.tsx` (Dashboard)

```
┌──────────────────────────────────────────────────────┐
│  Hi, Jane                                  ⚙        │
│                                                      │
│  Today's earnings                                    │
│  ₦ 47,500                                            │
│  12 payments                                         │
│                                                      │
│  ───────────────────────────────────────────────     │
│  Recent payments                          See all >  │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │ ●  ₦5,000                          12:43 PM  │    │
│  │ ↪  Settled                                   │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │ ●  ₦2,500                          12:18 PM  │    │
│  │ ↪  Settled                                   │    │
│  └──────────────────────────────────────────────┘    │
│  …                                                   │
│                                                      │
│                                                      │
│                                  ┌──────────────┐    │
│                                  │     +        │    │
│                                  │ New payment  │    │
│                                  └──────────────┘    │
└──────────────────────────────────────────────────────┘
```

Pull-to-refresh re-fetches `/v1/sender/stats` + the first page of `/v1/sender/orders`. Tapping a row navigates to `(app)/transactions/[id]`.

### `(app)/new-payment.tsx` (modal)

```
┌──────────────────────────────────────────────────────┐
│  ✕                              New payment          │
│                                                      │
│                                                      │
│                    ₦   5,000                         │
│                                                      │
│                                                      │
│  Memo (optional)                                     │
│  ┌────────────────────────────────────────────────┐  │
│  │ Table 4                                        │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│                                                      │
│   ┌───┐  ┌───┐  ┌───┐                                │
│   │ 1 │  │ 2 │  │ 3 │                                │
│   └───┘  └───┘  └───┘                                │
│   ┌───┐  ┌───┐  ┌───┐                                │
│   │ 4 │  │ 5 │  │ 6 │                                │
│   └───┘  └───┘  └───┘                                │
│   ┌───┐  ┌───┐  ┌───┐                                │
│   │ 7 │  │ 8 │  │ 9 │                                │
│   └───┘  └───┘  └───┘                                │
│   ┌───┐  ┌───┐  ┌───┐                                │
│   │ . │  │ 0 │  │ ⌫ │                                │
│   └───┘  └───┘  └───┘                                │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │              Tap to take                       │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

Bottom button enables once amount > 0. Submitting calls `POST /v1/sender/me/tap` and navigates to `(app)/broadcast` on success. Sends an Idempotency-Key UUID generated client-side per tap.

### `(app)/broadcast.tsx` (full-screen, no tab bar)

```
┌──────────────────────────────────────────────────────┐
│  ←                                          1:47     │
│                                                      │
│                                                      │
│                  Ready to receive                    │
│                                                      │
│                                                      │
│                                                      │
│                  ┌──────────────┐                    │
│                 (    NFC ring    )                   │
│                  └──────────────┘                    │
│                                                      │
│                                                      │
│                    ₦ 5,000                           │
│                                                      │
│                                                      │
│  Hold this phone against the customer's phone.       │
│  They'll tap to pay.                                 │
│                                                      │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │                   Cancel                       │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

Lifecycle:

- On mount → `useTapBroadcast({orderId, checkoutUrl, expiresAt})` → starts HCE + opens WebSocket.
- The NFC ring is an animated `react-native-reanimated` pulse, looped.
- Header `1:47` is the countdown to `expires_at`. At 0:00 → auto-cancel + back to dashboard.
- Back button or "Cancel" → `POST /v1/sender/orders/:id/cancel`, navigate back.
- On WS `payment.deposited` → swap copy to "Payment detected, settling..." + spinner.
- On WS `payment.settled` → navigate to a transient success screen (overlay with ₦ amount, confetti, dismiss → dashboard).

### `(app)/transactions/index.tsx`

```
┌──────────────────────────────────────────────────────┐
│  ←                              Transactions         │
│                                                      │
│  [All]  [Settled]  [Pending]  [Refunded]             │
│                                                      │
│  TODAY                                               │
│  ┌──────────────────────────────────────────────┐    │
│  │ ●  ₦5,000  Settled                12:43 PM   │    │
│  └──────────────────────────────────────────────┘    │
│  ┌──────────────────────────────────────────────┐    │
│  │ ●  ₦2,500  Settled                12:18 PM   │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  YESTERDAY                                           │
│  ┌──────────────────────────────────────────────┐    │
│  │ ●  ₦8,000  Settled                 4:22 PM   │    │
│  └──────────────────────────────────────────────┘    │
│  …                                                   │
└──────────────────────────────────────────────────────┘
```

Infinite scroll via TanStack Query's `useInfiniteQuery` → `GET /v1/sender/orders?cursor=...`.

### `(app)/transactions/[id].tsx`

```
┌──────────────────────────────────────────────────────┐
│  ←                            Payment detail         │
│                                                      │
│                    ₦ 5,000                           │
│                  Settled · 12:43 PM                  │
│                                                      │
│  Memo                                                │
│  Table 4                                             │
│                                                      │
│  Coin                                                │
│  3.267 USDC                                          │
│                                                      │
│  Rate                                                │
│  1 USDC ≈ ₦1,530.50                                  │
│                                                      │
│  Settlement                                          │
│  Tx · 0x9f8e...4c1a               (copy) (explorer)  │
│                                                      │
│  Payout                                              │
│  GTBank · ****6789                                   │
│                                                      │
└──────────────────────────────────────────────────────┘
```

Explorer link points to a Sui explorer for the settlement digest. "Copy" copies the tx hash.

### `(app)/settings.tsx`

```
┌──────────────────────────────────────────────────────┐
│  Settings                                            │
│                                                      │
│  Profile                                             │
│  ┌──────────────────────────────────────────────┐    │
│  │ Email          jane@example.com              │    │
│  │ Verified       May 22, 2026                  │    │
│  │ KYC            ✓ Verified                    │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  Payouts                                             │
│  ┌──────────────────────────────────────────────┐    │
│  │ Bank           GTBank · ****6789       Edit  │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  About                                               │
│  ┌──────────────────────────────────────────────┐    │
│  │ Version 1.0.0                                │    │
│  │ Terms of Service                       >     │    │
│  │ Privacy Policy                         >     │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │                  Sign out                      │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

## Visual style notes

- **Single accent colour** — pick a brand colour (placeholder: `#5B5BD6`, a confident indigo). Everything else neutral grayscale.
- **Type:** `Inter` for body, `Inter` bold for headlines. Display sizes use tabular-figures for currency amounts (`Inter SemiBold` with `font-feature-settings: 'tnum'`).
- **Radii:** `12px` for cards, `16px` for buttons, `24px` for the floating CTA.
- **Spacing scale:** 4 / 8 / 12 / 16 / 24 / 32. Stick to it.
- **Dark mode:** v1 ships light-mode only. Dark mode in v1.1 after we have brand alignment.

## States to design (cross-screen)

- **Loading:** centered spinner with the screen's primary action disabled.
- **Empty (transactions, dashboard):** illustration + copy "No payments yet. Tap 'New payment' to take your first."
- **Network error:** screen-level banner "We can't reach Tapp right now" + retry button. Background queries also paused.
- **Insufficient liquidity (`NO_LP_LIQUIDITY` from tap endpoint):** modal "We can't process this amount right now. Try smaller, or try again later."
- **HCE unavailable / NFC off:** broadcast screen replaces the NFC ring with a "Turn on NFC" prompt + system-settings deep link.

## Accessibility

- All tap targets ≥ 44×44 pt.
- Currency amounts have explicit a11y labels (e.g. "5,000 naira", not just "5000").
- Numeric pad keys announce as digits via `accessibilityLabel`.
- High-contrast colours; primary buttons pass WCAG AA on the chosen accent.
- Reduce-motion respects the NFC pulse animation (replace with a static glow ring).

## Out of scope (v1)

- Push notifications (rely on the WS while broadcast is active; dashboard refresh on cold open).
- Multi-language (Yoruba / Igbo / Hausa for v2 — Nigeria-first launch).
- Refund initiation from merchant side (operator-handled in v1).
- In-app receipt sharing (deep link / SMS) — v1.1.
- Multi-device / fleet mode (chain restaurants taking payments from many devices on one merchant account) — v2.
