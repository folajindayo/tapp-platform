"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PiCheckCircleFill } from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InputError } from "@/components/ui/InputError";
import { StatusChip } from "@/components/ui/StatusChip";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import { cardsApi, ApiError } from "@/lib/api";

export default function TopUpPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const [amount, setAmount] = useState("20");
  const [phase, setPhase] = useState<"ready" | "signing" | "done" | "error">("ready");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/cards/top-up");
  }, [hydrated, session, router]);

  async function go() {
    if (!session) return;
    const numericAmount = parseFloat(amount);
    if (isNaN(numericAmount) || numericAmount <= 0) return;
    setError(null);
    setPhase("signing");
    try {
      const card = await cardsApi.me(session.jwt);
      if (card.status !== "live" || !card.cap_object_id || !card.coin_type) {
        throw new Error("Your card isn't live yet — finish linking first.");
      }
      const packageId = process.env.NEXT_PUBLIC_TAPP_PACKAGE_ID;
      if (!packageId || !/^0x[0-9a-f]{64}$/i.test(packageId)) {
        throw new Error("Card package isn't configured.");
      }
      const usdcType = card.coin_type;
      const capId = card.cap_object_id;

      const zk = await import("@/lib/zklogin");
      const { Transaction } = await import("@mysten/sui/transactions");

      // top_up moves real USDC into the cap. Amount is USDC (6 decimals).
      const amountMicro = BigInt(Math.round(amount * 1_000_000));
      const owner = zk.readSession()?.suiAddress;
      if (!owner) throw new Error("No wallet address — please sign in again.");
      const { data: coins } = await zk.suiClient().getCoins({ owner, coinType: usdcType });
      const total = coins.reduce((s, c) => s + BigInt(c.balance), BigInt(0));
      if (total < amountMicro) {
        throw new Error(
          `Not enough USDC to top up $${amount} — your wallet has $${(Number(total) / 1e6).toFixed(2)}. Swap some SUI → USDC first.`,
        );
      }
      const coinIds = coins.map((c) => c.coinObjectId);

      const result = await zk.executeZkLoginTx((tx: InstanceType<typeof Transaction>) => {
        const primary = tx.object(coinIds[0]);
        if (coinIds.length > 1) {
          tx.mergeCoins(primary, coinIds.slice(1).map((id) => tx.object(id)));
        }
        const [funding] = tx.splitCoins(primary, [tx.pure.u64(amountMicro)]);
        tx.moveCall({
          target: `${packageId}::tapp_card::top_up`,
          typeArguments: [usdcType],
          arguments: [tx.object(capId), funding],
        });
      });
      console.info("top-up digest:", result.digest);
      setPhase("done");
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `${err.message}${err.code ? ` (${err.code})` : ""}`
          : err instanceof Error
            ? err.message
            : "Top-up failed";
      setError(msg);
      setPhase("error");
    }
  }

  if (phase === "done") {
    return (
      <Screen centered>
        <div className="flex flex-col items-center gap-6 text-center">
          <StatusChip tone="success" icon={<PiCheckCircleFill />}>
            Top-up sent
          </StatusChip>
          <p className="max-w-xs text-sm text-gray-500 dark:text-white/50">
            Your balance will update once the transaction confirms on Sui.
          </p>
          <Link href="/settings/card" className="w-full">
            <Button>Back to settings</Button>
          </Link>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <AnimatedComponent variant={slideInOut} className="grid gap-6 py-10 text-sm text-neutral-900 dark:text-white">
        <div className="space-y-2">
          <h1 className="text-xl font-medium">Top up your card</h1>
          <p className="text-sm text-gray-500 dark:text-white/50">
            Add USDC to your on-chain spending cap.
          </p>
        </div>

        <div className="grid gap-2 rounded-3xl border border-gray-200 p-4 transition-all dark:border-white/10">
          <div className="flex items-baseline justify-between">
            <label htmlFor="amount" className="text-sm font-medium">Amount</label>
          </div>
          <div className="relative">
            <input
              id="amount"
              type="number"
              inputMode="decimal"
              step="any"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2 pr-16 text-sm tabular-nums text-neutral-900 transition-all placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 dark:border-white/20 dark:bg-neutral-900 dark:text-white/80 dark:placeholder:text-white/30"
            />
            <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs text-gray-400 dark:text-white/30">
              USDC
            </span>
          </div>
          <p className="text-xs text-gray-400 dark:text-white/40">
            Sign with Google to confirm.
          </p>
        </div>

        {error ? <InputError message={error} /> : null}

        <div className="flex gap-3">
          <Link href="/settings/card" className="flex-1">
            <Button variant="secondary">Cancel</Button>
          </Link>
          <div className="flex-1">
            <Button
              onClick={go}
              loading={phase === "signing"}
              disabled={phase === "signing" || !amount || parseFloat(amount) <= 0 || isNaN(parseFloat(amount))}
            >
              Sign &amp; top up
            </Button>
          </div>
        </div>
      </AnimatedComponent>
    </Screen>
  );
}
