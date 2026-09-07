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
import { linkApi, ApiError } from "@/lib/api";
import { useSession } from "@/lib/auth";
import { bytesToHex, hexToBytes } from "@/lib/cardCrypto";

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
  const sessionId = params.get("session");
  const { session } = useSession();

  const pin = useLinkStore((s) => s.pin);
  const dailyLimitSubunit = useLinkStore((s) => s.dailyLimitSubunit);
  const perTapLimitSubunit = useLinkStore((s) => s.perTapLimitSubunit);
  const stepUpThresholdSubunit = useLinkStore((s) => s.stepUpThresholdSubunit);
  const setCryptoMaterial = useLinkStore((s) => s.setCryptoMaterial);
  const setCardUidHash = useLinkStore((s) => s.setCardUidHash);
  const setRotationToken = useLinkStore((s) => s.setRotationToken);

  const [phase, setPhase] = useState<Phase>("ready");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cardId || !pin) router.replace("/");
  }, [cardId, pin, router]);

  async function startWrite() {
    if (!pin || !sessionId || !session) return;
    setError(null);
    setPhase("writing");

    try {
      if (!webNfcSupported()) {
        throw new Error(
          "Web NFC isn't available — open this page in Chrome on Android.",
        );
      }

      const K = randomBytes(32);
      const cardPassword = newCardPassword();
      const { linkingProof, pinVerifier } = deriveLinkingProofs(K, pin);

      // Ask the server for the token to write. It is issued server-side, not
      // generated here: it is the value every later tap is checked against,
      // and client entropy is the weaker source. Asking again after a dropped
      // connection returns the SAME token, so a retry cannot leave two
      // different values on one chip.
      const provisioned = await linkApi.provision(
        sessionId,
        {
          pin_anchor: bytesToHex(linkingProof),
          per_tap_limit: (perTapLimitSubunit / 100).toFixed(2),
          step_up_limit: (stepUpThresholdSubunit / 100).toFixed(2),
          daily_limit: (dailyLimitSubunit / 100).toFixed(2),
        },
        session.jwt,
      );
      if (!provisioned.writeToken) {
        throw new Error("The server did not return a token to write.");
      }
      const rotationToken = hexToBytes(provisioned.writeToken);
      const payload = packCardPayload(K, rotationToken);

      await writeCardPayload(payload);

      // Verify the write actually persisted before the card is activated.
      // Without this a card can go "live" while the chip is physically blank,
      // which is exactly why a merchant could not read it — and the place that
      // is discovered is a checkout counter.
      const readback = await readCardPayload();
      if (!sameBytes(readback.payload, payload)) {
        throw new Error(
          "The card didn't store its data — keep it flat against the phone and tap again.",
        );
      }

      setCryptoMaterial({ K, linkingProof, pinVerifier, cardPassword });
      setCardUidHash(uidHash(readback.uid));
      setRotationToken(rotationToken);
      setPhase("done");
    } catch (err) {
      setPhase("error");
      const msg =
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not write to card";
      setError(msg);
    }
  }

  function next() {
    router.push(`/link/sign?session=${sessionId}&card=${cardId}`);
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
          Last step — confirm to activate your card.
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
