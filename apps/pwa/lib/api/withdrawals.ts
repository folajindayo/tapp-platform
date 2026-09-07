/**
 * Moving USDC back out to an address the holder names.
 */

import { request } from "./http";
import type { Money } from "./money";

export type WithdrawalState = "pending" | "sending" | "sent" | "failed" | "refunded";

export interface Withdrawal {
  id: string;
  amount: Money;
  to: string;
  state: WithdrawalState;
  /**
   * Set once the send has actually been submitted.
   *
   * Absent is not a failure. A withdrawal is debited and queued first and sent
   * by a worker, because a debit with no send is money we still hold and can
   * return, whereas a send with no debit is money gone that nobody paid for.
   */
  txHash?: string;
  lastError?: string;
  createdAt: string;
  sentAt?: string;
}

export const withdrawalsApi = {
  /** `amount` is a decimal string in USD. Answers 202: queued, not sent. */
  open: (body: { amount: string; to: string }, jwt: string) =>
    request<Withdrawal>("POST", "/v1/withdrawals", { body, token: jwt }),

  get: (id: string, jwt: string) =>
    request<Withdrawal>("GET", `/v1/withdrawals/${id}`, { token: jwt }),
};
