"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PiShieldCheckFill } from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { IconSuccessBadge } from "@/lib/icons";
import { GoogleSignInButton } from "@/components/GoogleSignInButton";
import { useSession } from "@/lib/auth";
import { cardsApi, ApiError } from "@/lib/api";
import {
  AnimatedComponent,
  fadeInOut,
  slideInOut,
} from "@/components/ui/AnimatedComponents";

export default function LinkPage() {
  return (
    <Suspense fallback={<Screen centered><div /></Screen>}>
      <LinkPageBody />
    </Suspense>
  );
}

function LinkPageBody() {
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token");
  const { hydrated, session } = useSession();

  if (!token) return <NoTokenState />;
  if (!hydrated) return <LoadingState />;
  if (!session) return <SignInState token={token} />;
  return (
    <ClaimingState
      token={token}
      jwt={session.jwt}
      onDone={(id) => router.replace(`/link/configure?card=${id}`)}
    />
  );
}

function NoTokenState() {
  return (
    <Screen centered>
      <div className="flex flex-col items-center gap-8 text-center">
        <AnimatedComponent variant={slideInOut}>
          <div className="space-y-3">
            <h1 className="text-xl font-medium text-neutral-900 dark:text-white">
              No card detected
            </h1>
            <p className="text-sm text-gray-500 dark:text-white/50">
              Tap a Tapp card on the back of your phone to get started.
            </p>
          </div>
        </AnimatedComponent>
      </div>
    </Screen>
  );
}

function LoadingState() {
  return (
    <Screen centered>
      <div className="loader" />
    </Screen>
  );
}

function SignInState({ token }: { token: string }) {
  // Sign in inline on this page — clicking Google goes straight to OAuth and
  // returns here to claim the card. No bounce to a separate /sign-in screen.
  const nextHref = `/link?token=${encodeURIComponent(token)}`;
  return (
    <Screen centered>
      <div className="flex flex-col items-center gap-8 text-center">
        <div className="space-y-3">
          <h1 className="text-xl font-medium text-neutral-900 dark:text-white">
            You tapped a new card
          </h1>
          <p className="text-sm text-gray-500 dark:text-white/50">
            Sign in with Google to claim it as yours.
          </p>
        </div>
        <GoogleSignInButton nextHref={nextHref} />
        <p className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-white/50">
          <PiShieldCheckFill className="text-blue-500" />
          This link works once. No one else can claim it after you.
        </p>
      </div>
    </Screen>
  );
}

function ClaimingState({
  token,
  jwt,
  onDone,
}: {
  token: string;
  jwt: string;
  onDone: (cardId: string) => void;
}) {
  const [status, setStatus] = useState<"claiming" | "error" | "already-yours">(
    "claiming",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function go() {
      try {
        const res = await cardsApi.claim(token, jwt);
        if (cancelled) return;
        onDone(res.card_id);
      } catch (err) {
        if (cancelled) return;
        if (
          err instanceof ApiError &&
          (err.code === "card_already_claimed_by_you" ||
            err.code === "card_already_live")
        ) {
          // Same card re-tapped, or a new card while they already have a live
          // one — either way, send them to the card they have.
          setStatus("already-yours");
          return;
        }
        setStatus("error");
        setError(err instanceof Error ? err.message : "Could not claim this card");
      }
    }
    void go();
    return () => {
      cancelled = true;
    };
  }, [token, jwt, onDone]);

  if (status === "claiming") {
    return (
      <Screen centered>
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="loader" />
          <p className="text-sm text-gray-500 dark:text-white/50">
            Claiming your card…
          </p>
        </div>
      </Screen>
    );
  }

  if (status === "already-yours") {
    return (
      <Screen centered>
        <div className="flex flex-col items-center gap-6 text-center">
          <Icon xml={IconSuccessBadge} size={84} />
          <p className="text-sm text-neutral-900 dark:text-white">
            This card is already linked to your account.
          </p>
          <a href="/" className="w-full">
            <Button variant="secondary">Go to wallet</Button>
          </a>
        </div>
      </Screen>
    );
  }

  return (
    <Screen centered>
      <div className="flex flex-col items-center gap-6 text-center">
        <h1 className="text-xl font-medium text-neutral-900 dark:text-white">
          Couldn&apos;t claim this card
        </h1>
        <p className="text-sm text-gray-500 dark:text-white/50">{error}</p>
        <a href="/" className="w-full">
          <Button variant="secondary">Go to wallet</Button>
        </a>
      </div>
    </Screen>
  );
}
