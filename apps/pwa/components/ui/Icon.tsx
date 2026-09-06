import { cn } from "@/lib/utils";

interface IconProps {
  /** Raw SVG XML string from `lib/icons.ts`. */
  xml: string;
  /** Square size shortcut. Use `width`/`height` for non-square icons. */
  size?: number;
  width?: number;
  height?: number;
  className?: string;
  ariaLabel?: string;
}

/**
 * Renders a brand SVG (XML string ported from users-app/assets/svg).
 *
 * The source SVGs carry their own brand-color fills, so this wrapper
 * intentionally does NOT inject a `color` prop — what you see in the
 * design system is what renders. Override per-icon by editing the
 * source XML, not by passing colors here.
 *
 * Server-renderable (no client boundary needed) since the XML is
 * deterministic per-icon.
 */
export function Icon({ xml, size = 24, width, height, className, ariaLabel }: IconProps) {
  const w = width ?? size;
  const h = height ?? size;
  return (
    <span
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      style={{ width: w, height: h, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
      className={cn(className, "[&>svg]:w-full [&>svg]:h-full [&>svg]:block")}
      dangerouslySetInnerHTML={{ __html: xml }}
    />
  );
}
