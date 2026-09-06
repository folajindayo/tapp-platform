"use client";

export type OfframpToken = "USDC" | "SUI" | "USDT";

export interface OfframpCurrency {
  code: string;
  name: string;
  supported_routes: string[];
  ceiling_rate: string;
}

export interface OfframpInstitution {
  code: string;
  name: string;
  type: string;
}

export interface OfframpQuote {
  rate: string;
  rateId?: string;
  token: OfframpToken;
  currency: string;
  expiresAt?: string;
}

export interface OfframpDepositOption {
  method: "ptb" | "receive_address" | string;
  label: string;
  gateway_package_id?: string;
  ptb_base64?: string;
  address?: string;
  qr_payload?: string;
}

export interface OfframpOrder {
  order_id: string;
  status: string;
  rate_quoted: string;
  fiat_amount: string;
  fee: string;
  sui_tx_hash?: string;
  settlement_tx_id?: string;
  created_at?: string;
  pay_to?: {
    chain: string;
    amount: string;
    coin_type: string;
    options: OfframpDepositOption[];
  };
}

export interface CreateOfframpOrderInput {
  amount: string;
  token: OfframpToken;
  rate: string;
  rateId?: string;
  reference?: string;
  recipient: {
    institution: string;
    currency: string;
    accountIdentifier: string;
    accountName: string;
    memo?: string;
  };
}

export interface VerifyAccountInput {
  institution: string;
  accountIdentifier: string;
  metadata?: Record<string, unknown>;
}

export interface VerifyAccountResult {
  accountName: string;
}

async function apiGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json.data as T;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json.data as T;
}

export const offrampApi = {
  currencies: () => apiGet<OfframpCurrency[]>("/api/offramp/currencies"),
  institutions: (currency: string) =>
    apiGet<OfframpInstitution[]>(
      `/api/offramp/institutions?currency=${encodeURIComponent(currency)}`,
    ),
  quote: (token: OfframpToken, amount: string, fiat: string) =>
    apiGet<OfframpQuote>(
      `/api/offramp/quote?token=${encodeURIComponent(token)}&amount=${encodeURIComponent(amount)}&fiat=${encodeURIComponent(fiat)}`,
    ),
  verifyAccount: (input: VerifyAccountInput) =>
    apiPost<VerifyAccountResult>("/api/offramp/verify-account", input),
  createOrder: (input: CreateOfframpOrderInput) =>
    apiPost<OfframpOrder>("/api/offramp/orders", input),
  order: (id: string) =>
    apiGet<OfframpOrder>(`/api/offramp/orders/${encodeURIComponent(id)}`),
};

export function primaryReceiveAddress(order: OfframpOrder): OfframpDepositOption | null {
  return (
    order.pay_to?.options.find((option) => option.method === "receive_address" && option.address) ??
    null
  );
}
