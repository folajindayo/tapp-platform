"use client";

import { cn } from "@/lib/utils";
import { CountUp } from "./CountUp";
import {
  formatUsdc,
  formatNgnFromUsdc,
  combinedUsdcSubunit,
} from "@/lib/wallet";

interface BalanceHeroProps {
  usdcSubunit: number;
  /** Native SUI balance in MIST (1 SUI = 1e9 MIST). Folded into the
   *  headline via suiUsdcRate; 0 means SUI doesn't contribute. */
  suiMist?: number;
  /** USDC per 1 SUI — required when suiMist > 0 to fold SUI in. */
  suiUsdcRate?: number;
  ngnRate: number;
  label?: string;
  className?: string;
}

const formatUsdcFromFloat = (n: number) => formatUsdc(Math.round(n * 1_000_000));

export function BalanceHero({
  usdcSubunit,
  suiMist = 0,
  suiUsdcRate = 0,
  ngnRate,
  label = "Balance",
  className,
}: BalanceHeroProps) {
  // Single unified balance: USDC + (SUI × rate), expressed in USDC subunits.
  // NGN equivalent follows from the unified total.
  const totalSubunit = combinedUsdcSubunit(usdcSubunit, suiMist, suiUsdcRate);
  const totalFloat = totalSubunit / 1_000_000;
  const includesSuiValue = suiMist > 0 && suiUsdcRate > 0;
  return (
    <div className={cn("grid gap-1", className)}>
      <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-white/30">
        {label}
      </p>
      <p className="font-medium tabular-nums text-neutral-900 dark:text-white">
        <CountUp
          value={totalFloat}
          format={formatUsdcFromFloat}
          threshold={1}
          rollKey={`bal-${Math.round(totalFloat)}`}
          className="text-4xl"
        />{" "}
        <span className="text-lg text-gray-500 dark:text-white/50">USDC</span>
      </p>
      <p className="text-sm text-gray-500 dark:text-white/50">
        ≈ {formatNgnFromUsdc(totalSubunit, ngnRate)}
      </p>
      {includesSuiValue ? (
        <p className="text-xs text-gray-400 dark:text-white/40">
          Available USDC: {formatUsdc(usdcSubunit)} | SUI:{" "}
          {(suiMist / 1_000_000_000).toFixed(4)}
        </p>
      ) : null}
    </div>
  );
}
