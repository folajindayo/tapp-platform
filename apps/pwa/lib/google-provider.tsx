"use client";

import { GoogleOAuthProvider } from "@react-oauth/google";
import type { ReactNode } from "react";

/**
 * Wraps the app in @react-oauth/google's provider. Reads the OAuth
 * client ID from `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` at build time.
 *
 * If the env var is empty (e.g. running locally without a Google
 * project set up), we render children without the provider — the
 * sign-in button will surface a clear error at click time rather
 * than failing silently at module load.
 */
export function GoogleProvider({ children }: { children: ReactNode }) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return <>{children}</>;
  return (
    <GoogleOAuthProvider clientId={clientId}>{children}</GoogleOAuthProvider>
  );
}
