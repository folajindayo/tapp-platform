"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { motion } from "framer-motion";
import { PiArrowRightBold, PiPlusBold } from "react-icons/pi";
import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from "@headlessui/react";
import { useSession } from "@/lib/auth";
import { Logo } from "@/components/ui/Logo";
import { ParticleTap } from "@/components/landing/ParticleTap";
import { AsciiMap } from "@/components/landing/AsciiMap";
import {
  IllCustody,
  IllHardware,
  IllInstant,
  IllSettlement,
} from "@/components/landing/Illustrations";

/**
 * Public marketing landing at `/`. Dark, full-bleed, Morpho-style:
 * particle card-tap hero (disperses on scroll) → ASCII merchant map
 * the particles hand off into → light blueprint platform section → FAQ →
 * big CTA → footer with a giant fading wordmark. Signed-in users get
 * "Open wallet" CTAs.
 */

const fadeUp = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, margin: "-80px" },
  transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as const },
};

export default function LandingPage() {
  const { hydrated, session } = useSession();
  const appHref = hydrated && session ? "/wallet" : "/sign-in";
  const appLabel = hydrated && session ? "Open wallet" : "Get started";

  return (
    <div
      className="min-h-screen bg-[#0a0a0c] text-white antialiased"
      style={{ fontFamily: "var(--font-dm-sans), system-ui, sans-serif" }}
    >
      <LandingNav appHref={appHref} appLabel={appLabel} />
      <Hero />
      <MapSection />
      <PlatformSection />
      <FaqSection />
      <CtaSection appHref={appHref} appLabel={appLabel} />
      <LandingFooter />
    </div>
  );
}

/* ───────────────────────── nav ───────────────────────── */

function LandingNav({
  appHref,
  appLabel,
}: {
  appHref: string;
  appLabel: string;
}) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 border-b border-white/[0.04] bg-[#0a0a0c]/80 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Link href="/" className="flex items-center">
          <Logo className="text-white" />
        </Link>
        <div className="hidden items-center gap-7 text-sm text-neutral-400 md:flex">
          <a href="#features" className="transition-colors hover:text-white">
            Features
          </a>
          <a href="#merchants" className="transition-colors hover:text-white">
            Merchants
          </a>
          <a href="#faq" className="transition-colors hover:text-white">
            FAQ
          </a>
        </div>
        <Link
          href={appHref}
          className="rounded-full bg-blue-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500"
        >
          {appLabel}
        </Link>
      </nav>
    </header>
  );
}

/* ───────────────────────── hero ───────────────────────── */

/** Copy fades out over the first 40% of the dispersal. */
const fadeWithHero = {
  opacity: "calc(1 - var(--hero-p, 0) * 2.5)",
} as const;

