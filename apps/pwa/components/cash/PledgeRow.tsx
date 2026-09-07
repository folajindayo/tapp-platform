import Link from "next/link";
import { cn } from "@/lib/utils";
import { Amount } from "@/components/ui/Amount";
import type { Pledge, PledgeState } from "@/lib/api";

/**
 * What each state means to the person who took the photograph.
 *
 * The ledger's vocabulary is not the user's. "matched" is a database fact;
 * "an agent is expecting you" is the thing they need to act on.
 */
const LABEL: Record<PledgeState, string> = {
  screening: "Checking the photo",
  open: "Looking for an agent",
  matched: "An agent is expecting you",
  handed_over: "Waiting on the other side",
  settled: "In your balance",
  expired: "Expired",
  refused: "Not accepted",
  disputed: "Under review",
};

const TONE: Record<PledgeState, string> = {
  screening: "bg-[var(--sunken)] text-[var(--fg-muted)]",
  open: "bg-[var(--sunken)] text-[var(--fg-muted)]",
  matched: "bg-[var(--accent-wash)] text-[var(--accent)]",
  handed_over: "bg-[var(--accent-wash)] text-[var(--accent)]",
  settled: "bg-[var(--positive-wash)] text-[var(--positive)]",
  expired: "bg-[var(--sunken)] text-[var(--fg-subtle)]",
  refused: "bg-[var(--negative-wash)] text-[var(--negative)]",
  disputed: "bg-[var(--caution-wash)] text-[var(--caution)]",
};

/** States where there is still something for the user to do. */
const LIVE: PledgeState[] = ["screening", "open", "matched", "handed_over"];

export function PledgeRow({ pledge }: { pledge: Pledge }) {
  const live = LIVE.includes(pledge.state);

  // What was declared and what was counted, shown apart when they disagree.
  // Averaging them away would destroy the single most useful signal there is,
  // and the disagreement is usually a bad photograph rather than a bad person.
  const disagrees =
    pledge.counted.minor > 0 && pledge.counted.minor !== pledge.declared.minor;

  return (
    <Link
      href={`/cash/${pledge.id}`}
      className={cn(
        "flex items-center gap-3 rounded-2xl border border-[var(--line)] bg-[var(--raised)] p-3.5 transition-colors hover:bg-[var(--sunken)]",
        !live && "opacity-80",
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <Amount value={pledge.declared} size="md" />
          <span className="text-[0.6875rem] text-[var(--fg-subtle)]">#{pledge.ref}</span>
        </span>

        {disagrees ? (
          <span className="mt-0.5 block text-xs text-[var(--caution)]">
            We counted <Amount value={pledge.counted} size="sm" className="font-normal" />
          </span>
        ) : null}

        {pledge.refusedReason ? (
          <span className="mt-0.5 block text-xs leading-relaxed text-[var(--fg-muted)]">
            {pledge.refusedReason}
          </span>
        ) : null}
      </span>

      <span
        className={cn(
          "shrink-0 rounded-full px-2.5 py-1 text-[0.6875rem] font-medium",
          TONE[pledge.state],
        )}
      >
        {LABEL[pledge.state]}
      </span>
    </Link>
  );
}

export { LABEL as pledgeStateLabel, TONE as pledgeStateTone };
