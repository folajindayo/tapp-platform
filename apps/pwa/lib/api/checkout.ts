/**
 * Phone-to-phone checkout: a merchant asks, a payer approves.
 */

import { request } from "./http";
import type { Currency, Money } from "./money";

export type CheckoutState = "open" | "paid" | "expired" | "cancelled";

export interface Checkout {
  id: string;
  checkout_url: string;

  amount: Money;
  /** The server's rendering, for surfaces that want a bare string. */
  amount_display: string;
  currency: Currency;
  narration?: string;

  /**
   * Who is being paid. Empty when the server cannot say -- the screen then
   * says "this merchant", because a name invented for a payment confirmation
   * is worse than no name.
   */
  merchant_name: string;

  state: CheckoutState;
  expires_at: string;
}

export const checkoutApi = {
  /**
   * Read a request. Deliberately open: somebody has to be able to see what
   * they are being asked for before deciding whether to sign in and pay it.
   */
  get: (id: string) => request<Checkout>("GET", `/v1/checkouts/${id}`),

  /** Pay it from the signed-in payer's balance. */
  pay: (id: string, jwt: string) =>
    request<Checkout>("POST", `/v1/checkouts/${id}/pay`, { token: jwt }),
};
