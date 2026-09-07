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

export const balancesApi = {
  /**
   * Every supported currency, including the ones at zero.
   *
   * The zeroes matter: a currency that only appears once it has a balance
   * gives somebody no way to discover they could hold dollars, and makes the
   * first deposit look like the app inventing an account.
   */
  list: (jwt: string) =>
    request<{ balances: CurrencyBalance[] }>("GET", "/v1/me/balances", { token: jwt }),
};
