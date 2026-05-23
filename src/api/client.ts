import axios, { type AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from './config';
import { getAccessToken, getRefreshToken, getUser, setTokens } from './storage';
import type { ApiError, AuthTokens } from './types';

// Every API response is wrapped in this envelope.
interface ApiEnvelope<T> {
  status: 'success' | 'error';
  message: string;
  data: T;
}

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
  headers: { 'X-Client': 'tapp-merchant', 'Client-Type': 'web' },
});

// Public paths that must never carry an Authorization header.
const PUBLIC_PATHS = new Set([
  '/v1/auth/register',
  '/v1/auth/login',
  '/v1/auth/refresh',
  '/v1/auth/confirm-account',
  '/v1/auth/resend-token',
  '/v1/auth/reset-password-token',
  '/v1/auth/reset-password',
]);

// --- Attach JWT to every outbound request (except public paths) ---
http.interceptors.request.use((config) => {
  const path = config.url ?? '';
  if (PUBLIC_PATHS.has(path)) return config;

  const token = getAccessToken();

  if (__DEV__) {
    console.log(
      `[API →] ${config.method?.toUpperCase()} ${path} | token: ${token ? `${token.slice(0, 12)}…` : 'MISSING'}`,
    );
  }

  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

// --- 401 → refresh path; single-flight to avoid stampede ---
let refreshInFlight: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  if (!refreshInFlight) {
    refreshInFlight = axios
      .post<ApiEnvelope<AuthTokens>>(`${API_BASE_URL}/v1/auth/refresh`, { refresh_token: refresh })
      .then((res) => {
        const tokens = res.data.data;
        // user is not in the refresh response; keep whatever is stored
        setTokens(tokens.accessToken, tokens.refreshToken, getUser());
        return tokens.accessToken;
      })
      .catch(() => {
        // Token is genuinely invalid — sign out fully (storage + Zustand store).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { useAuthStore } = require('@/auth/store') as typeof import('@/auth/store');
        useAuthStore.getState().signOut();
        return null;
      })
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    if (error.response?.status === 401 && original && !original._retry) {
      original._retry = true;
      const next = await refreshAccessToken();
      if (next) {
        original.headers.set('Authorization', `Bearer ${next}`);
        return http.request(original);
      }
    }
    return Promise.reject(error);
  },
);

// --- Helpers ---

export function normalizeError(err: unknown): ApiError {
  const ax = err as AxiosError<ApiEnvelope<{ code?: string; detail?: string } | string>>;

  if (__DEV__ && ax?.response && ax.response.status !== 404) {
    console.error(
      `[API ✗] ${ax.config?.method?.toUpperCase()} ${ax.config?.url} → ${ax.response.status}`,
      JSON.stringify(ax.response.data, null, 2),
    );
  }

  const body = ax?.response?.data;
  if (body) {
    const message = body.message ?? 'Something went wrong.';
    const errorData = typeof body.data === 'object' && body.data !== null ? body.data : {};
    const code = (errorData as { code?: string }).code ?? `HTTP_${ax.response?.status ?? 0}`;
    return { code, message };
  }

  if (ax?.message) return { code: 'NETWORK_ERROR', message: ax.message };
  return { code: 'UNKNOWN', message: 'Something went wrong.' };
}

// Unwraps the { status, message, data } envelope the API puts around
// every successful response, so callers get the payload directly.
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  if (__DEV__) {
    console.log(
      `[API →] ${config.method?.toUpperCase()} ${config.url}`,
      config.data ? JSON.stringify(config.data, null, 2) : '(no body)',
    );
  }

  try {
    const res = await http.request<ApiEnvelope<T>>(config);

    if (__DEV__) {
      console.log(
        `[API ✓] ${config.method?.toUpperCase()} ${config.url} → 2xx`,
        JSON.stringify(res.data, null, 2),
      );
    }

    return res.data.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

export { http };
