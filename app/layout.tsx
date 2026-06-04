import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { QueryProvider } from "@/lib/query-provider";
import { GoogleProvider } from "@/lib/google-provider";
import { SessionProvider } from "@/lib/auth";
import { ServiceWorkerRegistrar } from "./register-sw";
import { ThemeProvider } from "@/components/ThemeProvider";
import { Navbar } from "@/components/Navbar";
import { BottomNav } from "@/components/BottomNav";

// Zap-style components
import { Preloader } from "@/components/ui/Preloader";
import { LogoOutlineBg } from "@/components/ui/LogoOutlineBg";
import { Disclaimer } from "@/components/ui/Disclaimer";
import { CookieConsent } from "@/components/ui/CookieConsent";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Tapp by Zoracle Labs",
  description: "Tap, pay, done.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Tapp by Zoracle Labs",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/favicon.ico",
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#FFFFFF",
  width: "device-width",
  initialScale: 1,
  // Transactional surface — accidental pinch-zooms on a PIN pad =
  // bad UX. Use the OS-level text-size setting for accessibility.
  maximumScale: 1,
  userScalable: false,
};

/**
 * Root layout — mirrors paycrest/zap's shape: fixed navbar at top,
 * mobile-first centered column for content, footer at the bottom,
 * dark mode driven by `next-themes`. Each page renders into the
 * `<main>` slot inside `max-w-mobile`.
 */
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full bg-white text-neutral-900 transition-colors dark:bg-neutral-900 dark:text-white">
        <ThemeProvider>
          <GoogleProvider>
            <SessionProvider>
              <QueryProvider>
                <Preloader />
                <Navbar />
                <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-mobile flex-col px-4 pt-28 pb-24">
                  <main className="w-full flex-grow">{children}</main>
                </div>
                <BottomNav />
                <LogoOutlineBg />
                <Disclaimer />
                <CookieConsent />
              </QueryProvider>
            </SessionProvider>
          </GoogleProvider>
        </ThemeProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
