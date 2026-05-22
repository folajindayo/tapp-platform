// Typed shapes for every Rails endpoint the merchant app calls.
// Mirrors docs/merchant-backend-api.md — keep in sync.

export type UUID = string;

export interface ApiError {
  code: string;
  message: string;
  request_id?: string;
  details?: Record<string, unknown>;
}

// ---- Auth ----
export interface RegisterRequest {
  email: string;
  password: string;
  scope: 'sender';
}
export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  user: { id: UUID; email: string };
}
export interface LoginRequest {
  email: string;
  password: string;
}
export interface RefreshRequest {
  refresh_token: string;
}
export interface ConfirmAccountRequest {
  token: string;
}
export interface ResendTokenRequest {
  email: string;
}

// ---- Me ----
export interface MeResponse {
  id: UUID;
  email: string;
  email_verified: boolean;
  kyc_status: 'pending' | 'success' | 'failed' | 'not_started';
}

// ---- KYC ----
export interface RequestKycRequest {
  wallet_address?: string;
  signature?: string;
  nonce?: string;
  id_types?: { country: string; id_type: string }[];
}
export interface RequestKycResponse {
  url: string;
  expires_at: string;
}
export interface KycStatusResponse {
  status: 'pending' | 'success' | 'failed';
}

// ---- Catalog ----
export interface Currency {
  code: string;
  name: string;
  short_name: string;
  decimals: number;
  symbol: string;
  market_rate: string;
}
export interface Institution {
  code: string;
  name: string;
  type: 'bank' | 'mobile_money';
}

// ---- Verify account ----
export interface VerifyAccountRequest {
  institution: string;
  account_identifier: string;
  currency: string;
}
export interface VerifyAccountResponse {
  account_name: string;
}

// ---- Merchant bank account ----
export interface SaveBankAccountRequest {
  currency: string;
  bank_code: string;
  account_number: string;
  account_name: string;
}
export interface MerchantBankAccount {
  id: UUID;
  currency: string;
  bank_code: string;
  account_number: string;
  account_name: string;
  verified_at: string;
}

// ---- Tap (phone-to-phone) ----
export interface InitiateTapRequest {
  amount: string;
  memo?: string;
}
export interface InitiateTapResponse {
  order_id: UUID;
  reference: string;
  checkout_url: string;
  amount: string;
  currency: string;
  rate_quoted: string;
  coin_amount: string;
  coin_type: string;
  expires_at: string;
}

// ---- Tap Card (NTAG215) ----
// Wire shapes for the three-tier debit protocol — see
// docs/tap-card-pin-flow.md and rails/docs/tapp-card-spec.md (rev 2).

/** Tier the backend resolved the amount into. Determines the UI flow. */
export type TapCardTier = 'none' | 'pin' | 'step_up';

/**
 * GET /v1/sender/me/tap-card/nonce
 * Pre-debit probe: server returns a single-use 32-byte nonce + the
 * tier this amount falls into so the client knows whether to show
 * the PIN pad / step-up QR / submit straight away.
 */
export interface TapCardNonceRequest {
  amount: string;
  card_uid_hash: string; // hex(sha256(card UID))
}
export interface TapCardNonceResponse {
  tier: TapCardTier;
  server_nonce: string;        // hex, single-use, 60s TTL
  step_up_url?: string;        // present only when tier === 'step_up'
  step_up_token?: string;      // opaque; echoed back on re-submit
}

/** POST /v1/sender/me/tap-card — the debit itself. */
export interface TapCardDebitRequest {
  card_uid_hash:   string; // hex(sha256(UID))
  current_token_ct: string; // hex of the ciphertext bytes read off the card
  amount:          string;  // fiat amount, decimal string
  currency:        string;  // 'NGN' in v1
  memo?:           string;
  server_nonce:    string;  // echo from GET /nonce
  /** HMAC challenge-response. Null when tier === 'none'. */
  pin_response?:   string;  // hex(HMAC-SHA256(HMAC(K, PIN), server_nonce))
  /** Echoed back after a step-up grant; null on initial submit. */
  step_up_token?:  string;
}

export interface TapCardDebitResponse {
  status:          'settled' | 'processing';
  order_id:        UUID;
  amount:          string;
  currency:        string;
  /** New card-sector token to write back on success. Hex. */
  new_card_token:  string;
  /** Single-use NTAG215 PWD (4 bytes hex) for PWD_AUTH before write. */
  card_password:   string;
  remaining_daily: string; // subunit u64
  tx_hash?:        string;
}

/** POST /v1/sender/me/tap-card/:order_id/token-ack */
export interface TapCardTokenAckRequest {
  written: boolean;
}

/** GET /v1/sender/me/tap-card/step-up?token=… */
export interface TapCardStepUpResponse {
  status: 'pending' | 'granted' | 'denied' | 'expired';
}

// ---- Orders ----
export type OrderStatus =
  | 'initiated'
  | 'pending'
  | 'processing'
  | 'fulfilled'
  | 'validated'
  | 'settled'
  | 'cancelled'
  | 'refunded'
  | 'expired';

export interface PaymentOrderSummary {
  id: UUID;
  amount: string;
  currency: string;
  status: OrderStatus;
  created_at: string;
  settled_at?: string;
  gateway_id?: string;
  tx_hash?: string;
  memo?: string;
}

export interface OrdersListResponse {
  data: PaymentOrderSummary[];
  next_cursor?: string;
}

export interface SenderStatsResponse {
  today_amount: string;
  today_count: number;
  total_amount: string;
  total_count: number;
}

// ---- SSE events ----
export type SsePaymentEvent =
  | { event: 'payment.deposited'; data: { order_id: UUID; sui_tx_hash?: string } }
  | { event: 'payment.processing'; data: { order_id: UUID } }
  | { event: 'payment.fulfilled'; data: { order_id: UUID; fiat_amount: string } }
  | {
      event: 'payment.settled';
      data: { order_id: UUID; fiat_amount: string; tx_hash: string; settled_at: string };
    }
  | { event: 'payment.refunded'; data: { order_id: UUID; reason: string } };