function Hero() {
  // Tall track: the inner screen pins (sticky) while scroll progress
  // 0→1 across the extra 120vh drives the globe's dispersion. One
  // source of truth: the same rect math ParticleTap uses, mirrored
  // into a `--hero-p` CSS variable that the copy reads via calc() —
  // no per-frame React re-renders, no second scroll pipeline.
  const trackRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const rect = el.getBoundingClientRect();
      const range = rect.height - window.innerHeight;
      const p = range > 0 ? Math.min(1, Math.max(0, -rect.top / range)) : 0;
      el.style.setProperty("--hero-p", p.toFixed(4));
      // Faded-out copy must not stay invisibly clickable.
      el.classList.toggle("hero-faded", p > 0.35);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  return (
    <section ref={trackRef} className="relative h-[220vh]">
      <div className="sticky top-0 flex h-screen flex-col overflow-hidden px-5 pt-16">
        {/* Dark-grey grid backdrop — vignetted to the center, fades out
            with the dispersal so the handoff into the map stays seamless */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            opacity: "calc(1 - var(--hero-p, 0) * 1.4)",
            backgroundImage:
              "linear-gradient(to right, #131316 1px, transparent 1px), linear-gradient(to bottom, #131316 1px, transparent 1px)",
            backgroundSize: "72px 72px",
            maskImage:
              "radial-gradient(ellipse 80% 70% at 50% 45%, black 30%, transparent 100%)",
            WebkitMaskImage:
              "radial-gradient(ellipse 80% 70% at 50% 45%, black 30%, transparent 100%)",
          }}
        />
        {/* Full-screen canvas so dispersed particles can fill the viewport */}
        <ParticleTap
          trackRef={trackRef}
          className="absolute inset-0 h-full w-full"
        />

        <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col items-center">
          <div
            style={{
              ...fadeWithHero,
              transform: "translateY(calc(var(--hero-p, 0) * -80px))",
            }}
            className="pt-14 text-center md:pt-20"
          >
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              <h1 className="mx-auto max-w-3xl text-4xl font-light tracking-tight text-white md:text-5xl lg:text-6xl">
                Tap into the open payment network for the world
              </h1>
              <p className="mx-auto mt-5 max-w-xl text-sm text-neutral-500 md:text-base">
                Customers tap to pay in USDC. Merchants get money in their
                bank — without ever touching crypto.
              </p>
            </motion.div>
          </div>

          {/* Bottom strip: protocol stats left, scroll hint right */}
          <div
            style={fadeWithHero}
            className="mt-auto flex w-full items-end justify-between pb-8 [.hero-faded_&]:pointer-events-none"
          >
            <div className="flex gap-10">
              <div>
                <p className="text-xs text-neutral-500">Settlement finality</p>
                <p className="mt-1 text-lg font-medium tabular-nums">~0.5s</p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Fee per payment</p>
                <p className="mt-1 text-lg font-medium tabular-nums">
                  &lt;$0.01
                </p>
              </div>
            </div>
            <p className="hidden text-xs text-neutral-600 sm:block">
              Scroll to explore
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ──────────────── merchants map (dispersal handoff) ──────────────── */

const BUSINESSES = [
  "Mama K's Kitchen · Surulere",
  "Buka Express · Yaba",
  "GreenMart · Lekki",
  "Chop Life Café · Abuja",
  "Suya Spot · Port Harcourt",
  "Kahawa Corner · Nairobi",
];

/**
 * The dispersing hero particles hand off into this section: same
 * near-black canvas, no divider, and the world re-assembles as an
 * ASCII dot map of places already taking Tapp payments.
 */
function MapSection() {
  return (
    <section
      id="merchants"
      className="relative overflow-hidden bg-[#0a0a0c] px-5 pb-24 pt-8"
    >
      <div className="mx-auto flex max-w-6xl flex-col items-center">
        <motion.div {...fadeUp} className="text-center">
          <h2 className="text-2xl font-light tracking-tight md:text-3xl">
            Already powering everyday business
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-neutral-500">
            Businesses across Nigeria take Tapp payments today — money in the
            bank by the time the receipt prints.
          </p>
        </motion.div>
        <motion.div {...fadeUp} className="mt-14">
          <AsciiMap />
        </motion.div>
        <motion.div
          {...fadeUp}
          className="mt-12 flex max-w-3xl flex-wrap items-center justify-center gap-2"
        >
          {BUSINESSES.map((b) => (
            <span
              key={b}
              className="rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-xs text-neutral-400"
            >
              {b}
            </span>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* ────────────── platform pillars (blueprint style) ────────────── */

const PILLARS = [
  {
    title: "Instant, low-cost, 24/7",
    body: "A tap settles onchain in about half a second and costs less than a cent. No card networks, no business hours, no T+2 waits.",
    art: <IllInstant />,
  },
  {
    title: "Money in the bank, not tokens",
    body: "Customers pay in USDC; merchants receive local currency in their bank account, automatically. No wallet to run, no conversion step, no volatility to carry.",
    art: <IllSettlement />,
  },
  {
    title: "Self-custody without seed phrases",
    body: "Sign in with Google — zkLogin turns it into a Sui wallet only you control. Large debits wait for your fingerprint; merchants never see your PIN or keys.",
    art: <IllCustody />,
  },
  {
    title: "No terminals, no app store",
    body: "Tapp runs on the phones people already carry. Take payments with a phone tap, a Tapp Card, or a QR code — no POS hardware to buy.",
    art: <IllHardware />,
  },
];

function PlatformSection() {
  return (
    <section id="features" className="bg-[#e9eaef] px-5 py-24 text-neutral-900">
      <div className="mx-auto max-w-6xl">
        <motion.div
          {...fadeUp}
          className="flex items-start justify-between gap-6"
        >
          <h2 className="max-w-xl text-xl leading-snug tracking-tight md:text-2xl">
            <span className="font-semibold">Tapp</span>{" "}
            <span className="text-neutral-500">
              is how everyday payments settle onchain — a tap from the
              customer, money in the bank for the merchant.
            </span>
          </h2>
          <Link
            href="/sign-in"
            className="hidden shrink-0 items-center gap-1.5 pt-1 text-sm text-neutral-600 transition-colors hover:text-neutral-900 sm:flex"
          >
            Open the app <PiArrowRightBold />
          </Link>
        </motion.div>
        <div className="mt-20 grid gap-x-20 gap-y-16 md:grid-cols-2">
          {PILLARS.map((p) => (
            <motion.div key={p.title} {...fadeUp}>
              <div className="flex h-44 items-center justify-center">
                {p.art}
              </div>
              <h3 className="mt-8 text-sm font-semibold">{p.title}</h3>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-neutral-500">
                {p.body}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── FAQ ───────────────────────── */

const FAQS = [
  {
    q: "Do I need to understand crypto to use Tapp?",
    a: "No. You sign in with your Google account and see your balance in naira and dollars. The settlement happens onchain underneath — you never touch a seed phrase, manage gas, or see a token you didn't ask for.",
  },
  {
    q: "What does the merchant actually receive?",
    a: "Money in their bank account, in local currency, settled automatically after each payment. Merchants never hold, convert, or even see crypto.",
  },
  {
    q: "What does a payment cost?",
    a: "The network fee is a fraction of a cent per tap, and there are no card-network percentages stacked on top of it.",
  },
  {
    q: "What if I lose my Tapp Card?",
    a: "Your money lives in your account, not on the card. Open the app, revoke the lost card with one tap, and link a new one whenever you like.",
  },
  {
    q: "Do I need to download an app?",
    a: "No. Tapp runs in the browser on the phone you already have — tap a card, tap a phone, or scan a QR code. Add it to your home screen if you want the app feel.",
  },
  {
    q: "What keeps my money safe?",
    a: "Only you control your wallet — it's created from your Google sign-in and secured on your device. Large payments wait for your fingerprint or face before they move, and the merchant never sees your PIN or your keys.",
  },
];

function FaqSection() {
  return (
    <section id="faq" className="border-t border-white/[0.04] px-5 py-24">
      <div className="mx-auto max-w-2xl">
        <motion.h2
          {...fadeUp}
          className="text-center text-2xl font-light tracking-tight md:text-3xl"
        >
          Questions, answered
        </motion.h2>
        <motion.div
          {...fadeUp}
          className="mt-12 divide-y divide-white/[0.06] border-y border-white/[0.06]"
        >
          {FAQS.map((f) => (
            <Disclosure key={f.q} as="div">
              {({ open }) => (
                <>
                  <DisclosureButton className="flex w-full items-center justify-between gap-4 py-5 text-left text-sm font-medium text-neutral-200 transition-colors hover:text-white">
                    {f.q}
                    <PiPlusBold
                      className={`shrink-0 text-neutral-500 transition-transform duration-200 ${
                        open ? "rotate-45" : ""
                      }`}
                    />
                  </DisclosureButton>
                  <DisclosurePanel className="pb-5 pr-8 text-sm leading-relaxed text-neutral-500">
                    {f.a}
                  </DisclosurePanel>
                </>
              )}
            </Disclosure>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* ───────────────────────── CTA ───────────────────────── */

function CtaSection({
  appHref,
  appLabel,
}: {
  appHref: string;
  appLabel: string;
}) {
  return (
    <section className="border-t border-white/[0.04] bg-[#08080a] px-5 py-32">
      <motion.div {...fadeUp} className="mx-auto max-w-3xl text-center">
        <h2 className="text-3xl font-light tracking-tight md:text-5xl">
          Tap. Pay. Done.
        </h2>
        <p className="mt-4 text-sm text-neutral-500 md:text-base">
          Money that moves at the speed of a tap.
        </p>
        <Link
          href={appHref}
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-blue-600 px-6 py-2.5 text-sm font-medium transition-colors hover:bg-blue-500"
        >
          {appLabel} <PiArrowRightBold />
        </Link>
      </motion.div>
    </section>
  );
}

/* ───────────────────────── footer ───────────────────────── */

const FOOTER_COLS: { title: string; links: { label: string; href: string }[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Wallet", href: "/wallet" },
      { label: "Pay", href: "/pay" },
      { label: "Send", href: "/send" },
      { label: "Deposit", href: "/deposit" },
    ],
  },
  {
    title: "Explore",
    links: [
      { label: "Features", href: "#features" },
      { label: "Merchants", href: "#merchants" },
      { label: "FAQ", href: "#faq" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Sign in", href: "/sign-in" },
      { label: "Activity", href: "/history" },
      { label: "Settings", href: "/settings" },
    ],
  },
];

function LandingFooter() {
  return (
    <footer className="overflow-hidden border-t border-white/[0.04]">
      <div className="mx-auto grid max-w-6xl gap-10 px-5 pb-10 pt-16 sm:grid-cols-[1fr_auto] md:gap-24">
        <div className="flex items-baseline gap-2">
          <Logo className="text-sm text-white" />
          <span className="text-sm text-neutral-600">— a Zoracle product</span>
        </div>
        <div className="grid grid-cols-3 gap-10 text-sm">
          {FOOTER_COLS.map((col) => (
            <div key={col.title}>
              <p className="mb-3 text-xs text-neutral-600">{col.title}</p>
              <ul className="space-y-2">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <Link
                      href={l.href}
                      className="text-neutral-400 transition-colors hover:text-white"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Giant fading wordmark, cropped at the page edge like the reference */}
      <div aria-hidden className="relative h-36 select-none md:h-56">
        <span className="absolute left-1/2 top-2 -translate-x-1/2 bg-gradient-to-b from-[#2e2e33] to-transparent bg-clip-text text-[38vw] font-semibold leading-none tracking-tight text-transparent md:text-[24vw]">
          TAPP
        </span>
      </div>
    </footer>
  );
}
