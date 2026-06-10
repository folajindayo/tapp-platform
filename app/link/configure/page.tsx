"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InputError } from "@/components/ui/InputError";
import { PinInput } from "@/components/ui/PinInput";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import { cardsApi } from "@/lib/api";
import { useLinkStore } from "@/lib/cardLinkStore";
import { formatNgn } from "@/lib/utils";

export default function LinkConfigurePage() {
  return (
    <Suspense fallback={<Screen centered />}>
      <Body />
    </Suspense>
  );
}

const DEFAULTS = {
  dailyNGN:    40_000,
  perTapNGN:   2_000,
  stepUpNGN:   15_000,
  fundingUSDC: 25,
};

function Body() {
  const router = useRouter();
  const params = useSearchParams();
  const cardId = params.get("card");
  const { hydrated, session } = useSession();
  const setCardId = useLinkStore((s) => s.setCardId);
  const setLimits = useLinkStore((s) => s.setLimits);

  const [daily, setDaily] = useState(DEFAULTS.dailyNGN);
  const [perTap, setPerTap] = useState(DEFAULTS.perTapNGN);
  const [stepUp, setStepUp] = useState(DEFAULTS.stepUpNGN);
  const [funding, setFunding] = useState(String(DEFAULTS.fundingUSDC));
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!cardId) router.replace("/wallet");
    if (hydrated && !session)
      router.replace(
        `/sign-in?next=/link/configure?card=${cardId ?? ""}`,
      );
    if (cardId) setCardId(cardId);
  }, [cardId, hydrated, session, router, setCardId]);

  // One card per user: if the holder already has a live card, the link flow
  // is a dead end — bounce them to their card instead of re-showing "set
  // limits" (and never let them fund a second cap).
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    cardsApi
      .me(session.jwt)
      .then((c) => {
        if (!cancelled && c.status === "live" && c.cap_object_id) {
          router.replace("/settings/card");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [session, router]);

  function submit() {
    if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
      setError("PIN must be 4 digits.");
      return;
    }
    if (pin !== pinConfirm) {
      setError("PINs don't match.");
      return;
    }
    if (perTap > stepUp || stepUp > daily) {
      setError("Limits must satisfy: per-tap ≤ step-up ≤ daily.");
      return;
    }
    setError(null);
    setLimits({
      daily:   daily * 100,
      perTap:  perTap * 100,
      stepUp:  stepUp * 100,
      // Funding is USDC (6 decimals), not fiat kobo — scale by 1e6.
      funding: Math.round((parseFloat(funding) || 0) * 1_000_000),
      pin,
    });
    router.push(`/link/write?card=${cardId}`);
  }

  return (
    <Screen>
      <AnimatedComponent variant={slideInOut} className="grid gap-6 py-10 text-sm text-neutral-900 dark:text-white">
        <div className="space-y-2">
          <h1 className="text-xl font-medium">Set your limits</h1>
          <p className="text-sm text-gray-500 dark:text-white/50">
            Step 2 of 4 — choose how much your card can spend.
          </p>
        </div>

        <div className="grid divide-y divide-dashed divide-gray-200 rounded-3xl border border-gray-200 px-4 transition-all dark:divide-white/10 dark:border-white/10">
          <RangeField
            label="Daily limit"
            help="Max total spend per UTC day"
            value={daily}
            onChange={setDaily}
            min={5_000}
            max={200_000}
            step={5_000}
            display={formatNgn(daily)}
          />
          <RangeField
            label="Per-tap limit"
            help="Taps below this need no PIN"
            value={perTap}
            onChange={setPerTap}
            min={500}
            max={5_000}
            step={500}
            display={formatNgn(perTap)}
          />
          <RangeField
            label="Step-up threshold"
            help="Above this needs a biometric on your phone"
            value={stepUp}
            onChange={setStepUp}
            min={5_000}
            max={50_000}
            step={1_000}
            display={formatNgn(stepUp)}
          />
          <div className="grid gap-2 py-4">
            <div className="flex items-baseline justify-between">
              <label htmlFor="funding" className="text-sm font-medium text-neutral-900 dark:text-white">
                Fund with
              </label>
            </div>
            <div className="relative">
              <input
                id="funding"
                type="number"
                inputMode="decimal"
                step="any"
                min="0.01"
                value={funding}
                onChange={(e) => setFunding(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2 pr-16 text-sm tabular-nums text-neutral-900 transition-all placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 dark:border-white/20 dark:bg-neutral-900 dark:text-white/80 dark:placeholder:text-white/30"
              />
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs text-gray-400 dark:text-white/30">
                USDC
              </span>
            </div>
            <p className="text-xs text-gray-400 dark:text-white/40">
              USDC to load now — you can top up later
            </p>
          </div>
        </div>

        <div className="grid gap-4 rounded-3xl border border-gray-200 p-4 dark:border-white/10">
          <PinInput label="Choose a 4-digit PIN" value={pin} onChange={setPin} />
          <PinInput label="Confirm PIN" value={pinConfirm} onChange={setPinConfirm} />
        </div>

        {error ? <InputError message={error} /> : null}

        <Button
          onClick={submit}
          disabled={!funding || parseFloat(funding) <= 0 || isNaN(parseFloat(funding))}
        >
          Continue — tap your card
        </Button>
      </AnimatedComponent>
    </Screen>
  );
}

function RangeField({
  label,
  help,
  value,
  onChange,
  min,
  max,
  step,
  display,
}: {
  label: string;
  help: string;
  value: number;
  onChange: (n: number) => void;
  min: number;
  max: number;
  step: number;
  display: string;
}) {
  return (
    <div className="grid gap-2 py-4">
      <div className="flex items-baseline justify-between">
        <label className="text-sm font-medium text-neutral-900 dark:text-white">
          {label}
        </label>
        <span className="rounded-full bg-gray-50 px-2 py-1 text-xs font-medium tabular-nums text-neutral-900 dark:bg-white/5 dark:text-white/80">
          {display}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-blue-600"
      />
      <p className="text-xs text-gray-400 dark:text-white/40">{help}</p>
    </div>
  );
}
