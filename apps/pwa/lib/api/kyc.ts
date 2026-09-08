/**
 * Identity verification.
 *
 * A ladder, not a gate. An email address is enough to receive a payment and
 * buy lunch; a BVN raises the ceiling; a photograph matched to the bank's own
 * records raises it again. Nobody is asked for anything until the amount they
 * are trying to move needs it.
 *
 * The checks answer inside the request. There is no polling loop and no
 * "pending" state to render, because the server's provider decides
 * synchronously -- so a screen here either has the answer or is still waiting
 * on one HTTP call.
 */

import { request } from "./http";
import type { Money } from "./money";

/** How well established an identity is. Mirrors the server's kyc.Tier. */
export type KycTier = 0 | 1 | 2 | 3;

export interface KycLimits {
  per_transaction: Money;
  daily: Money;
  monthly: Money;
  max_balance: Money;
}

/**
 * What a verification proved.
 *
 * The BVN is present only as its last four digits. It is a national identifier
 * and the most sensitive thing a Nigerian fintech can hold; four digits let
 * somebody recognise which of their numbers was used and are useless to
 * anybody who steals them.
 */
export interface KycIdentity {
  firstName: string;
  lastName: string;
  dateOfBirth?: string;
  phone?: string;
  bvnLast4?: string;
}

export interface KycStatus {
  tier: KycTier;
  tier_name: string;
  identity?: KycIdentity | null;
  limits: KycLimits;
  /**
   * The step still available, absent once there is none.
   *
   * Carries the limits it would unlock, because the question somebody is
   * actually answering before handing over a BVN is "what do I get for this" —
   * and an app that answers it from its own hardcoded table will one day
   * answer it wrongly.
   */
  next?: { tier: KycTier; tier_name: string; unlocks: KycLimits } | null;
}

/**
 * The result of a check.
 *
 * A rejection is a successful request with a disappointing answer, not an
 * error: a misspelt surname and an unreachable provider are different things
 * and only one of them is something the person can fix. `status` distinguishes
 * them, and `reason` is what to actually show.
 */
export type KycResult =
  | ({ status: "approved" } & KycStatus)
  | { status: "rejected" | "failed" | "pending"; reason?: string };

export const kycApi = {
  status: (jwt: string) => request<KycStatus>("GET", "/v1/kyc", { token: jwt }),

  /**
   * Match a BVN against the bank's record.
   *
   * The name is sent with it and is compared server-side. The rail's endpoint
   * is a lookup that returns the details behind any valid BVN, so without the
   * comparison this would certify that a BVN exists rather than that it is
   * yours.
   */
  verifyBvn: (
    body: { bvn: string; firstName: string; lastName: string; dateOfBirth?: string },
    jwt: string,
  ) => request<KycResult>("POST", "/v1/kyc/bvn", { body, token: jwt }),

  /** Match a face to the photograph held behind that BVN. */
  verifySelfie: (body: { bvn: string; image: string }, jwt: string) =>
    request<KycResult>("POST", "/v1/kyc/selfie", { body, token: jwt }),
};
