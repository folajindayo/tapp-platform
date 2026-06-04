import { cn } from "@/lib/utils";

/**
 * Wordmark — "Zoracle" with a tiny royal-blue dot, mirroring zap's
 * "Zap" + Paycrest mini-logo treatment. Minimal on purpose; brand
 * marks can land later without touching consumers.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-lg font-semibold text-neutral-900 dark:text-white",
        className,
      )}
    >
      <span aria-hidden className="size-2 rounded-full bg-blue-600" />
      Tapp
    </span>
  );
}
