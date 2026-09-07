"use client";

import Link from "next/link";
import { PiLockSimpleBold } from "react-icons/pi";
import { cn } from "@/lib/utils";
import { Amount, CurrencyTag } from "./Amount";
import { Surface } from "./Surface";
import { HOME_CURRENCY, worthShowing } from "@/lib/ledger";
import type { CurrencyBalance } from "@/lib/api";

/**
 * What you have, in every currency you have it in.
 *
 * One currency leads and the rest sit under it, rather than a single summed
 * figure. Its predecessor folded a native token into a stablecoin balance at a
 * live rate and showed one number, which meant the headline moved when nobody
 * had spent or received anything — and there was no way to tell a price change
 * from a payment.
 */
export function Balances({
  balances,
  className,
}: {
  balances: CurrencyBalance[];
  className?: string;
}) {
  const home = balances.find((b) => b.currency === HOME_CURRENCY);
  const others = balances.filter((b) => b.currency !== HOME_CURRENCY && worthShowing(b));

  return (
    <Surface radius="3xl" className={cn("grid gap-4", className)}>
      <div className="grid gap-1">
        <p className="text-xs font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
          Balance
        </p>
        <Amount value={home?.available} size="hero" />
        {home && home.escrow.minor !== 0 ? <Escrowed amount={home.escrow} /> : null}
      </div>

      {others.length ? (
        <div className="grid gap-2 border-t border-[var(--line)] pt-3">
          {others.map((b) => (
            <div key={b.currency} className="grid gap-0.5">
              <div className="flex items-center justify-between gap-3">
                <CurrencyTag code={b.currency} />
                <Amount value={b.available} size="md" />
              </div>
              {b.escrow.minor !== 0 ? <Escrowed amount={b.escrow} /> : null}
            </div>
          ))}
        </div>
      ) : null}
    </Surface>
  );
}

/**
 * Money that is committed but not yet gone.
 *
 * Shown apart from the spendable figure and never added to it. Somebody who
 * has pledged cash to an agent has that amount reserved against the handover;
 * folding it into "balance" would show them money they cannot spend, and they
 * would find out at a checkout counter.
 */
function Escrowed({ amount }: { amount: CurrencyBalance["escrow"] }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-[var(--fg-muted)]">
      <PiLockSimpleBold className="shrink-0" />
      <Amount value={amount} size="sm" className="font-normal" /> held for a
      handover
    </p>
  );
}

/**
 * The row of things you can do with a balance.
 *
 * Four, deliberately: the two ways money comes in and the two ways it goes
 * out. A fifth would push these to a scroll on a small phone, which is where
 * an action goes to be never used.
 */
export function BalanceActions() {
  const actions = [
    { href: "/cash", label: "Cash in" },
    { href: "/deposit/base", label: "Receive" },
    { href: "/convert", label: "Convert" },
    { href: "/pay", label: "Pay" },
  ];
  return (
    <div className="grid grid-cols-4 gap-2">
      {actions.map((a) => (
        <Link
          key={a.href}
          href={a.href}
          className="grid justify-items-center gap-1 rounded-2xl border border-[var(--line)] bg-[var(--raised)] px-1 py-3 text-center text-xs font-medium text-[var(--fg)] transition-colors hover:bg-[var(--sunken)]"
        >
          {a.label}
        </Link>
      ))}
    </div>
  );
}
