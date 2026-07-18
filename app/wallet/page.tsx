import { redirect } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PiQrCodeBold,
  PiArrowDownLeftBold,
  PiBankBold,
  PiArrowsLeftRightBold,
  PiWarningOctagonFill,
} from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { SwapModal } from "@/components/ui/SwapModal";
import { BalanceHero } from "@/components/ui/BalanceHero";
import { ActivityList } from "@/components/ui/ActivityList";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { CardAllowanceWidget } from "@/components/ui/CardAllowanceWidget";
import { NoCardBanner } from "@/components/ui/NoCardBanner";
import { CrossFade } from "@/components/ui/CrossFade";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import { useWallet, useWalletHistory } from "@/lib/wallet";
import { Web3Avatar } from "@/components/ui/Web3Avatar";

export default function WalletPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const wallet = useWallet();
  const history = useWalletHistory();
  const [swapOpen, setSwapOpen] = useState(false);

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/wallet");
  }, [hydrated, session, router]);

  if (!hydrated || !session) return <Screen />;

  return (
    <Screen>
      <AnimatedComponent
        variant={slideInOut}
        className="grid gap-6 py-10 text-sm text-neutral-900 dark:text-white"
      >
        <header className="flex items-center gap-3">
          <Web3Avatar address={session.suiAddress || session.email} size={42} />
          <div className="grid gap-0.5">
            <p className="text-xs text-gray-500 dark:text-white/50">
              Signed in as
            </p>
            <p className="break-all text-sm font-medium">{session.email}</p>
          </div>
        </header>

        <CrossFade
          className="grid gap-6"
          branchKey={
            wallet.isLoading
              ? "loading"
              : wallet.isError
                ? "error"
                : wallet.data
                  ? "ready"
                  : "empty"
          }
        >
        {wallet.isLoading ? (
          <div className="flex flex-col items-center gap-4 py-10">
            <div className="loader" />
            <p className="text-xs text-gray-400 dark:text-white/40">
              Loading your wallet…
            </p>
          </div>
        ) : wallet.isError ? (
          <InfoBanner
            tone="warning"
            icon={<PiWarningOctagonFill className="text-amber-500" />}
          >
            <p className="font-medium text-neutral-900 dark:text-white">
              Couldn&apos;t load your wallet
            </p>
            <p className="mt-1 text-xs">
              {wallet.error instanceof Error
                ? wallet.error.message
                : "Try again in a moment."}
            </p>
          </InfoBanner>
        ) : wallet.data ? (
          <>
            <div className="rounded-3xl border border-gray-200 p-5 dark:border-white/10">
              <BalanceHero
                usdcSubunit={wallet.data.usdc_subunit}
                suiMist={wallet.data.sui_mist}
                suiUsdcRate={wallet.data.sui_usdc_rate}
                ngnRate={wallet.data.ngn_rate}
              />
            </div>

            <div className="grid grid-cols-4 gap-2">
              <Link href="/pay" className="block w-full">
                <Button
                  variant="primary"
                  leadingIcon={<PiQrCodeBold className="text-base" />}
                  className="px-1 text-xs sm:text-sm [&>span]:whitespace-nowrap"
                >
                  Pay
                </Button>
              </Link>
              <Link href="/cash-out" className="block w-full">
                <Button
                  variant="secondary"
                  leadingIcon={<PiBankBold className="text-base" />}
                  className="px-1 text-xs sm:text-sm [&>span]:whitespace-nowrap"
                >
                  Cash out
                </Button>
              </Link>
              <Button
                variant="secondary"
                onClick={() => setSwapOpen(true)}
                leadingIcon={<PiArrowsLeftRightBold className="text-base" />}
                className="px-1 text-xs sm:text-sm [&>span]:whitespace-nowrap"
              >
                Swap
              </Button>
              <Link href="/deposit" className="block w-full">
                <Button
                  variant="secondary"
                  leadingIcon={<PiArrowDownLeftBold className="text-base" />}
                  className="px-1 text-xs sm:text-sm [&>span]:whitespace-nowrap"
                >
                  Receive
                </Button>
              </Link>
            </div>

            {!wallet.data.has_linked_card && <NoCardBanner />}

            {wallet.data.has_linked_card && wallet.data.card && (
              <CardAllowanceWidget card={wallet.data.card} />
            )}

            {wallet.data.card_needs_resync && (
              <InfoBanner
                tone="warning"
                icon={<PiWarningOctagonFill className="text-amber-500" />}
              >
                <p className="font-medium text-neutral-900 dark:text-white">
                  Card out of sync
                </p>
                <p className="mt-1 text-xs">
                  Run a quick resync to keep your card balance accurate.
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
            )}

            <div className="grid gap-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-white/30">
                  Recent activity
                </h2>
                {(history.data?.length ?? 0) > 5 && (
                  <Link
                    href="/history"
                    className="text-xs font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-500"
                  >
                    View all
                  </Link>
                )}
              </div>
              {history.isLoading ? (
                <div className="rounded-3xl border border-gray-200 bg-gray-50 p-8 text-center dark:border-white/10 dark:bg-white/5">
                  <div className="loader mx-auto" />
                </div>
              ) : (
                <ActivityList
                  items={(history.data ?? []).slice(0, 5)}
                  ngnRate={wallet.data.ngn_rate}
                  hrefFor={(tx) => `/tx/${encodeURIComponent(tx.digest)}`}
                  emptyState="No activity yet — deposit USDC to start."
                />
              )}
            </div>
          </>
        ) : null}
        </CrossFade>
      </AnimatedComponent>

      <SwapModal
        open={swapOpen}
        onClose={() => setSwapOpen(false)}
        onSwapped={() => {
          wallet.refetch();
          history.refetch();
        }}
      />
    </Screen>
  );
}
