"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Surface } from "@/components/ui/Surface";
import { cn } from "@/lib/utils";
import type { Currency, Quote } from "@/lib/api";

/**
 * A price, and the clock it is good for.
 *
 * The countdown is not decoration. A quote is a commitment the server will
 * honour for about a minute, and after that it is refused rather than quietly
 * repriced — so the user needs to see the window closing, and the card needs
 * to stop offering a button that will fail.
 */
export function QuoteCard({
  quote,
  to,
  onAccept,
  onExpire,
  accepting,
}: {
  quote: Quote;
  to: Currency;
  onAccept: () => void;
  onExpire: () => void;
  accepting: boolean;
}) {
  const secondsLeft = useSecondsLeft(quote.expires_at);
  const expired = secondsLeft <= 0;

  useEffect(() => {
    if (expired) onExpire();
  }, [expired, onExpire]);

  return (
    <Surface radius="3xl" className="grid gap-5">
      <div className="grid gap-1">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
          You receive
        </p>
        <p className="text-[2.5rem] font-medium leading-none tabular-nums text-[var(--fg)]">
          {quote.receive}
        </p>
      </div>

      <dl className="grid gap-2 text-sm">
        <Line label="You sell" value={quote.sell} />
        <Line label="Rate" value={quote.rate} />
        {/* The spread is shown as money, not as a percentage buried in terms.
            Its predecessor applied a hardcoded 100 basis points inside the tap
            handler with a comment apologising for it, and told nobody. */}
        <Line
          label={`Our spread (${(quote.spread_bps / 100).toFixed(2)}%)`}
          value={quote.fee}
          muted
        />
      </dl>

      <div className="grid gap-2">
        <Button onClick={onAccept} loading={accepting} disabled={expired}>
          {expired ? "Price expired" : `Take this price`}
        </Button>
        <p
          className={cn(
            "text-center text-xs tabular-nums",
            secondsLeft <= 10 ? "text-[var(--caution)]" : "text-[var(--fg-muted)]",
          )}
        >
          {expired
            ? "Ask for a fresh price."
            : `Held for ${secondsLeft}s`}
        </p>
      </div>
    </Surface>
  );
}

function Line({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--fg-muted)]">{label}</dt>
      <dd
        className={cn(
          "tabular-nums",
          muted ? "text-[var(--fg-muted)]" : "text-[var(--fg)]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function useSecondsLeft(iso: string): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  const ms = new Date(iso).getTime() - now;
  return Number.isFinite(ms) ? Math.max(0, Math.ceil(ms / 1000)) : 0;
}
