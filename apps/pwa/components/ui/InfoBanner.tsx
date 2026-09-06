"use client";

import type { ReactNode } from "react";
import { TbInfoSquareRounded } from "react-icons/tb";
import { cn } from "@/lib/utils";

type Tone = "info" | "warning";

interface InfoBannerProps {
  icon?: ReactNode;
  children: ReactNode;
  tone?: Tone;
  className?: string;
}

const toneClasses: Record<Tone, string> = {
  info: "border-gray-200 bg-gray-50 text-gray-500 dark:border-white/10 dark:bg-white/5 dark:text-white/50",
  warning:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/10 dark:text-amber-300",
};

export function InfoBanner({ icon, children, tone = "info", className }: InfoBannerProps) {
  return (
    <div
      className={cn(
        "flex gap-2.5 rounded-xl border p-3 text-sm",
        toneClasses[tone],
        className,
      )}
    >
      <span className="flex w-8 shrink-0 items-start justify-center pt-0.5 text-xl">
        {icon ?? <TbInfoSquareRounded />}
      </span>
      <div className="flex-1 leading-relaxed">{children}</div>
    </div>
  );
}
