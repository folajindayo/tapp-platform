"use client";

import { useEffect } from "react";

/**
 * Mounts in the root layout and registers `/sw.js` once on the
 * client. Failures are non-fatal — PWA install is a progressive
 * enhancement, not a requirement for the app to work.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // No-op — best-effort.
    });
  }, []);
  return null;
}
