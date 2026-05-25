"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PiCheckCircleFill,
  PiPaperPlaneTiltBold,
  PiCoinBold,
} from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InputError } from "@/components/ui/InputError";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { SelectField } from "@/components/ui/SelectField";
import { ReceiptCard } from "@/components/ui/ReceiptCard";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import {
  useWallet,
  WALLET_MOCK,
  formatUsdc,
  formatNgnFromUsdc,
  USDC_COIN_TYPE,
  SUI_COIN_TYPE,
} from "@/lib/wallet";
import { useHaptic } from "@/lib/motion";

type Asset = "USDC" | "SUI";

const SUI_DECIMALS  = 9;
const USDC_DECIMALS = 6;

/**
 * Withdraw / send-to-address. Composes a Sui PTB that transfers either
 * USDC or native SUI to an arbitrary Sui address, signs via zkLogin,
 * and submits.
 *
 * In mock mode (default) the sign step is simulated. Real mode kicks
 * in when `NEXT_PUBLIC_WALLET_MOCK=0` and the session has
 * `zkLoginReady=true` (i.e. the user signed in through the proper
 * OAuth-with-nonce flow so on-chain signatures will be accepted).
 */
export default function SendPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const wallet = useWallet();
  const haptic = useHaptic();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount]       = useState("");
  const [asset, setAsset]         = useState<Asset>("USDC");
  const [phase, setPhase]         = useState<"compose" | "signing" | "submitting" | "done" | "error">("compose");
  const [error, setError]         = useState<string | null>(null);
  const [digest, setDigest]       = useState<string | null>(null);

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/send");
  }, [hydrated, session, router]);

  const availableSubunit = useMemo(() => {
    if (!wallet.data) return 0;
    return asset === "USDC" ? wallet.data.usdc_subunit : wallet.data.sui_mist;
  }, [wallet.data, asset]);

  const amountSubunit = useMemo(() => {
    const n = parseFloat(amount);
    if (!Number.isFinite(n) || n <= 0) return 0;
    const decimals = asset === "USDC" ? USDC_DECIMALS : SUI_DECIMALS;
    return Math.floor(n * 10 ** decimals);
  }, [amount, asset]);

  const validation = useMemo(() => {
    if (!recipient) return null;
    if (!isValidSuiAddress(recipient)) return "Recipient must be a valid Sui address (0x + 64 hex characters).";
    if (recipient.toLowerCase() === wallet.data?.sui_address.toLowerCase()) return "You can't send to your own wallet.";
    if (amountSubunit <= 0) return null;
    if (amountSubunit > availableSubunit) return `Not enough ${asset} in your wallet.`;
    return null;
  }, [recipient, amountSubunit, availableSubunit, asset, wallet.data]);

  async function submit() {
    if (!session) return;
    if (!recipient || !isValidSuiAddress(recipient)) {
      setError("Recipient address is required.");
      return;
    }
    if (amountSubunit <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    if (amountSubunit > availableSubunit) {
      setError(`Not enough ${asset} in your wallet.`);
      return;
    }
    setError(null);
    haptic.medium();
    setPhase("signing");

    try {
      if (WALLET_MOCK) {
        // Mock: simulate sign + submit, fabricate a digest.
        await new Promise((r) => setTimeout(r, 700));
        setPhase("submitting");
        await new Promise((r) => setTimeout(r, 600));
        setDigest("0xtx_mock_" + Date.now().toString(36));
      } else if (!session.zkLoginReady) {
        throw new Error(
          "Your sign-in didn't complete the full zkLogin handshake — sign out and back in to enable on-chain sends.",
        );
      } else {
        // Real path. Dynamic import keeps the heavy Sui+zkLogin code out
        // of the bundle until the user actually sends.
        const { executeZkLoginTx } = await import("@/lib/zklogin");
        const { Transaction } = await import("@mysten/sui/transactions");
        const { suiReadClient } = await import("@/lib/sui-client");

        const result = await executeZkLoginTx(async (tx: InstanceType<typeof Transaction>) => {
          // Pick coin objects owned by the sender, merge if many, split the
          // requested amount off, transfer. We deliberately do NOT split from
          // `tx.gas` for native SUI sends: under sponsored transactions the
          // gas coin is the sponsor's, so splitting from it would charge the
          // sponsor for the value transfer, not just the fees.
          const client = suiReadClient();
          const coinType = asset === "SUI" ? "0x2::sui::SUI" : USDC_COIN_TYPE;
          const coins = await client.getCoins({
            owner: session.suiAddress,
            coinType,
          });
          if (coins.data.length === 0) {
            throw new Error(`No ${asset} coin objects found in this wallet.`);
          }
          const inputs = coins.data.map((c) => tx.object(c.coinObjectId));
          const primary = inputs[0];
          if (inputs.length > 1) {
            tx.mergeCoins(primary, inputs.slice(1));
          }
          const [out] = tx.splitCoins(primary, [tx.pure.u64(BigInt(amountSubunit))]);
          tx.transferObjects([out], tx.pure.address(recipient));
        });

        setPhase("submitting");
        setDigest(result.digest);
      }
      setPhase("done");
      haptic.success();
      // Optimistic refresh after a beat.
      setTimeout(() => wallet.refetch(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed");
      setPhase("error");
      haptic.error();
    }
  }

  if (!hydrated || !session) return <Screen />;

  if (phase === "done") {
    return (
      <Screen centered>
        <AnimatedComponent
          variant={slideInOut}
          className="flex flex-col items-center gap-6 text-center"
        >
          <div className="grid size-20 place-items-center rounded-full bg-green-50 text-3xl text-green-700 dark:bg-green-900/20 dark:text-green-500">
            <PiCheckCircleFill />
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-medium text-neutral-900 dark:text-white">
              Sent
            </h1>
            <p className="text-sm text-gray-500 dark:text-white/50">
              {amount} {asset} on its way to {shorten(recipient)}.
            </p>
          </div>
          {digest ? (
            <p className="break-all rounded-full bg-gray-50 px-3 py-1.5 font-mono text-[11px] text-gray-500 dark:bg-white/5 dark:text-white/50">
              {digest}
            </p>
          ) : null}
          <div className="flex w-full gap-3">
            <Link href="/history" className="flex-1">
              <Button variant="secondary">See activity</Button>
            </Link>
            <Link href="/wallet" className="flex-1">
              <Button>Done</Button>
            </Link>
          </div>
        </AnimatedComponent>
      </Screen>
    );
  }

  return (
    <Screen>
      <AnimatedComponent
        variant={slideInOut}
        className="grid gap-6 py-10 text-sm text-neutral-900 dark:text-white"
      >
        <div className="space-y-2">
          <h1 className="flex items-center gap-2 text-xl font-medium">
            <PiPaperPlaneTiltBold className="text-gray-400" /> Send
          </h1>
          <p className="text-sm text-gray-500 dark:text-white/50">
            Withdraw {asset} on Sui to any address. Funds move on-chain.
          </p>
        </div>

        <div className="grid gap-4 rounded-3xl border border-gray-200 p-4 dark:border-white/10">
          <SelectField
            label="Asset"
            value={asset}
            onChange={(e) => setAsset(e.target.value as Asset)}
            required
          >
            <option value="USDC">USDC (Sui)</option>
            <option value="SUI">SUI (native)</option>
          </SelectField>

          <div className="grid gap-2">
            <label
              htmlFor="recipient"
              className="text-sm font-medium text-neutral-900 dark:text-white"
            >
              Recipient address <span className="text-rose-500">*</span>
            </label>
            <input
              id="recipient"
              type="text"
              autoCapitalize="off"
              autoComplete="off"
              spellCheck={false}
              value={recipient}
              onChange={(e) => setRecipient(e.target.value.trim())}
              placeholder="0x…"
              className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2 font-mono text-xs text-neutral-900 transition-all placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 dark:border-white/20 dark:bg-neutral-900 dark:text-white/80 dark:placeholder:text-white/30"
            />
          </div>

          <div className="grid gap-2">
            <div className="flex items-baseline justify-between">
              <label
                htmlFor="amount"
                className="text-sm font-medium text-neutral-900 dark:text-white"
              >
                Amount <span className="text-rose-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => {
                  const decimals = asset === "USDC" ? USDC_DECIMALS : SUI_DECIMALS;
                  setAmount((availableSubunit / 10 ** decimals).toString());
                }}
                className="text-xs font-medium text-blue-600 hover:text-blue-700 dark:text-blue-500"
              >
                Max
              </button>
            </div>
            <div className="relative">
              <input
                id="amount"
                type="number"
                inputMode="decimal"
                step="any"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-xl border border-gray-300 bg-white px-4 py-2 pr-16 text-sm tabular-nums text-neutral-900 transition-all placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 dark:border-white/20 dark:bg-neutral-900 dark:text-white/80 dark:placeholder:text-white/30"
              />
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs text-gray-400 dark:text-white/30">
                {asset}
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-white/50">
              <PiCoinBold className="-mt-0.5 mr-1 inline" />
              Available:{" "}
              <span className="font-medium tabular-nums">
                {asset === "USDC"
                  ? formatUsdc(availableSubunit) + " USDC"
                  : (availableSubunit / 1e9).toFixed(4) + " SUI"}
              </span>
            </p>
          </div>
        </div>

        {asset === "USDC" && amountSubunit > 0 && wallet.data ? (
          <ReceiptCard
            rows={[
              {
                label: "Amount",
                value: (
                  <span className="tabular-nums">
                    {formatUsdc(amountSubunit)} USDC
                  </span>
                ),
              },
              {
                label: "Equivalent",
                value: (
                  <span className="tabular-nums">
                    ≈ {formatNgnFromUsdc(amountSubunit, wallet.data.ngn_rate)}
                  </span>
                ),
              },
              { label: "Network",  value: "Sui" },
              { label: "Recipient", value: <span className="font-mono text-xs">{shorten(recipient || "—")}</span> },
            ]}
          />
        ) : null}

        {validation ? <InputError message={validation} /> : null}
        {error ? <InputError message={error} /> : null}

        {WALLET_MOCK ? (
          <InfoBanner>
            <p className="font-medium text-neutral-900 dark:text-white">
              Mock mode
            </p>
            <p className="mt-1 text-xs">
              No on-chain transaction is executed. Set{" "}
              <span className="font-mono">NEXT_PUBLIC_WALLET_MOCK=0</span> and
              sign in through the full Google flow to enable real sends.
            </p>
          </InfoBanner>
        ) : !session.zkLoginReady ? (
          <InfoBanner tone="warning">
            <p className="font-medium text-neutral-900 dark:text-white">
              zkLogin not ready
            </p>
            <p className="mt-1 text-xs">
              Your session used the legacy sign-in path. Sign out and back in
              to complete the zkLogin handshake — required for on-chain sends.
            </p>
          </InfoBanner>
        ) : null}

        {(phase === "signing" || phase === "submitting") && (
          <div className="flex flex-col items-center gap-2 py-2">
            <div className="loader" />
            <p className="text-xs text-gray-500 dark:text-white/50">
              {phase === "signing" ? "Signing on Sui…" : "Submitting…"}
            </p>
          </div>
        )}

        {(phase === "compose" || phase === "error") && (
          <div className="flex gap-3">
            <Link href="/wallet" className="flex-1">
              <Button variant="secondary">Cancel</Button>
            </Link>
            <div className="flex-1">
              <Button
                onClick={submit}
                disabled={!!validation || amountSubunit <= 0 || !recipient}
              >
                Send
              </Button>
            </div>
          </div>
        )}
      </AnimatedComponent>
    </Screen>
  );
}

function isValidSuiAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(addr.trim());
}

function shorten(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}
