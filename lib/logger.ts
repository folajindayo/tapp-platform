// Structured logging with per-request correlation IDs.
//
// Designed to be drop-in upgradable to Sentry / Datadog / Logflare
// later — the surface (`logger.info`, `.warn`, `.error`) and shape
// (JSON with `reqId`, `event`, `meta`) stays the same; only the
// underlying sink changes.

import { randomUUID } from "crypto";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  reqId?: string;
  event: string;
  meta?: Record<string, unknown>;
}

export interface RequestContext {
  reqId: string;
  /** Rails user id from the verified JWT, if the route is auth'd. */
  userId?: string;
}

function emit(entry: LogEntry): void {
  // Single JSON line so log aggregators can parse it without
  // multiline glue. console.* writes to stdout/stderr which Vercel,
  // Fly, Railway, and Docker all capture without extra config.
  const line = JSON.stringify(entry);
  if (entry.level === "error") console.error(line);
  else if (entry.level === "warn") console.warn(line);
  else console.log(line);
}

export function newRequestContext(): RequestContext {
  return { reqId: randomUUID() };
}

export const logger = {
  debug(event: string, ctx?: Partial<RequestContext>, meta?: Record<string, unknown>): void {
    emit({
      ts: new Date().toISOString(),
      level: "debug",
      reqId: ctx?.reqId,
      event,
      meta: combine(ctx, meta),
    });
  },
  info(event: string, ctx?: Partial<RequestContext>, meta?: Record<string, unknown>): void {
    emit({
      ts: new Date().toISOString(),
      level: "info",
      reqId: ctx?.reqId,
      event,
      meta: combine(ctx, meta),
    });
  },
  warn(event: string, ctx?: Partial<RequestContext>, meta?: Record<string, unknown>): void {
    emit({
      ts: new Date().toISOString(),
      level: "warn",
      reqId: ctx?.reqId,
      event,
      meta: combine(ctx, meta),
    });
  },
  error(event: string, ctx?: Partial<RequestContext>, meta?: Record<string, unknown>): void {
    emit({
      ts: new Date().toISOString(),
      level: "error",
      reqId: ctx?.reqId,
      event,
      meta: combine(ctx, meta),
    });
  },
};

function combine(
  ctx: Partial<RequestContext> | undefined,
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!ctx?.userId && !meta) return undefined;
  return { ...(ctx?.userId ? { userId: ctx.userId } : {}), ...meta };
}
