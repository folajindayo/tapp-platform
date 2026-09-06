"use client";

import { useEffect, useState } from "react";
import { PiTimerBold } from "react-icons/pi";
import { cn } from "@/lib/utils";

interface CountdownPillProps {
  expiresAt: number;
  onExpire?: () => void;
  className?: string;
}

function format(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function CountdownPill({ expiresAt, onExpire, className }: CountdownPillProps) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const remaining = expiresAt - now;

  useEffect(() => {
    if (remaining <= 0 && onExpire) onExpire();
  }, [remaining, onExpire]);

  const expired = remaining <= 0;
  const urgent = remaining <= 30_000 && !expired;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full bg-gray-50 px-2 py-1 text-xs font-medium tabular-nums dark:bg-white/5",
        expired
          ? "text-rose-500"
          : urgent
            ? "text-amber-500"
            : "text-gray-500 dark:text-white/50",
        className,
      )}
    >
      <PiTimerBold className="text-sm" />
      {expired ? "Expired" : `Expires in ${format(remaining)}`}
    </span>
  );
}
