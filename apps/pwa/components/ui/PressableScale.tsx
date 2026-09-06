"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SPRINGS, useHaptic, useMotionPrefs } from "@/lib/motion";

interface BaseProps {
  children: ReactNode;
  className?: string;
  /** Skip the light haptic (e.g. for parent-disabled rows). */
  silent?: boolean;
}

interface AsButton extends BaseProps {
  as?: "button";
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  ariaLabel?: string;
}

interface AsLink extends BaseProps {
  as: "link";
  href: ComponentProps<typeof Link>["href"];
  prefetch?: ComponentProps<typeof Link>["prefetch"];
  ariaLabel?: string;
}

type PressableScaleProps = AsButton | AsLink;

const SCALE_PRESSED  = 0.97;
const SCALE_DEFAULT  = 1;

/**
 * Wraps any tappable surface (Link row, list cell, tab, custom CTA)
 * with the same press feedback our `<Button>` already has via Tailwind:
 * a small scale dip + a light haptic the instant the touch lands.
 *
 * Use this for surfaces that don't render through `<Button>` — activity
 * rows, settings cells, tab buttons, etc.
 */
export function PressableScale(props: PressableScaleProps) {
  const { reduced } = useMotionPrefs();
  const haptic = useHaptic();

  const onTapStart = () => {
    if (!props.silent) haptic.light();
  };

  const motionProps = {
    whileTap: reduced ? undefined : { scale: SCALE_PRESSED },
    transition: SPRINGS.tight,
    onTapStart,
    initial: { scale: SCALE_DEFAULT },
    className: cn("block touch-manipulation select-none", props.className),
    "aria-label": props.ariaLabel,
  };

  if (props.as === "link") {
    return (
      <motion.div {...motionProps}>
        <Link href={props.href} prefetch={props.prefetch} className="block">
          {props.children}
        </Link>
      </motion.div>
    );
  }

  return (
    <motion.button
      type={props.type ?? "button"}
      onClick={props.onClick}
      disabled={props.disabled}
      {...motionProps}
    >
      {props.children}
    </motion.button>
  );
}
