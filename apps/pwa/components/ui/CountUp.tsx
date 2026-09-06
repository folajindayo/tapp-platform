"use client";

import { useEffect, useState } from "react";
import { animate, useMotionValue } from "framer-motion";
import { DURATIONS, useMotionPrefs } from "@/lib/motion";

interface CountUpProps {
  /** Target value the count rolls toward. */
  value: number;
  /** Formatter for each intermediate frame (commas, currency, etc.). */
  format: (n: number) => string;
  /** Skip the roll for values below this threshold (defaults to 1). */
  threshold?: number;
  /**
   * Render key — bump this to force a re-roll (e.g. after a sign-out /
   * sign-in cycle). Otherwise the count only plays on first arrival.
   */
  rollKey?: string;
  className?: string;
}

/**
 * Mount-time count-up. Rolls from 0 to `value` over ~1s with ease-out
 * cubic — the "bank counter clicking forward" feel. Skips the roll
 * for tiny values (where each tick would change digits less than
 * meaningfully) and for the reduced-motion preference.
 *
 * Subsequent updates to `value` after the initial roll snap to the
 * new number — they don't re-roll from zero. This is the
 * "first-arrival only" pattern from MOTION_PRINCIPLES.md.
 */
export function CountUp({
  value,
  format,
  threshold = 1,
  rollKey,
  className,
}: CountUpProps) {
  const { reduced } = useMotionPrefs();
  const motion = useMotionValue(0);
  const [display, setDisplay] = useState(() => format(0));
  const [hasRolled, setHasRolled] = useState(false);

  // Reset the played-flag when the rollKey changes — lets parents
  // re-trigger the roll on intentional "fresh arrival" events.
  useEffect(() => {
    setHasRolled(false);
  }, [rollKey]);

  useEffect(() => {
    // Direct snap when reduced motion is set OR when value is below the
    // threshold OR when we've already rolled once.
    if (reduced || value <= threshold || hasRolled) {
      motion.set(value);
      setDisplay(format(value));
      if (!hasRolled) setHasRolled(true);
      return;
    }

    motion.set(0);
    const controls = animate(motion, value, {
      duration: DURATIONS.countUp,
      ease: [0.16, 1, 0.3, 1], // strong ease-out: fast start, soft landing
      onUpdate: (n) => setDisplay(format(n)),
      onComplete: () => setHasRolled(true),
    });
    return () => controls.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, reduced, threshold, format]);

  return <span className={className}>{display}</span>;
}
