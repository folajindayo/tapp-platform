"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PiWarningOctagon, PiCheckCircleFill } from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InputError } from "@/components/ui/InputError";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import { cardsApi, ApiError } from "@/lib/api";

export default function RevokePage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const [phase, setPhase] = useState<"confirm" | "signing" | "done" | "error">("confirm");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/cards/revoke");
  }, [hydrated, session, router]);

  async function go() {
    if (!session) return;
    setError(null);
    setPhase("signing");
    try {
      const skeleton = await cardsApi.revoke(session.jwt);
      console.info("Revoke PTB skeleton (sign + submit):", skeleton);
      setPhase("done");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.message}${err.code ? ` (${err.code})` : ""}`
          : err instanceof Error
            ? err.message
            : "Revoke failed";
      setError(msg);
      setPhase("error");
    }
  }

  if (phase === "done") {
    return (
      <Screen centered>
        <div className="flex flex-col items-center gap-6 text-center">
          <StatusChip tone="success" icon={<PiCheckCircleFill />}>
            Card revoked
          </StatusChip>
          <p className="max-w-xs text-sm text-gray-500 dark:text-white/50">
            No more taps will be charged.
          </p>
          <Link href="/settings/card" className="w-full">
            <Button>Back to settings</Button>
          </Link>
        </div>
      </Screen>
    );
  }

  return (
    <Screen centered>
      <AnimatedComponent
        variant={slideInOut}
        className="flex flex-col items-center gap-6 text-center"
      >
        <PiWarningOctagon className="text-4xl text-rose-500" />
        <div className="space-y-3">
          <h1 className="text-xl font-medium text-neutral-900 dark:text-white">
            Revoke this card?
          </h1>
          <p className="max-w-xs text-sm text-gray-500 dark:text-white/50">
            Merchants won&apos;t be able to debit it. You can re-enable it from
            the dashboard, or destroy it later to reclaim the balance.
          </p>
        </div>
        {error ? <InputError message={error} /> : null}
        <Button variant="danger" onClick={go} loading={phase === "signing"}>
          Revoke
        </Button>
        <Link
          href="/settings/card"
          className="text-sm text-gray-500 hover:text-neutral-900 dark:text-white/50 dark:hover:text-white"
        >
          Keep card active
        </Link>
      </AnimatedComponent>
    </Screen>
  );
}
