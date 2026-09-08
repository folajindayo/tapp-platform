/**
 * Where money comes in: an address on Base, and an account number in Nigeria.
 *
 * Two answers to the same question -- "where do I send it" -- and they are in
 * one module because the mistake they share is the expensive one. An address
 * or an account number that is not actually yours takes money that does not
 * come back.
 */

import { request } from "./http";

export interface DepositAddress {
  address: string;
  network: string;
  chain_id: number;
  token: string;
  /**
   * True when this address is on a test network. Rendered as a distinct,
   * unmissable state rather than a number the reader has to recognise: a bare
   * "Chain ID 84532" is not something anyone can be expected to decode, and
   * real USDC was once sent to a testnet address that looked identical to a
   * mainnet one.
   */
  testnet?: boolean;
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

/**
 * A naira account number the holder can be paid into.
 *
 * Issued by the banking rail, permanent, and theirs: somebody who saves it as
 * a payee keeps using the same number. Money transferred to it becomes naira
 * in their balance when the rail reports the credit.
 */
export interface NGNAccount {
  account_number: string;
  bank_name: string;
  account_name: string;
  currency: "NGN";
  /** The server's own words about what this account is. Shown verbatim. */
  warning: string;
}

/**
 * What the rail needs to open one.
 *
 * Heavier than a BVN alone because Fintava opens a full customer wallet rather
 * than a pooled virtual account. The name and date of birth are omitted on
 * purpose: the server fills them from the verified BVN record, which is both a
 * shorter form and a better answer -- what the account displays to whoever
 * pays into it should be the bank's spelling of the name, not a phone
 * keyboard's.
 */
export interface ProvisionNGNAccount {
  bvn: string;
  nin: string;
  address: string;
}

export const ngnDepositsApi = {
  /** The caller's account, or a 404 they have not opened one yet. */
  account: (jwt: string) =>
    request<NGNAccount>("GET", "/v1/deposits/ngn/account", { token: jwt }),

  /**
   * Open it. Idempotent -- opening a bank account is a real side effect at the
   * rail, and a retry after a dropped connection returns the account that
   * already exists rather than issuing a second one nobody is watching.
   */
  open: (body: ProvisionNGNAccount, jwt: string) =>
    request<NGNAccount>("POST", "/v1/deposits/ngn/account", { body, token: jwt }),
};
