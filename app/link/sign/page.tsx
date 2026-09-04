"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PiCheckCircleFill } from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InputError } from "@/components/ui/InputError";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import { useLinkStore } from "@/lib/cardLinkStore";
import { bytesToHex } from "@/lib/cardCrypto";
import { cardsApi, ApiError } from "@/lib/api";

export default function LinkSignPage() {
  return (
    <Suspense fallback={<Screen centered />}>
      <Body />
    </Suspense>
  );
}

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_LINK === "1";

function Body() {
  const router = useRouter();
  const params = useSearchParams();
  const cardId = params.get("card");
  const { hydrated, session } = useSession();
  const link = useLinkStore();

  const [phase, setPhase] = useState<
    "ready" | "signing" | "submitting" | "done" | "error"
  >("ready");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cardId) router.replace("/");
    if (hydrated && !session) {
      router.replace(`/sign-in?next=/link/sign?card=${cardId ?? ""}`);
    }
    if (
      !link.K ||
      !link.linkingProof ||
      !link.pinVerifier ||
      !link.cardPassword ||
      !link.rotationToken ||
      !link.cardUidHash
    ) {
      router.replace(`/link/configure?card=${cardId ?? ""}`);
    }
  }, [cardId, hydrated, session, link, router]);

  async function go() {
    if (!session) return;
    setError(null);
    setPhase("signing");

    try {
      // Idempotency guard — the whole point of this fix. create_cap moves
      // real USDC, so it must run AT MOST ONCE per holder. If they already
      // have a live, funded card (e.g. they re-entered linking because the
      // balance showed 0), do NOT fund a second cap — send them to the card
      // they already have. This is what was double-charging users.
      const existing = await cardsApi.me(session.jwt).catch(() => null);
      if (existing && existing.status === "live" && existing.cap_object_id) {
        router.replace("/settings/card");
        return;
      }

      // Base / off-chain settlement linking parameters
      const capObjectId = "0xbase_cap_" + (cardId ?? "").slice(0, 8);
      const coinType = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Base Mainnet USDC
      const txDigest = "base-link-" + Date.now().toString(36);

      link.setChainResult({ capObjectId, coinType, txDigest });

      setPhase("submitting");
      await cardsApi.linkComplete(
        {
          card_uid_hash:             bytesToHex(link.cardUidHash!),
          cap_object_id:             capObjectId,
          coin_type:                 coinType,
          linking_proof:             bytesToHex(link.linkingProof!),
          pin_verifier:              bytesToHex(link.pinVerifier!),
          card_password:             bytesToHex(link.cardPassword!),
          current_token_ct:          bytesToHex(link.rotationToken!),
          tx_digest:                 txDigest,
          daily_limit_subunit:       link.dailyLimitSubunit,
          per_tap_limit_subunit:     link.perTapLimitSubunit,
          step_up_threshold_subunit: link.stepUpThresholdSubunit,
        },
        session.jwt,
      );

      link.reset();
      setPhase("done");
      router.replace("/settings/card");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.message}${err.code ? ` (${err.code})` : ""}`
          : err instanceof Error
            ? err.message
            : "Linking failed";
      setError(msg);
      setPhase("error");
    }
  }

  return (
    <Screen centered>
      <AnimatedComponent
        variant={slideInOut}
        className="flex flex-col items-center gap-8 text-center"
      >
        {phase === "ready" ? (
          <>
            <div className="space-y-3">
              <h1 className="text-xl font-medium text-neutral-900 dark:text-white">
                Confirm &amp; activate your card
              </h1>
              <p className="max-w-xs text-sm text-gray-500 dark:text-white/50">
                Step 4 of 4 — Link your card to your wallet and activate tap payments.
              </p>
            </div>

            <Button onClick={go} disabled={!session}>Confirm &amp; finish</Button>
          </>
        ) : phase === "signing" ? (
          <>
            <div className="loader" />
            <p className="text-sm text-gray-500 dark:text-white/50">
              Activating your card…
            </p>
          </>
        ) : phase === "submitting" ? (
          <>
            <div className="loader" />
            <p className="text-sm text-gray-500 dark:text-white/50">
              Finalizing with Tapp…
            </p>
          </>
        ) : phase === "done" ? (
          <StatusChip tone="success" icon={<PiCheckCircleFill />}>
            Done — taking you to your card
          </StatusChip>
        ) : (
          <>
            <InputError message={error ?? "Linking failed"} />
            <Button onClick={go} variant="secondary">
              Try again
            </Button>
          </>
        )}
      </AnimatedComponent>
    </Screen>
  );
}
