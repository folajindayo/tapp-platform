"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PiArrowLeftBold, PiCheckCircleFill } from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InputError } from "@/components/ui/InputError";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import { cardsApi } from "@/lib/api";
import { formatNgn } from "@/lib/utils";

export default function SettingsLimitsPage() {
  const router = useRouter();
  const qc = useQueryClient();
  const { hydrated, session } = useSession();

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/settings/limits");
  }, [hydrated, session, router]);

  const card = useQuery({
    queryKey: ["cards", "me"],
    queryFn:  () => cardsApi.me(session!.jwt),
    enabled:  !!session,
    retry:    false,
  });

  const [daily, setDaily]   = useState<number | null>(null);
  const [perTap, setPerTap] = useState<number | null>(null);
  const [stepUp, setStepUp] = useState<number | null>(null);
  const [saved, setSaved]   = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    if (card.data && daily === null) {
      setDaily(card.data.daily_limit_subunit / 100);
      setPerTap(card.data.per_tap_limit_subunit / 100);
      setStepUp(card.data.step_up_threshold_subunit / 100);
    }
  }, [card.data, daily]);

  async function save() {
    if (daily == null || perTap == null || stepUp == null || !session) return;
    if (perTap > stepUp || stepUp > daily) {
      setError("Limits must satisfy: per-tap ≤ step-up ≤ daily.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // 1. Persist the NGN limits off-chain (display + tier resolution).
      await cardsApi.updateLimits(
        {
          daily_limit_subunit: Math.round(daily * 100),
          per_tap_limit_subunit: Math.round(perTap * 100),
          step_up_threshold_subunit: Math.round(stepUp * 100),
        },
        session.jwt,
      );

      // 2. Push the limits ON-CHAIN as USDC subunit — the cap is USDC-
      //    denominated, so its limits must be too. Owner-signed via zkLogin.
      //    This is also the migration for older caps whose on-chain limits
      //    were stored in NGN kobo (they'd otherwise reject real debits).
      const c = card.data;
      if (c && c.status === "live" && c.cap_object_id && c.coin_type) {
        const packageId = process.env.NEXT_PUBLIC_TAPP_PACKAGE_ID;
        if (!packageId || !/^0x[0-9a-f]{64}$/i.test(packageId)) {
          throw new Error("Card package isn't configured.");
        }
        const ratesRes = await fetch("/api/rates", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null);
        const ngnPerUsdc = Number(ratesRes?.ngn_per_usdc);
        if (!ngnPerUsdc || ngnPerUsdc <= 0) {
          throw new Error("Couldn't load the NGN/USDC rate — try again in a moment.");
        }
        const ngnToUsdcMicro = (ngn: number) =>
          BigInt(Math.max(1, Math.round((ngn / ngnPerUsdc) * 1_000_000)));
        const dailyUsdc = ngnToUsdcMicro(daily);
        const perTapUsdc = ngnToUsdcMicro(perTap);

        const zk = await import("@/lib/zklogin");
        const { Transaction } = await import("@mysten/sui/transactions");
        await zk.executeZkLoginTx((tx: InstanceType<typeof Transaction>) => {
          tx.moveCall({
            target: `${packageId}::tapp_card::update_limits`,
            typeArguments: [c.coin_type!],
            arguments: [
              tx.object(c.cap_object_id!),
              tx.pure.u64(dailyUsdc),
              tx.pure.u64(perTapUsdc),
            ],
          });
        });
      }

      // Refresh the cached card so the new limits stick on reload.
      await qc.invalidateQueries({ queryKey: ["cards", "me"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save limits");
    } finally {
      setSaving(false);
    }
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
          <h1 className="text-xl font-medium">Spend limits</h1>
          <p className="text-sm text-gray-500 dark:text-white/50">
            How much your physical card can spend without extra steps.
          </p>
        </div>

        {card.isLoading || daily == null || perTap == null || stepUp == null ? (
          <div className="flex justify-center py-10">
            <div className="loader" />
          </div>
        ) : (
          <>
            <div className="grid divide-y divide-dashed divide-gray-200 rounded-3xl border border-gray-200 px-4 dark:divide-white/10 dark:border-white/10">
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
            </div>

            {error ? <InputError message={error} /> : null}

            {saved ? (
              <StatusChip tone="success" icon={<PiCheckCircleFill />}>
                Saved
              </StatusChip>
            ) : null}

            <Button onClick={save} loading={saving} disabled={saving}>
              Save changes
            </Button>
          </>
        )}
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
