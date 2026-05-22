# Tapp Merchant — Onboarding Spec

The flow from "merchant downloads app" to "merchant can accept their first tap." Four steps, gated linearly. Each step's completion is queryable from the backend so the app can resume mid-flow on a fresh install or after sign-out.

## Steps

| # | Step | Persisted on | "Done" when |
|---|---|---|---|
| 1 | Email + password signup | `SenderProfile` row exists | `/v1/auth/register` returns 201 |
| 2 | Email verification | `SenderProfile.email_verified = true` | `/v1/auth/confirm-account` returns 200 |
| 3 | KYB-light (Smile Identity) | `IdentityVerificationRequest.status = success` | KYC webhook fires + polled `/v1/kyc/:id` returns success |
| 4 | Bank account | `MerchantBankAccount` row exists + `verified_at` non-null | `/v1/sender/me/bank-account` returns 200 |

After step 4, the merchant is **live** and routed to the dashboard. Any attempt to tap-broadcast before all four are done is rejected backend-side (`KYC_REQUIRED` or `BANK_ACCOUNT_REQUIRED` error codes) and the app routes to the missing step.

## State resolution at app launch

On every cold start / foreground-from-background event:

```
1. Read JWT from mmkv.
   - If missing → (auth)/sign-in
   - If present → continue

2. GET /v1/auth/me  (returns { id, email, email_verified, kyc_status })
   - If 401 → try /v1/auth/refresh; on success retry; on fail purge + (auth)/sign-in
   - If email_verified=false → (auth)/verify-email
   - If kyc_status != "success" → (onboarding)/kyb
   - Continue

3. GET /v1/sender/me/bank-account
   - If 404 → (onboarding)/bank-account
   - If 200 → (app)/dashboard

4. Cache the resolved step in zustand; expo-router layout segments enforce
   the routing guard so deep links can't bypass the gate.
```

The merchant app does NOT have a "skip for now" affordance on any of these steps — each is required before they can transact. The UX makes that explicit: the bottom CTA is always "Continue" with the next-step label, never "Skip."

## Step 1: Signup

**Screen:** `(auth)/sign-up.tsx`

**Fields:** email, password (8+ chars, 1 number, 1 letter — enforced client-side via zod + server-side).

**Submit:** `POST /v1/auth/register { email, password, scope: "sender" }` → JWT pair on success.

**Persist:** access + refresh tokens → mmkv. Navigate to `(auth)/verify-email`.

**Errors:**
- `EMAIL_ALREADY_REGISTERED` → inline form error, link to sign-in
- `WEAK_PASSWORD` → inline rule reminder
- network → toast + retry

## Step 2: Email verification

**Screen:** `(auth)/verify-email.tsx`

**Mechanic:** a 6-digit OTP is emailed to the registered address. Resend button (rate-limited to once per 60s) calls `POST /v1/auth/resend-token`.

**Submit:** `POST /v1/auth/confirm-account { token }` → 200 on success.

**Navigate:** `(onboarding)/kyb`.

**Errors:**
- `INVALID_TOKEN` → inline error, prompt resend
- `TOKEN_EXPIRED` → auto-call resend, show "We've sent a new code"

## Step 3: KYB-light

**Screen:** `(onboarding)/kyb.tsx`

**v1 depth:** the existing Rails `/v1/kyc` flow runs Smile Identity, which collects BVN + selfie + ID document. For a Nigerian-first merchant launch, BVN-only KYC is a defensible lighter posture (Smile supports `id_type: "BVN"` without selfie). Phase 0 spec decision below.

**Flow:**

1. Show explanatory copy: "We need to verify your identity to enable payouts. Takes ~2 minutes."
2. Tap "Start verification" → `POST /v1/kyc` with the merchant's session as the identifying record (Phase 1 backend change: `wallet_address` falls back to JWT-resolved `sender_profile_id` when omitted).
3. Backend returns `{ url, expires_at }`. App opens `url` via `expo-web-browser` (in-app browser tab so the user stays in our app context).
4. After Smile Identity returns control (their hosted page redirects to a known deep link), poll `GET /v1/kyc/:id` every 5s for up to 5 minutes.
5. On `status: "success"` → navigate `(onboarding)/bank-account`.
6. On `status: "failed"` → show error with reason, offer to retry (calls `/v1/kyc` again, which generates a fresh link — Rails handles the deduplication).

**Edge:** the Smile Identity webhook to Rails (`POST /v1/kyc/webhook`) can land slightly before/after the app's poll. Polling is the source of truth from the app's perspective.

### Decision: BVN-only vs full ID

Recommendation: **BVN-only for v1, upgrade to full ID + selfie post-launch.**

- Pros: dramatically faster onboarding (~30s vs 2-5 min), much higher conversion. BVN is the universal Nigerian financial ID — already required to open a bank account, so every merchant has one.
- Cons: BVN-only is weaker against impersonation. Tolerable while volume is low + merchant set is small + bank-account verification (step 4) provides a second factor (whoever owns the bank account named on file).
- Implementation: Rails `/v1/kyc` already accepts an `id_types` array. The merchant app sends `[{ country: "NG", id_type: "BVN" }]` only. v2 can switch to multi-type.

## Step 4: Bank account

**Screen:** `(onboarding)/bank-account.tsx`

**Fields:**
1. Bank (dropdown, populated from `GET /v1/institutions/NGN`).
2. Account number (10 digits, NUBAN format).

**Live resolve:** on losing focus from the account-number field (or after 800ms debounce), call `POST /v1/verify-account` with the selected bank + number. Display the returned `account_name` in a confirmation row. Submit button is disabled until a name resolves.

**Submit:** `POST /v1/sender/me/bank-account { currency: "NGN", bank_code, account_number, account_name }` → 200 with the saved record.

**Navigate:** `(app)/dashboard`. Show a one-off success modal: "You're live. Tap 'New payment' to take your first payment."

**Errors:**
- `BANK_ACCOUNT_VERIFICATION_FAILED` → server-side double-check (the live resolve might have been stale); ask the merchant to retype.
- name mismatch with KYC record → for v1 we trust the bank's resolve; v2 may add a cross-check rule that the BVN's owner matches the bank account holder.

## Reauthentication and re-onboarding

If a merchant signs out and back in, the same state-resolution logic runs and they land on whichever step they had completed. Bank account changes go through the same `POST /v1/sender/me/bank-account` (it's an upsert).

If their KYC `status` ever flips back to `failed` (server-side detected fraud, etc.), the app routes them to `(onboarding)/kyb` with a banner explaining why. Transacting is blocked until re-verified.

## Non-onboarding settings

Outside the onboarding flow, settings screen (`settings.tsx`) lets a live merchant:

- View profile (read-only email, KYC date, BVN last-4).
- Update bank account (same `POST /v1/sender/me/bank-account`).
- Sign out (clears mmkv, navigates to `(auth)/sign-in`).
- (v2) change password, delete account.

## Telemetry

Each step transition logs a `onboarding.<step>.{started, completed, failed}` event so we can build a funnel and find drop-off. Events sent via Mixpanel (Phase 7 setup); buffered locally until then.

## What we explicitly do NOT collect at onboarding

- Phone number (KYC + bank account give us enough verification surface).
- Physical address (no mailing requirement in v1).
- Business name / category (merchant is an individual or trade-named operator; we treat all merchants symmetrically in v1).

These can be added in v2 if compliance or analytics demand it.
