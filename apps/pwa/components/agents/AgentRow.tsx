import { cn } from "@/lib/utils";
import { Amount } from "@/components/ui/Amount";
import { formatDistance } from "@/lib/geo/mercator";
import type { Agent } from "@/lib/api";
import { coverageOf, type Coverage } from "./AgentPin";

const NOTE: Record<Coverage, string> = {
  covered: "",
  short: "Not enough cash on hand right now",
  closed: "Closed",
};

const KIND_LABEL: Record<Agent["kind"], string> = {
  shop: "Shop",
  kiosk: "Kiosk",
  market_stall: "Market stall",
  office: "Office",
  person: "Individual",
};

/**
 * One agent in the list.
 *
 * Ordered by the server, which ranks by whether the float covers the amount
 * before it ranks by distance. Nearest-first alone puts the shop that has to
 * turn you away at the top of the list.
 */
export function AgentRow({
  agent,
  amountMinor,
  selected,
  onSelect,
}: {
  agent: Agent;
  amountMinor?: number;
  selected?: boolean;
  onSelect?: (agent: Agent) => void;
}) {
  const coverage = coverageOf(agent, amountMinor);
  const note = NOTE[coverage];

  return (
    <button
      type="button"
      onClick={() => onSelect?.(agent)}
      className={cn(
        "flex w-full items-start gap-3 rounded-2xl border p-3.5 text-left transition-colors",
        selected
          ? "border-[var(--accent)] bg-[var(--accent-wash)]"
          : "border-[var(--line)] bg-[var(--raised)] hover:bg-[var(--sunken)]",
        coverage === "closed" && "opacity-60",
      )}
    >
      <span
        className={cn(
          "mt-0.5 h-2 w-2 shrink-0 rounded-full",
          coverage === "covered" && "bg-[var(--positive)]",
          coverage === "short" && "bg-[var(--caution)]",
          coverage === "closed" && "bg-[var(--fg-subtle)]",
        )}
      />

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-[var(--fg)]">
            {agent.name}
          </span>
          {agent.distanceM !== undefined ? (
            <span className="shrink-0 text-xs tabular-nums text-[var(--fg-muted)]">
              {formatDistance(agent.distanceM)}
            </span>
          ) : null}
        </span>

        <span className="mt-0.5 block truncate text-xs text-[var(--fg-muted)]">
          {KIND_LABEL[agent.kind]} · {agent.address}
        </span>

        <span className="mt-2 flex items-center gap-2 text-xs">
          {note ? (
            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 font-medium",
                coverage === "short"
                  ? "bg-[var(--caution-wash)] text-[var(--caution)]"
                  : "bg-[var(--sunken)] text-[var(--fg-muted)]",
              )}
            >
              {note}
            </span>
          ) : (
            <span className="rounded-md bg-[var(--positive-wash)] px-1.5 py-0.5 font-medium text-[var(--positive)]">
              Can take this now
            </span>
          )}

          {/* Verification is shown, never assumed. An unverified agent is a
              real agent somebody may still choose -- the point is that they
              choose knowingly. */}
          {agent.verified ? (
            <span className="text-[var(--fg-subtle)]">Verified</span>
          ) : (
            <span className="text-[var(--fg-subtle)]">Not yet verified</span>
          )}
        </span>

        {/* Settlement history is the only reputation signal that costs
            something to fake, so it is the one shown. */}
        {agent.settledCount > 0 ? (
          <span className="mt-1.5 block text-[0.6875rem] text-[var(--fg-subtle)]">
            {agent.settledCount} handover{agent.settledCount === 1 ? "" : "s"} completed
            {agent.disputedCount > 0 ? ` · ${agent.disputedCount} disputed` : ""}
            {" · holds "}
            <Amount value={agent.float} size="sm" className="font-normal" />
          </span>
        ) : null}
      </span>
    </button>
  );
}
