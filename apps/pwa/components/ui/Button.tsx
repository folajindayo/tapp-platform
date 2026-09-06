"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { PiSpinnerBold } from "react-icons/pi";
import { cn } from "@/lib/utils";
import {
  dangerBtnClasses,
  ghostBtnClasses,
  primaryBtnClasses,
  secondaryBtnClasses,
} from "./Styles";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  /** Full-width by default — matches zap's mobile-first button blocks. */
  fullWidth?: boolean;
}

const variantClassMap: Record<ButtonVariant, string> = {
  primary: primaryBtnClasses,
  secondary: secondaryBtnClasses,
  ghost: ghostBtnClasses,
  danger: dangerBtnClasses,
};

/**
 * CTA primitive. Class strings live in `Styles.ts` so the visual
 * language stays in one place — same pattern paycrest/zap uses.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    loading,
    leadingIcon,
    trailingIcon,
    fullWidth = true,
    children,
    className,
    disabled,
    ...rest
  },
  ref,
) {
  const isDisabled = disabled || loading;
  return (
    <button
      ref={ref}
      disabled={isDisabled}
      className={cn(
        variantClassMap[variant],
        "flex items-center justify-center gap-2",
        fullWidth && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <PiSpinnerBold className="animate-spin" size={18} />
      ) : (
        <>
          {leadingIcon}
          <span>{children}</span>
          {trailingIcon}
        </>
      )}
    </button>
  );
});
