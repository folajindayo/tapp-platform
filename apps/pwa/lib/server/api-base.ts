/**
 * Where the API lives, for the route handlers that run on the server and
 * proxy to it (card issuing, gas sponsorship, order streams).
 *
 * Read per request rather than at module load, so a deployment that is
 * missing the variable answers every call with a clear 503 instead of
 * whatever a build-time default pointed at. Earlier revisions fell back to
 * http://localhost:8000, which on a server meant "a machine that is not
 * there" and surfaced as an opaque fetch failure.
 *
 * The browser bundle has its own copy of this rule in lib/api/http.ts.
 */
export function apiBase(): string | null {
  const base = process.env.NEXT_PUBLIC_API_BASE_URL;
  return base ? base.replace(/\/+$/, "") : null;
}

/** The response every proxy route returns when apiBase() is null. */
export function apiNotConfigured(): Response {
  return Response.json(
    { error: "This deployment was built without NEXT_PUBLIC_API_BASE_URL, so it does not know where the API is." },
    { status: 503 },
  );
}
