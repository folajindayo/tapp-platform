# Tapp Merchant — Backend API

The merchant app talks to Rails over HTTPS + a single WebSocket. JWT auth via `Authorization: Bearer <access_token>` on every request. Tokens come from the existing `/v1/auth/login` path and live in `react-native-mmkv` on-device.

This doc enumerates **every endpoint the app calls**, split into reused (already shipped in Rails) and new (Phase 1 additions). Anything not listed here is out of scope for the merchant app.

---

## Auth headers

```
Authorization: Bearer <access_token>
Content-Type: application/json
X-Client: tapp-merchant            # optional, helps with analytics + rate-limit buckets
```

On `401` the app attempts a refresh via `POST /v1/auth/refresh`. If that also 401s, JWT is purged and the user is bounced to `(auth)/sign-in`.

---

## Reused endpoints (already in Rails)

### `POST /v1/auth/register`

Creates a `SenderProfile`.

Request:

```json
{ "email": "merchant@example.com", "password": "...", "scope": "sender" }
```

Response `201`:

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "user": { "id": "...", "email": "..." }
}
```

### `POST /v1/auth/login`

Returns JWT pair.

### `POST /v1/auth/refresh`

Refresh token → new access token.

### `POST /v1/auth/confirm-account`

Email verification via OTP.

### `POST /v1/auth/resend-token`

Resend verification token.

### `POST /v1/kyc`

Initiates Smile Identity KYB. Body needs an EIP-191-style wallet signature today; the merchant app currently has no Sui wallet integration, so we use the merchant's authenticated session as the signing identity instead (see Phase 1 backend tweak below — `WalletAddress` becomes optional when `JWTMiddleware` already identified the sender). Returns hosted KYC URL.

Request:

```json
{
  "wallet_address": "<sender_profile_id>", // optional, falls back to JWT
  "signature": "...", // optional in the merchant flow
  "nonce": "...",
  "id_types": [{ "country": "NG", "id_type": "BVN" }]
}
```

Response `200`:

```json
{ "url": "https://links.usesmileid.com/...", "expires_at": "..." }
```

### `GET /v1/kyc/:wallet_address`

Polls KYB status. Returns `{ status: "pending" | "success" | "failed" }`.

### `POST /v1/verify-account`

Pre-save bank account name resolve.

Request:

```json
{ "institution": "044", "account_identifier": "0123456789", "currency": "NGN" }
```

Response `200`:

```json
{ "account_name": "JANE DOE" }
```

### `GET /v1/currencies`

List of enabled fiat currencies. Used to populate currency selectors.

### `GET /v1/institutions/:currency_code`

Banks + mobile-money providers for a given currency. Used in the bank-account onboarding screen.

### `GET /v1/sender/orders`

Paginated list of the authenticated sender's `PaymentOrder` rows. Used for dashboard history.

Query: `?status=settled&limit=20&cursor=...`

Response `200`:

```json
{
  "data": [
    {
      "id": "ord_abc",
      "amount": "5000.00",
      "currency": "NGN",
      "status": "settled",
      "created_at": "...",
      "settled_at": "...",
      "gateway_id": "0x...",
      "tx_hash": "..."
    }
  ],
  "next_cursor": "..."
}
```

### `GET /v1/sender/orders/:id`

Single order detail. Polled by the broadcast screen as a fallback if the WebSocket isn't connected.

### `POST /v1/sender/orders/:id/cancel`

Cancels a pending order. Called when the merchant backs out of broadcast or `expires_at` passes.

### `GET /v1/sender/stats`

Aggregate stats (today's settled, total volume, count). Used on dashboard.

---

## New endpoints (Phase 1, Rails additions)

All three live under `/v1/sender/me/` (segment chosen so existing `/v1/sender/orders` paths stay distinct from merchant-self endpoints).

### `POST /v1/sender/me/bank-account`

Save or replace the merchant's bank account. One-to-one with `SenderProfile`; subsequent calls upsert.

Request:

```json
{
  "currency": "NGN",
  "bank_code": "044",
  "account_number": "0123456789",
  "account_name": "JANE DOE"
}
```

The handler MUST internally call the existing `VerifyAccount` path to confirm the resolved name matches `account_name`. Mismatch returns `400 BANK_ACCOUNT_VERIFICATION_FAILED`.

Response `200`:

```json
{
  "id": "mba_xyz",
  "currency": "NGN",
  "bank_code": "044",
  "account_number": "0123456789",
  "account_name": "JANE DOE",
  "verified_at": "2026-05-22T10:00:00Z"
}
```

Errors:

- `400 BANK_ACCOUNT_VERIFICATION_FAILED` — name mismatch
- `400 INVALID_BANK_CODE` — institution not in Institution table
- `400 UNSUPPORTED_CURRENCY`

### `GET /v1/sender/me/bank-account`

Returns the saved account or `404 NOT_FOUND` if not yet set.

### `POST /v1/sender/me/tap`

The headline endpoint. Creates a `PaymentOrder` with recipient auto-populated from the saved `MerchantBankAccount`, returns the order ID + checkout URL the HCE service broadcasts.

Request:

```json
{
  "amount": "5000.00",
  "memo": "Table 4"
}
```

Notes:

- `currency` comes from the saved bank account, not the request.
- `rate` is computed server-side from the current spot median + ceiling (existing `services/ceiling_rate.go`).
- `valid_until` defaults to `orderConf.OrderRequestValidity` (120s) but the app should treat the returned `expires_at` as authoritative.

Response `201`:

```json
{
  "order_id": "ord_abc",
  "reference": "ord_abc",
  "checkout_url": "https://checkout.zoracle.xyz/order/ord_abc",
  "amount": "5000.00",
  "currency": "NGN",
  "rate_quoted": "1530.50",
  "coin_amount": "3.267",
  "coin_type": "0x...::usdc::USDC",
  "expires_at": "2026-05-22T10:02:00Z"
}
```

Errors:

- `400 BANK_ACCOUNT_REQUIRED` — merchant hasn't completed bank onboarding
- `400 KYC_REQUIRED` — KYB not yet `success`
- `503 RATE_UNAVAILABLE` — spot median oracle unhealthy
- `503 NO_LP_LIQUIDITY` — no LP within ceiling for the amount (caller can retry with smaller amount or wait)

### `POST /v1/sender/me/tap-card`

Synchronous Tap Card payment. The merchant scanned a customer's NTAG215 card; backend resolves the card UID to its linked Sui zkLogin balance, debits via a pre-authorized Move capability, and settles in one round-trip.

Request:

```json
{
  "amount": "5000.00",
  "card_uid": "04A3B2C1D5E6F7",
  "memo": "Table 4"
}
```

- `card_uid` is the 7-byte NTAG215 UID, hex-encoded, no separators. The merchant app reads this via `react-native-nfc-manager` (Android NfcAdapter or iOS CoreNFC) and posts it as-is.
- `currency` is implied from the merchant's saved bank account.
- `rate` is computed server-side at the spot median (same path as `/tap`).

Response `200` (settled in the round-trip):

```json
{
  "order_id": "ord_abc",
  "status": "settled",
  "amount": "5000.00",
  "currency": "NGN",
  "coin_amount": "3.267",
  "coin_type": "0x...::usdc::USDC",
  "rate_quoted": "1530.50",
  "tx_hash": "0x9f8e...4c1a",
  "settled_at": "2026-05-22T10:05:00Z"
}
```

If the round-trip can't complete synchronously (e.g. the Move debit succeeds but BaaS payout is queued), the response returns `status: "processing"` with the `order_id` and the merchant app falls back to the WebSocket / polling path used by phone-to-phone.

Errors:

- `400 BANK_ACCOUNT_REQUIRED` / `400 KYC_REQUIRED` — same as `/tap`
- `404 CARD_NOT_LINKED` — the UID has no linked Sui address (card was never registered or was unlinked)
- `400 CARD_INSUFFICIENT_BALANCE` — linked balance < required coin amount
- `400 CARD_DEBIT_AUTHORITY_EXPIRED` — the card's pre-authorized debit cap has expired; user must re-link
- `503 RATE_UNAVAILABLE`

Note: the **card-linking flow** (user logs in via zkLogin on checkout web, taps a blank NTAG215 to bind it to their Sui address + grant a debit cap) lives on the Zoracle checkout web, not in this merchant app. The merchant app only consumes cards that are already linked.

### `GET /v1/sender/me/payments/stream` (SSE)

Server-Sent Events stream of payment status updates scoped to the authenticated `SenderProfile`. Purely server→client push (we never need to talk back on the same channel), so SSE is a better fit than WebSocket — plain HTTP, automatic reconnect via the `Last-Event-ID` header, `curl`-debuggable.

Headers:

```
Accept: text/event-stream
Authorization: Bearer <access_token>
```

Server emits events as they happen, scoped to the authenticated sender:

```
event: payment.deposited
data: {"order_id":"ord_abc","sui_tx_hash":"..."}

