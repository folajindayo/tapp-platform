import {
  PiCreditCardBold,
  PiMoneyWavyBold,
  PiArrowsLeftRightBold,
  PiArrowDownLeftBold,
  PiArrowUpRightBold,
  PiLockSimpleBold,
  PiReceiptBold,
} from "react-icons/pi";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Amount } from "./Amount";
import { EmptyState } from "./Surface";
import type { Movement } from "@/lib/ledger";

/**
 * How a ledger reason reads to the person it happened to.
 *
 * The ledger's vocabulary is precise and not conversational: "tap.debit",
 * "handover.credited_trader", "fx.spread". Mapping it here rather than
 * softening it at the source keeps the ledger's own words exact — they are
 * what an auditor reconciles against — while the app says something a person
 * recognises.
 *
 * The lookup is by prefix, so a new movement type in an existing domain gets a
 * sensible icon and label without anyone remembering to come back here. An
 * unmapped reason falls through to its own text rather than to "Transaction",
 * because a label nobody can act on is worse than a slightly technical one.
 */
const DOMAINS: Record<string, { icon: ReactNode; label: string }> = {
  tap: { icon: <PiCreditCardBold />, label: "Card payment" },
  handover: { icon: <PiMoneyWavyBold />, label: "Cash handover" },
  deposit: { icon: <PiArrowDownLeftBold />, label: "Deposit" },
  withdrawal: { icon: <PiArrowUpRightBold />, label: "Withdrawal" },
  fx: { icon: <PiArrowsLeftRightBold />, label: "Conversion" },
  settlement: { icon: <PiReceiptBold />, label: "Transfer" },
  merchant_payout: { icon: <PiReceiptBold />, label: "Payout" },
  agent: { icon: <PiMoneyWavyBold />, label: "Agent float" },
  treasury: { icon: <PiReceiptBold />, label: "Treasury" },
};

const EXACT: Record<string, string> = {
  "tap.debit": "Card payment",
  "tap.fee": "Card fee",
  "handover.escrowed": "Cash held for handover",
  "handover.credited_trader": "Cash handed over",
  "handover.released": "Handover cancelled",
  "fx.sold": "Converted out",
  "fx.bought": "Converted in",
  "fx.spread": "Conversion spread",
  "deposit.credited": "USDC received",
  "withdrawal.debited": "Withdrawal sent",
  "settlement.refunded_sender": "Refunded",
};

function describe(reason: string): { icon: ReactNode; label: string } {
  // A reason can carry a suffix after a colon -- "handover.released:expired".
  const [base] = reason.split(":");
  const domain = DOMAINS[base.split(".")[0]] ?? {
    icon: <PiReceiptBold />,
    label: base,
  };
  return { icon: domain.icon, label: EXACT[base] ?? domain.label };
}

export function MovementList({
  movements,
  emptyState,
  className,
}: {
  movements: Movement[];
  emptyState?: ReactNode;
  className?: string;
}) {
  if (!movements.length) {
    return (
      emptyState ?? (
        <EmptyState title="Nothing yet">
          Every movement of your money shows up here, in and out.
        </EmptyState>
      )
    );
  }

  return (
    <div className={cn("grid gap-1", className)}>
      {movements.map((m) => (
        <MovementRow key={m.id} movement={m} />
      ))}
    </div>
  );
}

function MovementRow({ movement }: { movement: Movement }) {
  const { icon, label } = describe(movement.reason);
  const incoming = movement.amount.minor > 0;

  // A movement into escrow is not income, even though its sign is positive
  // from the escrow account's point of view. Marking it keeps somebody from
  // reading "money arrived" when what happened is "money was set aside".
  const held = movement.account === "escrow";

  return (
    <div className="flex items-center gap-3 rounded-2xl px-1 py-2.5">
      <span
        className={cn(
          "grid h-9 w-9 shrink-0 place-items-center rounded-full text-base",
          held
            ? "bg-[var(--sunken)] text-[var(--fg-muted)]"
            : incoming
              ? "bg-[var(--positive-wash)] text-[var(--positive)]"
              : "bg-[var(--sunken)] text-[var(--fg-muted)]",
        )}
      >
        {held ? <PiLockSimpleBold /> : icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-[var(--fg)]">{label}</span>
        <span className="block text-xs text-[var(--fg-subtle)]">
          {held ? "Held · " : ""}
          {when(movement.at)}
        </span>
      </span>

      <Amount value={movement.amount} size="sm" signed showPlus />
    </div>
  );
}

/**
 * Relative for anything recent, absolute once it stops being "recent".
 *
 * "3 days ago" is worse than a date: past a couple of days people want to know
 * which day it was, not how to count backwards to it.
 */
function when(iso: string): string {
  const then = new Date(iso);
  const seconds = (Date.now() - then.getTime()) / 1000;
  if (!Number.isFinite(seconds)) return "";
  if (seconds < 60) return "just now";
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  if (seconds < 172_800) return "yesterday";
  return then.toLocaleDateString("en-NG", { day: "numeric", month: "short" });
}
