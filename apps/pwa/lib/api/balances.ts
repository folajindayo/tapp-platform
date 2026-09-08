/**
 * What the signed-in person holds, per currency.
 */

import { request } from "./http";
import type { Currency, Money } from "./money";

export interface CurrencyBalance {
  currency: Currency;
  /** Spendable now. */
  available: Money;
  /**
   * Committed to a handover that has not completed.
   *
   * Reported separately from `available`, and shown separately, because
   * folding the two into one number is how somebody comes to believe money is
   * theirs to spend while an agent is already relying on it.
   */
  escrow: Money;
}

/**
 * Everything held, in one currency.
 *
 * Absent when the server had no rate to convert with. The client must then
 * show the per-currency figures alone rather than a total: a headline
 * assembled from a guessed rate is a wrong answer to "how much do I have".
 */
export interface TotalBalance {
  amount: Money;
  /** At least one currency was converted, so the figure is approximate. */
  converted: boolean;
  /** Mid-market rate used per pair, for tracing a disputed figure. */
  rates?: Record<string, string>;
}

export const balancesApi = {
  /**
   * Every supported currency, including the ones at zero.
   *
   * The zeroes matter: a currency that only appears once it has a balance
   * gives somebody no way to discover they could hold dollars, and makes the
   * first deposit look like the app inventing an account.
   */
  list: (jwt: string) =>
    request<{ balances: CurrencyBalance[]; total?: TotalBalance }>(
      "GET", "/v1/me/balances", { token: jwt }),
};
