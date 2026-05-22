import axios, { type AxiosError, type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import { API_BASE_URL } from './config';
import { clearAuth, getAccessToken, getRefreshToken, setTokens } from './storage';
import type { ApiError, AuthTokens } from './types';

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
  headers: { 'X-Client': 'tapp-merchant' },
});

// --- Attach JWT to every outbound request ---
http.interceptors.request.use((config) => {
  const token = getAccessToken();
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
      .post<AuthTokens>(`${API_BASE_URL}/v1/auth/refresh`, { refresh_token: refresh })
      .then((res) => {
        setTokens(res.data.access_token, res.data.refresh_token, res.data.user);
        return res.data.access_token;
      })
      .catch(() => {
        clearAuth();
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
  async (error: AxiosError<{ error?: ApiError }>) => {
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
  const ax = err as AxiosError<{ error?: ApiError }>;
  if (ax?.response?.data?.error) return ax.response.data.error;
  if (ax?.message) {
    return { code: 'NETWORK_ERROR', message: ax.message };
  }
  return { code: 'UNKNOWN', message: 'Something went wrong.' };
}

export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  try {
    const res = await http.request<T>(config);
    return res.data;
  } catch (err) {
    throw normalizeError(err);
  }
}

export { http };
