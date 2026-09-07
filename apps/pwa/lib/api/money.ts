/**
 * Money, as the API sends it.
 *
 * The server never sends a bare number for an amount, and this type is why.
 * 150000 is ₦1,500.00 and it is also $1,500.00 -- a client that guesses is
 * wrong by a factor of a hundred, in a direction nobody notices until somebody
 * is paid wrong.
 *
 * `display` is the server's own rendering. Show it. Grouping, symbol placement
 * and the number of decimal places are decided once, on the server, so a
 * receipt the API prints and a balance this app draws cannot disagree about
 * what the same amount looks like. `minor` is authoritative for arithmetic and
 * comparison, and is what goes back over the wire.
 */
export interface Money {
  minor: number;
  currency: Currency;
  display: string;
}

export type Currency = "NGN" | "USD";

/** How many minor units make one major unit. Mirrors money.Currency.Scale(). */
const SCALE: Record<Currency, number> = { NGN: 100, USD: 100 };

/** The symbol, for the rare place a value is being composed rather than shown. */
export const SYMBOL: Record<Currency, string> = { NGN: "₦", USD: "$" };

export const zero = (currency: Currency): Money => ({
  minor: 0,
  currency,
  display: `${SYMBOL[currency]}0.00`,
});

export const isZero = (m: Money | null | undefined) => !m || m.minor === 0;
export const isPositive = (m: Money | null | undefined) => !!m && m.minor > 0;

/**
 * Renders an amount the app composed itself, before the server has seen it.
 *
 * Used only where there is no server value to show yet -- the running total on
 * a keypad, a limit being dragged. Anything that came back from the API shows
 * its own `display` instead, because this function is a second implementation
 * of the server's formatting and the two will drift.
 */
export function formatMinor(minor: number, currency: Currency): string {
  const scale = SCALE[currency];
  const negative = minor < 0;
  const abs = Math.abs(minor);
  const major = Math.floor(abs / scale);
  const frac = abs % scale;
  const grouped = major.toLocaleString("en-NG");
  const decimals = String(scale).length - 1;
  return `${negative ? "-" : ""}${SYMBOL[currency]}${grouped}.${String(frac).padStart(decimals, "0")}`;
}

/**
 * Parses what somebody typed into minor units.
 *
 * Returns null rather than a guess. "12.345" in a currency with two decimal
 * places is not 1234 and not 1235 -- it is a number this currency cannot
 * express, and rounding it silently is how a user is charged something they
 * did not type.
 */
export function parseAmount(input: string, currency: Currency): number | null {
  const trimmed = input.trim().replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;

  const decimals = String(SCALE[currency]).length - 1;
  const [major, frac = ""] = trimmed.split(".");
  if (frac.length > decimals) return null;

  const minor = Number(major) * SCALE[currency] + Number(frac.padEnd(decimals, "0") || 0);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** The decimal string the API expects in a request body. */
export function toDecimalString(minor: number, currency: Currency): string {
  const scale = SCALE[currency];
  const decimals = String(scale).length - 1;
  return `${Math.floor(minor / scale)}.${String(minor % scale).padStart(decimals, "0")}`;
}
