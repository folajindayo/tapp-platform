"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PiCheckCircleFill } from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InputError } from "@/components/ui/InputError";
import { PinInput } from "@/components/ui/PinInput";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import { cardsApi, ApiError } from "@/lib/api";
import {
  bytesToHex,
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

// Re-link: repair path for a card whose NDEF payload was destroyed
// (e.g. a torn token-rotation write at a merchant). Resync can't help
// — it needs K from the card — so we rerun the full link ceremony on
// the SAME chip: fresh K + PIN + token + password, written and
// verified, then registered via /v1/cards/me/relink. The on-chain cap
// and its balance never move; the server accepts the re-provision
// only when the chip's hardware UID matches the live card's.
export default function RelinkPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const [phase, setPhase] = useState<"pin" | "ready" | "writing" | "done" | "error">("pin");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/cards/relink");
  }, [hydrated, session, router]);

  function confirmPin() {
    setError(null);
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      setError("PIN must be 4 digits");
      return;
    }
    if (pin !== pinConfirm) {
      setError("PINs don't match");
      return;
    }
    setPhase("ready");
  }

  async function go() {
    if (!session) return;
    setError(null);
    setPhase("writing");
    try {
      if (!webNfcSupported()) {
        throw new Error(
          "iOS Safari can't write to NFC cards. Borrow an Android phone, or contact support for remote recovery.",
        );
      }

      const K = randomBytes(32);
      const rotationToken = newRotationToken();
      const cardPassword = newCardPassword();
      const { linkingProof, pinVerifier } = deriveLinkingProofs(K, pin);
      const payload = packCardPayload(K, rotationToken);

      await writeCardPayload(payload);

      // Verify the write persisted before registering anything — the
      // torn-write failure mode this page exists for must not recur
      // silently here of all places.
      const readback = await readCardPayload();
      if (
        readback.payload.length !== payload.length ||
        !readback.payload.every((b, i) => b === payload[i])
      ) {
        throw new Error(
          "The card didn't store its data — keep it flat against the phone and try again.",
        );
      }

      await cardsApi.relink(
        {
          card_uid_hash: bytesToHex(uidHash(readback.uid)),
          linking_proof: bytesToHex(linkingProof),
          pin_verifier: bytesToHex(pinVerifier),
          card_password: bytesToHex(cardPassword),
          current_token_ct: bytesToHex(rotationToken),
        },
        session.jwt,
      );
      setPhase("done");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.message}${err.code ? ` (${err.code})` : ""}`
          : err instanceof Error
            ? err.message
            : "Re-link failed";
      setError(msg);
      setPhase("error");
    }
  }

  if (phase === "done") {
    return (
      <Screen centered>
        <div className="flex flex-col items-center gap-6 text-center">
          <StatusChip tone="success" icon={<PiCheckCircleFill />}>
            Card repaired
          </StatusChip>
          <p className="max-w-xs text-sm text-gray-500 dark:text-white/50">
            Your balance and limits are unchanged. Try tapping at a merchant
            again.
          </p>
          <Link href="/settings/card" className="w-full">
            <Button>Done</Button>
          </Link>
        </div>
      </Screen>
    );
  }

  if (phase === "pin") {
    return (
      <Screen centered>
        <AnimatedComponent
          variant={slideInOut}
          className="flex w-full max-w-xs flex-col items-center gap-6 text-center"
        >
          <div className="space-y-3">
            <h1 className="text-xl font-medium text-neutral-900 dark:text-white">
              Repair your card
            </h1>
            <p className="text-sm text-gray-500 dark:text-white/50">
              We&apos;ll rewrite your card&apos;s data from scratch. Your money
              is safe — balance and limits stay exactly as they are. First,
              choose your PIN (the same one is fine).
            </p>
          </div>
          <PinInput label="Choose a 4-digit PIN" value={pin} onChange={setPin} />
          <PinInput label="Confirm PIN" value={pinConfirm} onChange={setPinConfirm} />
          {error ? <InputError message={error} /> : null}
          <Button onClick={confirmPin}>Continue</Button>
          <Link
            href="/settings/card"
            className="text-sm text-gray-500 hover:text-neutral-900 dark:text-white/50 dark:hover:text-white"
          >
            Cancel
          </Link>
        </AnimatedComponent>
      </Screen>
    );
  }

  return (
    <Screen centered>
      <AnimatedComponent
        variant={slideInOut}
        className="flex flex-col items-center gap-6 text-center"
      >
        <div className="space-y-3">
          <h1 className="text-xl font-medium text-neutral-900 dark:text-white">
            Tap your card
          </h1>
          <p className="max-w-xs text-sm text-gray-500 dark:text-white/50">
            Hold the card flat against your phone until we confirm — we write
            and verify in one tap. ~3 seconds.
          </p>
        </div>
        {error ? <InputError message={error} /> : null}
        <Button onClick={go} loading={phase === "writing"}>
          {phase === "error" ? "Try again" : "Start repair"}
        </Button>
        <Link
          href="/settings/card"
          className="text-sm text-gray-500 hover:text-neutral-900 dark:text-white/50 dark:hover:text-white"
        >
          Cancel
        </Link>
      </AnimatedComponent>
    </Screen>
  );
}
