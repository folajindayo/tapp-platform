"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type Tone = "neutral" | "success" | "warning" | "error" | "pending";

interface StatusChipProps {
  icon?: ReactNode;
  children: ReactNode;
  tone?: Tone;
  className?: string;
}

const toneIconClasses: Record<Tone, string> = {
  neutral: "text-gray-400 dark:text-white/40",
  success: "text-green-700 dark:text-green-500",
  warning: "text-amber-500 dark:text-amber-400",
  error:   "text-rose-500",
  pending: "text-sky-500",
};

export function StatusChip({ icon, children, tone = "neutral", className }: StatusChipProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2 py-1 text-xs font-medium text-neutral-900 dark:bg-white/5 dark:text-white/80",
        className,
      )}
    >
      {icon ? <span className={cn("text-sm", toneIconClasses[tone])}>{icon}</span> : null}
      <span>{children}</span>
    </span>
  );
}
