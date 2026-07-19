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
      const amountMicro = BigInt(Math.round(numericAmount * 1_000_000));
      const owner = zk.readSession()?.suiAddress;
      if (!owner) throw new Error("No wallet address — please sign in again.");
      const { fetchAllCoins, fetchSuiMist } = await import("@/lib/sui-client");
      const { walletApi, USDC_COIN_TYPE, SUI_COIN_TYPE } = await import("@/lib/wallet");
      const { calculatePaymentPlan } = await import("@/lib/payment-plan");

      // 1. Fetch user USDC coins (paginated + retry for indexer lag)
      let coins: { coinObjectId: string; balance: string }[] = [];
      let totalUsdc = BigInt(0);
      const MAX_ATTEMPTS = 4;
      const DELAY_MS = 1500;

      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        const allCoins = await fetchAllCoins(owner, usdcType);
        coins = allCoins.filter((c) => BigInt(c.balance) > BigInt(0));
        totalUsdc = coins.reduce((s, c) => s + BigInt(c.balance), BigInt(0));
        
        if (totalUsdc >= amountMicro) {
          break;
        }
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, DELAY_MS));
        }
      }

      let result;

      if (totalUsdc >= amountMicro) {
        // Option A: Standard USDC top-up (Sponsorable by gas-station)
        const coinIds = coins.map((c) => c.coinObjectId);
        result = await zk.executeZkLoginTx((tx: InstanceType<typeof Transaction>) => {
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
      } else {
        // Option B: Combined SUI + USDC top-up (Requires self-sponsor for swap payload)
        const suiMist = await fetchSuiMist(owner);
        const walletState = await walletApi.me(session.jwt, session.email, owner);
        const suiUsdcRate = walletState.sui_usdc_rate;

        const plan = calculatePaymentPlan(
          Number(amountMicro),
          Number(totalUsdc),
          suiMist,
          suiUsdcRate
        );

        if (!plan || plan.path !== "combined") {
          throw new Error(
            `Not enough USDC or SUI to top up $${amount} — your wallet has $${(Number(totalUsdc) / 1e6).toFixed(2)} USDC and ${(suiMist / 1e9).toFixed(4)} SUI. Swap some assets or load your wallet first.`
          );
        }

        // Initialize Cetus SDK for mainnet swap
        const { CetusClmmSDK, clmmMainnet } = await import("@cetusprotocol/sui-clmm-sdk");
        const sdk = new CetusClmmSDK(clmmMainnet);
        sdk.setSenderAddress(owner);

        const swapRes = await sdk.Swap.createSwapWithoutTransferCoinsPayload({
          pool_id: "0xb8d7d9e66a60c239e7a60110efcf8de6c705580ed924d0dde141f4a0e2c90105", // SUI/USDC 0.25% pool
          a2b: false, // B to A swap (SUI -> USDC)
          by_amount_in: true,
          amount: plan.suiNeededMist.toString(),
          amount_limit: plan.shortfallUsdcSubunit.toString(),
          coin_type_a: USDC_COIN_TYPE,
          coin_type_b: SUI_COIN_TYPE,
        });

        const tx = swapRes.tx;
        const coin_ab_s = swapRes.coin_ab_s; // coin_ab_s[0] is Coin A (USDC), coin_ab_s[1] is Coin B (SUI)

        // Transfer remaining SUI from the swap back to the user's wallet
        tx.transferObjects([coin_ab_s[1]], tx.pure.address(owner));

        let primaryUsdc: any = null;
        if (coins.length > 0) {
          const inputs = coins.map((c) => tx.object(c.coinObjectId));
          primaryUsdc = inputs[0];
          if (inputs.length > 1) {
            tx.mergeCoins(primaryUsdc, inputs.slice(1));
          }
          tx.mergeCoins(primaryUsdc, [coin_ab_s[0]]);
        } else {
          primaryUsdc = coin_ab_s[0];
        }

        // Split the exact top-up amount from the combined USDC pool
        const [funding] = tx.splitCoins(primaryUsdc, [tx.pure.u64(amountMicro)]);
        
        tx.moveCall({
          target: `${packageId}::tapp_card::top_up`,
          typeArguments: [usdcType],
          arguments: [tx.object(capId), funding],
        });

        // Transfer remaining USDC change back to sender if they had no USDC coins initially
        if (coins.length === 0) {
          tx.transferObjects([primaryUsdc], tx.pure.address(owner));
        }

        result = await zk.executeZkLoginTx(tx, { selfSponsor: true });
      }
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
