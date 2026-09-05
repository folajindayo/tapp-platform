"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCode } from "react-qrcode-logo";
import { HiOutlineDuplicate, HiCheck, HiOutlineShare } from "react-icons/hi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InfoBanner } from "@/components/ui/InfoBanner";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import { formatUsdc, useWallet } from "@/lib/wallet";

export default function DepositPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const wallet = useWallet();
  const [copied, setCopied] = useState(false);
  const initialBalanceRef = useRef<number | null>(null);
  const [receivedDeposit, setReceivedDeposit] = useState<number | null>(null);

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/deposit");
  }, [hydrated, session, router]);

  // Active polling every 3.5s while user is viewing the deposit page
  useEffect(() => {
    const timer = window.setInterval(() => {
      wallet.refetch();
    }, 3500);
    return () => window.clearInterval(timer);
  }, [wallet]);

  // Detect incoming deposits in real-time
  useEffect(() => {
    if (!wallet.data) return;
    if (initialBalanceRef.current === null) {
      initialBalanceRef.current = wallet.data.usdc_subunit;
      return;
    }
    if (wallet.data.usdc_subunit > initialBalanceRef.current) {
      const diff = wallet.data.usdc_subunit - initialBalanceRef.current;
      setReceivedDeposit(diff);
      initialBalanceRef.current = wallet.data.usdc_subunit;
    }
  }, [wallet.data]);

  const depositAddress = wallet.data
    ? (wallet.data.evm_address || wallet.data.sui_address)
    : "";

  async function copy() {
    if (!depositAddress) return;
    try {
      await navigator.clipboard.writeText(depositAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  async function share() {
    if (!depositAddress) return;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          title: "My Tapp wallet address",
          text: `Send USDC on Base to: ${depositAddress}`,
        });
      } catch {
        // user dismissed; fall back to copy
      }
    } else {
      await copy();
    }
  }

  if (!hydrated || !session) return <Screen />;

  return (
    <Screen>
      <AnimatedComponent
        variant={slideInOut}
        className="grid gap-6 py-10 text-sm text-neutral-900 dark:text-white"
      >
        <div className="space-y-2">
          <h1 className="text-xl font-medium">Receive</h1>
          <p className="text-sm text-gray-500 dark:text-white/50">
            Send USDC on Base to the address below — funds land in your wallet
            usually within a minute.
          </p>
        </div>

        {receivedDeposit !== null && (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-green-900 dark:border-green-800/40 dark:bg-green-950/40 dark:text-green-300">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-sm">Deposit Confirmed!</p>
                <p className="text-xs text-green-700 dark:text-green-400">
                  +{formatUsdc(receivedDeposit)} USDC has arrived in your wallet.
                </p>
              </div>
              <Button
                variant="primary"
                onClick={() => router.push("/")}
                className="py-1.5 px-3 text-xs bg-green-600 hover:bg-green-700"
              >
                View wallet
              </Button>
            </div>
          </div>
        )}

        {/* Network Indicator — Base USDC only */}
        <div className="flex items-center justify-between rounded-2xl border border-blue-500/20 bg-blue-500/5 p-3 dark:border-blue-500/30 dark:bg-blue-500/10">
          <div className="flex items-center gap-3">
            <div className="flex size-9 items-center justify-center rounded-xl bg-blue-600 text-white font-bold text-sm shadow-sm">
              $
            </div>
            <div>
              <div className="flex items-center gap-1.5 font-semibold text-neutral-900 dark:text-white text-sm">
                USDC
                <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                  Base
                </span>
              </div>
              <p className="text-[11px] text-gray-500 dark:text-white/60">
                USD Coin on Base Mainnet
              </p>
            </div>
          </div>
        </div>

        {wallet.data ? (
          <>
            <div className="grid place-items-center gap-4 rounded-3xl border border-gray-200 p-6 dark:border-white/10">
              <div
                className="rounded-2xl overflow-hidden"
                style={{ borderRadius: 16 }}
              >
                <QRCode
                  value={depositAddress}
                  qrStyle="fluid"
                  eyeRadius={12}
                  bgColor="#F9FAFB"
                  size={200}
                  logoImage="/tapp-logo.svg"
                  logoWidth={35}
                  logoHeight={35}
                  logoPadding={3}
                />
              </div>
              <p className="break-all text-center font-mono text-xs text-neutral-900 dark:text-white/80">
                {depositAddress}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Button
                variant="primary"
                onClick={copy}
                leadingIcon={
                  copied ? (
                    <HiCheck className="text-base" />
                  ) : (
                    <HiOutlineDuplicate className="text-base" />
                  )
                }
              >
                {copied ? "Copied" : "Copy address"}
              </Button>
              <Button
                variant="secondary"
                onClick={share}
                leadingIcon={<HiOutlineShare className="text-base" />}
              >
                Share
              </Button>
            </div>

            <InfoBanner>
              <p className="font-medium text-neutral-900 dark:text-white">
                Base Mainnet only
              </p>
              <p className="mt-1 text-xs">
                Only send USDC on the Base network to this address. Sending tokens on the wrong network may result in permanent loss.
              </p>
            </InfoBanner>
          </>
        ) : (
          <div className="flex justify-center py-20">
            <div className="loader" />
          </div>
        )}
      </AnimatedComponent>
    </Screen>
  );
}
