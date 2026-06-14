"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PiCheckCircleFill } from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { InputError } from "@/components/ui/InputError";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { IconContactlessCard } from "@/lib/icons";
import {
  deriveLinkingProofs,
  newCardPassword,
  newRotationToken,
  randomBytes,
  uidHash,
} from "@/lib/cardCrypto";
import {
  packCardPayload,
  readCardPayload,
  webNfcSupported,
  writeCardPayload,
} from "@/lib/webnfc";
import { useLinkStore } from "@/lib/cardLinkStore";

/** Constant-time-ish byte compare for the write read-back verification. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export default function LinkWritePage() {
  return (
    <Suspense fallback={<Screen centered />}>
      <Body />
    </Suspense>
  );
}

type Phase = "ready" | "writing" | "done" | "error";

function Body() {
  const router = useRouter();
  const params = useSearchParams();
  const cardId = params.get("card");

  const pin = useLinkStore((s) => s.pin);
  const setCryptoMaterial = useLinkStore((s) => s.setCryptoMaterial);
  const setCardUidHash = useLinkStore((s) => s.setCardUidHash);

  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cardId || !pin) router.replace("/");
  }, [cardId, pin, router]);

  async function startWrite() {
    if (!pin) return;
    setError(null);
    setPhase("writing");

    try {
      if (!webNfcSupported()) {
        throw new Error(
          "Web NFC isn't available — open this page in Chrome on Android.",
        );
      }

      const K = randomBytes(32);
      const rotationToken = newRotationToken();
      const cardPassword = newCardPassword();
      const { linkingProof, pinVerifier } = deriveLinkingProofs(K, pin);
      const payload = packCardPayload(K, rotationToken);

      await writeCardPayload(payload);

      // Verify the write actually persisted BEFORE anything downstream funds
      // the card. Without this, a card can end up funded + "live" while the
      // chip is physically blank — which is exactly why the merchant couldn't
      // read it. Read the card back and require the exact payload to be there.
      const readback = await readCardPayload();
      if (!sameBytes(readback.payload, payload)) {
        throw new Error(
          "The card didn't store its data — keep it flat against the phone and tap again.",
        );
      }
      const cardUidHash = uidHash(readback.uid);

      setCryptoMaterial({ K, linkingProof, pinVerifier, cardPassword, rotationToken });
      setCardUidHash(cardUidHash);
      setPhase("done");
    } catch (err) {
      setPhase("error");
      setError(err instanceof Error ? err.message : "Could not write to card");
    }
  }

  function next() {
    router.push(`/link/sign?card=${cardId}`);
  }

  return (
    <Screen centered>
      <AnimatedComponent
        variant={slideInOut}
        className="flex flex-col items-center gap-8 text-center"
      >
        {phase === "ready" ? (
          <ReadyState onStart={startWrite} />
        ) : phase === "writing" ? (
          <WritingState />
        ) : phase === "done" ? (
          <DoneState onNext={next} />
        ) : (
          <ErrorState message={error} onRetry={startWrite} />
        )}
      </AnimatedComponent>
    </Screen>
  );
}

function ReadyState({ onStart }: { onStart: () => void }) {
  return (
    <>
      <Icon xml={IconContactlessCard} width={56} height={78} className="opacity-60" />
      <div className="space-y-3">
        <h1 className="text-xl font-medium text-neutral-900 dark:text-white">
          Tap your card
        </h1>
        <p className="max-w-xs text-sm text-gray-500 dark:text-white/50">
          Place the card against the back of your phone. We&apos;ll set it up
          in a single tap.
        </p>
      </div>
      <Button onClick={onStart}>Start</Button>
    </>
  );
}

function WritingState() {
  return (
    <>
      <div className="loader" />
      <p className="text-sm text-gray-500 dark:text-white/50">
        Writing to your card — keep it on the phone…
      </p>
    </>
  );
}

function DoneState({ onNext }: { onNext: () => void }) {
  return (
    <>
      <StatusChip tone="success" icon={<PiCheckCircleFill />}>
        Card configured
      </StatusChip>
      <div className="space-y-3">
        <h1 className="text-xl font-medium text-neutral-900 dark:text-white">
          Card configured
        </h1>
        <p className="max-w-xs text-sm text-gray-500 dark:text-white/50">
          Last step — confirm with Google to fund the card on-chain.
        </p>
      </div>
      <Button onClick={onNext}>Continue</Button>
    </>
  );
}

function ErrorState({ message, onRetry }: { message: string | null; onRetry: () => void }) {
  return (
    <>
      <InputError message={message ?? "Something went wrong"} />
      <Button onClick={onRetry}>Try again</Button>
    </>
  );
}
