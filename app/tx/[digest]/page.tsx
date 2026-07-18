"use client";

import { use, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PiArrowLeftBold,
  PiCheckCircleFill,
  PiClockBold,
  PiXCircleFill,
  PiArrowDownLeftBold,
  PiArrowUpRightBold,
  PiArrowSquareOutBold,
} from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { ReceiptCard } from "@/components/ui/ReceiptCard";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import {
  useTransaction,
  useWallet,
  formatUsdc,
  formatUsdcSigned,
  formatNgnFromUsdc,
  formatTimeAgo,
} from "@/lib/wallet";

const kindLabel: Record<string, string> = {
  pay: "Merchant payment",
  deposit: "Deposit received",
  topup: "Card top up",
  refund: "Refund received",
};

function shorten(str: string): string {
  if (str.length <= 16) return str;
  return `${str.slice(0, 8)}…${str.slice(-6)}`;
}

export default function TxPage({
  params,
}: {
  params: Promise<{ digest: string }>;
}) {
  const { digest } = use(params);
  const router = useRouter();
  const { hydrated, session } = useSession();
  const wallet = useWallet();
  const tx = useTransaction(digest);

  useEffect(() => {
    if (hydrated && !session)
      router.replace(`/sign-in?next=/tx/${encodeURIComponent(digest)}`);
  }, [hydrated, session, router, digest]);

  if (!hydrated || !session) return <Screen />;

  if (tx.isLoading || !wallet.data) {
    return (
      <Screen centered>
        <div className="loader" />
      </Screen>
    );
  }

  if (!tx.data) {
    return (
      <Screen centered>
        <div className="flex flex-col items-center gap-6 text-center">
          <h1 className="text-xl font-medium text-neutral-900 dark:text-white">
            Transaction not found
          </h1>
          <Link href="/history" className="w-full">
            <Button variant="secondary">Back to activity</Button>
          </Link>
        </div>
      </Screen>
    );
  }

  const t = tx.data;
  const inflow = t.amount_subunit > 0;
  const isPay = t.kind === "pay";

  const HeroIcon =
    t.status === "declined"
      ? PiXCircleFill
      : t.status === "pending"
        ? PiClockBold
        : inflow
          ? PiArrowDownLeftBold
          : PiArrowUpRightBold;

  const heroBg =
    t.status === "declined"
      ? "bg-rose-50 text-rose-500 dark:bg-rose-900/20"
      : t.status === "pending"
        ? "bg-amber-50 text-amber-500 dark:bg-amber-900/20"
        : inflow
          ? "bg-orange-50 text-orange-700 dark:bg-orange-900/20 dark:text-orange-400"
          : "bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-white/50";

  return (
    <Screen>
      <AnimatedComponent
        variant={slideInOut}
        className="grid gap-4 py-4 text-sm text-neutral-900 dark:text-white"
      >
        <Link
          href="/history"
          className="inline-flex w-fit items-center gap-1 text-xs font-medium text-gray-500 transition-colors hover:text-neutral-900 dark:text-white/50 dark:hover:text-white"
        >
          <PiArrowLeftBold /> Back to activity
        </Link>

        <div className="grid place-items-center gap-2 text-center">
          <span
            className={`grid size-14 place-items-center rounded-full text-2xl ${heroBg}`}
          >
            <HeroIcon />
          </span>
          <p className="font-medium tabular-nums text-neutral-900 dark:text-white">
            <span className="text-2xl">
              {formatUsdcSigned(t.amount_subunit)}
            </span>{" "}
            <span className="text-sm text-gray-500 dark:text-white/50">
              USDC
            </span>
          </p>
          <p className="text-xs text-gray-500 dark:text-white/50">
            ≈ {formatNgnFromUsdc(t.amount_subunit, wallet.data.ngn_rate)} ·{" "}
            {kindLabel[t.kind] ?? t.kind}
          </p>
          <StatusChip
            tone={
              t.status === "success"
                ? "success"
                : t.status === "pending"
                  ? "pending"
                  : "error"
            }
            icon={
              t.status === "success" ? (
                <PiCheckCircleFill />
              ) : t.status === "pending" ? (
                <PiClockBold />
              ) : (
                <PiXCircleFill />
              )
            }
          >
            {t.status.charAt(0).toUpperCase() + t.status.slice(1)}
          </StatusChip>
        </div>

        <ReceiptCard
          rows={[
            ...(isPay && t.merchant
              ? [{ label: "Merchant", value: t.merchant }]
              : []),
            ...(t.reference
              ? [
                  {
                    label: "Reference",
                    value: (
                      <span className="font-mono text-xs">
                        {shorten(t.reference)}
                      </span>
                    ),
                  },
                ]
              : []),

            { label: "Network", value: "Sui" },
            {
              label: "Date",
              value: new Date(t.at).toLocaleString(undefined, {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            },
            {
              label: "Digest",
              value: (
                <a
                  href={`https://suiscan.xyz/${process.env.NEXT_PUBLIC_SUI_NETWORK ?? "testnet"}/tx/${t.digest}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-xs text-blue-600 hover:underline dark:text-blue-400"
                >
                  {shorten(t.digest)}
                  <PiArrowSquareOutBold className="text-[10px]" />
                </a>
              ),
            },
          ]}
        />

        <Link href="/" className="w-full">
          <Button variant="secondary">Back to wallet</Button>
        </Link>
      </AnimatedComponent>
    </Screen>
  );
}
