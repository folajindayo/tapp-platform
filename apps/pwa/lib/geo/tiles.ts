/**
 * Where map tiles come from.
 *
 * Configured, never hardcoded. A tile URL is a contract with a provider --
 * their terms, their rate limits, their bill -- and baking one into the bundle
 * decides that on their behalf. Set NEXT_PUBLIC_MAP_TILE_URL to a template
 * with {z}/{x}/{y} (and optionally {s} for a subdomain rotation), plus
 * NEXT_PUBLIC_MAP_ATTRIBUTION with the credit that provider requires.
 *
 * When it is unset the map says so, in place of the tiles, rather than
 * rendering a grey rectangle that looks like a bug or quietly falling back to
 * somebody else's servers.
 */

export interface TileSource {
  template: string;
  subdomains: string[];
  attribution: string;
  maxZoom: number;
}

const DEFAULT_MAX_ZOOM = 19;

export function tileSource(): TileSource | null {
  const template = process.env.NEXT_PUBLIC_MAP_TILE_URL;
  if (!template) return null;

  const subdomains = (process.env.NEXT_PUBLIC_MAP_TILE_SUBDOMAINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const maxZoom = Number(process.env.NEXT_PUBLIC_MAP_MAX_ZOOM);

  return {
    template,
    subdomains,
    // Required by every tile provider worth using, and shown on the map.
    attribution: process.env.NEXT_PUBLIC_MAP_ATTRIBUTION ?? "",
    maxZoom: Number.isFinite(maxZoom) && maxZoom > 0 ? maxZoom : DEFAULT_MAX_ZOOM,
  };
}

/** Fills a tile template. Wraps x so panning past the date line still works. */
export function tileUrl(source: TileSource, z: number, x: number, y: number): string {
  const span = 2 ** z;
  const wrappedX = ((x % span) + span) % span;
  const subdomain = source.subdomains.length
    ? source.subdomains[Math.abs(wrappedX + y) % source.subdomains.length]
    : "";
  return source.template
    .replace("{s}", subdomain)
    .replace("{z}", String(z))
    .replace("{x}", String(wrappedX))
    .replace("{y}", String(y));
}
