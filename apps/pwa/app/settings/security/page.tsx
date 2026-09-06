"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PiArrowLeftBold, PiCheckCircleFill } from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { PinInput } from "@/components/ui/PinInput";
import { InputError } from "@/components/ui/InputError";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";

export default function SettingsSecurityPage() {
  const router = useRouter();
  const { hydrated, session, clear } = useSession();
  const [current, setCurrent]     = useState("");
  const [next, setNext]           = useState("");
  const [confirm, setConfirm]     = useState("");
  const [error, setError]         = useState<string | null>(null);
  const [saved, setSaved]         = useState(false);

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/settings/security");
  }, [hydrated, session, router]);

  function save() {
    if (current.length !== 4 || next.length !== 4) {
      setError("Both PINs must be 4 digits.");
      return;
    }
    if (next !== confirm) {
      setError("New PINs don't match.");
      return;
    }
    setError(null);
    // TODO: PATCH /v1/cards/me/pin once Rails endpoint lands.
    setSaved(true);
    setCurrent("");
    setNext("");
    setConfirm("");
    setTimeout(() => setSaved(false), 1500);
  }

  if (!hydrated || !session) return <Screen />;

  return (
    <Screen>
      <AnimatedComponent
        variant={slideInOut}
        className="grid gap-6 py-10 text-sm text-neutral-900 dark:text-white"
      >
        <Link
          href="/settings"
          className="inline-flex w-fit items-center gap-1 text-xs font-medium text-gray-500 transition-colors hover:text-neutral-900 dark:text-white/50 dark:hover:text-white"
        >
          <PiArrowLeftBold /> Back to settings
        </Link>

        <div className="space-y-2">
          <h1 className="text-xl font-medium">Security</h1>
          <p className="text-sm text-gray-500 dark:text-white/50">
            Change your card PIN or sign out of this device.
          </p>
        </div>

        <div className="grid gap-4 rounded-3xl border border-gray-200 p-4 dark:border-white/10">
          <h2 className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-white/30">
            Change PIN
          </h2>
          <PinInput label="Current PIN" value={current} onChange={setCurrent} />
          <PinInput label="New PIN" value={next} onChange={setNext} />
          <PinInput label="Confirm new PIN" value={confirm} onChange={setConfirm} />
          {error ? <InputError message={error} /> : null}
          {saved ? (
            <StatusChip tone="success" icon={<PiCheckCircleFill />}>
              Saved (offline — backend endpoint coming)
            </StatusChip>
          ) : null}
          <Button onClick={save}>Save PIN</Button>
        </div>

        <div className="grid gap-3 rounded-3xl border border-gray-200 p-4 dark:border-white/10">
          <h2 className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-white/30">
            Session
          </h2>
          <p className="text-sm text-gray-500 dark:text-white/50">
            You&apos;re signed in as <span className="font-medium text-neutral-900 dark:text-white">{session.email}</span>.
          </p>
          <Button variant="danger" onClick={clear}>
            Sign out
          </Button>
        </div>
      </AnimatedComponent>
    </Screen>
  );
}
