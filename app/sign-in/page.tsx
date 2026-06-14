"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Screen } from "@/components/ui/Screen";
import {
  GoogleSignInButton,
  takeNextHref,
} from "@/components/GoogleSignInButton";
import { useSession, completeAuth } from "@/lib/auth";
import { InputError } from "@/components/ui/InputError";
import {
  AnimatedComponent,
  slideInOut,
  fadeInOut,
} from "@/components/ui/AnimatedComponents";
import { parseGoogleAuthFragment } from "@/lib/google-oauth";

export default function SignInPage() {
  return (
    <Suspense fallback={<Screen centered />}>
      <SignInBody />
    </Suspense>
  );
}

function SignInBody() {
  const router = useRouter();
  const params = useSearchParams();
  const nextHref = params.get("next") ?? "/";
  const emailHint = params.get("email") ?? undefined;
  const { hydrated, session, login } = useSession();
  

  const [callbackError, setCallbackError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const { idToken, error } = parseGoogleAuthFragment(window.location.hash);
    if (error) {
      setCallbackError(error);
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
      return;
    }
    if (!idToken) return;
    setCompleting(true);
    window.history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    (async () => {
      try {
        const session = await completeAuth(idToken);
        login(session);
        const target = takeNextHref() ?? nextHref;
        router.replace(target);
      } catch (err) {
        setCallbackError(
          err instanceof Error ? err.message : "Sign-in failed",
        );
        setCompleting(false);
      }
    })();
  }, [login, router, nextHref]);

  if (hydrated && session && !completing) {
    router.replace(nextHref);
    return null;
  }

  if (completing) {
    return (
      <Screen centered>
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="loader" />
          <p className="text-sm text-gray-500 dark:text-white/50">
            Completing sign-in…
          </p>
        </div>
      </Screen>
    );
  }

  return (
    <Screen centered>
      <div className="flex flex-col items-center gap-8 text-center">
        <AnimatedComponent variant={slideInOut}>
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-900 dark:text-white">
            Tap. Pay. Done.
          </h1>
        </AnimatedComponent>

        <AnimatedComponent
          variant={slideInOut}
          delay={0.15}
          className="w-full space-y-3"
        >
          <GoogleSignInButton nextHref={nextHref} loginHint={emailHint} />
          {callbackError ? <InputError message={callbackError} /> : null}
          <Link
            href="/link"
            className="block text-center text-sm text-gray-500 transition-colors hover:text-neutral-900 dark:text-white/50 dark:hover:text-white"
          >
            I already tapped a card →
          </Link>
          <p className="pt-1 text-center text-[10px] text-gray-400 dark:text-white/30">
            Powered by Sui · zkLogin secured
          </p>
        </AnimatedComponent>
      </div>
    </Screen>
  );
}
