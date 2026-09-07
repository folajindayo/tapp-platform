"use client";

/**
 * The wallet's data, read from the ledger.
 *
 * Every number on every balance screen comes from here, and every one of them
 * is derived from the ledger entries themselves rather than from a cached
 * total or a chain read. That matters more than it sounds: the predecessor
 * assembled the wallet from an RPC provider's view of an on-chain address, and
 * answered zero whenever the provider was unreachable -- so an outage and an
 * empty account looked identical to the person holding the phone.
 *
 * Nothing here falls back. A read that fails surfaces as an error for the UI
 * to show, because "we could not load this" and "you have nothing" are
 * different sentences and only one of them is true.
 */

import { useQuery } from "@tanstack/react-query";
import { useSession } from "./auth";
import {
  activityApi,
  balancesApi,
  cardsApi,
  cashApi,
  depositsApi,
  type CurrencyBalance,
  type Currency,
} from "./api";
export type { Movement, ActivityPage } from "./api";

/** How often a balance re-reads itself while somebody is watching it. */
const BALANCE_POLL_MS = 8_000;
/** The feed changes less often than the balance and costs more to read. */
const ACTIVITY_POLL_MS = 20_000;

// -----------------------------------------------------------------------------
// Balances
// -----------------------------------------------------------------------------

export function useBalances() {
  const { session, hydrated } = useSession();
  return useQuery({
    queryKey: ["ledger", "balances", session?.email ?? ""],
    enabled: hydrated && !!session,
    queryFn: () => balancesApi.list(session!.jwt),
    select: (data) => data.balances,
    refetchInterval: BALANCE_POLL_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * The currency the app leads with.
 *
 * Naira, because this is a naira product: people are paid in it, hand it over
 * in cash, and tap to spend it. Dollars are something you hold on purpose.
 */
export const HOME_CURRENCY: Currency = "NGN";

export function balanceIn(
  balances: CurrencyBalance[] | undefined,
  currency: Currency,
): CurrencyBalance | undefined {
  return balances?.find((b) => b.currency === currency);
}

/** True when a currency is worth showing on the home screen at all. */
export const worthShowing = (b: CurrencyBalance) =>
  b.currency === HOME_CURRENCY || b.available.minor !== 0 || b.escrow.minor !== 0;

// -----------------------------------------------------------------------------
// Activity
// -----------------------------------------------------------------------------

export function useActivity(limit = 30) {
  const { session, hydrated } = useSession();
  return useQuery({
    queryKey: ["ledger", "activity", session?.email ?? "", limit],
    enabled: hydrated && !!session,
    queryFn: () => activityApi.page(session!.jwt, limit),
    refetchInterval: ACTIVITY_POLL_MS,
  });
}

// -----------------------------------------------------------------------------
// Card
// -----------------------------------------------------------------------------

/**
 * The linked card, or null.
 *
 * A 404 here means "no card", which is an ordinary state for a new account and
 * not a failure -- so it resolves to null rather than throwing, and nothing
 * retries it.
 */
export function useCard() {
  const { session, hydrated } = useSession();
  return useQuery({
    queryKey: ["cards", "me", session?.email ?? ""],
    enabled: hydrated && !!session,
    queryFn: async () => {
      try {
        return await cardsApi.me(session!.jwt);
      } catch (err) {
        if (err instanceof Error && "status" in err && (err as { status: number }).status === 404) {
          return null;
        }
        throw err;
      }
    },
    retry: false,
  });
}

// -----------------------------------------------------------------------------
// Deposit address
// -----------------------------------------------------------------------------

/**
 * The holder's USDC deposit address on Base.
 *
 * Stable per person, so one saved in somebody else's contacts keeps working.
 * Not polled: an address does not change, and re-fetching it on a timer would
 * only add ways for it to briefly render as something else.
 */
export function useDepositAddress() {
  const { session, hydrated } = useSession();
  return useQuery({
    queryKey: ["deposits", "address", session?.email ?? ""],
    enabled: hydrated && !!session,
    queryFn: () => depositsApi.address(session!.jwt),
    staleTime: Infinity,
    retry: false,
  });
}

// -----------------------------------------------------------------------------
// Cash pledges
// -----------------------------------------------------------------------------

export function usePledges() {
  const { session, hydrated } = useSession();
  return useQuery({
    queryKey: ["cash", "pledges", session?.email ?? ""],
    enabled: hydrated && !!session,
    queryFn: () => cashApi.list(session!.jwt),
    select: (data) => data.pledges,
  });
}

/**
 * One pledge and the handover it is waiting on.
 *
 * Polled hard while it is live, because the person is standing at a counter
 * waiting for the other side to confirm, and not polled at all once it has
 * settled -- there is nothing left to change.
 */
export function usePledge(id: string | null, live = true) {
  const { session, hydrated } = useSession();
  return useQuery({
    queryKey: ["cash", "pledge", id],
    enabled: hydrated && !!session && !!id,
    queryFn: () => cashApi.get(id!, session!.jwt),
    refetchInterval: live ? 3_000 : false,
  });
}
