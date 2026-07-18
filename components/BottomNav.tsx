"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  PiWalletFill,
  PiClockCounterClockwiseBold,
  PiQrCodeBold,
  PiPaperPlaneTiltBold,
  PiCreditCardBold,
  PiGearSixBold,
} from "react-icons/pi";
import type { IconType } from "react-icons";
import { cn } from "@/lib/utils";
import { useSession } from "@/lib/auth";
import { SPRINGS, useHaptic, useMotionPrefs } from "@/lib/motion";

interface Tab {
  href: string;
  label: string;
  icon: IconType;
  match: (pathname: string) => boolean;
  prominent?: boolean;
}

const TABS: Tab[] = [
  { href: "/",              label: "Wallet",   icon: PiWalletFill,                match: (p) => p === "/" },
  { href: "/history",       label: "Activity", icon: PiClockCounterClockwiseBold, match: (p) => p === "/history" || p.startsWith("/tx/") },
  { href: "/pay",           label: "Pay",      icon: PiQrCodeBold,                match: (p) => p === "/pay" || p.startsWith("/order/"), prominent: true },
  { href: "/send",          label: "Send",     icon: PiPaperPlaneTiltBold,        match: (p) => p === "/send" },
  { href: "/settings/card", label: "Card",     icon: PiCreditCardBold,            match: (p) => p === "/settings/card" || p.startsWith("/settings/limits") },
  { href: "/settings",      label: "Settings", icon: PiGearSixBold,               match: (p) => (p === "/settings" || p.startsWith("/settings/")) && !p.startsWith("/settings/card") && !p.startsWith("/settings/limits") },
];

export function shouldShowBottomNav(pathname: string): boolean {
  if (pathname.startsWith("/sign-in")) return false;
  if (pathname.startsWith("/link")) return false;
  if (pathname.startsWith("/order/")) return false;
  if (pathname.startsWith("/cards/")) return false;
  if (pathname === "/cash-out") return false;
  if (pathname === "/cashout") return false;
  return true;
}

export function BottomNav() {
  const pathname = usePathname() ?? "";
  const { hydrated, session } = useSession();

  if (!hydrated || !session) return null;
  if (!shouldShowBottomNav(pathname)) return null;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white transition-colors dark:border-white/10 dark:bg-neutral-900"
    >
      <ul className="mx-auto flex w-full max-w-mobile items-end justify-between px-3 pt-2 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
        {TABS.map((tab) =>
          tab.prominent ? (
            <ProminentTab key={tab.href} tab={tab} pathname={pathname} />
          ) : (
            <RegularTab key={tab.href} tab={tab} pathname={pathname} />
          ),
        )}
      </ul>
    </nav>
  );
}

function RegularTab({ tab, pathname }: { tab: Tab; pathname: string }) {
  const active = tab.match(pathname);
  const haptic = useHaptic();
  const { reduced } = useMotionPrefs();
  const Icon = tab.icon;

  return (
    <li className="flex-1">
      <Link
        href={tab.href}
        aria-current={active ? "page" : undefined}
        onClick={() => haptic.light()}
        className="flex flex-col items-center gap-1 py-1 touch-manipulation"
      >
        <span className="relative grid size-10 place-items-center">
          {active && !reduced ? (
            <motion.span
              layoutId="bn-active-pill"
              transition={SPRINGS.default}
              className="absolute inset-0 rounded-2xl bg-blue-50 dark:bg-blue-500/15"
              aria-hidden
            />
          ) : null}
          {active && reduced ? (
            <span
              aria-hidden
              className="absolute inset-0 rounded-2xl bg-blue-50 dark:bg-blue-500/15"
            />
          ) : null}
          <Icon
            className={cn(
              "relative z-10 text-2xl transition-colors",
              active
                ? "text-blue-600 dark:text-blue-400"
                : "text-gray-400 dark:text-white/40",
            )}
          />
        </span>
        <span
          className={cn(
            "text-[11px] font-medium leading-none transition-colors",
            active
              ? "text-neutral-900 dark:text-white"
              : "text-gray-400 dark:text-white/40",
          )}
        >
          {tab.label}
        </span>
      </Link>
    </li>
  );
}

function ProminentTab({ tab, pathname }: { tab: Tab; pathname: string }) {
  const active = tab.match(pathname);
  const haptic = useHaptic();
  const Icon = tab.icon;
  return (
    <li className="flex-1">
      <Link
        href={tab.href}
        aria-current={active ? "page" : undefined}
        onClick={() => haptic.medium()}
        className="flex flex-col items-center gap-1 py-1 touch-manipulation"
      >
        <motion.span
          whileTap={{ scale: 0.9 }}
          transition={SPRINGS.tight}
          className="relative grid size-10 place-items-center"
        >
          <span
            aria-hidden
            className="absolute inset-0 rounded-2xl bg-blue-600/10 dark:bg-blue-500/15"
          />
          <Icon
            className="relative z-10 text-2xl text-blue-600 dark:text-blue-400"
          />
        </motion.span>
        <span
          className={cn(
            "text-[11px] font-medium leading-none transition-colors",
            active
              ? "text-neutral-900 dark:text-white"
              : "text-gray-500 dark:text-white/60",
          )}
        >
          {tab.label}
        </span>
      </Link>
    </li>
  );
}
