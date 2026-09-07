/**
 * Currency conversion: a price is offered, then accepted.
 *
 * Two calls on purpose. Quoting and executing together would convert at
 * whatever the rate happened to be when the request landed, which is what the
 * predecessor did -- and why no conversion could afterwards be reconciled
 * against the number the customer was shown.
 */

import { request } from "./http";
import type { Currency } from "./money";

export interface Quote {
  quote_id: string;
  /** All four are rendered amounts from the server; show them as they are. */
  sell: string;
  receive: string;
  fee: string;
  rate: string;
  spread_bps: number;
  /** RFC3339 UTC. After this the quote is refused, not silently repriced. */
  expires_at: string;
}

export const convertApi = {
  /** Offer a price. `sell` is a decimal string in `from`. */
  quote: (body: { sell: string; from: Currency; to: Currency }, jwt: string) =>
    request<Quote>("POST", "/v1/me/convert/quote", { body, token: jwt }),

  /** Accept the price. Redeeming a quote and moving the money is one step. */
  execute: (quoteId: string, jwt: string) =>
    request<Quote>("POST", "/v1/me/convert", {
      body: { quote_id: quoteId },
      token: jwt,
    }),
};
