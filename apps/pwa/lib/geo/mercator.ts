/**
 * Web Mercator, the projection every slippy map uses.
 *
 * Small enough to own. The alternative is a mapping library, and the ones
 * worth using are 40-140kB of JavaScript to draw some tiles, place some pins
 * and handle a drag -- which is what this file and its two components do in
 * about three hundred lines, with no third-party code between the app and the
 * user's location.
 *
 * The model: at zoom z the whole world is a square of 256·2^z pixels, origin
 * at the top left (180°W, ~85.05°N). Everything else is arithmetic.
 */

export const TILE_SIZE = 256;

export interface LatLng {
  lat: number;
  lng: number;
}

/** World pixel coordinates at a given zoom. */
export interface Point {
  x: number;
  y: number;
}

/**
 * The latitude limit.
 *
 * Mercator sends the poles to infinity, so every implementation cuts the map
 * at the latitude that makes the world square: 85.051129°. Beyond it the
 * arithmetic still produces a number, just not one on the map.
 */
export const MAX_LATITUDE = 85.0511287798;

export const clampLat = (lat: number) =>
  Math.max(-MAX_LATITUDE, Math.min(MAX_LATITUDE, lat));

export function project({ lat, lng }: LatLng, zoom: number): Point {
  const scale = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin((clampLat(lat) * Math.PI) / 180);
  return {
    x: scale * (0.5 + lng / 360),
    y: scale * (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)),
  };
}

export function unproject({ x, y }: Point, zoom: number): LatLng {
  const scale = TILE_SIZE * 2 ** zoom;
  return {
    lng: (x / scale - 0.5) * 360,
    lat: (2 * Math.atan(Math.exp((0.5 - y / scale) * 2 * Math.PI)) - Math.PI / 2) * (180 / Math.PI),
  };
}

/**
 * Great-circle distance in metres.
 *
 * The same haversine the server uses to rank agents by distance, so the "1.2km
 * away" on a list row and the gap between two pins on the map are the same
 * measurement. Two different distance functions is how a nearer agent ends up
 * drawn further away.
 */
export function haversineMetres(a: LatLng, b: LatLng): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "1.2 km" / "340 m" — the shorter unit wins under a kilometre. */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return "";
  if (metres < 1_000) return `${Math.round(metres)} m`;
  return `${(metres / 1_000).toFixed(metres < 10_000 ? 1 : 0)} km`;
}

/**
 * The zoom at which a radius fits the viewport.
 *
 * Used to frame a search: show the whole area being searched rather than an
 * arbitrary zoom that happens to cut half the results off the screen.
 */
export function zoomForRadius(radiusM: number, viewportPx: number, lat: number): number {
  // Metres per pixel at zoom 0, adjusted for latitude.
  const metresPerPixelAtZ0 = (2 * Math.PI * 6_378_137 * Math.cos((clampLat(lat) * Math.PI) / 180)) / TILE_SIZE;
  const wanted = (radiusM * 2) / viewportPx;
  const zoom = Math.log2(metresPerPixelAtZ0 / wanted);
  return Math.max(2, Math.min(18, zoom));
}
