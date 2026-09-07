/**
 * The transport every API module shares.
 *
 * One place that knows the base URL, the response envelope, and what to do
 * about a 401. The predecessor had three hand-rolled clients across `api.ts`,
 * `auth.tsx` and `wallet.ts`, each with its own `API_BASE` and its own
 * refresh-and-retry -- which meant an expired token surfaced to the user from
 * whichever of the three had not been updated.
 */

import { refreshAccessToken, formatApiErrorMessage } from "../auth";

/**
 * Where the API lives. Required.
 *
 * The predecessor defaulted to http://localhost:8000 when the variable was
 * unset. In a browser bundle that is not a helpful default: it ships a build
 * whose every request goes to a machine the user does not have, and the
 * failure reads as "the network is down" rather than "this was built without
 * an API URL". Missing configuration should be obvious at the first request,
 * so it is named here instead of guessed at.
 */
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL;

function baseUrl(): string {
  if (!API_BASE) {
    throw new ApiError(
      0,
      "This app was built without NEXT_PUBLIC_API_BASE_URL set, so it does not know where the API is.",
      "api_base_url_missing",
    );
  }
  return API_BASE;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly data?: unknown;

  constructor(status: number, message: string, code?: string, data?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

interface RailsEnvelope<T> {
  status: "success" | "error";
  message: string;
  data?: T;
}

interface RequestOptions {
  body?: unknown;
  token?: string;
  signal?: AbortSignal;
}

export async function request<T>(
  method: string,
  path: string,
  { body, token, signal }: RequestOptions = {},
  retried = false,
): Promise<T> {
  const headers: Record<string, string> = {
    "ngrok-skip-browser-warning": "1",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${baseUrl()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  const json = (await res.json().catch(() => ({}))) as RailsEnvelope<T>;

  if (!res.ok || json.status === "error") {
    // The rails access JWT lives ~15 min. On a 401, silently refresh it
    // (rotating the refresh token) and retry the request once with the
    // fresh token, so an expired access token never surfaces to the user.
    if (res.status === 401 && token && !retried && !path.startsWith("/v1/auth/")) {
      const fresh = await refreshAccessToken(token);
      if (fresh) {
        return request<T>(method, path, { body, token: fresh, signal }, true);
      }
    }
    const rawMsg = formatApiErrorMessage(json, `Request failed (${res.status})`);
    throw new ApiError(
      res.status,
      rawMsg,
      typeof json.data === "object" && json.data !== null && "code" in (json.data as Record<string, unknown>)
        ? String((json.data as Record<string, unknown>).code)
        : undefined,
      json.data,
    );
  }

  return json.data as T;
}
