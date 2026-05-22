// Locale-aware formatting helpers shared across screens.

const NGN_FORMATTER = new Intl.NumberFormat('en-NG', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/** Formats a numeric amount as "₦5,000" (or with cents when present). */
export function formatNgn(amount: string | number): string {
  const n = typeof amount === 'string' ? Number.parseFloat(amount) : amount;
  if (!Number.isFinite(n)) return '₦0';
  return `₦${NGN_FORMATTER.format(n)}`;
}

/** Masks all but the last 4 digits of an account number. */
export function maskAccountNumber(num: string): string {
  return num.length <= 4 ? num : `****${num.slice(-4)}`;
}
