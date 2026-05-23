"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PiArrowLeftBold,
  PiCaretRightBold,
  PiCreditCardBold,
  PiSlidersHorizontalBold,
  PiLockKeyBold,
  PiQuestionBold,
  PiSignOutBold,
} from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import { useWallet, shortenAddress } from "@/lib/wallet";
import { Web3Avatar } from "@/components/ui/Web3Avatar";

export default function SettingsPage() {
  const router = useRouter();
  const { hydrated, session, clear } = useSession();
  const wallet = useWallet();

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/settings");
  }, [hydrated, session, router]);

  if (!hydrated || !session) return <Screen />;

  return (
    <Screen>
      <AnimatedComponent
        variant={slideInOut}
        className="grid gap-6 py-10 text-sm text-neutral-900 dark:text-white"
      >
        <Link
          href="/wallet"
          className="inline-flex w-fit items-center gap-1 text-xs font-medium text-gray-500 transition-colors hover:text-neutral-900 dark:text-white/50 dark:hover:text-white"
        >
          <PiArrowLeftBold /> Back to wallet
        </Link>

        <div className="flex items-center gap-3">
          <Web3Avatar address={session.suiAddress || session.email} size={42} />
          <div className="grid gap-0.5">
            <h1 className="text-xl font-medium">Settings</h1>
            <p className="break-all text-sm text-gray-500 dark:text-white/50">
              {session.email}
            </p>
          </div>
        </div>

        <div className="grid divide-y divide-dashed divide-gray-200 overflow-hidden rounded-3xl border border-gray-200 dark:divide-white/10 dark:border-white/10">
          <SettingsRow
            href="/settings/card"
            icon={<PiCreditCardBold />}
            title="Linked Tapp Card"
            subtitle={
              wallet.data?.has_linked_card
                ? "Manage your physical card"
                : "Link a card for contactless spending"
            }
            badge={
              wallet.data?.has_linked_card ? (
                <StatusChip tone="success">Linked</StatusChip>
              ) : (
                <StatusChip>None</StatusChip>
              )
            }
          />
          {wallet.data?.has_linked_card && (
            <SettingsRow
              href="/settings/limits"
              icon={<PiSlidersHorizontalBold />}
              title="Spend limits"
              subtitle="Daily, per-tap, step-up threshold"
            />
          )}
          <SettingsRow
            href="/settings/security"
            icon={<PiLockKeyBold />}
            title="Security"
            subtitle="Change PIN, sign out"
          />
        </div>

        <div className="grid gap-2 rounded-3xl border border-gray-200 p-4 dark:border-white/10">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-white/30">
            Wallet address
          </p>
          <p className="select-all break-all font-mono text-xs text-neutral-900 dark:text-white/80">
            {wallet.data ? wallet.data.sui_address : "—"}
          </p>
          <p className="text-xs text-gray-500 dark:text-white/50">
            {wallet.data ? shortenAddress(wallet.data.sui_address) : ""} ·
            {process.env.NEXT_PUBLIC_SUI_NETWORK === "mainnet" ? "Sui Mainnet" : "Sui Testnet"}
          </p>
        </div>

        <div className="grid divide-y divide-dashed divide-gray-200 overflow-hidden rounded-3xl border border-gray-200 dark:divide-white/10 dark:border-white/10">
          <SettingsRow
            href="mailto:labs@zoracle.xyz"
            icon={<PiQuestionBold />}
            title="Help &amp; support"
            subtitle="labs@zoracle.xyz"
            external
          />
          <button
            type="button"
            onClick={clear}
            className="flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-white/5"
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gray-50 text-rose-500 dark:bg-white/5">
              <PiSignOutBold />
            </span>
            <div className="grid flex-1 gap-0.5">
              <p className="font-medium text-rose-500">Sign out</p>
              <p className="text-xs text-gray-500 dark:text-white/50">
                Sign back in with Google to restore access.
              </p>
            </div>
          </button>
        </div>
      </AnimatedComponent>
    </Screen>
  );
}

function SettingsRow({
  href,
  icon,
  title,
  subtitle,
  badge,
  external,
}: {
  href: string;
  icon: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  badge?: React.ReactNode;
  external?: boolean;
}) {
  const inner = (
    <div className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-white/5">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gray-50 text-gray-500 dark:bg-white/5 dark:text-white/60">
        {icon}
      </span>
      <div className="grid flex-1 gap-0.5">
        <p className="font-medium text-neutral-900 dark:text-white">{title}</p>
        {subtitle ? (
          <p className="text-xs text-gray-500 dark:text-white/50">{subtitle}</p>
        ) : null}
      </div>
      {badge ?? <PiCaretRightBold className="text-gray-400 dark:text-white/40" />}
    </div>
  );
  if (external) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {inner}
      </a>
    );
  }
  return <Link href={href}>{inner}</Link>;
}
