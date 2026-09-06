"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { CURVES, DURATIONS, useMotionPrefs } from "@/lib/motion";

interface CrossFadeProps {
  /**
   * Stable key that identifies the *current* branch. When this changes
   * the outgoing branch fades out and the incoming one fades in.
   */
  branchKey: string;
  children: ReactNode;
  className?: string;
}

/**
 * Drop-in for `{loading ? <A /> : <B />}` patterns. Wrap the
 * conditional in `<CrossFade branchKey={loading ? "loading" : "ready"}>`
 * and the swap animates instead of popping.
 *
 * `mode="wait"` so the outgoing branch finishes before the incoming
 * one mounts — avoids the "two stacked" look during the transition.
 */
export function CrossFade({ branchKey, children, className }: CrossFadeProps) {
  const { reduced } = useMotionPrefs();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={branchKey}
        initial={reduced ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={reduced ? { opacity: 1 } : { opacity: 0 }}
        transition={{ duration: DURATIONS.fast, ease: CURVES.easeOut }}
        className={className}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
