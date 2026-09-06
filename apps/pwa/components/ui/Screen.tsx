import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ScreenProps {
  children?: ReactNode;
  className?: string;
  /** Vertically center the content (true) vs top-aligned (false). */
  centered?: boolean;
}

/**
 * Per-page content shell. The mobile container + padding live on the
 * root layout (see app/layout.tsx), so this is just the column inside.
 * Use `centered` when the page is a single hero (sign-in, single-step
 * prompts).
 */
export function Screen({ children, className, centered = false }: ScreenProps) {
  return (
    <div
      className={cn(
        "w-full flex flex-col gap-6",
        centered && "min-h-[70vh] justify-center",
        className,
      )}
    >
      {children}
    </div>
  );
}
