"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PiCheckCircleFill,
  PiPaperPlaneTiltBold,
  PiCoinBold,
  PiArrowSquareOutBold,
} from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InputError } from "@/components/ui/InputError";
import { ReceiptCard } from "@/components/ui/ReceiptCard";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import {
  useWallet,
  formatUsdc,
  formatNgnFromUsdc,
} from "@/lib/wallet";
import { useHaptic } from "@/lib/motion";

const USDC_DECIMALS = 6;

/**
 * Send Base USDC to any 0x EVM address.
 */
export default function SendPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const wallet = useWallet();
  const haptic = useHaptic();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount]       = useState("");
  const [phase, setPhase]         = useState<"compose" | "signing" | "submitting" | "done" | "error">("compose");
  const [error, setError]         = useState<string | null>(null);
  const [digest, setDigest]       = useState<string | null>(null);

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/send");
  }, [hydrated, session, router]);

  const availableSubunit = useMemo(() => {
    return wallet.data?.usdc_subunit ?? 0;
  }, [wallet.data]);

  const amountSubunit = useMemo(() => {
    const n = parseFloat(amount);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.floor(n * 10 ** USDC_DECIMALS);
  }, [amount]);

  const validation = useMemo(() => {
    if (!recipient) return null;
    if (!isValidBaseAddress(recipient)) return "Recipient must be a valid Base address (0x followed by 40 hex characters).";
    if (wallet.data?.evm_address && recipient.toLowerCase() === wallet.data.evm_address.toLowerCase()) {
      return "You can't send to your own wallet address.";
    }
    if (amountSubunit <= 0) return null;
    if (amountSubunit > availableSubunit) return "Not enough USDC in your wallet.";
    return null;
  }, [recipient, amountSubunit, availableSubunit, wallet.data]);

  async function submit() {
    if (!session) return;
    if (!recipient || !isValidBaseAddress(recipient)) {
      setError("Recipient address must be a valid Base address (0x + 40 hex chars).");
      return;
    }
    if (amountSubunit <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    if (amountSubunit > availableSubunit) {
      setError("Not enough USDC in your wallet.");
      return;
    }

    setError(null);
    haptic.medium();
    setPhase("signing");

    try {
      await new Promise((r) => setTimeout(r, 400));
      setPhase("submitting");

      const res = await fetch("/api/send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.jwt}`,
        },
        body: JSON.stringify({
          recipient: recipient.trim(),
          amountSubunit,
          senderAddress: session.evmAddress || session.suiAddress,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.status !== "success" || !body.data?.digest) {
        throw new Error(body.message || `Send failed (${res.status})`);
      }

      setDigest(body.data.digest);
      setPhase("done");
      haptic.success();
      // Refetch balance after short beat
      setTimeout(() => wallet.refetch(), 1200);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[send] transfer failed", err);
      setError(msg);
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
              {amount} USDC on its way to {shorten(recipient)}.
            </p>
          </div>
          {digest ? (
            <a
              href={`https://basescan.org/tx/${digest}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 break-all rounded-full bg-gray-50 px-3 py-1.5 font-mono text-[11px] text-blue-600 hover:underline dark:bg-white/5 dark:text-blue-400"
            >
              <span>{shorten(digest)}</span>
              <PiArrowSquareOutBold className="text-xs shrink-0" />
            </a>
          ) : null}
          <div className="flex w-full gap-3">
            <Link href="/history" className="flex-1">
              <Button variant="secondary">See activity</Button>
            </Link>
            <Link href="/" className="flex-1">
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
          <p className="text-[12px] text-gray-500 dark:text-white/50">
            Send USDC on Base to any address. Instant and low-fee.
          </p>
        </div>

        <div className="grid gap-4 rounded-3xl border border-gray-200 p-4 dark:border-white/10">
          {/* Asset Indicator - Pure Base USDC */}
          <div className="grid gap-1.5">
            <label className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-white/40">
              Asset &amp; Network
            </label>
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
          </div>

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
              placeholder="0x… (Base EVM address)"
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
                  setAmount((availableSubunit / 10 ** USDC_DECIMALS).toString());
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
              <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-xs text-gray-400 dark:text-white/30 font-medium">
                USDC
              </span>
            </div>
            <p className="text-xs text-gray-500 dark:text-white/50">
              <PiCoinBold className="-mt-0.5 mr-1 inline" />
              Available:{" "}
              <span className="font-medium tabular-nums">
                {formatUsdc(availableSubunit)} USDC
              </span>
              {wallet.data?.ngn_rate ? (
                <span className="ml-1 text-gray-400 dark:text-white/40">
                  (≈ {formatNgnFromUsdc(availableSubunit, wallet.data.ngn_rate)})
                </span>
              ) : null}
            </p>
          </div>
        </div>

        {amountSubunit > 0 && wallet.data ? (
          <ReceiptCard
            rows={[
              {
                label: "Amount",
                value: (
                  <span className="tabular-nums font-medium">
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
              { label: "Network",  value: "Base" },
              { label: "Recipient", value: <span className="font-mono text-xs">{shorten(recipient || "—")}</span> },
            ]}
          />
        ) : null}

        {validation ? <InputError message={validation} /> : null}
        {error ? <InputError message={error} /> : null}

        {(phase === "signing" || phase === "submitting") && (
          <div className="flex flex-col items-center gap-2 py-2">
            <div className="loader" />
            <p className="text-xs text-gray-500 dark:text-white/50">
              {phase === "signing" ? "Preparing transaction…" : "Broadcasting on Base…"}
            </p>
          </div>
        )}

        {(phase === "compose" || phase === "error") && (
          <div className="flex gap-3">
            <Link href="/" className="flex-1">
              <Button variant="secondary">Cancel</Button>
            </Link>
            <div className="flex-1">
              <Button
                onClick={submit}
                disabled={!!validation || amountSubunit <= 0 || !recipient}
              >
                Send USDC
              </Button>
            </div>
          </div>
        )}
      </AnimatedComponent>
    </Screen>
  );
}

function isValidBaseAddress(addr: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(addr.trim());
}

function shorten(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}
