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
export interface InitiateTapCardRequest {
  amount: string;
  card_uid: string;
  memo?: string;
}
export interface InitiateTapCardResponse {
  order_id: UUID;
  status: 'settled' | 'processing';
  amount: string;
  currency: string;
  coin_amount: string;
  coin_type: string;
  rate_quoted: string;
  tx_hash?: string;
  settled_at?: string;
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
