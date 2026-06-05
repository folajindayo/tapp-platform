// Typed wrappers for every Rails endpoint the merchant app calls.
// Keep in sync with the OpenAPI spec at /docs.

import { request } from "./client";
import type {
  AuthTokens,
  ChangePasswordRequest,
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
  RateResponse,
  RegisterRequest,
  RequestKycRequest,
  RequestKycResponse,
  ResendTokenRequest,
  ResetPasswordRequest,
  ResetPasswordTokenRequest,
  SaveBankAccountRequest,
  SenderProfile,
  SenderStatsResponse,
  TapCardDebitRequest,
  TapCardDebitResponse,
  TapCardNonceRequest,
  TapCardNonceResponse,
  TapCardStepUpResponse,
  TapCardTokenAckRequest,
  UUID,
  UpdateSenderProfileRequest,
  VerifyAccountRequest,
  VerifyAccountResponse,
} from "./types";

// ---- Auth ----
export const authApi = {
  register: (body: RegisterRequest) =>
    request<AuthTokens>({
      method: "POST",
      url: "/v1/auth/register",
      data: { ...body, currency: "NGN", scope: "sender", scopes: ["sender"] },
    }),
  login: (body: LoginRequest) =>
    request<AuthTokens>({
      method: "POST",
      url: "/v1/auth/login",
      data: { ...body, scope: "sender", scopes: ["sender"] },
    }),
  confirmAccount: (body: ConfirmAccountRequest) =>
    request<{ ok: true }>({
      method: "POST",
      url: "/v1/auth/confirm-account",
      data: body,
    }),
  resendToken: (body: ResendTokenRequest) =>
    request<{ ok: true }>({
      method: "POST",
      url: "/v1/auth/resend-token",
      data: body,
    }),
  me: () => request<MeResponse>({ method: "GET", url: "/v1/me" }),
  // Update the authenticated user's first/last name. Email and scope
  // are intentionally not editable here.
  updateMe: (body: { firstName?: string; lastName?: string }) =>
    request<MeResponse>({ method: "PATCH", url: "/v1/me", data: body }),
  resetPasswordToken: (body: ResetPasswordTokenRequest) =>
    request<{ ok: true }>({
      method: "POST",
      url: "/v1/auth/reset-password-token",
      data: body,
    }),
  resetPassword: (body: ResetPasswordRequest) =>
    request<{ ok: true }>({
      method: "PATCH",
      url: "/v1/auth/reset-password",
      data: body,
    }),
  changePassword: (body: ChangePasswordRequest) =>
    request<{ ok: true }>({
      method: "PATCH",
      url: "/v1/auth/change-password",
      data: body,
    }),
  // Server-side revocation. Pass the current refresh token (best-effort)
  // so its family is killed. Always returns 200 so caller can fire-and-
  // forget without leaking validity.
  logout: (refreshToken?: string) =>
    request<{ ok: true }>({
      method: "POST",
      url: "/v1/auth/logout",
      data: refreshToken ? { refreshToken } : {},
    }),
};

// ---- Settings ----
export const settingsApi = {
  getSender: () =>
    request<SenderProfile>({ method: "GET", url: "/v1/settings/sender" }),
  updateSender: (body: UpdateSenderProfileRequest) =>
    request<SenderProfile>({
      method: "PATCH",
      url: "/v1/settings/sender",
      data: body,
    }),
};

// ---- KYC ----
export const kycApi = {
  request: (body: RequestKycRequest) =>
    request<RequestKycResponse>({ method: "POST", url: "/v1/kyc", data: body }),
  status: (id: string) =>
    request<KycStatusResponse>({ method: "GET", url: `/v1/kyc/${id}` }),
};

// ---- Catalog ----
export const catalogApi = {
  currencies: () =>
    request<Currency[]>({ method: "GET", url: "/v1/currencies" }),
  institutions: (currencyCode: string) =>
    request<Institution[]>({
      method: "GET",
      url: `/v1/institutions/${currencyCode}`,
    }),
  rates: (token: string, amount: string, fiat: string) =>
    request<RateResponse>({
      method: "GET",
      url: `/v1/rates/${token}/${amount}/${fiat}`,
    }),
};

// ---- Verify account ----
export const verifyApi = {
  account: (body: VerifyAccountRequest) =>
    request<VerifyAccountResponse>({
      method: "POST",
      url: "/v1/verify-account",
      data: body,
    }),
};

// ---- Merchant self ----
export const merchantApi = {
  saveBankAccount: (body: SaveBankAccountRequest) =>
    request<MerchantBankAccount>({
      method: "POST",
      url: "/v1/sender/me/bank-account",
      data: body,
    }),
  getBankAccount: () =>
    request<MerchantBankAccount>({
      method: "GET",
      url: "/v1/sender/me/bank-account",
      scope: "sender",
    }),
  initiateTap: (body: InitiateTapRequest, idempotencyKey: string) =>
    request<InitiateTapResponse>({
      method: "POST",
      url: "/v1/sender/me/tap",
      data: body,
      headers: { "Idempotency-Key": idempotencyKey },
    }),
  tapCardNonce: (body: TapCardNonceRequest) =>
    request<TapCardNonceResponse>({
      method: "GET",
      url: "/v1/sender/me/tap-card/nonce",
      params: body,
    }),
  tapCardDebit: (body: TapCardDebitRequest) =>
    request<TapCardDebitResponse>({
      method: "POST",
      url: "/v1/sender/me/tap-card",
      data: body,
    }),
  tapCardTokenAck: (orderId: UUID, body: TapCardTokenAckRequest) =>
    request<{ acknowledged: true }>({
      method: "POST",
      url: `/v1/sender/me/tap-card/${orderId}/token-ack`,
      data: body,
    }),
  tapCardStepUpPoll: (token: string) =>
    request<TapCardStepUpResponse>({
      method: "GET",
      url: "/v1/sender/me/tap-card/step-up",
      params: { token },
    }),
};

// ---- Orders ----
export const ordersApi = {
  list: (opts: { status?: string; limit?: number; page?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.status) params.set("status", opts.status);
    if (opts.limit) params.set("limit", String(opts.limit));
    if (opts.page && opts.page > 1) params.set("page", String(opts.page));
    const qs = params.toString();
    return request<OrdersListResponse>({
      method: "GET",
      url: `/v1/sender/orders${qs ? `?${qs}` : ""}`,
    });
  },
  get: (id: UUID) =>
    request<PaymentOrderSummary>({
      method: "GET",
      url: `/v1/sender/orders/${id}`,
    }),
  cancel: (id: UUID) =>
    request<{ ok: true }>({
      method: "POST",
      url: `/v1/sender/orders/${id}/cancel`,
    }),
  stats: (period?: "today" | "week" | "month" | "all") => {
    const url = period
      ? `/v1/sender/stats?period=${period}`
      : "/v1/sender/stats";
    return request<SenderStatsResponse>({ method: "GET", url });
  },
};
