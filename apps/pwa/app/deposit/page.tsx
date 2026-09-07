"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PiMoneyWavyBold,
  PiCoinsBold,
  PiCaretRightBold,
} from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Surface } from "@/components/ui/Surface";
import { Amount } from "@/components/ui/Amount";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import { useBalances, balanceIn } from "@/lib/ledger";

/**
 * The two ways money comes in.
 *
 * A chooser rather than a single screen, because they are genuinely different
 * acts with different risks. Cash means walking to somebody; USDC means
 * getting an address right. Putting them behind one "Deposit" button meant the
 * cash route was invisible to the people most likely to use it.
 */
export default function DepositPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const balances = useBalances();

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/deposit");
  }, [hydrated, session, router]);

  if (!hydrated || !session) return <Screen />;

  const ngn = balanceIn(balances.data, "NGN");
  const usd = balanceIn(balances.data, "USD");

  return (
    <Screen>
      <AnimatedComponent variant={slideInOut} className="grid gap-6 py-8">
        <header className="grid gap-1">
          <h1 className="text-xl font-medium text-[var(--fg)]">Add money</h1>
          <p className="text-sm leading-relaxed text-[var(--fg-muted)]">
            Two ways in. Both land in the same balance.
          </p>
        </header>

        <Route
          href="/cash"
          icon={<PiMoneyWavyBold />}
          title="Cash"
          body="Photograph the notes, hand them to an agent near you. Naira in your balance when they confirm."
          balanceLabel="Your naira"
          balance={ngn?.available}
        />

        <Route
          href="/deposit/base"
          icon={<PiCoinsBold />}
          title="USDC on Base"
          body="Send USDC to your own address. Dollars in your balance once the network confirms it."
          balanceLabel="Your dollars"
          balance={usd?.available}
        />

        <p className="px-1 text-center text-xs leading-relaxed text-[var(--fg-muted)]">
          Holding both?{" "}
          <Link href="/convert" className="font-medium text-[var(--accent)]">
            Convert between them
          </Link>
          .
        </p>
      </AnimatedComponent>
    </Screen>
  );
}

function Route({
  href,
  icon,
  title,
  body,
  balanceLabel,
  balance,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
  balanceLabel: string;
  balance: Parameters<typeof Amount>[0]["value"];
}) {
  return (
    <Link href={href}>
      <Surface radius="3xl" className="grid gap-3 transition-colors hover:bg-[var(--sunken)]">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[var(--sunken)] text-lg text-[var(--fg-muted)]">
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-[var(--fg)]">{title}</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--fg-muted)]">{body}</p>
          </div>
          <PiCaretRightBold className="mt-1 shrink-0 text-[var(--fg-subtle)]" />
        </div>
        <div className="flex items-baseline justify-between border-t border-[var(--line)] pt-3">
          <span className="text-xs text-[var(--fg-muted)]">{balanceLabel}</span>
          <Amount value={balance} size="md" />
        </div>
      </Surface>
    </Link>
  );
}
