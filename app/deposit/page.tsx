"use client";

import { useEffect, useState } from "react";
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
import { useWallet } from "@/lib/wallet";

export default function DepositPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const wallet = useWallet();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/deposit");
  }, [hydrated, session, router]);

  async function copy() {
    if (!wallet.data) return;
    try {
      await navigator.clipboard.writeText(wallet.data.sui_address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  async function share() {
    if (!wallet.data) return;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          title: "My Tapp wallet address",
          text:  `Send USDC on Sui to: ${wallet.data.sui_address}`,
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
            Send USDC or SUI to the address below — funds land in your wallet
            usually within a minute.
          </p>
        </div>

        {wallet.data ? (
          <>
            <div className="grid place-items-center gap-4 rounded-3xl border border-gray-200 p-6 dark:border-white/10">
              <div
                className="rounded-2xl overflow-hidden"
                style={{ borderRadius: 16 }}
              >
                <QRCode
                  value={wallet.data.sui_address}
                  qrStyle="fluid"
                  eyeRadius={12}
                  bgColor="#F9FAFB"
                  size={200}
                />
              </div>
              <p className="break-all text-center font-mono text-xs text-neutral-900 dark:text-white/80">
                {wallet.data.sui_address}
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
                Sui network only
              </p>
              <p className="mt-1 text-xs">
                Send USDC or native SUI on the Sui network — other assets or
                networks can be permanently lost. Always double-check before
                sending.
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
