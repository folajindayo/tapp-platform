// Typed wrappers for every Rails endpoint the merchant app calls.
// Keep in sync with docs/merchant-backend-api.md.

import { request } from './client';
import type {
  AuthTokens,
  ConfirmAccountRequest,
  Currency,
  InitiateTapCardRequest,
  InitiateTapCardResponse,
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
  initiateTapCard: (body: InitiateTapCardRequest, idempotencyKey: string) =>
    request<InitiateTapCardResponse>({
      method: 'POST',
      url: '/v1/sender/me/tap-card',
      data: body,
      headers: { 'Idempotency-Key': idempotencyKey },
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
