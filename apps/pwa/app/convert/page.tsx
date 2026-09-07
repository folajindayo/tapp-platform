"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PiArrowsDownUpBold,
  PiCheckCircleFill,
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
import { QuoteCard } from "@/components/convert/QuoteCard";
import { useSession } from "@/lib/auth";
import { useBalances, balanceIn } from "@/lib/ledger";
import {
  convertApi,
  parseAmount,
  toDecimalString,
  ApiError,
  type Currency,
  type Quote,
} from "@/lib/api";

export default function ConvertPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const qc = useQueryClient();
  const balances = useBalances();

  const [from, setFrom] = useState<Currency>("USD");
  const [amountText, setAmountText] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [receipt, setReceipt] = useState<Quote | null>(null);

  const to: Currency = from === "USD" ? "NGN" : "USD";
  const amountMinor = useMemo(
    () => (amountText ? parseAmount(amountText, from) : null),
    [amountText, from],
  );
  const source = balanceIn(balances.data, from);

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/convert");
  }, [hydrated, session, router]);

  // A quote is priced for one direction and one amount. Changing either makes
  // the one on screen a number that no longer describes what would happen, so
  // it is discarded rather than left there looking authoritative.
  useEffect(() => {
    setQuote(null);
  }, [from, amountText]);

  const ask = useMutation({
    mutationFn: () =>
      convertApi.quote(
        { sell: toDecimalString(amountMinor!, from), from, to },
        session!.jwt,
      ),
    onSuccess: setQuote,
  });

  const accept = useMutation({
    mutationFn: () => convertApi.execute(quote!.quote_id, session!.jwt),
    onSuccess: (done) => {
      setReceipt(done);
      setQuote(null);
      setAmountText("");
      void qc.invalidateQueries({ queryKey: ["ledger"] });
    },
  });

  const enough = source && amountMinor !== null && amountMinor <= source.available.minor;
  const canQuote = amountMinor !== null && amountMinor > 0 && enough;

  if (!hydrated || !session) return <Screen />;

  if (receipt) {
    return (
      <Screen centered>
        <AnimatedComponent variant={slideInOut} className="grid justify-items-center gap-6 text-center">
          <PiCheckCircleFill className="text-4xl text-[var(--positive)]" />
          <div className="grid gap-1">
            <p className="text-2xl font-medium text-[var(--fg)]">{receipt.receive}</p>
            <p className="text-sm text-[var(--fg-muted)]">
              converted from {receipt.sell} at {receipt.rate}
            </p>
          </div>
          <div className="grid w-full gap-2">
            <Button onClick={() => router.push("/wallet")}>See my balance</Button>
            <Button variant="ghost" onClick={() => setReceipt(null)}>
              Convert something else
            </Button>
          </div>
        </AnimatedComponent>
      </Screen>
    );
  }

  return (
    <Screen>
      <AnimatedComponent variant={slideInOut} className="grid gap-6 py-8">
        <header className="grid gap-1">
          <h1 className="text-xl font-medium text-[var(--fg)]">Convert</h1>
          <p className="text-sm leading-relaxed text-[var(--fg-muted)]">
            We show you a price first. It holds for a minute — nothing moves
            until you take it.
          </p>
        </header>

        <div className="grid gap-2">
          <div className="flex items-center justify-between px-1">
            <label
              htmlFor="amount"
              className="text-xs font-medium uppercase tracking-wider text-[var(--fg-subtle)]"
            >
              Sell {from}
            </label>
            <button
              type="button"
              onClick={() => {
                setFrom(to);
                setAmountText("");
              }}
              className="flex items-center gap-1 text-xs font-medium text-[var(--accent)]"
            >
              <PiArrowsDownUpBold /> {to} instead
            </button>
          </div>

          <Surface kind="sunken" padding="md" radius="2xl">
            <div className="flex items-center gap-2">
              <span className="text-2xl text-[var(--fg-muted)]">
                {from === "USD" ? "$" : "₦"}
              </span>
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
              You have <Amount value={source?.available} size="sm" className="font-normal" />
            </span>
            {source ? (
              <button
                type="button"
                onClick={() =>
                  setAmountText(toDecimalString(source.available.minor, from))
                }
                className="font-medium text-[var(--accent)]"
              >
                Use all
              </button>
            ) : null}
          </div>

          {amountText && amountMinor === null ? (
            <p className="px-1 text-xs text-[var(--negative)]">
              That is not an amount in {from}.
            </p>
          ) : amountMinor !== null && !enough ? (
            <p className="px-1 text-xs text-[var(--negative)]">
              That is more than your {from} balance.
            </p>
          ) : null}
        </div>

        {quote ? (
          <QuoteCard
            quote={quote}
            to={to}
            onAccept={() => accept.mutate()}
            onExpire={() => setQuote(null)}
            accepting={accept.isPending}
          />
        ) : (
          <Button
            onClick={() => ask.mutate()}
            disabled={!canQuote}
            loading={ask.isPending}
          >
            Show me the price
          </Button>
        )}

        {ask.error || accept.error ? (
          <ConvertError error={ask.error ?? accept.error} />
        ) : null}
      </AnimatedComponent>
    </Screen>
  );
}

/**
 * Refusing to price something is not a fault, and does not read as one.
 *
 * When no source can price a pair the server declines rather than inventing a
 * rate, which is correct — and the message says that plainly instead of
 * showing the outage face.
 */
function ConvertError({ error }: { error: unknown }) {
  const code = error instanceof ApiError ? error.code : undefined;

  const guidance: Record<string, string> = {
    rate_unavailable:
      "We would rather show you nothing than a price we cannot honour. Try again shortly.",
    quote_expired: "Prices hold for about a minute. Ask for a fresh one.",
    quote_used: "That conversion already went through — check your balance.",
    insufficient_funds: "There is not enough in that balance any more.",
  };

  return (
    <InfoBanner tone="warning" icon={<PiWarningOctagonFill className="text-amber-500" />}>
      <p className="font-medium text-[var(--fg)]">
        {error instanceof Error ? error.message : "That didn't work"}
      </p>
      {code && guidance[code] ? (
        <p className="mt-1 text-xs leading-relaxed">{guidance[code]}</p>
      ) : null}
    </InfoBanner>
  );
}
