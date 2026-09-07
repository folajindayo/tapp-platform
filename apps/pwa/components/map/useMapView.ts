"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  project,
  unproject,
  clampLat,
  TILE_SIZE,
  type LatLng,
} from "@/lib/geo/mercator";

export interface Viewport {
  centre: LatLng;
  zoom: number;
  width: number;
  height: number;
}

interface Options {
  centre: LatLng;
  zoom: number;
  minZoom: number;
  maxZoom: number;
  onMove?: (centre: LatLng, zoom: number) => void;
}

/**
 * The interaction half of the map: drag to pan, wheel or pinch to zoom.
 *
 * Kept apart from the rendering so that the arithmetic can be reasoned about
 * on its own. Everything here is a pure transform of a pointer event into a
 * new centre and zoom; nothing in this file knows what a tile is.
 *
 * Pointer events rather than mouse and touch handlers: one code path covers a
 * finger, a mouse and a stylus, and the browser's own capture means a drag
 * that leaves the element still tracks instead of sticking.
 */
export function useMapView({ centre, zoom, minZoom, maxZoom, onMove }: Options) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState({ centre, zoom });
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);

  // Follow the prop when the caller moves the map (recentring on the user,
  // say), but not while a finger is down -- taking the map away mid-drag is
  // the most disorienting thing a map can do.
  const draggingRef = useRef(false);
  useEffect(() => {
    if (draggingRef.current) return;
    setView({ centre, zoom });
  }, [centre.lat, centre.lng, zoom]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize({ width, height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const commit = useCallback(
    (next: { centre: LatLng; zoom: number }) => {
      setView(next);
      onMove?.(next.centre, next.zoom);
    },
    [onMove],
  );

  // Active pointers, so two fingers can be told apart from one.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      draggingRef.current = true;
      setDragging(true);
    }
  }, []);

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      const previous = pointers.current.get(e.pointerId);
      if (!previous) return;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      const points = [...pointers.current.values()];

      if (points.length >= 2) {
        // Two fingers: zoom about the midpoint.
        const [a, b] = points;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (!pinch.current) {
          pinch.current = { distance, zoom: view.zoom };
          return;
        }
        const ratio = distance / pinch.current.distance;
        const next = Math.max(
          minZoom,
          Math.min(maxZoom, pinch.current.zoom + Math.log2(ratio)),
        );
        commit({ centre: view.centre, zoom: next });
        return;
      }

      // One finger: pan by the pixel delta, converted back to degrees at the
      // current zoom. Working in world pixels rather than in degrees is what
      // keeps a drag feeling the same at every latitude.
      const dx = e.clientX - previous.x;
      const dy = e.clientY - previous.y;
      const p = project(view.centre, view.zoom);
      const moved = unproject({ x: p.x - dx, y: p.y - dy }, view.zoom);
      commit({ centre: { lat: clampLat(moved.lat), lng: moved.lng }, zoom: view.zoom });
    },
    [view, minZoom, maxZoom, commit],
  );

  const endPointer = useCallback((e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) {
      draggingRef.current = false;
      setDragging(false);
    }
  }, []);

  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const el = ref.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();

      // Zoom about the cursor, not the centre: the point under the pointer
      // should stay under the pointer, which is the behaviour every map has
      // and the one people notice immediately when it is missing.
      const offsetX = e.clientX - rect.left - rect.width / 2;
      const offsetY = e.clientY - rect.top - rect.height / 2;

      const next = Math.max(
        minZoom,
        Math.min(maxZoom, view.zoom - Math.sign(e.deltaY) * 0.5),
      );
      if (next === view.zoom) return;

      const anchor = unproject(
        { x: project(view.centre, view.zoom).x + offsetX, y: project(view.centre, view.zoom).y + offsetY },
        view.zoom,
      );
      const anchorAtNext = project(anchor, next);
      const centre = unproject(
        { x: anchorAtNext.x - offsetX, y: anchorAtNext.y - offsetY },
        next,
      );
      commit({ centre: { lat: clampLat(centre.lat), lng: centre.lng }, zoom: next });
    },
    [view, minZoom, maxZoom, commit],
  );

  /** World-pixel position of the viewport's top-left corner. */
  const origin = (() => {
    const c = project(view.centre, view.zoom);
    return { x: c.x - size.width / 2, y: c.y - size.height / 2 };
  })();

  /** Where a coordinate lands inside the element, in CSS pixels. */
  const toScreen = useCallback(
    (at: LatLng) => {
      const p = project(at, view.zoom);
      return { x: p.x - origin.x, y: p.y - origin.y };
    },
    [view.zoom, origin.x, origin.y],
  );

  return {
    ref,
    view,
    size,
    origin,
    dragging,
    toScreen,
    setZoom: (z: number) =>
      commit({ centre: view.centre, zoom: Math.max(minZoom, Math.min(maxZoom, z)) }),
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: endPointer,
      onPointerCancel: endPointer,
      onWheel,
    },
    TILE_SIZE,
  };
}
