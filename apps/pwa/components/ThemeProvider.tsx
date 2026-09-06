"use client";

import { ThemeProvider as NextThemeProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Wraps the app in `next-themes` per zap's convention. Class-based
 * dark mode (`darkMode: "class"` in globals.css via `@variant dark`),
 * system pref as default, no flash since the provider runs as a
 * client component above the page tree.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemeProvider>
  );
}
