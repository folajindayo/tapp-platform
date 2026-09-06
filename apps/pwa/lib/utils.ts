import clsx, { type ClassValue } from "clsx";

/**
 * Tailwind class merger. Trivial wrapper over `clsx`; we don't pull
 * `tailwind-merge` since our component library is small enough that
 * we manage conflicting classes by convention rather than runtime
 * resolution.
 */
export function cn(...inputs: ClassValue[]): string {
  return clsx(...inputs);
}

const ngnFormatter = new Intl.NumberFormat("en-NG", {
  style: "currency",
  currency: "NGN",
  currencyDisplay: "symbol",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Format a number-or-string as a Nigerian Naira amount. */
export function formatNgn(value: string | number): string {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return "₦0";
  return ngnFormatter.format(n);
}
