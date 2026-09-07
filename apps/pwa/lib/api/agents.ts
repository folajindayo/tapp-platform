/**
 * The agent network: who can take cash, and where they are.
 */

import { request } from "./http";
import type { Money } from "./money";

export type AgentKind = "shop" | "kiosk" | "market_stall" | "office" | "person";

export interface Agent {
  id: string;
  name: string;
  kind: AgentKind;
  address: string;
  phone?: string;

  lat: number;
  lng: number;

  /** "HH:MM" local. */
  opensAt: string;
  closesAt: string;

  verified: boolean;
  active: boolean;

  settledCount: number;
  disputedCount: number;

  /**
   * What this agent can currently hand out as cash.
   *
   * A balance, not a flag. An agent who cannot cover an amount is not offered
   * for it, which is a fact about their money rather than a status somebody
   * remembered to update.
   */
  float: Money;

  /** Set only by a nearby search. */
  distanceM?: number;
  /** Evaluated against the caller's clock, on the server. */
  openNow: boolean;
}

export interface NearbyQuery {
  lat: number;
  lng: number;
  /** Metres. */
  radius?: number;
  /**
   * Decimal string. When given, agents whose float cannot cover it are ranked
   * below those who can -- walking to somebody who has to turn you away is the
   * failure this parameter exists to prevent.
   */
  amount?: string;
}

export const agentsApi = {
  /** Public: finding somewhere to hand cash to does not require an account. */
  nearby: (q: NearbyQuery) => {
    const params = new URLSearchParams({
      lat: String(q.lat),
      lng: String(q.lng),
    });
    if (q.radius !== undefined) params.set("radius", String(q.radius));
    if (q.amount !== undefined) params.set("amount", q.amount);
    return request<{ agents: Agent[] }>("GET", `/v1/agents/nearby?${params}`);
  },

  /** Register as an agent. Coordinates are required, and this is why: */
  register: (
    body: {
      name: string;
      kind: AgentKind;
      address: string;
      phone?: string;
      lat: number;
      lng: number;
      opens_at: string;
      closes_at: string;
    },
    jwt: string,
  ) => request<Agent>("POST", "/v1/agents", { body, token: jwt }),
};
