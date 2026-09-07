"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PiWarningOctagonFill } from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { Balances, BalanceActions } from "@/components/ui/Balances";
import { MovementList } from "@/components/ui/MovementList";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { CardAllowanceWidget } from "@/components/ui/CardAllowanceWidget";
import { NoCardBanner } from "@/components/ui/NoCardBanner";
import { SectionLabel, Surface, EmptyState } from "@/components/ui/Surface";
import { CrossFade } from "@/components/ui/CrossFade";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { Web3Avatar } from "@/components/ui/Web3Avatar";
import { useSession } from "@/lib/auth";
import { useBalances, useActivity, useCard } from "@/lib/ledger";

/**
 * The wallet, and the app's home screen.
 *
 * One implementation behind both routes. They were two copies of the same
 * screen, which is how "/" and "/wallet" came to show different things -- a
 * fix applied to one of them silently did not apply to the other.
 */
export function WalletScreen() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const balances = useBalances();
  const activity = useActivity(6);
  const card = useCard();

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/wallet");
  }, [hydrated, session, router]);

  if (!hydrated || !session) return <Screen />;

  return (
    <Screen>
      <AnimatedComponent variant={slideInOut} className="grid gap-6 py-10">
        <header className="flex items-center gap-3">
          <Web3Avatar address={session.email} size={42} />
          <div className="grid gap-0.5">
            <p className="text-xs text-[var(--fg-muted)]">Signed in as</p>
            <p className="break-all text-sm font-medium text-[var(--fg)]">
              {session.email}
            </p>
          </div>
        </header>

        <CrossFade
          className="grid gap-6"
          branchKey={
            balances.isLoading
              ? "loading"
              : balances.isError
                ? "error"
                : "ready"
          }
        >
          {balances.isLoading ? (
            <div className="flex flex-col items-center gap-4 py-10">
              <div className="loader" />
              <p className="text-xs text-[var(--fg-subtle)]">Loading your balance…</p>
            </div>
          ) : balances.isError ? (
            /* An unreadable balance is an error, never a zero. Its predecessor
               answered zero whenever the RPC provider was unreachable, so an
               outage and an empty account looked identical. */
            <InfoBanner tone="warning" icon={<PiWarningOctagonFill className="text-amber-500" />}>
              <p className="font-medium text-[var(--fg)]">
                Couldn&apos;t load your balance
              </p>
              <p className="mt-1 text-xs">
                {balances.error instanceof Error
                  ? balances.error.message
                  : "Try again in a moment."}
              </p>
            </InfoBanner>
          ) : (
            <>
              <Balances balances={balances.data ?? []} />
              <BalanceActions />

              {card.data === null ? <NoCardBanner /> : null}
              {card.data ? <CardAllowanceWidget card={card.data} /> : null}

              {card.data?.needs_resync ? (
                <InfoBanner tone="warning" icon={<PiWarningOctagonFill className="text-amber-500" />}>
                  <p className="font-medium text-[var(--fg)]">Card out of sync</p>
                  <p className="mt-1 text-xs">
                    A quick resync keeps it working at the counter.
                  </p>
                  <Link href="/cards/resync" className="mt-3 inline-block">
                    <Button
                      variant="secondary"
                      fullWidth={false}
                      className="px-3 py-1.5 text-xs"
                    >
                      Resync now
                    </Button>
                  </Link>
                </InfoBanner>
              ) : null}

              <div className="grid gap-3">
                <SectionLabel
                  action={
                    activity.data?.nextCursor ? (
                      <Link
                        href="/history"
                        className="text-xs font-medium text-[var(--accent)]"
                      >
                        View all
                      </Link>
                    ) : undefined
                  }
                >
                  Recent activity
                </SectionLabel>

                {activity.isLoading ? (
                  <Surface kind="sunken" radius="3xl" className="grid place-items-center py-8">
                    <div className="loader" />
                  </Surface>
                ) : (
                  <MovementList
                    movements={activity.data?.movements ?? []}
                    emptyState={
                      <EmptyState title="No activity yet">
                        Add cash through an agent, or receive USDC on Base, and
                        it will show up here.
                      </EmptyState>
                    }
                  />
                )}
              </div>
            </>
          )}
        </CrossFade>
      </AnimatedComponent>
    </Screen>
  );
}
