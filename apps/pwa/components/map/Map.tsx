"use client";

import { useMemo, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { tileSource, tileUrl } from "@/lib/geo/tiles";
import { TILE_SIZE, type LatLng } from "@/lib/geo/mercator";
import { useMapView } from "./useMapView";

interface MapProps {
  centre: LatLng;
  zoom?: number;
  minZoom?: number;
  maxZoom?: number;
  onMove?: (centre: LatLng, zoom: number) => void;
  /** Rendered above the tiles, positioned by `<Pin>`. */
  children?: (toScreen: (at: LatLng) => { x: number; y: number }) => ReactNode;
  className?: string;
}

/**
 * A map, without a mapping library.
 *
 * Tiles in a grid, absolutely positioned; pan and zoom in `useMapView`;
 * markers as ordinary React children. That is what a mapping library does,
 * and doing it here costs about three hundred lines against 40-140kB of
 * third-party JavaScript sitting between this app and the user's location.
 *
 * The tile provider is configuration. See lib/geo/tiles.ts: a tile URL is
 * somebody's terms, rate limit and bill, and baking one into the bundle
 * decides that on their behalf. With none configured this renders a message
 * saying so, rather than a grey rectangle that reads as a bug.
 */
export function Map({
  centre,
  zoom = 13,
  minZoom = 3,
  maxZoom,
  onMove,
  children,
  className,
}: MapProps) {
  const source = useMemo(() => tileSource(), []);
  const effectiveMax = maxZoom ?? source?.maxZoom ?? 18;

  const map = useMapView({
    centre,
    zoom,
    minZoom,
    maxZoom: effectiveMax,
    onMove,
  });

  const tiles = useMemo(() => {
    if (!source || !map.size.width || !map.size.height) return [];

    // Tiles are drawn at an integer zoom and the fractional part becomes a
    // CSS scale, so a pinch is smooth instead of stepping between whole zooms.
    const z = Math.round(map.view.zoom);
    const span = 2 ** z;

    // Which tiles the viewport covers at that integer zoom.
    const scale = 2 ** (map.view.zoom - z);
    const worldX = map.origin.x / scale;
    const worldY = map.origin.y / scale;
    const width = map.size.width / scale;
    const height = map.size.height / scale;

    const first = { x: Math.floor(worldX / TILE_SIZE), y: Math.floor(worldY / TILE_SIZE) };
    const last = {
      x: Math.floor((worldX + width) / TILE_SIZE),
      y: Math.floor((worldY + height) / TILE_SIZE),
    };

    const out: { key: string; url: string; left: number; top: number }[] = [];
    for (let x = first.x; x <= last.x; x++) {
      for (let y = first.y; y <= last.y; y++) {
        // y does not wrap: above the north edge or below the south there is no
        // map, and requesting those tiles just produces 404s in the console.
        if (y < 0 || y >= span) continue;
        out.push({
          key: `${z}/${x}/${y}`,
          url: tileUrl(source, z, x, y),
          left: x * TILE_SIZE - worldX,
          top: y * TILE_SIZE - worldY,
        });
      }
    }
    return out;
  }, [source, map.size.width, map.size.height, map.origin.x, map.origin.y, map.view.zoom]);

  const fractionalScale = 2 ** (map.view.zoom - Math.round(map.view.zoom));

  return (
    <div
      ref={map.ref}
      className={cn(
        "relative overflow-hidden bg-[var(--sunken)] touch-none select-none",
        map.dragging ? "cursor-grabbing" : "cursor-grab",
        className,
      )}
      {...map.handlers}
    >
      {source ? (
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `scale(${fractionalScale})` }}
          aria-hidden
        >
          {tiles.map((t) => (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              key={t.key}
              src={t.url}
              alt=""
              width={TILE_SIZE}
              height={TILE_SIZE}
              draggable={false}
              loading="lazy"
              className="absolute max-w-none"
              style={{ left: t.left, top: t.top }}
            />
          ))}
        </div>
      ) : (
        <div className="absolute inset-0 grid place-items-center px-8 text-center">
          <p className="text-xs leading-relaxed text-[var(--fg-muted)]">
            The map needs a tile provider. Set{" "}
            <code className="rounded bg-[var(--raised)] px-1 py-0.5">
              NEXT_PUBLIC_MAP_TILE_URL
            </code>{" "}
            to enable it — the list below works without it.
          </p>
        </div>
      )}

      {/* Markers sit above the tiles and outside the scaled layer, so a pin
          stays pin-sized at every zoom instead of growing with the map. */}
      {children ? <div className="absolute inset-0">{children(map.toScreen)}</div> : null}

      {source?.attribution ? (
        <p className="pointer-events-none absolute bottom-0 right-0 bg-[var(--surface)]/80 px-1.5 py-0.5 text-[0.625rem] text-[var(--fg-muted)]">
          {source.attribution}
        </p>
      ) : null}
    </div>
  );
}

/**
 * A marker at a coordinate.
 *
 * Positioned by its bottom point, because that is where a pin actually points.
 * Anchoring by the centre puts the tip half a pin below the thing it marks,
 * which at street zoom is most of a block.
 */
export function Pin({
  at,
  toScreen,
  children,
  onClick,
  className,
}: {
  at: LatLng;
  toScreen: (at: LatLng) => { x: number; y: number };
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const { x, y } = toScreen(at);
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn("absolute -translate-x-1/2 -translate-y-full", className)}
      style={{ left: x, top: y }}
    >
      {children}
    </Tag>
  );
}
