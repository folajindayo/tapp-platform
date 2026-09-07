/**
 * Cash: photograph the notes, walk to an agent, hand them over.
 *
 * The photograph is evidence, never collateral. It cannot secure value and
 * nothing here treats it as though it does -- anyone can photograph a
 * stranger's cash. What settles a pledge is the physical handover, confirmed
 * independently by both people standing there.
 */

import { request } from "./http";
import type { Money } from "./money";

export type PledgeState =
  | "screening"
  | "open"
  | "matched"
  | "handed_over"
  | "settled"
  | "expired"
  | "refused"
  | "disputed";

export type HandoverState =
  | "proposed"
  | "trader_confirmed"
  | "agent_confirmed"
  | "completed"
  | "expired"
  | "refused"
  | "disputed";

export interface Pledge {
  id: string;
  /** Human reference, short enough to read over a phone. */
  ref: number;

  /**
   * What was declared, and what recognition counted.
   *
   * Shown side by side when they disagree rather than reconciled into one
   * number: a disagreement is the most useful thing on this screen, and it is
   * usually a bad photograph rather than a bad person.
   */
  declared: Money;
  counted: Money;

  state: PledgeState;

  riskScore?: number;
  refusedReason?: string;

  createdAt: string;
  expiresAt: string;
  settledAt?: string;
}

export interface Handover {
  id: string;
  pledgeId: string;
  agentId: string;
  amount: Money;

  /**
   * Spoken aloud at the counter. It bounds a window; it does not authenticate
   * anybody. What authenticates the meeting is that both sides confirm it.
   */
  code: string;

  distanceM: number;
  state: HandoverState;
  expiresAt: string;
}

/** A pledge and the handover it is waiting on, if any. */
export interface PledgeView {
  pledge: Pledge;
  handover?: Handover;
}

export const cashApi = {
  /**
   * Offer cash. `image` is base64 of a downscaled photograph.
   *
   * The server hashes it and keeps the hash, not the picture. Storing every
   * image of somebody's money forever is not a trade worth making.
   */
  pledge: (
    body: { amount: string; lat: number; lng: number; image: string; device?: string },
    jwt: string,
  ) => request<Pledge>("POST", "/v1/cash/pledges", { body, token: jwt }),

  list: (jwt: string) =>
    request<{ pledges: Pledge[] }>("GET", "/v1/cash/pledges", { token: jwt }),

  /** Poll this while walking, and between the two confirmations. */
  get: (pledgeId: string, jwt: string) =>
    request<PledgeView>("GET", `/v1/cash/pledges/${pledgeId}`, { token: jwt }),

  /** Find an agent and lock their float against this pledge. */
  match: (pledgeId: string, jwt: string) =>
    request<Handover>("POST", `/v1/cash/pledges/${pledgeId}/match`, { token: jwt }),

  /** The person handing the cash over confirms. They read the code out. */
  confirm: (handoverId: string, jwt: string) =>
    request<Handover>("POST", `/v1/cash/handovers/${handoverId}/confirm`, { token: jwt }),

  /** The agent receiving it confirms, quoting the code they were told. */
  receive: (handoverId: string, code: string, jwt: string) =>
    request<Handover>("POST", `/v1/cash/handovers/${handoverId}/receive`, {
      body: { code },
      token: jwt,
    }),
};
