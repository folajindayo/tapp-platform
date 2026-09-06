# UI rework spec — make Tapp visually identical to paycrest/zap

Status: **DRAFT — awaiting go-ahead before any code lands**
Last updated: 2026-05-22
Scope: cardholder PWA only. Merchant Expo app is out of scope.

## 1. Goal & non-goals

**Goal.** Every Tapp page should feel like it was cut from the same
sheet as `paycrest/zap` — same column width, same radii ladder, same
type rhythm, same dashed dividers, same Headless-UI modal chrome,
same animation vocabulary. Visitors who know Zap should recognise
Tapp instantly. Only the *content* (Sui zkLogin, NFC card mgmt,
tap-to-pay) differs.

**Non-goals.**
- Not porting wallet stack (no RainbowKit/wagmi/viem/Biconomy — we
  keep `@mysten/sui` + `@mysten/zklogin` + `@react-oauth/google`).
- Not adding chain selectors / `NetworkButton` / `NetworksDropdown`
  (Tapp is single-chain Sui).
- Not changing API contracts, auth, or routes. Only the rendered
  surface changes. `lib/`, `register-sw.tsx`, providers stay as-is.
- Not adding new dependencies *unless* listed in §6.

## 2. Audit summary — what already matches vs what drifts

Tapp already inherits the Zap shell shape (fixed Navbar, mobile column
inside `max-w-mobile`, `pt-28` clearance, `Preloader`, `LogoOutlineBg`,
`Disclaimer`, `CookieConsent`, `Styles.ts` class catalog, `next-themes`
class-based dark mode, royal #0065F5 token, Inter font). The four
animation variants and `AnimatedPage` are already ported. **Bones are
correct; the drift is in surface-level styling on individual pages.**

Drift items (the rework targets):

| # | Drift | Files |
|---|---|---|
| D1 | Footer is one neutral line — Zap's has a dashed top border, a left attribution row, and a right cluster of three social icons. | `components/Footer.tsx` |
| D2 | Navbar uses an explicit `border-b border-neutral-100 dark:border-neutral-800`; Zap's Navbar has no bottom border (it relies on the column padding for separation). | `components/Navbar.tsx` |
| D3 | `ThemeSwitch` uses Pi icons (matches Zap) — but Tapp passes `p-1` to the outer pill where Zap uses `p-1.5`. One token off. | `components/ThemeSwitch.tsx` |
| D4 | Headings are heavier than Zap. Tapp uses `text-2xl font-bold`/`font-semibold`; Zap uses `text-xl font-medium` for screen titles and `font-medium` (no size override) for section headings. | every `app/**/page.tsx` |
| D5 | Home page uses a gradient text headline. Zap uses no gradients anywhere. | `app/page.tsx` |
| D6 | Sign-in page has a bespoke "zkLogin shield" row and an extra TOS line. Shape is OK; needs trim + Zap-shape footing copy. | `app/sign-in/page.tsx` |
| D7 | Dashboard balance number is `text-3xl font-extrabold text-blue-600`. Zap values are `text-neutral-900 dark:text-white` in `font-medium`. Need to pick a stance — see §8 Q1. | `app/dashboard/page.tsx`, `app/dashboard/cards/[id]/page.tsx` |
| D8 | Many cards use `rounded-3xl border border-neutral-200 ... shadow-sm`. Zap uses `rounded-3xl border border-gray-200 dark:border-white/10` with NO `shadow-sm`, plus `gray-50`/`white/5` for "subtle" tint. Tapp swaps `gray-*` for `neutral-*` in places — small drift but visible. | `app/dashboard/page.tsx`, `app/dashboard/cards/[id]/page.tsx` |
| D9 | Configure page (`/link/configure`) has bespoke range inputs and a PIN field. Functional but visually divergent. Replace with shared `SelectField`-style chrome and add a Zap-style "details card" wrapper. | `app/link/configure/page.tsx` |
| D10 | Cards/top-up, cards/revoke, cards/resync, link/write, link/sign all use the same loose hero shape. Should be wrapped in Zap's `grid gap-6` page rhythm + use the Zap "TransactionPreview" detail-row pattern (label-left, value-right, dashed `<hr>` separators). | `app/cards/*`, `app/link/{write,sign}/page.tsx` |
| D11 | `<div className="loader" />` (CSS in `globals.css`) is in use ✓ but with `text-2xl ✓`/spring/spinner ad-hoc in pages. Consolidate every "in-flight" state to the same primitive. | many |
| D12 | Status badges on the card page use bespoke `bg-green-50/text-green-700/border`. Zap uses dimmer status chips: `rounded-full bg-gray-50 px-2 py-1 dark:bg-white/5` with the colored token only on the icon. Re-skin. | `app/dashboard/cards/[id]/page.tsx` |
| D13 | Several `<input>` elements in `link/configure` and `cards/top-up` are inline-styled. Should funnel through `inputClasses` from `Styles.ts`. | `app/link/configure/page.tsx`, `app/cards/top-up/page.tsx` |
| D14 | `LogoOutlineBg` currently renders the Paycrest brand SVGs verbatim. They're paycrest-branded silhouettes — not safe to ship under Tapp. Need replacement (or removal) — see §8 Q2. | `public/logo-outline-group-*-{light,dark}.svg`, `components/ui/LogoOutlineBg.tsx` |
| D15 | Tapp ships chain logos (`arbitrum-logo.svg`, `dai-logo.svg`, etc.) in `public/` that it never references. Strip + replace with Sui + USDC marks. | `public/*.svg` |
| D16 | No `Tooltip`, `InputError`, `SelectField`, or `TabButton` primitives. Three of these would tighten the forms (configure + top-up). | new files in `components/ui/` |

## 3. Design tokens — confirmed unchanged

No `tailwind.config.ts` (Tailwind v4 via `@theme` in `globals.css`) —
already declares `--color-royal` and `--max-width-mobile: 428px`. We
do not add tokens. Every shade comes from Tailwind defaults. Radii
ladder stays: `rounded-full` → `rounded-xl` (CTAs/inputs) → `rounded-2xl`
(sub-panels) → `rounded-3xl` (outer cards + modals).

Dark/light pairs (used as a checklist for the page rewrites):

- Bg / surface: `bg-white` ↔ `bg-neutral-900` (outer), `bg-gray-50` ↔
  `bg-white/5` (subtle fill).
- Border: `border-gray-200` ↔ `border-white/10` (panels), `border-gray-300`
  ↔ `border-white/20` (controls).
- Text: `text-neutral-900` ↔ `text-white` (primary), `text-gray-500`
  ↔ `text-white/50` (secondary), `text-gray-400` ↔ `text-white/30`
  (placeholder).
- Accent: `text-blue-600 dark:text-blue-500` (links/CTAs), `text-blue-500`
  (form errors — yes, blue not red — Zap convention).
- Required marker: `text-rose-500`.

## 4. Shell tweaks (small)

### 4.1 `components/Navbar.tsx`
- Drop `border-b border-neutral-100 dark:border-neutral-800`. Leave
  the `transition-colors` and the rest.
- Right cluster spacing: `gap-3` ✓, no other changes.
- "Sign out" pill: keep, but render it with `secondaryBtnClasses`-shape
  not `ghost` — Zap doesn't have a true ghost button; secondary is its
  ambient action.

### 4.2 `components/Footer.tsx`
Rewrite to: outer `mt-8 w-full border-t border-dashed border-gray-200
pb-6 pt-4 dark:border-white/10 flex items-center justify-between`.
Left: `text-xs font-medium text-gray-500 dark:text-white/50` with
"© {year} Zoracle" plus a link slot for "Powered by Sui" (or similar
— see §8 Q3). Right: three icon links (X, GitHub, support) using
`react-icons/fi` (`FiTwitter`, `FiGithub`, `FiMail`) at `size-5
transition-opacity hover:opacity-70`. No `lucide-react`.

### 4.3 `components/ThemeSwitch.tsx`
- Outer pill: change `p-1` → `p-1.5` (matches Zap).
- Inner `IconButton` `p-1.5` ✓ already.

### 4.4 `components/ui/Logo.tsx`
- Keep wordmark "Zoracle" + royal dot. Drop the `text-lg font-semibold`
  override on consumers — let `Logo` own its typography. Already does.

### 4.5 `app/layout.tsx`
No structural change. Already matches Zap's shell. Verify the
`pt-28` ✓ / `max-w-mobile` ✓ / provider nesting ✓ are intact after
the rewrites.

## 5. Page-by-page rework

For each page below: target column = same `<Screen>` wrapper; target
rhythm = `grid gap-6 py-10` (Zap's signature page rhythm); target
headlines = `text-xl font-medium`; target body = `text-sm`.

### 5.1 `app/page.tsx` — landing/hero
- Drop gradient on headline. Use `text-3xl font-semibold text-neutral-900
  dark:text-white tracking-tight`.
- Keep Framer entry. Subtitle stays `text-sm text-gray-500 dark:text-white/50`.
- CTA: keep `<Button variant="primary">Get Started</Button>`. Add a
  secondary outline link below: "I already have a card → Sign in".

### 5.2 `app/sign-in/page.tsx`
- Logo at top ✓.
- Headline → `text-xl font-medium`. Copy unchanged.
- Drop the lucide `ShieldCheck` row; replace with Zap's `<InputError>`
  pattern only when sign-in errors. Sub-copy footing kept (`text-xs
  text-gray-500 dark:text-white/50`).
- TOS line: trim wording; keep `text-[10px]` style.

### 5.3 `app/dashboard/page.tsx`
- Header block: `space-y-1`; title `text-xl font-medium`; subtitle
  `text-sm text-gray-500 dark:text-white/50`.
- Empty-card banner: re-skin to Zap's "info banner" pattern: `flex
  gap-2.5 rounded-xl border border-gray-200 bg-gray-50 p-3 ... dark:bg-white/5`
  with a leading `TbInfoSquareRounded` icon. No nested rounded
  avatar circle.
- Wallet balance card: keep `rounded-3xl` outer; drop `shadow-sm`;
  swap `neutral-200`→`gray-200`, `neutral-50`→`gray-50`. Balance
  number style — see §8 Q1.
- Sub-panel rows (cards / network): use Zap's two-half pattern with
  `<div className="h-full w-px border border-dashed
  border-gray-200 dark:border-white/10" />` between halves.
- Sui zkLogin address card: keep `rounded-3xl`; reduce shadow; chip
  pill at right re-skinned to Zap status-chip style (`rounded-full
  bg-gray-50 px-2 py-1 dark:bg-white/5` + colored icon).
- Recent payments section heading → `text-xs font-medium uppercase
  tracking-wider text-gray-400 dark:text-white/30`. Empty-state card
  uses `rounded-3xl border border-gray-200 bg-gray-50 ... dark:bg-white/5
  p-8 text-center text-sm text-gray-400 dark:text-white/40`.

### 5.4 `app/dashboard/cards/[id]/page.tsx`
- `CardLoading` → use the shared `loader` (already does ✓).
- Header chips (`StatusBadge` + ID): re-skin both to Zap status-chip
  pattern. ID chip: `rounded-full bg-gray-50 px-2 py-1 font-mono
  text-xs dark:bg-white/5`.
- Balance grid: dashed vertical separator between USDC and NGN halves
  (`w-px border border-dashed border-gray-200 dark:border-white/10`).
- Spend-limit row: keep progress bar but slim it (`h-1.5`) and change
  fill to `bg-blue-600` flat (no `transition-all duration-500`
  fluff — Zap uses CSS `transition-all` only).
- Per-tap / Step-up stats: wrap each in `rounded-2xl border
  border-gray-200 p-3.5 dark:border-white/10` (not `bg-white
  dark:bg-neutral-900/50` — borderless dark surfaces).
- Resync banner: use Zap's "info banner" pattern (already noted) but
  on amber. Replace lucide `AlertTriangle` with `react-icons` `PiWarningOctagon`.
- Action buttons: `grid grid-cols-2 gap-3` — already correct.
- Transactions list: re-skin to Zap's preview-page detail-row pattern.
  Label-left, value-right, dashed `<hr>` between entries.

### 5.5 `app/link/page.tsx`
Already in Zap shape. Trim:
- All `lucide-react` (`ShieldCheck`) → `react-icons/pi` (`PiShieldCheck`).
- Inline ad-hoc spinners (`border-t-blue-600 animate-spin`) → shared
  `.loader` CSS class.
- "Continue with Google" `<Button>` should pass `leadingIcon={<Icon
  xml={IconGoogle} size={20} />}` for parity with sign-in.

### 5.6 `app/link/configure/page.tsx`
- Wrap body in `grid gap-6 py-10` (Zap page rhythm).
- Group the four numeric fields into one `rounded-3xl border
  border-gray-200 p-4 dark:border-white/10` card with `divide-y
  divide-dashed divide-gray-200 dark:divide-white/10` between fields.
- Replace bespoke `<input type="range">` styles by adopting a
  `LimitField` shape: label-left, current value pill on the right
  (`rounded-full bg-gray-50 px-2 py-1 text-xs dark:bg-white/5`), range
  underneath using `accent-blue-600` ✓. Help text below in
  `text-xs text-gray-400 dark:text-white/40`.
- PIN fields: route through new `<PinInput>` primitive (see §6) so
  both fields look identical and present an error via `<InputError>`
  not a generic `<p role="alert">`.

### 5.7 `app/link/write/page.tsx`
- `Body` already in good shape. Replace ad-hoc spinner with `.loader`.
- The green-check round on `DoneState` → swap to `PiCheckCircleFill`
  inside a Zap status-pill (`rounded-full bg-gray-50 ...`) — drop the
  `text-4xl ✓` raw glyph.

### 5.8 `app/link/sign/page.tsx`
- Same pattern as 5.7: replace bespoke spinners with `.loader`; replace
  the success line with a Zap status indicator chip.
- Wrap in `grid gap-6 py-10` so it shares the linking-flow rhythm.

### 5.9 `app/cards/top-up/page.tsx`
- Use the same `LimitField` shape introduced in 5.6 for the amount
  slider.
- Wrap the form in Zap's outer card pattern.
- Replace `<Link href="/dashboard" className="text-sm text-gray-500">Cancel</Link>`
  with a Zap-shape footing row: `<button>` styled with `secondaryBtnClasses`,
  half-width next to the primary.

### 5.10 `app/cards/revoke/page.tsx`
- Headline `text-xl font-medium` and color back to neutral (not red).
  Use a red `PiWarningOctagon` icon row above instead. Mirrors Zap's
  Disclaimer pattern.
- Buttons: vertical layout, primary `danger` + secondary "Keep card
  active". Already close.

### 5.11 `app/cards/resync/page.tsx`
- Same shape as 5.7 (spinner → `.loader`, success → status pill).
- iOS no-NFC message: render via shared `<InputError>` not an inline
  `<p>`.

### 5.12 `app/cards/unavailable/page.tsx`
- Replace lucide `AlertCircle` with `react-icons/pi` (`PiSealQuestion`
  or similar) to drop the lucide dep at the leaf.
- Headline weight tightened (`font-medium`).

## 6. New primitives to add

Each new file ports the Zap shape, names match Zap's:

1. `components/ui/Tooltip.tsx` — hover bubble; same chrome as Zap.
2. `components/ui/InputError.tsx` — `text-xs text-blue-500` + `TiInfo`
   icon, Framer `y:-10→0`.
3. `components/ui/SelectField.tsx` — native `<select>` skin + custom
   `PiCaretDown` overlay + label/required marker.
4. `components/ui/TabButton.tsx` — pill segmented tab.
5. `components/ui/InfoBanner.tsx` — Zap's `flex gap-2.5 rounded-xl
   border bg-gray-50 ...` pattern with leading icon slot. Used for the
   "no card linked" + "iOS NFC unsupported" + "resync needed" messages.
6. `components/ui/StatusChip.tsx` — `rounded-full bg-gray-50 px-2
   py-1 dark:bg-white/5` + colored leading icon. Used for the card
   status badge and every success/in-flight pill.
7. `components/ui/PinInput.tsx` — already inline in `link/configure`.
   Lift out so configure + any future step-up flow share it.
8. `components/ui/FundCardModal.tsx` — Tapp's analogue of Zap's
   `FundWalletModal`. Headless UI dialog with the Sui zkLogin
   address + a `react-qrcode-logo` QR. Triggered from the dashboard
   "Top up" button as an alternative to the on-chain top-up flow.
   *Adds two deps:* `@headlessui/react`, `react-qrcode-logo`. See §8 Q4.

## 7. Components / assets to delete

- `lucide-react` imports throughout. Replace with `react-icons/pi`
  and `react-icons/fi`. **Drop `lucide-react` from `package.json`**
  after the sweep — currently pulls 100+ icons we don't tree-shake.
- `public/arbitrum-logo.svg`, `base-logo.svg`, `binance-logo.svg`,
  `dai-logo.svg`, `ethereum-logo.svg`, `polygon-logo.svg`,
  `usdc-logo.svg`, `usdt-logo.svg`, `checkmark.svg` — Zap leftovers
  Tapp doesn't load. Delete; add `sui-logo.svg` + `usdc-logo.svg`
  (Sui-aware) in their place.
- `public/stepper{,-long}{,-dark}.svg` — these are Zap's swap
  progress steppers. Tapp's linking flow has 4 sequential pages
  driven by router; doesn't need a step graphic. Delete.
- `public/{file,globe,next,vercel,window}.svg` — Next default starter
  assets, unused. Delete.

## 8. Open questions — need user decision before code lands

**Q1 — Balance number styling.** Tapp currently makes the wallet/card
balance huge and blue (`text-3xl font-extrabold text-blue-600`). Zap
keeps every number `text-neutral-900` `font-medium`. Two options:

  a. **Mirror Zap exactly** — balance becomes quieter, on-brand with
     the rest. Cleanest visually.
  b. **Keep blue/extrabold balance** — louder, but matches consumer
     fintech convention (Cash App / Revolut / Chipper hero balance).

Recommendation: (a) for "identical" feel; concede that Tapp is a
fintech UI and (b) is defensible. **Please pick.**

**Q2 — `LogoOutlineBg` SVGs.** The four files
`logo-outline-group-{left,right}-{light,dark}.svg` are Paycrest's
outlined wordmark — branding we shouldn't ship under Tapp. Options:

  a. Delete the SVGs + delete `components/ui/LogoOutlineBg.tsx`. Pages
     stay clean.
  b. Replace with abstract decorative SVGs derived from the Tapp
     "contactless card" mark (the `IconContactlessCard` outline,
     tiled or scaled).
  c. Replace with Sui logo outlines.

Recommendation: (b) — keeps the decorative footprint but reads as
"Tapp", not "Paycrest". **Please pick.**

**Q3 — Footer attribution.** Zap's footer says "Powered by Paycrest
Protocol". Tapp options:

  a. "Powered by Sui" with a link to suiwallet.com.
  b. "Built on Sui · zkLogin" plain text.
  c. Just the year + Zoracle.

Recommendation: (a). **Please pick.**

**Q4 — Add `@headlessui/react` + `react-qrcode-logo`?** These let us
ship the `FundCardModal` (Zap's signature modal pattern) for receiving
USDC at the Sui address. Without them, "Top up" only takes you to the
existing `/cards/top-up` page. ~80 KB combined. **Please confirm
add/skip.**

**Q5 — Drop `lucide-react`?** Currently imported in 5 files. Swap to
`react-icons` (already in deps) for Zap parity. ~150 KB saved.
**Please confirm drop.**

**Q6 — Splash/Disclaimer copy.** Disclaimer currently shows "Demo
Disclaimer" body verbatim. Tapp on-chain operations are real if
the user has demo mode off. Keep as-is or rewrite for Tapp? **Please
pick.**

## 9. Order of execution (after sign-off)

1. Add new primitives (§6 #1-7) — no consumer changes yet.
2. Shell tweaks (Navbar, Footer, ThemeSwitch).
3. Page sweep in this order: landing → sign-in → dashboard → card
   detail → link/configure → link/write → link/sign → cards/{top-up,
   revoke, resync, unavailable}.
4. `lucide-react` removal sweep.
5. Asset cleanup (`public/` deletes + Sui-aware additions).
6. Add `FundCardModal` only if Q4 = yes.
7. Run `npm run dev`, walk through every flow visually in Chrome
   mobile-emulation, capture screenshots.
8. Build + typecheck (`npm run build`) before reporting done.

No `npm install` will run until all questions in §8 are answered.
