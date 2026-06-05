import axios, {
  type AxiosError,
  type AxiosRequestConfig,
  type InternalAxiosRequestConfig,
} from "axios";
import { API_BASE_URL } from "./config";
import { getAccessToken, getRefreshToken, getUser, setTokens } from "./storage";
import type { ApiError, AuthTokens } from "./types";

declare module "axios" {
  export interface AxiosRequestConfig {
    scope?: string;
  }
  export interface InternalAxiosRequestConfig {
    scope?: string;
  }
}

// Every API response is wrapped in this envelope.
interface ApiEnvelope<T> {
  status: "success" | "error";
  message: string;
  data: T;
}

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 30_000,
  headers: { "X-Client": "tapp-merchant" },
});

// Public paths that must never carry an Authorization header.
const PUBLIC_PATHS = new Set([
  "/v1/auth/register",
  "/v1/auth/login",
  "/v1/auth/refresh",
  "/v1/auth/confirm-account",
  "/v1/auth/resend-token",
  "/v1/auth/reset-password-token",
  "/v1/auth/reset-password",
]);

// --- Attach JWT to every outbound request (except public paths) ---
http.interceptors.request.use((config) => {
  const path = config.url ?? "";
  if (PUBLIC_PATHS.has(path)) {
    // Public paths take no Authorization header. Rails' previous
    // `OnlyWebMiddleware` gate has been retired; no Client-Type spoof
    // needed.
    return config;
  }

  const token = getAccessToken();

  if (__DEV__) {
    console.log(
      `[API →] ${config.method?.toUpperCase()} ${path} | token: ${token ? `${token.slice(0, 12)}…` : "MISSING"}`,
    );
  }

  if (token) {
    config.headers.set("Authorization", `Bearer ${token}`);
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
      .post<ApiEnvelope<AuthTokens>>(`${API_BASE_URL}/v1/auth/refresh`, {
        refreshToken: refresh,
      })
      .then((res) => {
        const tokens = res.data.data;
        // user is not in the refresh response; keep whatever is stored
        setTokens(tokens.accessToken, tokens.refreshToken, getUser());
        return tokens.accessToken;
      })
      .catch(() => {
        // Refresh failed. Only sign out if the access token is truly gone
        // (i.e. don't nuke a working session just because one endpoint
        // returns 401 for non-expiry reasons — e.g. scope mismatch).
        const current = getAccessToken();
        if (!current) {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { useAuthStore } =
            require("@/auth/store") as typeof import("@/auth/store");
          useAuthStore.getState().signOut();
        }
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
    const original = error.config as
      | (InternalAxiosRequestConfig & { _retry?: boolean })
      | undefined;

    // Only attempt a refresh when the 401 is likely due to an expired
    // access token (i.e. the token was present but the server rejected it).
    // Skip the refresh dance entirely when:
    //   • the request already retried once (_retry flag), OR
    //   • the error body says "Invalid API key" — this means the endpoint
    //     rejects the token for non-expiry reasons (scope, backend config).
    if (error.response?.status === 401 && original && !original._retry) {
      const body = error.response.data as ApiEnvelope<unknown> | undefined;
      const msg = body?.message ?? "";

      // "Invalid API key or token" or missing sender profile means the backend
      // rejected the token for reasons other than expiry — don't try to refresh,
      // just let the error propagate to the caller (react-query will handle it).
      if (msg.includes("Invalid API key") || msg.includes("Sender profile required")) {
        return Promise.reject(error);
      }

      original._retry = true;
      const next = await refreshAccessToken();
      if (next) {
        original.headers.set("Authorization", `Bearer ${next}`);
        return http.request(original);
      }
    }
    return Promise.reject(error);
  },
);

// --- Helpers ---

export function normalizeError(err: unknown): ApiError {
  const ax = err as AxiosError<
    ApiEnvelope<{ code?: string; detail?: string } | string>
  >;

  if (__DEV__ && ax?.response) {
    console.error(
      `[API ✗] ${ax.config?.method?.toUpperCase()} ${ax.config?.baseURL ?? ""}${ax.config?.url ?? ""} → ${ax.response.status}`,
      JSON.stringify(ax.response.data, null, 2),
    );
  }

  const body = ax?.response?.data;
  if (body) {
    const message = body.message ?? "Something went wrong.";
    const errorData =
      typeof body.data === "object" && body.data !== null ? body.data : {};
    const code =
      (errorData as { code?: string }).code ??
      `HTTP_${ax.response?.status ?? 0}`;
    return { code, message };
  }

  if (ax?.message) return { code: "NETWORK_ERROR", message: ax.message };
  return { code: "UNKNOWN", message: "Something went wrong." };
}

// Unwraps the { status, message, data } envelope the API puts around
// every successful response, so callers get the payload directly.
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  if (__DEV__) {
    console.log(
      `[API →] ${config.method?.toUpperCase()} ${config.url}`,
      config.data ? JSON.stringify(config.data, null, 2) : "(no body)",
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
