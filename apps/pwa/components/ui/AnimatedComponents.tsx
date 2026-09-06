"use client";

import type { ReactNode } from "react";
import { motion, type Variants } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  CURVES,
  DURATIONS,
  PAGE_TRANSITION,
  PAGE_VARIANTS,
  STATIC_VARIANTS,
  useMotionPrefs,
  useSlowMotion,
} from "@/lib/motion";

/**
 * Page-level entry/exit. Subtle slide + fade, < 240ms — the rule
 * is "page swaps must feel as fast as a cut, plus the spatial story."
 */
export const AnimatedPage = ({
  children,
  componentKey,
  className,
}: {
  children: ReactNode;
  componentKey?: string;
  className?: string;
}) => {
  const { reduced } = useMotionPrefs();
  const slow = useSlowMotion();
  const variants = reduced ? STATIC_VARIANTS : PAGE_VARIANTS;
  return (
    <motion.div
      key={componentKey}
      initial="initial"
      animate="in"
      exit="out"
      variants={variants}
      transition={{ ...PAGE_TRANSITION, duration: PAGE_TRANSITION.duration! * slow }}
      className={cn("w-full", className)}
    >
      {children}
    </motion.div>
  );
};

// -----------------------------------------------------------------------------
// Shared variants
// -----------------------------------------------------------------------------

export const fadeInOut: Variants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit:    { opacity: 0 },
};

export const slideInOut: Variants = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -12 },
};

export const slideInDown: Variants = {
  initial: { opacity: 0, y: -12 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -12 },
};

export const scaleInOut: Variants = {
  initial: { scale: 0 },
  animate: { scale: 1 },
  exit:    { scale: 0 },
};

/**
 * Generic per-block animator. Reads reduced-motion + slow-mode so
 * pages don't need to thread either through manually.
 */
export const AnimatedComponent = ({
  children,
  variant = fadeInOut,
  delay = 0,
  className,
}: {
  children: ReactNode;
  variant?: Variants;
  delay?: number;
  className?: string;
}) => {
  const { reduced } = useMotionPrefs();
  const slow = useSlowMotion();
  return (
    <motion.div
      initial="initial"
      animate="animate"
      exit="exit"
      variants={reduced ? STATIC_VARIANTS : variant}
      transition={{
        ease: CURVES.easeOut,
        duration: DURATIONS.normal * slow,
        delay: delay * slow,
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
};
