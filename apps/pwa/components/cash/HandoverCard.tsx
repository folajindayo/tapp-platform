"use client";

import { useEffect, useState } from "react";
import { PiCheckCircleFill, PiHourglassMediumBold } from "react-icons/pi";
import { Button } from "@/components/ui/Button";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { Surface } from "@/components/ui/Surface";
import { Amount } from "@/components/ui/Amount";
import { formatDistance } from "@/lib/geo/mercator";
import type { Handover } from "@/lib/api";

/**
 * The meeting, and the one number the person needs at the counter.
 *
 * The code is the whole screen when it matters. Somebody is standing in front
 * of an agent holding a phone in one hand and money in the other, in daylight,
 * and needs to read six digits aloud — so it is set large, spaced, and nothing
 * competes with it.
 *
 * What the code is NOT is authentication. It bounds a window; what actually
 * makes the handover real is that both sides confirm it independently. Saying
 * so here keeps anyone from building a flow that trusts the code alone.
 */
export function HandoverCard({
  handover,
  onConfirm,
  confirming,
  error,
}: {
  handover: Handover;
  onConfirm: () => void;
  confirming: boolean;
  error: unknown;
}) {
  const remaining = useCountdown(handover.expiresAt);
  const waitingOnAgent =
    handover.state === "trader_confirmed" || handover.state === "agent_confirmed";
  const done = handover.state === "completed";

  if (done) return null;

  return (
    <Surface radius="3xl" className="grid gap-5">
      <div className="grid gap-1">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
          Read this to the agent
        </p>
        <p className="font-mono text-4xl font-semibold tracking-[0.25em] text-[var(--fg)]">
          {handover.code}
        </p>
      </div>

      <dl className="grid gap-2 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[var(--fg-muted)]">They&apos;re expecting</dt>
          <dd>
            <Amount value={handover.amount} size="md" />
          </dd>
        </div>
        {handover.distanceM > 0 ? (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-[var(--fg-muted)]">Distance</dt>
            <dd className="tabular-nums text-[var(--fg)]">
              {formatDistance(handover.distanceM)}
            </dd>
          </div>
        ) : null}
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-[var(--fg-muted)]">Held for you</dt>
          <dd className="tabular-nums text-[var(--fg)]">{remaining}</dd>
        </div>
      </dl>

      {waitingOnAgent ? (
        <Surface kind="sunken" padding="md" radius="2xl" className="flex items-start gap-2.5">
          <PiHourglassMediumBold className="mt-0.5 shrink-0 text-lg text-[var(--fg-subtle)]" />
          <p className="text-xs leading-relaxed text-[var(--fg-muted)]">
            You&apos;ve confirmed. As soon as the agent confirms on their side,
            the money is in your balance. This page updates on its own.
          </p>
        </Surface>
      ) : (
        <>
          <Button
            onClick={onConfirm}
            loading={confirming}
            leadingIcon={<PiCheckCircleFill />}
          >
            I&apos;ve handed over the cash
          </Button>
          <p className="text-center text-xs leading-relaxed text-[var(--fg-muted)]">
            Only after they have the notes. Both of you confirm separately —
            that is what makes it count.
          </p>
        </>
      )}

      {error ? (
        <InfoBanner tone="warning">
          <p className="text-xs">
            {error instanceof Error ? error.message : "That didn't go through."}
          </p>
        </InfoBanner>
      ) : null}
    </Surface>
  );
}

/**
 * Time left, ticking.
 *
 * Counts to zero and stops there rather than going negative: an expired
 * handover reads as expired, not as "-00:14 remaining".
 */
function useCountdown(iso: string): string {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const msLeft = new Date(iso).getTime() - now;
  if (!Number.isFinite(msLeft)) return "—";
  if (msLeft <= 0) return "expired";

  const totalSeconds = Math.floor(msLeft / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
