import { cn } from "@/lib/utils";
import type { Agent } from "@/lib/api";

/**
 * An agent on the map.
 *
 * Three states, and the distinction is the point of the screen:
 *
 *   covered   open, and holding enough float for this amount
 *   short     open, but cannot cover it right now
 *   closed    shut
 *
 * "Can they actually take my money" is the only question somebody is asking
 * when they look at this map, so it is answered in the pin itself rather than
 * two taps away in a detail sheet. Walking twenty minutes to a shop that turns
 * you away is the failure this product cannot afford.
 */
export type Coverage = "covered" | "short" | "closed";

export function coverageOf(agent: Agent, amountMinor?: number): Coverage {
  if (!agent.openNow || !agent.active) return "closed";
  if (amountMinor !== undefined && agent.float.minor < amountMinor) return "short";
  return "covered";
}

const DOT: Record<Coverage, string> = {
  covered: "bg-[var(--accent)] text-[var(--accent-fg)] ring-[var(--accent)]/25",
  short: "bg-[var(--caution)] text-white ring-[var(--caution)]/25",
  closed: "bg-[var(--fg-subtle)] text-[var(--surface)] ring-[var(--fg-subtle)]/20",
};

const TAIL: Record<Coverage, string> = {
  covered: "bg-[var(--accent)]",
  short: "bg-[var(--caution)]",
  closed: "bg-[var(--fg-subtle)]",
};

export function AgentPin({
  coverage,
  selected,
  label,
}: {
  coverage: Coverage;
  selected?: boolean;
  label?: string;
}) {
  return (
    <span className="grid justify-items-center gap-1">
      {label ? (
        <span className="max-w-[9rem] truncate rounded-full bg-[var(--surface)]/95 px-2 py-0.5 text-[0.6875rem] font-medium text-[var(--fg)] shadow-sm">
          {label}
        </span>
      ) : null}
      <span
        className={cn(
          "grid h-7 w-7 place-items-center rounded-full text-[0.625rem] font-bold ring-4 transition-transform",
          DOT[coverage],
          selected && "scale-125",
        )}
      >
        ₦
      </span>
      {/* The tail, so the pin points at something rather than hovering. */}
      <span className={cn("-mt-1.5 h-2 w-2 rotate-45", TAIL[coverage])} />
    </span>
  );
}

/** Where the person looking at the map is. */
export function YouPin() {
  return (
    <span className="block h-3.5 w-3.5 translate-y-1/2 rounded-full border-2 border-[var(--surface)] bg-[var(--fg)] shadow" />
  );
}
