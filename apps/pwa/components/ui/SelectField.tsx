"use client";

import { forwardRef, type SelectHTMLAttributes, type ReactNode } from "react";
import { PiCaretDown } from "react-icons/pi";
import { ImSpinner2 } from "react-icons/im";
import { cn } from "@/lib/utils";
import { InputError } from "./InputError";

interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  required?: boolean;
  loading?: boolean;
  error?: string;
  placeholder?: string;
  children: ReactNode;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(
  function SelectField(
    { label, required, loading, error, placeholder, children, value, className, ...rest },
    ref,
  ) {
    const isEmpty = !value;
    return (
      <div className="grid gap-2">
        {label ? (
          <label className="text-sm font-medium text-neutral-900 dark:text-white">
            {label}
            {required ? <span className="text-rose-500"> *</span> : null}
          </label>
        ) : null}
        <div className="relative">
          <select
            ref={ref}
            value={value}
            className={cn(
              "w-full cursor-pointer rounded-xl border border-gray-300 bg-white px-4 py-2 text-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:border-white/20 dark:bg-neutral-900 dark:focus-visible:ring-offset-neutral-900",
              isEmpty
                ? "text-gray-400 dark:text-white/30"
                : "text-neutral-900 dark:text-white/80",
              className,
            )}
            {...rest}
          >
            {placeholder ? (
              <option value="" disabled>
                {placeholder}
              </option>
            ) : null}
            {children}
          </select>
          <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center">
            {loading ? (
              <ImSpinner2 className="animate-spin text-gray-400 dark:text-white/30" />
            ) : (
              <PiCaretDown className="text-gray-400 dark:text-white/30" />
            )}
          </span>
        </div>
        {error ? <InputError message={error} /> : null}
      </div>
    );
  },
);
