/*
 * Minimal service worker — enables "Add to Home Screen" installability
 * without any offline caching. Per the architecture spec, every hot
 * path (linking, checkout, resync, step-up) needs the live backend,
 * so an offline shell would only show "you're offline" which the
 * browser already does just fine.
 *
 * Activate immediately on install/upgrade so users get the latest
 * shell on the next open instead of waiting for tabs to close.
 */

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Intentionally no-op — let the browser handle every request.
  // Required for the SW to be "installable" per the PWA manifest spec.
});
