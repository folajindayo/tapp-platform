"use client";

/**
 * Motion tokens + helpers. Single source of truth for durations,
 * curves, springs, reduced-motion, and haptics across the Tapp PWA.
 *
 * Background: `docs/motion-guidelines.md` (and the long-form treatment
 * in users-app/docs/MOTION_PRINCIPLES.md). Read those before adding
 * a new constant here — most things you'd reach for already exist.
 */

import { useEffect, useState } from "react";
import { useReducedMotion as useFramerReducedMotion } from "framer-motion";
import type { Transition, Variants } from "framer-motion";

// -----------------------------------------------------------------------------
// Tokens
// -----------------------------------------------------------------------------

export const DURATIONS = {
  fast:    0.16,  // press feedback, opacity flips
  normal:  0.24,  // page transitions, sheet/modal entries
  slow:    0.36,  // multi-step rail panes
  countUp: 1.0,   // balance / amount mount roll-up
} as const;

/** Cubic-bezier curves. The Kowalski/Family ease-out is our default. */
export const CURVES = {
  easeOut: [0.32, 0.72, 0, 1] as [number, number, number, number],
  inOut:   [0.65, 0,    0.35, 1] as [number, number, number, number],
} as const;

/** Framer Motion spring configs. */
export const SPRINGS = {
  default: { type: "spring" as const, mass: 0.6, damping: 18, stiffness: 220 },
  tight:   { type: "spring" as const, mass: 0.4, damping: 22, stiffness: 320 },
  soft:    { type: "spring" as const, mass: 0.8, damping: 14, stiffness: 140 },
} as const;

/** Page-level entry / exit. Used by `<AnimatedPage>`. */
export const PAGE_VARIANTS: Variants = {
  initial: { opacity: 0, y: 12 },
  in:      { opacity: 1, y: 0 },
  out:     { opacity: 0, y: -12 },
};

export const PAGE_TRANSITION: Transition = {
  duration: DURATIONS.normal,
  ease:     CURVES.easeOut,
};

/** Static variants (used when prefers-reduced-motion is set). */
export const STATIC_VARIANTS: Variants = {
  initial: { opacity: 1 },
  in:      { opacity: 1 },
  out:     { opacity: 1 },
  animate: { opacity: 1 },
  exit:    { opacity: 1 },
};

// -----------------------------------------------------------------------------
// Reduced motion
// -----------------------------------------------------------------------------

/**
 * Single hook to check the user's motion preference. Wraps Framer's
 * `useReducedMotion` (which subscribes to the OS media query) so we
 * don't add a second listener. Returns a stable boolean.
 */
export function useMotionPrefs(): { reduced: boolean } {
  const reduced = useFramerReducedMotion() ?? false;
  return { reduced };
}

// -----------------------------------------------------------------------------
// Haptics
// -----------------------------------------------------------------------------

/**
 * Tiny haptic feedback wrapper around `navigator.vibrate`. Web haptics
 * are unsupported on iOS Safari (no-op) and most desktops; Android
 * Chrome + Samsung Internet honor it. We never *rely* on haptic — it
 * supplements the visible reaction.
 *
 * Tiers (durations are pattern arrays so all browsers behave the same):
 *   light   — 10ms        nav tap, row tap, tab switch
 *   medium  — 18ms        commit (Pay confirm, sign, top-up)
 *   success — [10, 60, 14] success after a long action (payment confirmed)
 *   error   — [30, 50, 30] failed sign / declined tap
 */
function vibrate(pattern: number | number[]): void {
  if (typeof navigator === "undefined") return;
  if (typeof navigator.vibrate !== "function") return;
  try {
    navigator.vibrate(pattern);
  } catch {
    // Some browsers throw on unsupported devices; ignore.
  }
}

export function useHaptic() {
  const { reduced } = useMotionPrefs();
  return {
    light:   () => { if (!reduced) vibrate(10); },
    medium:  () => { if (!reduced) vibrate(18); },
    success: () => { if (!reduced) vibrate([10, 60, 14]); },
    error:   () => { /* keep error haptic even with reduced motion — it's a safety cue */ vibrate([30, 50, 30]); },
  };
}

// -----------------------------------------------------------------------------
// Dev helpers
// -----------------------------------------------------------------------------

/**
 * `?slow=1` in the URL slows every page transition 8× so timing
 * mismatches show up in dev. The rule from MOTION_PRINCIPLES.md
 * is "test in slow motion" — this is the lever.
 */
export function useSlowMotion(): number {
  const [factor, setFactor] = useState(1);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    setFactor(params.get("slow") === "1" ? 8 : 1);
  }, []);
  return factor;
}
