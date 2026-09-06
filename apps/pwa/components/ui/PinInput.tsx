"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { InputError } from "./InputError";

interface PinInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "type"> {
  label: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  length?: number;
}

export const PinInput = forwardRef<HTMLInputElement, PinInputProps>(function PinInput(
  { label, value, onChange, error, length = 4, className, ...rest },
  ref,
) {
  return (
    <div className="grid gap-2">
      <label className="text-sm font-medium text-neutral-900 dark:text-white">{label}</label>
      <input
        ref={ref}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={length}
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, length))}
        className={cn(
          "h-14 w-full rounded-xl border border-gray-300 bg-white px-4 text-center text-2xl tracking-[0.6em] text-neutral-900 transition-all focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 dark:border-white/20 dark:bg-neutral-900 dark:text-white/80",
          className,
        )}
        {...rest}
      />
      {error ? <InputError message={error} /> : null}
    </div>
  );
});
