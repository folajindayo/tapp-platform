import { randomUUID } from "crypto";

export const RAILS_B2B_BASE =
  process.env.RAILS_B2B_API_BASE_URL ?? "https://b2b.usetapp.xyz";

interface RailsEnvelope<T> {
  status: "success" | "error";
  message?: string;
  data?: T;
}

export class RailsB2BError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = "RailsB2BError";
    this.status = status;
    this.data = data;
  }
}

function senderApiKey(): string {
  const key = process.env.RAILS_B2B_API_KEY;
  if (!key) {
    throw new RailsB2BError(
      500,
      "Missing RAILS_B2B_API_KEY. Add the sender API key issued by Rails.",
    );
  }
  return key;
}

export async function railsPublicGet<T>(path: string): Promise<T> {
  return railsRequest<T>("GET", path, { authenticated: false });
}

export async function railsSenderGet<T>(path: string): Promise<T> {
  return railsRequest<T>("GET", path, { authenticated: true });
}

export async function railsSenderPost<T>(
  path: string,
  body: unknown,
  idempotencyKey = randomUUID(),
): Promise<T> {
  return railsRequest<T>("POST", path, {
    authenticated: true,
    body,
    idempotencyKey,
  });
}

async function railsRequest<T>(
  method: string,
  path: string,
  opts: {
    authenticated: boolean;
    body?: unknown;
    idempotencyKey?: string;
  },
): Promise<T> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (opts.authenticated) headers["API-Key"] = senderApiKey();
  if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;

  const res = await fetch(`${RAILS_B2B_BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as RailsEnvelope<T>;
  if (!res.ok || json.status === "error") {
    throw new RailsB2BError(
      res.status,
      json.message ?? `Rails B2B request failed (${res.status})`,
      json.data,
    );
  }
  return json.data as T;
}

export function jsonError(error: unknown): Response {
  if (error instanceof RailsB2BError) {
    return Response.json(
      { error: error.message, data: error.data },
      { status: error.status },
    );
  }
  const message = error instanceof Error ? error.message : "Unexpected error";
  return Response.json({ error: message }, { status: 500 });
}
