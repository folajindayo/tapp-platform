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
  ApiError,
  activityApi,
  balancesApi,
  cardsApi,
  cashApi,
  depositsApi,
  kycApi,
  ngnDepositsApi,
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
 * Everything held, as one figure.
 *
 * Shares useBalances' query key, so both hooks are served by one request.
 * Undefined when the server could not price a conversion -- the caller then
 * falls back to the per-currency figures rather than inventing a total.
 */
export function useBalanceTotal() {
  const { session, hydrated } = useSession();
  return useQuery({
    queryKey: ["ledger", "balances", session?.email ?? ""],
    enabled: hydrated && !!session,
    queryFn: () => balancesApi.list(session!.jwt),
    select: (data) => data.total,
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
// Naira account
// -----------------------------------------------------------------------------

/**
 * The holder's own naira account number, or null when they have not opened one.
 *
 * A 404 means "not opened yet", which is the ordinary state of a new account
 * and not a failure -- so it resolves to null rather than throwing, and the
 * screen renders the step that opens one instead of an error.
 *
 * Not polled. An account number does not change, and re-fetching it on a timer
 * would only add ways for it to briefly render as something else while
 * somebody is copying it into their banking app.
 */
export function useNGNAccount() {
  const { session, hydrated } = useSession();
  return useQuery({
    queryKey: ["deposits", "ngn", session?.email ?? ""],
    enabled: hydrated && !!session,
    queryFn: async () => {
      try {
        return await ngnDepositsApi.account(session!.jwt);
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    staleTime: Infinity,
    retry: false,
  });
}

// -----------------------------------------------------------------------------
// Identity verification
// -----------------------------------------------------------------------------

/**
 * How far the holder has verified, and what that lets them move.
 *
 * The limits come from the server rather than a table in this app, because the
 * question somebody is answering before handing over a BVN is "what do I get
 * for this" -- and two copies of that answer will drift.
 */
export function useKycStatus() {
  const { session, hydrated } = useSession();
  return useQuery({
    queryKey: ["kyc", "status", session?.email ?? ""],
    enabled: hydrated && !!session,
    queryFn: () => kycApi.status(session!.jwt),
    staleTime: 60_000,
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
