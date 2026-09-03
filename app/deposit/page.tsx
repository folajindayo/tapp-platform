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
  const [selectedNetwork, setSelectedNetwork] = useState<"base" | "sui">("base");

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/deposit");
  }, [hydrated, session, router]);

  const depositAddress = wallet.data
    ? selectedNetwork === "base"
      ? (wallet.data.evm_address || wallet.data.sui_address)
      : wallet.data.sui_address
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
          text: `Send USDC on ${selectedNetwork === "base" ? "Base" : "Sui"} to: ${depositAddress}`,
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
            Send USDC on Base or Sui to the address below — funds land in your wallet
            usually within a minute.
          </p>
        </div>

        {/* Network Selector Tabs */}
        <div className="grid grid-cols-2 p-1 bg-gray-100 dark:bg-white/5 rounded-2xl text-xs font-semibold text-center select-none">
          <button
            type="button"
            onClick={() => setSelectedNetwork("base")}
            className={`py-2.5 rounded-xl transition-all ${
              selectedNetwork === "base"
                ? "bg-blue-600 text-white shadow-sm font-bold"
                : "text-gray-500 dark:text-white/40 hover:text-neutral-900 dark:hover:text-white"
            }`}
          >
            Base Network (USDC)
          </button>
          <button
            type="button"
            onClick={() => setSelectedNetwork("sui")}
            className={`py-2.5 rounded-xl transition-all ${
              selectedNetwork === "sui"
                ? "bg-blue-600 text-white shadow-sm font-bold"
                : "text-gray-500 dark:text-white/40 hover:text-neutral-900 dark:hover:text-white"
            }`}
          >
            Sui Network (USDC/SUI)
          </button>
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
                {selectedNetwork === "base" ? "Base Mainnet USDC" : "Sui network only"}
              </p>
              <p className="mt-1 text-xs">
                {selectedNetwork === "base"
                  ? "Send USDC on the Base Mainnet (EVM) network. Always double-check network and address before sending."
                  : "Send USDC or native SUI on the Sui network — other assets or networks can be permanently lost."}
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
