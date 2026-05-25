"use client";

import {
  PiArrowUpRightBold,
  PiArrowDownLeftBold,
  PiClockBold,
  PiXCircleFill,
} from "react-icons/pi";
import { cn } from "@/lib/utils";
import { PressableScale } from "./PressableScale";
import {
  type ActivityEvent,
  formatTimeAgo,
  formatUsdcSigned,
  formatNgnFromUsdc,
} from "@/lib/wallet";

interface ActivityRowProps {
  tx: ActivityEvent;
  ngnRate: number;
  href?: string;
}

const kindLabel: Record<ActivityEvent["kind"], string> = {
  pay:     "Paid",
  deposit: "Deposit",
  topup:   "Card top up",
  refund:  "Refund",
};

export function ActivityRow({ tx, ngnRate, href }: ActivityRowProps) {
  const inflow = tx.amount_subunit > 0;
  const declined = tx.status === "declined";
  const pending  = tx.status === "pending";
  const amountColor = declined
    ? "text-gray-400 dark:text-white/30 line-through"
    : inflow
      ? "text-orange-700 dark:text-orange-400"
      : "text-neutral-900 dark:text-white/80";

  const title =
    tx.kind === "pay"
      ? tx.merchant ?? "Merchant payment"
      : tx.kind === "deposit" && tx.asset
        ? `Deposit ${tx.asset}`
        : kindLabel[tx.kind];

  const Icon = declined
    ? PiXCircleFill
    : pending
      ? PiClockBold
      : inflow
        ? PiArrowDownLeftBold
        : PiArrowUpRightBold;

  const iconColor = declined
    ? "text-rose-500"
    : pending
      ? "text-amber-500"
      : inflow
        ? "text-orange-700 dark:text-orange-400"
        : "text-gray-400 dark:text-white/40";

  const body = (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-white/5">
      <span
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-full bg-gray-50 text-base dark:bg-white/5",
          iconColor,
        )}
      >
        <Icon />
      </span>
      <div className="grid flex-1 gap-0.5 text-left">
        <p className="font-medium text-neutral-900 dark:text-white">{title}</p>
        <p className="text-xs text-gray-500 dark:text-white/50">
          {pending ? "Pending · " : declined ? "Declined · " : ""}
          {formatTimeAgo(tx.at)}
        </p>
      </div>
      <div className="grid gap-0.5 text-right">
        <p className={cn("font-mono text-sm font-medium tabular-nums", amountColor)}>
          {formatUsdcSigned(tx.amount_subunit)}
        </p>
        <p className="text-xs text-gray-500 dark:text-white/50">
          ≈ {formatNgnFromUsdc(tx.amount_subunit, ngnRate)}
        </p>
      </div>
    </div>
  );

  if (href) {
    return (
      <PressableScale as="link" href={href}>
        {body}
      </PressableScale>
    );
  }
  return body;
}
