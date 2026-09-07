"use client";

import Link from "next/link";
import { PiSlidersHorizontalBold } from "react-icons/pi";
import { Amount } from "./Amount";
import { Surface } from "./Surface";
import { formatMinor, type CardSummary } from "@/lib/api";

interface Props {
  card: CardSummary;
}

/**
 * Glance-level allowance card on /wallet. Shows today's tap-card
 * spend against the daily cap, plus per-tap and step-up thresholds.
 * Tapping the gear → /settings/limits to edit.
 */
export function CardAllowanceWidget({ card }: Props) {
  const spent = card.spent_today_subunit;
  const daily = card.daily_limit_subunit;
  const pct = daily > 0 ? Math.min(100, (spent / daily) * 100) : 0;

  // The limit and the balance are different constraints, and a card is stopped
  // by whichever binds first. Showing only the limit lets somebody plan a
  // purchase they cannot afford; showing only the balance lets them plan one
  // their own daily cap will refuse.
  const headroomMinor = Math.max(0, daily - spent);
  const bindingIsBalance = card.spendable.minor < headroomMinor;

  return (
    <Surface radius="3xl" padding="md" className="grid gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
          Card spending today
        </h3>
        <Link
          href="/settings/limits"
          aria-label="Edit limits"
          className="text-base text-[var(--fg-subtle)] transition-colors hover:text-[var(--accent)]"
        >
          <PiSlidersHorizontalBold />
        </Link>
      </div>

      <div className="grid gap-2">
        <p className="font-medium tabular-nums text-[var(--fg)]">
          <span className="text-2xl">{formatMinor(spent, "NGN")}</span>{" "}
          <span className="text-sm text-[var(--fg-muted)]">
            / {formatMinor(daily, "NGN")} today
          </span>
        </p>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--sunken)]">
          <div
            className="h-full rounded-full bg-[var(--accent)] transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="text-xs text-[var(--fg-muted)]">
          {bindingIsBalance ? (
            <>
              You can spend <Amount value={card.spendable} size="sm" className="font-normal" />{" "}
              — that&apos;s your balance, not your limit.
            </>
          ) : (
            <>
              {formatMinor(headroomMinor, "NGN")} left before today&apos;s limit.
            </>
          )}
        </p>
      </div>

      <hr className="border-dashed border-[var(--line)]" />

      <div className="flex items-start justify-between gap-4">
        <div className="grid flex-1 gap-0.5">
          <p className="text-xs text-[var(--fg-muted)]">Per-tap</p>
          <p className="font-medium tabular-nums text-[var(--fg)]">
            {formatMinor(card.per_tap_limit_subunit, "NGN")}
          </p>
        </div>
        <div className="h-full w-px border border-dashed border-[var(--line)]" />
        <div className="grid flex-1 gap-0.5">
          <p className="text-xs text-[var(--fg-muted)]">Step-up above</p>
          <p className="font-medium tabular-nums text-[var(--fg)]">
            {formatMinor(card.step_up_threshold_subunit, "NGN")}
          </p>
        </div>
      </div>
    </Surface>
  );
}
