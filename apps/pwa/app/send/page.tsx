"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  PiPaperPlaneTiltBold,
  PiCheckCircleFill,
  PiHourglassMediumBold,
  PiWarningOctagonFill,
} from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { Surface } from "@/components/ui/Surface";
import { Amount } from "@/components/ui/Amount";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import { useBalances, balanceIn } from "@/lib/ledger";
import {
  withdrawalsApi,
  parseAmount,
  toDecimalString,
  ApiError,
  type Withdrawal,
} from "@/lib/api";

/** An EVM address: 0x and forty hex characters. Checked before sending. */
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/**
 * Send USDC out to an address on Base.
 *
 * This used to send from a per-user custodial wallet whose private key the
 * platform held. It does not any more: dollars are a ledger balance, the
 * treasury is pooled, and a withdrawal debits the balance and queues a send.
 * So the screen reports something queued, and keeps reporting until it has
 * actually left — the previous version showed a success the moment a
 * transaction was submitted.
 */
export default function SendPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const qc = useQueryClient();
  const balances = useBalances();

  const [to, setTo] = useState("");
  const [amountText, setAmountText] = useState("");
  const [sent, setSent] = useState<Withdrawal | null>(null);

  const usd = balanceIn(balances.data, "USD");
  const amountMinor = useMemo(
    () => (amountText ? parseAmount(amountText, "USD") : null),
    [amountText],
  );

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/send");
  }, [hydrated, session, router]);

  const send = useMutation({
    mutationFn: () =>
      withdrawalsApi.open(
        { amount: toDecimalString(amountMinor!, "USD"), to: to.trim() },
        session!.jwt,
      ),
    onSuccess: (w) => {
      setSent(w);
      void qc.invalidateQueries({ queryKey: ["ledger"] });
    },
  });

  const addressLooksRight = ADDRESS.test(to.trim());
  const enough = usd && amountMinor !== null && amountMinor <= usd.available.minor;
  const ready = addressLooksRight && amountMinor !== null && amountMinor > 0 && enough;

  if (!hydrated || !session) return <Screen />;

  if (sent) return <SendProgress withdrawal={sent} jwt={session.jwt} />;

  return (
    <Screen>
      <AnimatedComponent variant={slideInOut} className="grid gap-6 py-8">
        <header className="grid gap-1">
          <h1 className="text-xl font-medium text-[var(--fg)]">Send USDC</h1>
          <p className="text-sm leading-relaxed text-[var(--fg-muted)]">
            Moves dollars from your balance out to an address on Base.
          </p>
        </header>

        <div className="grid gap-2">
          <label
            htmlFor="to"
            className="px-1 text-xs font-medium uppercase tracking-wider text-[var(--fg-subtle)]"
          >
            To
          </label>
          <Surface kind="sunken" padding="md" radius="2xl">
            <input
              id="to"
              placeholder="0x…"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-full bg-transparent font-mono text-sm text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)]"
            />
          </Surface>
          {to && !addressLooksRight ? (
            <p className="px-1 text-xs text-[var(--negative)]">
              That is not a Base address. It should start with 0x and have 40
              characters after it.
            </p>
          ) : (
            /* Nothing can verify that somebody controls an address they named.
               Saying so is the only honest protection this screen offers. */
            <p className="px-1 text-xs leading-relaxed text-[var(--fg-muted)]">
              Check this with whoever gave it to you. Once it is sent, nobody
              can bring it back.
            </p>
          )}
        </div>

        <div className="grid gap-2">
          <label
            htmlFor="amount"
            className="px-1 text-xs font-medium uppercase tracking-wider text-[var(--fg-subtle)]"
          >
            Amount
          </label>
          <Surface kind="sunken" padding="md" radius="2xl">
            <div className="flex items-center gap-2">
              <span className="text-2xl text-[var(--fg-muted)]">$</span>
              <input
                id="amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                className="w-full bg-transparent text-2xl font-medium tabular-nums text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)]"
              />
            </div>
          </Surface>
          <div className="flex items-baseline justify-between px-1 text-xs">
            <span className="text-[var(--fg-muted)]">
              You have <Amount value={usd?.available} size="sm" className="font-normal" />
            </span>
            {usd ? (
              <button
                type="button"
                onClick={() => setAmountText(toDecimalString(usd.available.minor, "USD"))}
                className="font-medium text-[var(--accent)]"
              >
                Send all
              </button>
            ) : null}
          </div>
          {amountMinor !== null && !enough ? (
            <p className="px-1 text-xs text-[var(--negative)]">
              That is more than your dollar balance.
            </p>
          ) : null}
        </div>

        {send.error ? <SendError error={send.error} /> : null}

        <Button
          onClick={() => send.mutate()}
          disabled={!ready}
          loading={send.isPending}
          leadingIcon={<PiPaperPlaneTiltBold />}
        >
          Send
        </Button>
      </AnimatedComponent>
    </Screen>
  );
}

