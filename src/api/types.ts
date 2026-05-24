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
  firstName: string;
  lastName: string;
  email: string;
  password: string;
}
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  scopes: string[];
}
export interface LoginRequest {
  email: string;
  password: string;
}
export interface RefreshRequest {
  refreshToken: string;
}
// Confirm an email-verification or password-reset code. Both `token` and
// `email` are required — Rails uses the pair to invalidate the row and
// flip the user's IsEmailVerified flag.
export interface ConfirmAccountRequest {
  token: string;
  email: string;
}
// Re-issue a verification or reset token. Rails enforces the `scope` enum
// to disambiguate which token kind to mint.
export interface ResendTokenRequest {
  email: string;
  scope: 'emailVerification' | 'resetPassword';
}

// ---- Me ----
export interface MeResponse {
  id: UUID;
  email: string;
  first_name?: string;
  last_name?: string;
  scopes: string[];
  is_email_verified: boolean;
  kyc_status?: 'pending' | 'success' | 'failed' | 'not_started';
  has_sender_profile: boolean;
  has_provider_profile: boolean;
  has_tapp_card: boolean;
  created_at: string;
  updated_at: string;
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
export type VerifyAccountResponse = string;

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

export interface PaymentOrderRecipient {
  institution: string;
  accountIdentifier: string;
  accountName: string;
  memo: string;
  providerId?: string;
  currency?: string;
  reference?: string;
}

export interface PaymentOrderSummary {
  id: UUID;
  amount: string;
  status: OrderStatus;
  createdAt: string;
  updatedAt: string;
  txHash?: string;
  gatewayId?: string;
  reference?: string;
  recipient?: PaymentOrderRecipient;
  amountPaid?: string;
  amountReturned?: string;
  token?: string;
  senderFee?: string;
  transactionFee?: string;
  rate?: string;
  network?: string;
}

export interface OrdersListResponse {
  total: number;
  page: number;
  pageSize: number;
  orders: PaymentOrderSummary[] | null;
}

export interface SenderStatsResponse {
  totalOrders: number;
  totalOrderVolume: string;
  totalFeeEarnings: string;
}

// ---- Auth — password management ----
// Field names must match Rails' camelCase JSON tags exactly — Rails
// rejects with 400 when the binding `required` field is missing.
export interface ChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
}
export interface ResetPasswordTokenRequest {
  email: string;
}
export interface ResetPasswordRequest {
  resetToken: string;
  password: string;
}

// ---- Settings ----
export interface SenderProfile {
  id: UUID;
  email: string;
  first_name?: string;
  last_name?: string;
}
export interface UpdateSenderProfileRequest {
  first_name?: string;
  last_name?: string;
}

// ---- Catalog — live rates ----
export type RateResponse = string;

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
