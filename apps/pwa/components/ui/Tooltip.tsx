"use client";

import { useState, type ReactNode } from "react";

interface TooltipProps {
  message: string;
  children: ReactNode;
}

export function Tooltip({ message, children }: TooltipProps) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open ? (
        <span className="absolute bottom-full left-1/2 z-10 mb-2 flex -translate-x-1/2 flex-col items-center">
          <span className="relative z-10 w-52 max-w-full break-words rounded-xl bg-gray-100 p-3 px-4 text-center text-xs text-gray-500 shadow-lg dark:bg-neutral-700 dark:text-white/50">
            {message}
          </span>
          <span className="-mt-2 h-3 w-3 rotate-45 bg-gray-100 shadow-lg dark:bg-neutral-700" />
        </span>
      ) : null}
    </span>
  );
}