/**
 * After the debit, before the send.
 *
 * Polls until the withdrawal reaches a state that will not change again. The
 * distinction between "queued" and "sent" is the whole reason this screen
 * exists: the money has already left the balance, and the user is entitled to
 * know whether it has also left the platform.
 */
function SendProgress({ withdrawal, jwt }: { withdrawal: Withdrawal; jwt: string }) {
  const settled = ["sent", "failed", "refunded"];
  const w = useQuery({
    queryKey: ["withdrawal", withdrawal.id],
    queryFn: () => withdrawalsApi.get(withdrawal.id, jwt),
    initialData: withdrawal,
    refetchInterval: (query) =>
      settled.includes(query.state.data?.state ?? "") ? false : 4_000,
  });

  const current = w.data ?? withdrawal;

  return (
    <Screen centered>
      <AnimatedComponent variant={slideInOut} className="grid justify-items-center gap-6 text-center">
        {current.state === "sent" ? (
          <PiCheckCircleFill className="text-5xl text-[var(--positive)]" />
        ) : current.state === "failed" || current.state === "refunded" ? (
          <PiWarningOctagonFill className="text-5xl text-[var(--caution)]" />
        ) : (
          <PiHourglassMediumBold className="text-5xl text-[var(--fg-subtle)]" />
        )}

        <div className="grid gap-1">
          <Amount value={current.amount} size="hero" />
          <p className="max-w-[28ch] text-sm leading-relaxed text-[var(--fg-muted)]">
            {current.state === "sent"
              ? "Sent. It is on Base now."
              : current.state === "refunded"
                ? "It could not be sent, so it is back in your balance."
                : current.state === "failed"
                  ? "It could not be sent. We are returning it to your balance."
                  : "Taken from your balance and queued. This usually takes under a minute."}
          </p>
        </div>

        <Surface kind="sunken" padding="md" radius="2xl" className="w-full">
          <p className="break-all text-center font-mono text-xs text-[var(--fg-muted)]">
            {current.to}
          </p>
        </Surface>

        {current.lastError ? (
          <InfoBanner tone="warning">
            <p className="text-xs leading-relaxed">{current.lastError}</p>
          </InfoBanner>
        ) : null}

        <Link href="/wallet" className="w-full">
          <Button variant={current.state === "sent" ? "primary" : "secondary"}>
            Back to my wallet
          </Button>
        </Link>
      </AnimatedComponent>
    </Screen>
  );
}

function SendError({ error }: { error: unknown }) {
  const code = error instanceof ApiError ? error.code : undefined;
  const guidance: Record<string, string> = {
    bad_address: "Check the address again — it should start with 0x.",
    withdrawals_unavailable:
      "Sending is switched off at the moment. Your balance is untouched.",
    insufficient_funds: "There is not enough in your dollar balance any more.",
  };
  return (
    <InfoBanner tone="warning" icon={<PiWarningOctagonFill className="text-amber-500" />}>
      <p className="font-medium text-[var(--fg)]">
        {error instanceof Error ? error.message : "That didn't go through"}
      </p>
      {code && guidance[code] ? (
        <p className="mt-1 text-xs leading-relaxed">{guidance[code]}</p>
      ) : null}
      <p className="mt-1 text-xs">Nothing has left your balance.</p>
    </InfoBanner>
  );
}
