// Typed wrappers for every Rails endpoint the merchant app calls.
// Keep in sync with docs/merchant-backend-api.md.

import { request } from './client';
import type {
  AuthTokens,
  ConfirmAccountRequest,
  Currency,
  InitiateTapRequest,
  InitiateTapResponse,
  Institution,
  KycStatusResponse,
  LoginRequest,
  MeResponse,
  MerchantBankAccount,
  OrdersListResponse,
  PaymentOrderSummary,
  RegisterRequest,
  RequestKycRequest,
  RequestKycResponse,
  ResendTokenRequest,
  SaveBankAccountRequest,
  SenderStatsResponse,
  TapCardDebitRequest,
  TapCardDebitResponse,
  TapCardNonceRequest,
  TapCardNonceResponse,
  TapCardStepUpResponse,
  TapCardTokenAckRequest,
  UUID,
  VerifyAccountRequest,
  VerifyAccountResponse,
} from './types';

// ---- Auth ----
export const authApi = {
  register: (body: RegisterRequest) =>
    request<AuthTokens>({ method: 'POST', url: '/v1/auth/register', data: body }),
  login: (body: LoginRequest) =>
    request<AuthTokens>({ method: 'POST', url: '/v1/auth/login', data: body }),
  confirmAccount: (body: ConfirmAccountRequest) =>
    request<{ ok: true }>({ method: 'POST', url: '/v1/auth/confirm-account', data: body }),
  resendToken: (body: ResendTokenRequest) =>
    request<{ ok: true }>({ method: 'POST', url: '/v1/auth/resend-token', data: body }),
  me: () => request<MeResponse>({ method: 'GET', url: '/v1/auth/me' }),
};

// ---- KYC ----
export const kycApi = {
  request: (body: RequestKycRequest) =>
    request<RequestKycResponse>({ method: 'POST', url: '/v1/kyc', data: body }),
  status: (id: string) =>
    request<KycStatusResponse>({ method: 'GET', url: `/v1/kyc/${id}` }),
};

// ---- Catalog ----
export const catalogApi = {
  currencies: () => request<Currency[]>({ method: 'GET', url: '/v1/currencies' }),
  institutions: (currencyCode: string) =>
    request<Institution[]>({ method: 'GET', url: `/v1/institutions/${currencyCode}` }),
};

// ---- Verify account ----
export const verifyApi = {
  account: (body: VerifyAccountRequest) =>
    request<VerifyAccountResponse>({ method: 'POST', url: '/v1/verify-account', data: body }),
};

// ---- Merchant self (Phase 1 new endpoints) ----
export const merchantApi = {
  saveBankAccount: (body: SaveBankAccountRequest) =>
    request<MerchantBankAccount>({
      method: 'POST',
      url: '/v1/sender/me/bank-account',
      data: body,
    }),
  getBankAccount: () =>
    request<MerchantBankAccount>({ method: 'GET', url: '/v1/sender/me/bank-account' }),
  initiateTap: (body: InitiateTapRequest, idempotencyKey: string) =>
    request<InitiateTapResponse>({
      method: 'POST',
      url: '/v1/sender/me/tap',
      data: body,
      headers: { 'Idempotency-Key': idempotencyKey },
    }),
  // Pre-debit probe: resolves the auth tier (none / pin / step_up) and
  // returns a single-use server_nonce the debit POST must echo.
  tapCardNonce: (body: TapCardNonceRequest) =>
    request<TapCardNonceResponse>({
      method: 'GET',
      url: '/v1/sender/me/tap-card/nonce',
      params: body,
    }),
  // The debit itself. PIN response (if any) is computed on-device from
  // K (read off the card) + the typed PIN + the server_nonce; see
  // src/hooks/pinHmac.ts. Idempotent on server_nonce.
  tapCardDebit: (body: TapCardDebitRequest) =>
    request<TapCardDebitResponse>({
      method: 'POST',
      url: '/v1/sender/me/tap-card',
      data: body,
    }),
  // After a successful write of `new_card_token` back to the card.
  // The server uses written=false to flag the card for PWA-driven
  // resync at the cardholder's next opportunity.
  tapCardTokenAck: (orderId: UUID, body: TapCardTokenAckRequest) =>
    request<{ acknowledged: true }>({
      method: 'POST',
      url: `/v1/sender/me/tap-card/${orderId}/token-ack`,
      data: body,
    }),
  // Polled by the step-up screen while the cardholder completes
  // WebAuthn biometric in their own PWA.
  tapCardStepUpPoll: (token: string) =>
    request<TapCardStepUpResponse>({
      method: 'GET',
      url: '/v1/sender/me/tap-card/step-up',
      params: { token },
    }),
};

// ---- Orders ----
export const ordersApi = {
  list: (opts: { status?: string; limit?: number; cursor?: string } = {}) => {
    const params = new URLSearchParams();
    if (opts.status) params.set('status', opts.status);
    if (opts.limit) params.set('limit', String(opts.limit));
    if (opts.cursor) params.set('cursor', opts.cursor);
    const qs = params.toString();
    return request<OrdersListResponse>({
      method: 'GET',
      url: `/v1/sender/orders${qs ? `?${qs}` : ''}`,
    });
  },
  get: (id: UUID) =>
    request<PaymentOrderSummary>({ method: 'GET', url: `/v1/sender/orders/${id}` }),
  cancel: (id: UUID) =>
    request<{ ok: true }>({ method: 'POST', url: `/v1/sender/orders/${id}/cancel` }),
  stats: () => request<SenderStatsResponse>({ method: 'GET', url: '/v1/sender/stats' }),
};
