"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
}

export function TabButton({ active, onClick, children, disabled }: TabButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex-1 rounded-full px-5 py-2.5 transition-all duration-300",
        active
          ? "border border-gray-300 bg-white text-neutral-900 shadow dark:border-white/20 dark:bg-transparent dark:text-white"
          : "border border-transparent text-gray-400 dark:text-white/40",
        disabled && "cursor-not-allowed opacity-70",
      )}
    >
      {children}
    </button>
  );
}

export function TabRow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-gray-50 p-1 font-medium dark:bg-white/5">
      {children}
    </div>
  );
}
