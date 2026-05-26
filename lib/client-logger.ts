"use client";

export type ClientLogLevel = "debug" | "info" | "warn" | "error";

export interface ClientLogEntry {
  ts: string;
  level: ClientLogLevel;
  flow: string;
  event: string;
  meta?: Record<string, any>;
}

export const clientLogger = {
  log(level: ClientLogLevel, flow: string, event: string, meta?: Record<string, any>) {
    const entry: ClientLogEntry = {
      ts: new Date().toISOString(),
      level,
      flow,
      event,
      meta,
    };
    
    const prefix = `[${entry.flow}] [${entry.level.toUpperCase()}] ${entry.event}`;
    
    if (level === "error") {
      console.error(prefix, meta ?? "");
    } else if (level === "warn") {
      console.warn(prefix, meta ?? "");
    } else {
      console.log(prefix, meta ?? "");
    }
  },
  
  debug(flow: string, event: string, meta?: Record<string, any>) {
    this.log("debug", flow, event, meta);
  },
  
  info(flow: string, event: string, meta?: Record<string, any>) {
    this.log("info", flow, event, meta);
  },
  
  warn(flow: string, event: string, meta?: Record<string, any>) {
    this.log("warn", flow, event, meta);
  },
  
  error(flow: string, event: string, meta?: Record<string, any>) {
    this.log("error", flow, event, meta);
  }
};
