"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PiArrowLeftBold,
  PiCheckCircleFill,
  PiStorefrontFill,
  PiFingerprintBold,
} from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { ReceiptCard } from "@/components/ui/ReceiptCard";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { InputError } from "@/components/ui/InputError";
import { CountdownPill } from "@/components/ui/CountdownPill";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { motion } from "framer-motion";
import { signOut, useSession } from "@/lib/auth";
import {
  useOrder,
  useWallet,
  walletApi,
  formatUsdc,
  formatNgnFromUsdc,
  orderStreamURL,
} from "@/lib/wallet";
import { useHaptic } from "@/lib/motion";
import { SessionExpiredError } from "@/lib/zklogin";
import { calculatePaymentPlan } from "@/lib/payment-plan";
import { clientLogger } from "@/lib/client-logger";

// Lifecycle: review → (optional step-up) → signing → submitting
//   → submitted   (chain tx confirmed; awaiting Rails indexer)
//   → bridging    (Rails has started LiFi bridge)
//   → fulfilled   (LP filled — settlement imminent)
//   → done        (fiat at merchant — final success)
// Plus failure branches: expired, error, refunded.
type Phase =
  | "review"
  | "step-up"
  | "signing"
  | "submitting"
  | "submitted"
  | "bridging"
  | "fulfilled"
  | "done"
  | "expired"
  | "error"
  | "refunded";

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { hydrated, session } = useSession();
  const wallet = useWallet();
  const order = useOrder(id);

  const [phase, setPhase] = useState<Phase>("review");
  const [error, setError] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const haptic = useHaptic();

  // Compute the payment plan dynamically based on order details and user balances
  const paymentPlan = (wallet.data && order.data) ? calculatePaymentPlan(
    order.data.amount_subunit,
    wallet.data.usdc_subunit,
    wallet.data.sui_mist,
    wallet.data.sui_usdc_rate
  ) : null;

  const insufficient = !paymentPlan;

  useEffect(() => {
    if (hydrated && !session) {
      clientLogger.info("checkout-page", "unauthorized session, redirecting to sign-in", { orderId: id });
      router.replace(`/sign-in?next=/order/${encodeURIComponent(id)}`);
    }
  }, [hydrated, session, router, id]);

  useEffect(() => {
    clientLogger.info("checkout-page", "page state transition", {
      orderId: id,
      phase,
      hasWallet: !!wallet.data,
      hasOrder: !!order.data,
      paymentPlanPath: paymentPlan?.path,
    });
  }, [id, phase, !!wallet.data, !!order.data, paymentPlan?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  async function confirm() {
    if (!session || !order.data) return;
    setError(null);
    haptic.medium();

    clientLogger.info("checkout-page", "confirming order payment", {
      orderId: order.data.id,
      path: paymentPlan?.path,
    });

    if (order.data.step_up_required && phase !== "step-up") {
      clientLogger.info("checkout-page", "biometric step-up verification required first");
      setPhase("step-up");
      return;
    }

    setPhase("signing");
    try {
      setTimeout(() => setPhase((p) => (p === "signing" ? "submitting" : p)), 600);
      const res = await walletApi.confirmOrder(session.jwt, order.data, {
        suiAddress:    session.suiAddress,
        zkLoginReady:  session.zkLoginReady,
      }, paymentPlan ?? undefined);
      setDigest(res.digest);
      // We don't jump to "done" yet — Rails still has to bridge + settle.
      // The SSE subscription below advances the phase through bridging
      // → fulfilled → done as the on-chain pipeline progresses.
      setPhase("submitted");
      haptic.success();
    } catch (err) {
      clientLogger.error("checkout-page", "payment execution failed", { err: String(err) });
      // Expired-JWT → sign out + back to /sign-in with this order as
      // the post-login redirect. Avoids surfacing raw Rails JSON to
      // the user and lets them resume the same payment after auth.
      if (err instanceof SessionExpiredError || (err instanceof Error && /session has expired/i.test(err.message))) {
        haptic.error();
        signOut();
        router.replace(`/sign-in?next=/order/${encodeURIComponent(id)}`);
        return;
      }
      const msg = err instanceof Error ? err.message : "Payment failed";
      setError(msg);
      setPhase("error");
      haptic.error();
    }
  }

  // Per-order SSE subscription. Opens once we've submitted on-chain and
  // closes on terminal state (done / refunded) or component unmount.
  // EventSource auto-reconnects on transient drops; we leave Last-Event-
  // ID handling to the browser since the customer page is a one-shot
  // (refreshing the page just opens a new connection from "now").
  useEffect(() => {
    const live = phase === "submitted" || phase === "bridging" || phase === "fulfilled";
    if (!live || !order.data) return;

    clientLogger.info("checkout-page", "subscribing to order backend event stream", { orderId: order.data.id });
    const es = new EventSource(orderStreamURL(order.data.id));
    const advance = (next: Phase) => {
      clientLogger.info("checkout-page", "received backend status event", { nextStatus: next });
      setPhase((p) => (p === "done" || p === "refunded" ? p : next));
    };

    es.addEventListener("payment.deposited", () => {
      clientLogger.info("checkout-page", "payment.deposited SSE received");
      advance("submitted");
    });
    es.addEventListener("payment.processing", () => {
      clientLogger.info("checkout-page", "payment.processing (bridging) SSE received");
      advance("bridging");
    });
    es.addEventListener("payment.fulfilled", () => {
      clientLogger.info("checkout-page", "payment.fulfilled SSE received");
      advance("fulfilled");
    });
    es.addEventListener("payment.settled", () => {
      clientLogger.info("checkout-page", "payment.settled (done) SSE received");
      setPhase("done");
      haptic.success();
      es.close();
    });
    es.addEventListener("payment.refunded", () => {
      clientLogger.info("checkout-page", "payment.refunded SSE received");
      setPhase("refunded");
      haptic.error();
      es.close();
    });
    
    es.onerror = (err) => {
      clientLogger.warn("checkout-page", "EventSource connection encountered error", { err: String(err) });
    };

    return () => {
      clientLogger.debug("checkout-page", "closing EventSource event stream");
      es.close();
    };
  }, [phase, order.data?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runStepUp() {
    setError(null);
    setPhase("signing");
    clientLogger.info("checkout-page", "initiating WebAuthn step-up biometric check");
    try {
      // Real impl: navigator.credentials.get(...) WebAuthn assertion.
      await new Promise((r) => setTimeout(r, 600));
      await confirm();
    } catch (err) {
      clientLogger.error("checkout-page", "WebAuthn step-up check failed", { err: String(err) });
      const msg = err instanceof Error ? err.message : "Biometric check failed";
      setError(msg);
      setPhase("error");
    }
  }

  if (!hydrated || !session) return <Screen />;

  if (order.isLoading) {
    return (
      <Screen centered>
        <div className="flex flex-col items-center gap-4">
          <div className="loader" />
          <p className="text-sm text-gray-500 dark:text-white/50">
            Loading order…
          </p>
        </div>
      </Screen>
    );
  }

  if (order.isError || !order.data) {
    return (
      <Screen centered>
        <div className="flex flex-col items-center gap-6 text-center">
          <h1 className="text-xl font-medium text-neutral-900 dark:text-white">
            Order not found
          </h1>
          <p className="text-sm text-gray-500 dark:text-white/50">
            This order link is invalid or no longer active.
          </p>
          <Link href="/wallet" className="w-full">
            <Button variant="secondary">Back to wallet</Button>
          </Link>
        </div>
      </Screen>
    );
  }

  const o = order.data;

  if (phase === "done") {
    return (
      <Screen centered>
        <AnimatedComponent
          variant={slideInOut}
          className="flex flex-col items-center gap-6 text-center"
        >
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 220, damping: 18 }}
            className="grid size-20 place-items-center rounded-full bg-green-50 text-3xl text-green-700 dark:bg-green-900/20 dark:text-green-500"
          >
            <PiCheckCircleFill />
          </motion.div>
          <div className="space-y-2">
            <h1 className="text-xl font-medium text-neutral-900 dark:text-white">
              Payment sent
            </h1>
            <motion.p
              layoutId="order-amount"
              className="font-medium tabular-nums text-neutral-900 dark:text-white"
            >
              <span className="text-2xl">{formatUsdc(o.amount_subunit)}</span>{" "}
              <span className="text-sm text-gray-500 dark:text-white/50">USDC</span>
            </motion.p>
            <p className="text-sm text-gray-500 dark:text-white/50">
              to {toTitleCase(o.merchant_name)} · ≈{" "}
              {formatNgnFromUsdc(o.amount_subunit, o.ngn_rate)}
            </p>
            {digest ? (
              <p className="break-all rounded-full bg-gray-50 px-3 py-1.5 font-mono text-[11px] text-gray-500 dark:bg-white/5 dark:text-white/50">
                {digest}
              </p>
            ) : null}
          </div>
          <div className="flex w-full gap-3">
            <Link href="/wallet" className="flex-1">
              <Button>Done</Button>
            </Link>
          </div>
        </AnimatedComponent>
      </Screen>
    );
  }

  if (phase === "expired") {
    return (
      <Screen centered>
        <div className="flex flex-col items-center gap-6 text-center">
          <h1 className="text-xl font-medium text-neutral-900 dark:text-white">
            Order expired
          </h1>
          <p className="text-sm text-gray-500 dark:text-white/50">
            Ask the merchant to generate a new one.
          </p>
          <Link href="/wallet" className="w-full">
            <Button variant="secondary">Back to wallet</Button>
          </Link>
        </div>
      </Screen>
    );
  }

  if (phase === "refunded") {
    return (
      <Screen centered>
        <div className="flex flex-col items-center gap-6 text-center">
          <h1 className="text-xl font-medium text-rose-600 dark:text-rose-500">
            Payment refunded
          </h1>
          <p className="text-sm text-gray-500 dark:text-white/50">
            The merchant couldn&apos;t complete settlement, so your USDC has
            been returned to your wallet.
            {digest ? (
              <span className="mt-3 block break-all font-mono text-[11px]">{digest}</span>
            ) : null}
          </p>
          <Link href="/wallet" className="w-full">
            <Button variant="secondary">Back to wallet</Button>
          </Link>
        </div>
      </Screen>
    );
  }

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
          <PiArrowLeftBold /> Cancel
        </Link>

        {/* Header — small label on top, then the merchant name and the
            countdown side-by-side so they read as one unit (the timer
            modifies the merchant, not the label). Pill is shrink-0 so a
            long name truncates instead of squishing the timer. NUBAN
            names come back ALL CAPS — title-case for readability. */}
        <div className="grid gap-1">
          <p className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-white/30">
            You&apos;re paying
          </p>
          <div className="flex items-center justify-between gap-4">
            <p className="flex min-w-0 max-w-[60%] items-center gap-2 text-lg font-medium">
              <PiStorefrontFill className="shrink-0 text-gray-400 dark:text-white/40" />
              <span className="truncate">{toTitleCase(o.merchant_name)}</span>
            </p>
            <div className="shrink-0">
              <CountdownPill
                expiresAt={o.expires_at}
                onExpire={() => setPhase("expired")}
              />
            </div>
          </div>
        </div>

        <div className="grid gap-2 rounded-3xl border border-gray-200 p-5 text-center dark:border-white/10">
          <motion.p
            layoutId="order-amount"
            className="font-medium tabular-nums text-neutral-900 dark:text-white"
          >
            <span className="text-4xl">{formatUsdc(o.amount_subunit)}</span>{" "}
            <span className="text-lg text-gray-500 dark:text-white/50">USDC</span>
          </motion.p>
          <p className="text-sm text-gray-500 dark:text-white/50">
            ≈ {formatNgnFromUsdc(o.amount_subunit, o.ngn_rate)}
          </p>
        </div>

        <ReceiptCard
          rows={[
            { label: "Merchant",  value: toTitleCase(o.merchant_name) },
            ...(o.reference ? [{ label: "Reference", value: <span className="font-mono text-xs">{o.reference}</span> }] : []),
            { label: "Network",   value: "Sui" },
            { label: "Token",     value: "USDC" },
          ]}
        />

        {insufficient && (
          <InfoBanner tone="warning">
            <p className="font-medium text-neutral-900 dark:text-white">
              Insufficient balance
            </p>
            <p className="mt-1 text-xs">
              You do not have enough USDC or SUI in your wallet to cover this order and transaction fees.
              Your balance is {wallet.data ? formatUsdc(wallet.data.usdc_subunit) : "0.00"} USDC and {wallet.data ? (wallet.data.sui_mist / 1_000_000_000).toFixed(2) : "0.00"} SUI.
            </p>
            <Link href="/deposit" className="mt-3 inline-block">
              <Button
                variant="secondary"
                fullWidth={false}
                className="px-3 py-1.5 text-xs"
              >
                Deposit
              </Button>
            </Link>
          </InfoBanner>
        )}

        {paymentPlan && paymentPlan.path === "combined" && (
          <div className="grid gap-4">
            <InfoBanner tone="info">
              <p className="font-medium text-neutral-900 dark:text-white">
                SUI + USDC Combined Payment
              </p>
              <p className="mt-1 text-xs">
                Your USDC balance is insufficient. We will swap a portion of your SUI to cover the remaining amount.
              </p>
            </InfoBanner>

            <div className="rounded-3xl border border-gray-200 bg-gray-50/50 p-5 text-sm dark:border-white/10 dark:bg-white/5">
              <p className="mb-3 font-semibold text-neutral-900 dark:text-white">Payment Breakdown</p>
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-gray-500 dark:text-white/50">
                  <span>USDC Balance Used</span>
                  <span className="font-medium text-neutral-900 dark:text-white/80 tabular-nums">
                    {formatUsdc(paymentPlan.breakdown.usdcPaid)} USDC
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-500 dark:text-white/50">
                  <span>Shortfall Owed</span>
                  <span className="font-medium text-neutral-900 dark:text-white/80 tabular-nums">
                    {formatUsdc(paymentPlan.breakdown.suiPaidInUsdc)} USDC
                  </span>
                </div>
                <hr className="border-dashed border-gray-200 dark:border-white/10" />
                <div className="flex justify-between text-xs text-gray-500 dark:text-white/50">
                  <span>SUI to Swap (Estimated)</span>
                  <span className="font-medium text-neutral-900 dark:text-white/80 tabular-nums">
                    {(paymentPlan.suiQuoteMist / 1_000_000_000).toFixed(4)} SUI
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-500 dark:text-white/50">
                  <span>Swap Fee (Cetus 0.25%)</span>
                  <span className="font-medium text-neutral-900 dark:text-white/80 tabular-nums">
                    {formatUsdc(paymentPlan.breakdown.swapFeeUsdc)} USDC
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-500 dark:text-white/50">
                  <span>Slippage Protection (0.5%)</span>
                  <span className="font-medium text-neutral-900 dark:text-white/80 tabular-nums">
                    {formatUsdc(paymentPlan.breakdown.slippageBufferUsdc)} USDC
                  </span>
                </div>
                <div className="flex justify-between text-xs text-gray-500 dark:text-white/50">
                  <span>Network Gas Reservation</span>
                  <span className="font-medium text-neutral-900 dark:text-white/80 tabular-nums">
                    {(paymentPlan.breakdown.gasFeeSui / 1_000_000_000).toFixed(2)} SUI
                  </span>
                </div>
                <hr className="border-gray-200 dark:border-white/10" />
                <div className="flex justify-between text-xs font-semibold text-neutral-900 dark:text-white">
                  <span>Total SUI Swapped + Gas</span>
                  <span className="tabular-nums">
                    {((paymentPlan.suiNeededMist + paymentPlan.gasReservationMist) / 1_000_000_000).toFixed(4)} SUI
                  </span>
                </div>
                <p className="text-[10px] text-gray-400 mt-2 leading-normal dark:text-white/30">
                  * Rate: 1 SUI ≈ {wallet.data?.sui_usdc_rate.toFixed(4)} USDC. Any unused slippage buffer is automatically returned to your wallet.
                </p>
              </div>
            </div>
          </div>
        )}


        {o.step_up_required && (
          <InfoBanner>
            <p className="font-medium text-neutral-900 dark:text-white">
              Biometric required
            </p>
            <p className="mt-1 text-xs">
              This amount is above your card&apos;s step-up threshold.
              You&apos;ll be asked for Face ID / Touch ID before signing.
            </p>
          </InfoBanner>
        )}

        {phase === "step-up" && (
          <div className="flex flex-col items-center gap-4 rounded-3xl border border-gray-200 p-6 text-center dark:border-white/10">
            <PiFingerprintBold className="text-4xl text-blue-600 dark:text-blue-500" />
            <p className="text-sm font-medium">Confirm with your device</p>
            <Button onClick={runStepUp} fullWidth={false} className="px-4">
              Use Face ID / Touch ID
            </Button>
          </div>
        )}

        {(phase === "signing" || phase === "submitting" || phase === "submitted" || phase === "bridging" || phase === "fulfilled") && (
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="loader" />
            <p className="text-xs text-gray-500 dark:text-white/50">
              {phase === "signing" ? "Signing on Sui…"
                : phase === "submitting" ? "Submitting on-chain…"
                : phase === "submitted" ? "Payment on chain — notifying merchant…"
                : phase === "bridging" ? "Merchant is bridging your funds…"
                : "Settling to merchant's bank…"}
            </p>
          </div>
        )}

        {error ? <InputError message={error} /> : null}

        {phase === "review" || phase === "error" ? (
          <div className="flex gap-3">
            <Link href="/wallet" className="flex-1">
              <Button variant="secondary">Cancel</Button>
            </Link>
            <div className="flex-1">
              <Button onClick={confirm} disabled={insufficient}>
                Confirm &amp; pay
              </Button>
            </div>
          </div>
        ) : null}
      </AnimatedComponent>
    </Screen>
  );
}

// Bank account names from the institution lookup come back ALL CAPS
// (Nigerian NUBAN convention). Title-case for display.
// Handles hyphens and apostrophes naturally — "MARY-JANE O'CONNOR"
// becomes "Mary-Jane O'connor". Edge cases like "MC DONALD" stay as-is.
function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
