"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { IconGoogle } from "@/lib/icons";
import {
  buildGoogleAuthUrl,
  defaultRedirectUri,
} from "@/lib/google-oauth";
import { startZkLoginSession } from "@/lib/zklogin";

interface Props {
  /** Where to bounce back to after the post-callback completion. */
  nextHref?: string;
  label?: string;
  loginHint?: string;
}

const NEXT_STORAGE_KEY = "tapp.signin.next.v1";

/**
 * Kicks off the manual Google OAuth implicit-flow redirect with the
 * zkLogin nonce attached. The callback is handled in
 * `app/sign-in/page.tsx` — see `completeAuth` in `lib/auth.ts`.
 *
 * If `NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID` isn't set, we surface a
 * clear error rather than silently failing.
 */
export function GoogleSignInButton({
  nextHref = "/wallet",
  label = "Continue with Google",
  loginHint,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) {
      setError(
        "Google sign-in isn't configured. Set NEXT_PUBLIC_GOOGLE_OAUTH_CLIENT_ID and reload.",
      );
      return;
    }
    setError(null);
    setLoading(true);
    try {
      // Bootstrap a zkLogin session — ephemeral keypair, randomness,
      // nonce. Persisted in localStorage so the OAuth callback can pick
      // it up after Google redirects back.
      const { nonce } = await startZkLoginSession();
      const redirectUri = defaultRedirectUri();
      window.localStorage.setItem(NEXT_STORAGE_KEY, nextHref);
      window.location.assign(
        buildGoogleAuthUrl({ clientId, redirectUri, nonce, loginHint }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start sign-in");
      setLoading(false);
    }
  }

  return (
    <div className="w-fit mx-auto space-y-3">
      <Button
        variant="secondary"
        loading={loading}
        onClick={start}
        className="px-6"
        leadingIcon={
          <Icon xml={IconGoogle} size={20} />
        }
      >
        {label}
      </Button>
      {error ? (
        <p
          className="text-center text-sm text-red-600 dark:text-red-400"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Read + clear the "next" href stored before the OAuth redirect. */
export function takeNextHref(): string | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(NEXT_STORAGE_KEY);
  if (v) window.localStorage.removeItem(NEXT_STORAGE_KEY);
  return v;
}
