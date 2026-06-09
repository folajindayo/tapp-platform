"use client";

import { usePathname } from "next/navigation";
import { Navbar } from "@/components/Navbar";
import { Preloader } from "@/components/ui/Preloader";
import { Disclaimer } from "@/components/ui/Disclaimer";

/**
 * Route-aware chrome switch. `/` is the public marketing landing —
 * full-bleed, dark, with its own header — so it skips the app chrome
 * (fixed Navbar, mobile column, white preloader flash, disclaimer
 * modal). Every other route keeps the exact shell that used to live
 * inline in layout.tsx.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";

  if (pathname === "/") {
    return <>{children}</>;
  }

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
