"use client";

import { Navbar } from "@/components/Navbar";
import { Preloader } from "@/components/ui/Preloader";
import { Disclaimer } from "@/components/ui/Disclaimer";

/**
 * Route-aware chrome shell. Every route (including root `/` since it is
 * now the wallet page) renders inside the default app chrome (fixed Navbar,
 * mobile column, white preloader flash, disclaimer modal).
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Preloader />
      <Navbar />
      <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-mobile flex-col px-4 pt-28 pb-24">
        <main className="w-full flex-grow">{children}</main>
      </div>
      <Disclaimer />
    </>
  );
}
