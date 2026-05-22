# Tapp Merchant

The merchant-side app for the Zoracle tap-to-pay ecosystem. Shop owners
take crypto-funded payments by tapping a customer's phone (or scanning
a QR on iOS) or by reading a physical NTAG215 "Tapp Card". Fiat lands
in their saved NGN bank account via the Rails settlement backend.

Cross-platform Expo (Android + iOS). Same auth, dashboard, and
checkout-broadcast flows on both — the only platform split is
phone-to-phone broadcast (Android = NFC HCE, iOS = QR fallback).

---

## Where this fits

Three repos make up the Zoracle stack. Treat this README as the
merchant-app entry point only — the broader product context lives in
the architecture spec below.

| Repo | Role |
| --- | --- |
| [`usezoracle/rails-sui`](https://github.com/usezoracle/rails-sui) | Go backend + Sui Move contracts. Settles payments, manages cards, hosts the SSE stream this app subscribes to. |
| **`usezoracle/tapp-merchant`** *(this repo)* | The merchant Expo app. Takes payments. |
| [`usezoracle/tapp`](https://github.com/usezoracle/tapp) | Cardholder PWA. Where customers link/manage their Tapp Cards and where payers complete phone-to-phone zkLogin checkout. |

---

## Status at a glance

### ✅ Working end-to-end

- Sign-up / sign-in (email + password), email verification stub
- KYB + bank-account onboarding (BVN-only NGN flow)
- Dashboard: today's earnings + recent payments
- Transactions list + detail with status filter
- "New payment" amount entry + method picker (phone-to-phone / Tap Card)
- **Phone-to-phone broadcast** — Android NFC HCE (custom Kotlin
  `HostApduService` emulating an NDEF Type 4 Tag) + iOS QR fallback
- **Tap Card reader** — cross-platform NFC reader session via
  `react-native-nfc-manager`, captures UID, sends to backend
- **Real-time SSE** for `payment.deposited` / `.settled` / `.refunded`
  — Tapp merchant phone shows "Payment received" the moment the
  Sui event indexer publishes
- Brand-consistent UI: Clash Grotesk font (Indian Type Foundry, via
  expo-font), brand icons ported from `users-app/assets/svg`,
  NativeWind v4 with the same token language as the PWA

### ⚠️ Stubbed / not yet wired

| What | Why | Where to start |
| --- | --- | --- |
| **Tap Card debit** | The backend `POST /v1/sender/me/tap-card` returns `501 card_unrecognized` — full path needs the `tapp_card` Move contract + linked-card DB rows on Rails + HMAC PIN math here. | `docs/tap-card-pin-flow.md` (this repo) + `docs/tapp-card-spec.md` (Rails repo). |
| **PIN pad screen** (`tap-card-pin.tsx`) | Three-tier auth was specced (no PIN <₦2k, PIN ₦2k–₦15k, step-up >₦15k) but not built. | `docs/tap-card-pin-flow.md` → "Screens" section. |
| **Step-up QR screen** (`tap-card-step-up.tsx`) | Same — depends on the Rails step-up endpoint. | Same doc → "Step-up QR display". |
| **HMAC PIN math on-device** | `@noble/hashes` isn't installed yet. Compute `HMAC(HMAC(K, PIN), server_nonce)` from the card's read `K`. | Same doc → "PIN math on-device (TypeScript)". |
| **NFC write-back with PWD_AUTH** | Per-tap token rotation needs writing the new ciphertext back to the card sector with `NTAG215 PWD_AUTH`. Reader is wired; writer is not. | `docs/nfc-reader-spec.md` + `useTapCard.ts`. |
| **In-the-moment rescue UX** | "Please tap once more to finalize" copy for the torn-write recovery edge case. | `docs/tap-card-pin-flow.md` → "Failure modes". |
| **App icons** | `app.json` points to `./assets/icon.png` and `./assets/splash.png` but only the brand fonts live in `assets/`. Expo uses defaults; needs the real 1024×1024 brand icon. | Borrow from `usezoracle/tapp` which already has `app/icon.png` at 1028×1028 from `users-app/assets/icons/zercard-app-icon.png`. |
| **Settings page row actions** | Several rows render a chevron but don't navigate. | `app/(app)/settings.tsx`. |

### 🚫 Out of scope here

- **Card linking flow** — lives in `usezoracle/tapp` (the PWA). The
  merchant app never participates in linking, by design (trust
  boundary).
- **Payer checkout** — also `usezoracle/tapp`. Payer's phone opens
  the checkout URL via NDEF/QR; this app only broadcasts the URL.
- **Move contract for `tapp_card`** — `usezoracle/rails-sui/contracts/`.
  Spec at `rails-sui/docs/tapp-card-spec.md`.

---

## Stack

- **Expo SDK 52** + dev client (NFC HCE needs native code, so Expo Go
  doesn't work — must build a dev client)
- **expo-router v4** (file-based routing, route groups via `(parens)`)
- **React 19**, RN 0.76
- **NativeWind v4** + Tailwind — design tokens in `tailwind.config.js`
  mirror `users-app`
- **TanStack Query v5** for server state
- **zustand v5** + **react-native-mmkv** for auth persistence
  (encrypted)
- **react-hook-form** + **zod** for forms
- **axios** for HTTP with a single-flight JWT refresh interceptor
- **react-native-sse** for the real-time payment-status stream
  (replaces WebSocket — plain HTTP, `Last-Event-ID` resume, easier
  to debug)
- **react-native-nfc-manager** for the cross-platform Tap Card reader
- Custom Kotlin `HostApduService` for Android HCE (see
  `plugins/withNfcHce/android/`)
- **expo-font** with Clash Grotesk TTFs in `assets/fonts/`
- **lucide-react-native** + brand icons ported from
  `users-app/assets/svg/svg-list.ts` (see `src/ui/icons.ts`)

---

## Quick start

### Prerequisites

- Node 20+ and npm
- Xcode 15+ (iOS), Android Studio (Android)
- Java 17 (Android Gradle)
- An Android device with NFC (HCE doesn't work in emulators)
- An iPhone with NFC (iPhone 7+) for Tap Card testing

### 1. Install + env

```bash
git clone git@github.com:usezoracle/tapp-merchant.git
cd tapp-merchant
npm install

# Create .env (no .env.example yet — copy the block below)
cat > .env <<'EOF'
# Rails backend. Use your laptop's LAN IP for device testing
# (localhost only resolves from the dev machine itself).
EXPO_PUBLIC_API_BASE_URL=http://192.168.X.Y:8000

# Payer-side checkout web. The merchant phone embeds this URL in
# NDEF/QR — payer's phone opens it via the OS handler.
EXPO_PUBLIC_CHECKOUT_BASE_URL=https://checkout.zoracle.com
EOF
```

For production builds, set the same values in `app.json` →
`expo.extra.{apiBaseUrl,checkoutBaseUrl}` so they bake into the
binary instead of relying on dev-server env injection.

### 2. Prebuild

NFC HCE requires custom native code from the config plugin. Generate
the native projects:

```bash
npm run prebuild
```

This runs `expo prebuild --clean`, which:
- Generates `android/` and `ios/` directories
- Runs `plugins/withNfcHce/index.js` — copies the Kotlin
  `HostApduService` + `apduservice.xml` AID filter into
  `android/app/src/main/`, registers the service in the manifest,
  patches `MainApplication.kt` to add `NfcHcePackage()`
- Runs `plugins/withIosNfc/index.js` — sets NFC reader-session
  entitlements + `NFCReaderUsageDescription` in Info.plist

### 3. Run

```bash
# Android (physical NFC-capable device):
npm run android

# iOS (physical device, NFC requires it):
npm run ios

# Or start the dev server and pick a target in the Expo UI:
npm start
```

The dev client launches with hot reload. If you change anything
under `plugins/withNfcHce/` or `app.json`, re-run `npm run prebuild`
then `npm run android`/`ios` so the native side picks it up.

### 4. Typecheck before pushing

```bash
npm run typecheck   # tsc --noEmit
```

---

## Architecture

### Route tree

```
app/
├── _layout.tsx                     root: QueryClient + safe-area + auth guard
├── (auth)/                         not yet signed in
│   ├── _layout.tsx
│   ├── sign-in.tsx
│   ├── sign-up.tsx
│   └── verify-email.tsx
├── (onboarding)/                   signed in, not yet "live"
│   ├── _layout.tsx
│   ├── kyb.tsx                     Smile Identity BVN
│   └── bank-account.tsx            verify + persist NGN payout account
└── (app)/                          authenticated + onboarded
    ├── _layout.tsx                 tab bar
    ├── index.tsx                   dashboard
    ├── new-payment.tsx             amount + method picker
    ├── broadcast.tsx               phone-to-phone (HCE / QR)
    ├── tap-card.tsx                Tap Card reader
    ├── settings.tsx
    └── transactions/
        ├── _layout.tsx
        ├── index.tsx               infinite-scroll list
        └── [id].tsx                detail
```

The root `_layout.tsx` reads onboarding state via
`useOnboardingState()` and redirects to the right segment when the
state changes (sign-in → verify-email → kyb → bank-account → live).

### Hot paths

| Hook | Purpose |
| --- | --- |
| `src/hooks/useTapBroadcast.ts` | Orchestrates phone-to-phone: POST `/tap`, start HCE (Android) or render QR (iOS), subscribe SSE, transition on `payment.deposited` / `.settled` / `.refunded`. |
| `src/hooks/useTapCard.ts` | Opens NFC reader session, captures UID, POSTs to `/tap-card`. Currently expects 501 from the backend — picks up the rest of the protocol when the spec is built out. |
| `src/api/sse.ts` | Subscribe to `GET /v1/sender/me/payments/stream` with `Authorization: Bearer`. |
| `src/auth/store.ts` | zustand auth store with MMKV-backed persistence (encrypted). |
| `src/auth/useOnboardingState.ts` | Resolves the current `OnboardingStep` from server queries — drives the root-layout redirects. |

### Native modules

| File | Role |
| --- | --- |
| `plugins/withNfcHce/android/TappHceService.kt` | Android `HostApduService` emulating an NDEF Type 4 Tag. Responds to SELECT AID (`D2760000850101`) + READ_BINARY APDUs with the encoded checkout URL. |
| `plugins/withNfcHce/android/NfcHceModule.kt` | React Native bridge: `isHceSupported()`, `start(url, ttlMs)`, `stop()`. |
| `plugins/withNfcHce/android/NfcHcePackage.kt` | Registers the module with RN's PackageList. |
| `plugins/withNfcHce/android/apduservice.xml` | AID filter resource referenced by the manifest `<service>` entry. |
| `plugins/withNfcHce/index.js` | Expo config plugin that copies the above into the prebuild output and patches the manifest + `MainApplication.kt`. |
| `plugins/withIosNfc/index.js` | Sets the iOS NFC reader-session entitlement + `NFCReaderUsageDescription` + ISO-7816 select-identifiers (NDEF AID + NTAG application AID). |
| `src/hce/NfcHce.ts` | TypeScript facade. iOS = no-op (Apple doesn't allow third-party HCE). |

---

## Env vars

| Var | Where used | Required? |
| --- | --- | --- |
| `EXPO_PUBLIC_API_BASE_URL` | `src/api/config.ts` — base URL for the Rails backend. | Yes (use LAN IP for device dev). |
| `EXPO_PUBLIC_CHECKOUT_BASE_URL` | `src/api/config.ts` — embedded in NDEF / QR for payers. | Yes (defaults to `https://checkout.zoracle.com`). |

Production builds: set `expo.extra.apiBaseUrl` and
`expo.extra.checkoutBaseUrl` in `app.json` instead — those bake into
the JS bundle.

---

## Docs index

The spec set in `docs/` is the source of truth for product behavior.
Keep these synced with code as you ship.

| File | Covers |
| --- | --- |
| `docs/tapp-merchant-architecture.md` | Cross-platform overview, sequence diagrams (phone-to-phone + Tap Card), method matrix. |
| `docs/merchant-backend-api.md` | All Rails endpoints the app calls, request/response shapes, SSE event shape. |
| `docs/nfc-hce-spec.md` | Android-only HCE (NDEF Type 4 Tag, AID `D2760000850101`). |
| `docs/nfc-reader-spec.md` | Cross-platform Tap Card NTAG215 reader. |
| `docs/qr-fallback-spec.md` | iOS QR phone-to-phone fallback. |
| `docs/onboarding-spec.md` | 4-step linear onboarding flow. |
| `docs/screens-spec.md` | expo-router tree, ASCII wireframes, error states. |
| `docs/tap-card-pin-flow.md` | **Tap Card three-tier auth UX** — the next chunk of work. Read this before touching `useTapCard.ts`. |

Companion docs in the other repos:

- `rails-sui/docs/tapp-card-spec.md` — Move contract + Rails state
  machine for the Tap Card vertical (HMAC PIN, daily caps, resync,
  step-up). The merchant-app PIN flow doc above is the client half.
- `rails-sui/docs/merchant-backend-api.md` — full backend API surface.
- `tapp/docs/*` — cardholder PWA flows (linking, checkout, resync,
  step-up).

---

## Common gotchas

- **NFC HCE doesn't work in Android emulators.** Test on a physical
  Android phone (NFC enabled in system settings).
- **`localhost` doesn't resolve on a tethered device.** Set
  `EXPO_PUBLIC_API_BASE_URL` to your laptop's LAN IP (same Wi-Fi).
- **Expo Go is not enough.** This app needs a dev client because
  `react-native-nfc-manager` + the custom HCE module require native
  code. Use `npm run android` / `npm run ios`, not `expo start --go`.
- **Re-run `npm run prebuild` after config-plugin changes.** Anything
  under `plugins/withNfcHce/` or in `app.json`'s `plugins`/`extra`
  arrays needs a clean prebuild to land in the native projects.
- **Android FOREGROUND_SERVICE permissions are declared but no
  service is registered as `foreground` yet.** When the HCE
  broadcast lifecycle grows past the 30s burst, you'll need to wire
  a foreground service notification per the HCE spec.
- **iOS NFC requires a paid Apple Developer account.** The entitlement
  `com.apple.developer.nfc.readersession.formats` only signs on a
  paid team profile.
- **Clash Grotesk is loaded at runtime via expo-font.** First paint
  is held by `SplashScreen.preventAutoHideAsync()` until the TTFs
  resolve. If you see fallback fonts briefly during dev hot-reload,
  it's not a regression — production cold-start respects the gate.
- **`@/*` is the path alias** (configured in `tsconfig.json`). Use
  it instead of relative imports across modules.

---

## Where to start (handoff guide)

1. **Read `docs/tapp-merchant-architecture.md`** for product context.
2. **Run the app end-to-end** with a real device against a local
   Rails backend. You'll need the corresponding `rails-sui` repo
   running with a Postgres + Redis + a few seed rows in the
   `institution` table. See `rails-sui/README.md` for that setup.
3. **Pick from the "Stubbed / not yet wired" table at the top.** The
   Tap Card vertical is the largest open chunk; the
   `docs/tap-card-pin-flow.md` spec has the design fully written —
   it's an implementation task, not a design task.
4. **Cross-repo work to keep an eye on:** the Tap Card vertical needs
   coordinated commits across all three repos. Move contract +
   `TappCard` ent fields land in `rails-sui` first; then the PWA
   linking flow in `tapp`; then this app's PIN pad + step-up
   screens.

---

## License

UNLICENSED (private). All rights reserved.

---

## Contact

This repo is under active development. For questions / context not
covered in `docs/`, ping the maintainer or check the project plan at
`rails-sui/docs/handoff-2026-05-21.md`.
