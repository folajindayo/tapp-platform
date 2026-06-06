import Image from "next/image";
import logoIcon from "@/app/icon.png";
import { cn } from "@/lib/utils";

/**
 * Logo component — renders the updated brand icon next to the "Tapp" wordmark.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 text-lg font-semibold text-neutral-900 dark:text-white",
        className,
      )}
      style={{ fontFamily: "var(--font-dm-sans), var(--font-sans)" }}
    >
      <Image
        src={logoIcon}
        alt="Tapp Logo"
        width={24}
        height={24}
        className="size-6 object-contain"
        priority
      />
      tapp
    </span>
  );
}
