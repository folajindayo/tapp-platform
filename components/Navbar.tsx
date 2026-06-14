"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/ui/Logo";
import { ThemeSwitch } from "@/components/ThemeSwitch";
import { useSession } from "@/lib/auth";
import { Button } from "@/components/ui/Button";
import { shouldShowBottomNav } from "./BottomNav";

export function Navbar() {
  const { hydrated, session, clear } = useSession();
  const pathname = usePathname() ?? "";
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <header className="fixed left-0 top-0 z-20 w-full bg-white transition-all dark:bg-neutral-900">
        <nav className="container mx-auto flex items-center justify-between p-4 lg:px-8">
          <Logo />
        </nav>
      </header>
    );
  }

  const isLoggedIn = hydrated && !!session;
  const navVisible = isLoggedIn && shouldShowBottomNav(pathname);

  return (
    <header className="fixed left-0 top-0 z-20 w-full bg-white transition-all dark:bg-neutral-900">
      <nav
        aria-label="Navbar"
        className="container mx-auto flex items-center justify-between p-4 text-neutral-900 dark:text-white lg:px-8"
      >
        <Link href={isLoggedIn ? "/" : "/sign-in"} className="flex items-center">
          <Logo />
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {/* When the bottom tab nav is visible it owns wallet-nav + sign-out
              (via the Settings tab → Security). Keep the navbar minimal so the
              two pieces of chrome don't duplicate. */}
          {isLoggedIn && !navVisible && (
            <Button
              variant="secondary"
              fullWidth={false}
              onClick={clear}
              className="px-3 py-1.5 text-xs"
            >
              Sign out
            </Button>
          )}
          <ThemeSwitch />
        </div>
      </nav>
    </header>
  );
}