event: payment.processing
data: {"order_id":"ord_abc"}

event: payment.fulfilled
data: {"order_id":"ord_abc","fiat_amount":"5000.00"}

event: payment.settled
data: {"order_id":"ord_abc","fiat_amount":"5000.00","tx_hash":"...","settled_at":"..."}
id: 1747920000-ord_abc

event: payment.refunded
data: {"order_id":"ord_abc","reason":"..."}
```

The trailing `id:` after `settled` (and any terminal event) lets the client resume from that point on reconnect via the `Last-Event-ID` request header. Server keeps a short ring buffer of recent events per sender.

Server sends a comment line (`:heartbeat\n\n`) every 25s to keep the connection alive through intermediate proxies that drop idle TCP. The browser/RN `EventSource` polyfill handles reconnect transparently.

**Client lib (RN):** [`react-native-sse`](https://github.com/binaryminds/react-native-sse) — supports `Authorization` headers natively (the browser `EventSource` API doesn't, which is the main reason we'd otherwise be forced to a query-string token). Adds custom-event listeners (`addEventListener('payment.settled', ...)`).

On `401` the stream closes; client refreshes the JWT and reopens.

---

## Error model

All errors follow the existing Rails shape:

```json
{
  "error": {
    "code": "BANK_ACCOUNT_REQUIRED",
    "message": "Save a bank account before initiating a tap payment.",
    "request_id": "req_...",
    "details": {}
  }
}
```

App handles known codes:

| Code                               | App reaction                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `UNAUTHENTICATED`                  | clear JWT, navigate to `(auth)/sign-in`                                                                 |
| `KYC_REQUIRED`                     | navigate to `(onboarding)/kyb`                                                                          |
| `BANK_ACCOUNT_REQUIRED`            | navigate to `(onboarding)/bank-account`                                                                 |
| `BANK_ACCOUNT_VERIFICATION_FAILED` | inline form error, suggest re-entering account number                                                   |
| `RATE_UNAVAILABLE`                 | toast "Rates unavailable — try again in a moment"                                                       |
| `NO_LP_LIQUIDITY`                  | toast "No liquidity for this amount — try smaller"                                                      |
| `CARD_NOT_LINKED`                  | screen-level error "This card isn't registered yet. The customer needs to link it at zoracle.xyz/link." |
| `CARD_INSUFFICIENT_BALANCE`        | screen-level error "Card balance is too low for this amount."                                           |
| `CARD_DEBIT_AUTHORITY_EXPIRED`     | screen-level error "The card's authorization expired. Customer needs to re-link."                       |
| any other                          | toast with `message`, log to Sentry                                                                     |

---

## Idempotency

`POST /v1/sender/me/tap` accepts an `Idempotency-Key` header (server uses existing Rails idempotency cache for 24h). The app generates one UUID per amount-confirmation tap so accidental double-taps don't create duplicate orders.

---

## Versioning

All endpoints are under `/v1/`. The merchant app pins to v1; breaking changes go to `/v2/`.
