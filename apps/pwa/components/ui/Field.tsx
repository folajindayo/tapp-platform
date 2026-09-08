"use client";

import type { InputHTMLAttributes } from "react";
import { inputClasses } from "./Styles";

/**
 * A labelled text input with an optional hint beneath it.
 *
 * The one form control the verification and account screens share, so a
 * BVN field looks the same whether it is asked for on the deposit screen or
 * in settings.
 */
export function Field({
  id,
  label,
  value,
  onChange,
  hint,
  ...rest
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "value" | "onChange">) {
  return (
    <div className="grid gap-1.5">
      <label
        htmlFor={id}
        className="px-1 text-xs font-medium uppercase tracking-wider text-[var(--fg-subtle)]"
      >
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClasses}
        {...rest}
      />
      {hint ? <p className="px-1 text-xs text-[var(--fg-muted)]">{hint}</p> : null}
    </div>
  );
}
