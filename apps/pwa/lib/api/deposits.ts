/**
 * Deposit addresses on Base.
 */

import { request } from "./http";

export interface DepositAddress {
  address: string;
  network: string;
  chain_id: number;
  token: string;
  /**
   * What this address will and will not accept, in the server's words.
   *
   * Shown verbatim and prominently. An address that silently swallows the
   * wrong token on the wrong chain is the most expensive mistake available on
   * this screen, and it is not recoverable.
   */
  warning: string;
}

export const depositsApi = {
  /**
   * The caller's own deposit address. Stable: the same person gets the same
   * address every time, so one saved in a contact list keeps working.
   */
  address: (jwt: string) =>
    request<DepositAddress>("GET", "/v1/deposits/address", { token: jwt }),
};
