import { cn } from "@/lib/utils";
import type { Money } from "@/lib/api";

type Size = "hero" | "lg" | "md" | "sm";

const SIZES: Record<Size, string> = {
  hero: "text-[2.75rem] leading-none tracking-tight",
  lg: "text-2xl leading-tight",
  md: "text-base",
  sm: "text-sm",
};

interface AmountProps {
  value: Money | null | undefined;
  size?: Size;
  /**
   * Colour the number by direction: green arriving, plain leaving.
   *
   * Off by default. A balance is not a direction, and painting every figure on
   * a screen green or red teaches people to stop reading the colour.
   */
  signed?: boolean;
  /** Show a leading + on positive values. Only meaningful with `signed`. */
  showPlus?: boolean;
  className?: string;
}

/**
 * An amount, rendered the way the server rendered it.
 *
 * `display` comes from the API and is shown as-is. Formatting money is decided
 * in exactly one place -- the server -- so a receipt the API prints and a
 * figure this app draws cannot disagree about what the same number looks like.
 * Re-implementing grouping and decimal places on the client is how a naira
 * figure ends up with two decimal places in one screen and none in the next.
 *
 * A missing value renders an em dash rather than a zero. "We don't know" and
 * "nothing" are different, and only one of them should look like ₦0.00.
 */
export function Amount({
  value,
  size = "md",
  signed = false,
  showPlus = false,
  className,
}: AmountProps) {
  if (!value) {
    return (
      <span className={cn("tabular-nums text-[var(--fg-subtle)]", SIZES[size], className)}>
        —
      </span>
    );
  }

  const positive = value.minor > 0;
  const tone = signed
    ? positive
      ? "text-[var(--positive)]"
      : "text-[var(--fg)]"
    : "text-[var(--fg)]";

  return (
    <span className={cn("tabular-nums font-medium", SIZES[size], tone, className)}>
      {signed && showPlus && positive ? "+" : ""}
      {value.display}
    </span>
  );
}

/**
 * The three-letter code, for places where two currencies sit side by side and
 * the symbol alone is ambiguous.
 */
export function CurrencyTag({ code, className }: { code: string; className?: string }) {
  return (
    <span
      className={cn(
        "rounded-md bg-[var(--sunken)] px-1.5 py-0.5 text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--fg-muted)]",
        className,
      )}
    >
      {code}
    </span>
  );
}
