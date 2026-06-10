"use client";

import Link from "next/link";
import { PiSlidersHorizontalBold } from "react-icons/pi";
import { type CardSnapshot, formatUsdc } from "@/lib/wallet";
import { formatNgn } from "@/lib/utils";

interface Props {
  card: CardSnapshot;
}

/**
 * Glance-level allowance card on /wallet. Shows today's tap-card
 * spend against the daily cap, plus per-tap and step-up thresholds.
 * Tapping the gear → /settings/limits to edit.
 */
export function CardAllowanceWidget({ card }: Props) {
  const dailyN  = card.daily_limit_subunit / 100;
  const spentN  = card.spent_today_subunit / 100;
  const perTapN = card.per_tap_limit_subunit / 100;
  const stepUpN = card.step_up_threshold_subunit / 100;
  const pct = dailyN > 0 ? Math.min(100, (spentN / dailyN) * 100) : 0;

  return (
    <div className="grid gap-4 rounded-3xl border border-gray-200 p-4 dark:border-white/10">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-white/30">
          Card spending today
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-full tabular-nums">
            {formatUsdc(Number(card.on_chain_balance ?? 0))} USDC
          </span>
          <Link
            href="/settings/limits"
            aria-label="Edit limits"
            className="text-base text-gray-400 transition-colors hover:text-blue-600 dark:text-white/40 dark:hover:text-blue-400"
          >
            <PiSlidersHorizontalBold />
          </Link>
        </div>
      </div>

      <div className="grid gap-2">
        <p className="font-medium tabular-nums text-neutral-900 dark:text-white">
          <span className="text-2xl">{formatNgn(spentN)}</span>{" "}
          <span className="text-sm text-gray-500 dark:text-white/50">
            / {formatNgn(dailyN)} today
          </span>
        </p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-white/10">
          <div
            className="h-full rounded-full bg-blue-600 transition-all dark:bg-blue-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <hr className="border-dashed border-gray-200 dark:border-white/10" />

      <div className="flex items-start justify-between gap-4">
        <div className="grid flex-1 gap-0.5">
          <p className="text-xs text-gray-500 dark:text-white/50">Per-tap</p>
          <p className="font-medium tabular-nums">{formatNgn(perTapN)}</p>
        </div>
        <div className="h-full w-px border border-dashed border-gray-200 dark:border-white/10" />
        <div className="grid flex-1 gap-0.5">
          <p className="text-xs text-gray-500 dark:text-white/50">Step-up above</p>
          <p className="font-medium tabular-nums">{formatNgn(stepUpN)}</p>
        </div>
      </div>
    </div>
  );
}
