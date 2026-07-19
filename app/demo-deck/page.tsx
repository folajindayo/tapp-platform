"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  PiArrowRightBold,
  PiBankBold,
  PiCaretLeftBold,
  PiCaretRightBold,
  PiCoinsBold,
  PiCreditCardBold,
  PiCurrencyNgnBold,
  PiGlobeHemisphereWestBold,
  PiImageSquareBold,
  PiKeyboardBold,
  PiLightningBold,
  PiMonitorPlayBold,
  PiPlayBold,
  PiStorefrontBold,
  PiVideoCameraBold,
} from "react-icons/pi";
import type { IconType } from "react-icons";

const slides = [
  {
    kicker: "0:00",
    title: "Major chains in. Local currency out.",
    note: "Open with the uncomfortable truth: crypto moves everywhere except the checkout counter.",
  },
  {
    kicker: "Problem",
    title: "Fragmented twice.",
    note: "There are over 50 blockchains today and trillions of dollars sitting on them. But here's the uncomfortable truth: almost none of that money can be spent in the real world. You can hold it, trade it, bridge it between chains — but you can't walk into a store and use it. Only few chains have rails to real-world local currency, and the few that exist are fragmented, region-locked, and clunky. So money is fragmented twice: scattered across chains, and cut off from real life.",
  },
  {
    kicker: "Solution",
    title: "Rails settles. Tapp spends.",
    note: "We fix both. We built Rails — the settlement layer that connects any chain to real-world local currency. It's the missing infrastructure between the 50-plus chains and the corner store. Then, on top of Rails, we built Tapp — a card that lets anyone spend their on-chain money at any merchant, instantly. The user taps. The merchant gets paid in their own local currency — and never touches crypto. We take everything that doesn't matter — chains, tokens, bridges, FX — and abstract it down to the one thing that does: spending.",
  },
  {
    kicker: "Demo",
    title: "Product Usage.",
    note: "Live product usage demo: user taps, Rails settles, merchant sees paid.",
  },
  {
    kicker: "Why Sui",
    title: "Sui is the payments home base.",
    note: "Fast, cheap, built for volume, and the right launchpad through Overflow.",
  },
  {
    kicker: "Traction",
    title: "Live in production today.",
    note: "Not a prototype. Merchants are onboarded and businesses are integrating Rails.",
  },
  {
    kicker: "Revenue",
    title: "We earn when real value moves.",
    note: "Close by handing off to the live merchant-phone demo.",
  },
];

const chains = ["Sui", "Base", "Polygon", "Ethereum", "Starknet", "Arbitrum"];

const supportedChains = [
  { name: "Sui", logo: "/demo-deck/logos/sui.svg", tag: "settlement" },
  { name: "Base", logo: "/demo-deck/logos/base.svg", tag: "CCTP" },
  { name: "Ethereum", logo: "/demo-deck/logos/ethereum.svg", tag: "EVM" },
  { name: "Polygon", logo: "/demo-deck/logos/polygon.svg", tag: "EVM" },
  { name: "Arbitrum", logo: "/demo-deck/logos/arbitrum.svg", tag: "EVM" },
  { name: "OP Mainnet", logo: "/demo-deck/logos/optimism.svg", tag: "EVM" },
  { name: "Avalanche", logo: "/demo-deck/logos/avalanche.svg", tag: "EVM" },
  { name: "Starknet", logo: "/demo-deck/logos/starknet.svg", tag: "native USDC" },
];

export default function DemoDeckPage() {
  const [index, setIndex] = useState(0);
  const slide = slides[index];
  const progress = ((index + 1) / slides.length) * 100;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight" || event.key === " ") {
        event.preventDefault();
        setIndex((current) => Math.min(current + 1, slides.length - 1));
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setIndex((current) => Math.max(current - 1, 0));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const content = useMemo(() => {
    switch (index) {
      case 0:
        return <OpeningMosaic />;
      case 1:
        return <ProblemSlide />;
      case 2:
        return <SolutionSlide />;
      case 3:
        return <ProductDemoSlide />;
      case 4:
        return <SuiSlide />;
      case 5:
        return <TractionSlide />;
      default:
        return <CloseSlide />;
    }
  }, [index]);

  return (
    <main className="deck-root h-screen max-h-screen overflow-hidden bg-[#050505] text-[#f8f3e8]">
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 h-1 bg-white/10">
        <motion.div
          className="h-full bg-[#c8ff45]"
          initial={false}
          animate={{ width: `${progress}%` }}
          transition={{ type: "spring", stiffness: 160, damping: 24 }}
        />
      </div>

      <div className="fixed left-5 top-5 z-50 flex items-center gap-2 rounded-full border border-white/15 bg-black/40 px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-white/75 backdrop-blur">
        <span className="size-2 rounded-full bg-[#c8ff45]" />
        Tapp demo day
      </div>

      <div className="fixed right-5 top-5 z-50 hidden items-center gap-2 rounded-full border border-white/15 bg-black/40 px-3 py-2 text-xs font-semibold text-white/70 backdrop-blur md:flex">
        <PiKeyboardBold />
        Use arrow keys
      </div>

      <AnimatePresence mode="wait">
        <motion.section
          key={index}
          className="relative grid h-screen max-h-screen grid-rows-[1fr_auto] px-4 py-8 md:px-8 md:py-10 overflow-hidden"
          initial={{ opacity: 0, y: 18, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -14, scale: 1.015 }}
          transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="grid min-h-0 place-items-center h-full overflow-hidden">{content}</div>

          <footer className="mx-auto flex w-full max-w-7xl items-end justify-between gap-4 pt-3">
            <div className="max-w-2xl">
              <div className="text-xs font-black uppercase tracking-[0.24em] text-[#c8ff45]">
                {slide.kicker}
              </div>
              <p className="mt-1 text-sm font-medium text-white/55 md:text-base">
                {slide.note}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <DeckButton
                label="Previous"
                icon={PiCaretLeftBold}
                disabled={index === 0}
                onClick={() => setIndex((current) => Math.max(current - 1, 0))}
              />
              <div className="min-w-16 text-center text-sm font-black tabular-nums text-white/50">
                {index + 1}/{slides.length}
              </div>
              <DeckButton
                label="Next"
                icon={PiCaretRightBold}
                disabled={index === slides.length - 1}
                onClick={() =>
                  setIndex((current) => Math.min(current + 1, slides.length - 1))
                }
              />
            </div>
          </footer>
        </motion.section>
      </AnimatePresence>
    </main>
  );
}

function OpeningMosaic() {
  return (
    <div className="deck-mosaic grid w-full max-w-7xl grid-cols-6 grid-rows-4 gap-2 md:h-[63vh]">
      <Tile className="col-span-3 row-span-1 bg-[#c6c05b] p-0 text-[#16130f]">
        <ChainRoll />
      </Tile>
      <Tile className="col-span-3 row-span-2 bg-[#f0ede5] text-[#111]">
        <div className="max-w-xl text-[clamp(2.7rem,6vw,6rem)] font-black uppercase leading-[0.86]">
          Sui settles every chain <span className="bg-[#c8ff45] px-2">to local currency</span>
        </div>
        <FloatingCard className="right-8 top-8 rotate-6" />
      </Tile>
      <Tile className="col-span-2 row-span-2 bg-[#84a17d] text-[#10140f] relative">
        <PhoneMockup />
      </Tile>
      <Tile className="col-span-2 row-span-1 bg-[#9f8dc3] text-[#16121f]">
        <div className="text-[clamp(1.9rem,3.2vw,3.35rem)] font-black uppercase leading-[0.88]">
          Tap.
          <br />
          Pay.
          <br />
          Done.
        </div>
      </Tile>
      <Tile className="col-span-2 row-span-1 bg-[#e9a0a2] text-[#1b1112]">
        <LineStore />
        <p className="mt-auto text-xl font-black">merchant gets local currency</p>
      </Tile>
      <Tile className="col-span-4 row-span-1 bg-[#d9d1bc] text-[#17130d]">
        <div className="deck-marquee my-auto text-[clamp(2rem,4.2vw,4.8rem)] font-black uppercase leading-none">
          Connecting any chain
          <br />
          to local fiat
        </div>
      </Tile>
      <Tile className="col-span-2 row-span-1 bg-[#bed6ea] text-[#111820] relative">
        <div className="absolute -right-18 -bottom-18 w-[112%] z-20 rounded-xl bg-black/95 p-4 font-mono text-[11px] text-[#c8ff45] border border-white/10 shadow-2xl backdrop-blur-sm select-none">
          <div className="flex items-center gap-1.5 border-b border-white/10 pb-2 mb-2 text-[8px] text-white/40 uppercase font-sans font-bold tracking-wider">
            <span className="size-1.5 rounded-full bg-[#ff5f56]" />
            <span className="size-1.5 rounded-full bg-[#ffbd2e]" />
            <span className="size-1.5 rounded-full bg-[#27c93f]" />
            <span className="ml-1 text-[8px]">sui-pay.ts</span>
          </div>
          <pre className="overflow-x-auto leading-relaxed text-white/95">
            <code>{`const tx = new Transaction();
tx.moveCall({
  target: '0x...::pay::instant',
  arguments: [coin, merchant]
});
await client.signAndExecute({
  transaction: tx,
  signer: zkLoginKeypair
});`}</code>
          </pre>
        </div>
      </Tile>
    </div>
  );
}

const problemCol1 = [
  { name: "Sui", logo: "/demo-deck/logos/sui.svg" },
  { name: "Polygon", logo: "/demo-deck/logos/polygon.svg" },
  { name: "Starknet", logo: "/demo-deck/logos/starknet.svg" },
  { name: "Base", logo: "/demo-deck/logos/base.svg" },
  { name: "Circle", logo: "/demo-deck/logos/circle.svg" },
];

const problemCol2 = [
  { name: "Ethereum", logo: "/demo-deck/logos/ethereum.svg" },
  { name: "Arbitrum", logo: "/demo-deck/logos/arbitrum.svg" },
  { name: "Optimism", logo: "/demo-deck/logos/optimism.svg" },
  { name: "Avalanche", logo: "/demo-deck/logos/avalanche.svg" },
  { name: "Circle", logo: "/demo-deck/logos/circle.svg" },
];

function ProblemSlide() {
  const col1Items = [...problemCol1, ...problemCol1];
  const col2Items = [...problemCol2, ...problemCol2];

  return (
    <TwoColumn title="Trillions on-chain. Cut off from real life.">
      <div className="grid gap-3">
        <StatCard value="$T" label="on-chain value" tone="lime" />
        <StatCard value="50+" label="blockchains" tone="violet" />
        <StatCard value="few" label="real-world rails" tone="rose" />
      </div>
      <div className="relative h-full min-h-0 overflow-hidden rounded-[2rem] border border-white/10 bg-[#111] p-4 flex gap-3">
        <div className="absolute inset-0 deck-grid opacity-30 pointer-events-none" />

        {/* Column 1: Upwards */}
        <div className="relative h-full flex-1 overflow-hidden z-10">
          <motion.div
            className="flex flex-col gap-3"
            animate={{ y: ["0%", "-50%"] }}
            transition={{
              repeat: Infinity,
              ease: "linear",
              duration: 15,
            }}
          >
            {col1Items.map((item, index) => (
              <div
                key={`${item.name}-${index}`}
                className="flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04] p-4 h-28 shrink-0 select-none"
              >
                <img
                  src={item.logo}
                  alt={`${item.name} logo`}
                  className="size-10 object-contain filter drop-shadow-[0_4px_10px_rgba(255,255,255,0.1)]"
                />
                <span className="mt-2 text-[9px] font-black uppercase tracking-[0.14em] text-white/40">
                  {item.name}
                </span>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Column 2: Downwards */}
        <div className="relative h-full flex-1 overflow-hidden z-10">
          <motion.div
            className="flex flex-col gap-3"
            animate={{ y: ["-50%", "0%"] }}
            transition={{
              repeat: Infinity,
              ease: "linear",
              duration: 15,
            }}
          >
            {col2Items.map((item, index) => (
              <div
                key={`${item.name}-${index}`}
                className="flex flex-col items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04] p-4 h-28 shrink-0 select-none"
              >
                <img
                  src={item.logo}
                  alt={`${item.name} logo`}
                  className="size-10 object-contain filter drop-shadow-[0_4px_10px_rgba(255,255,255,0.1)]"
                />
                <span className="mt-2 text-[9px] font-black uppercase tracking-[0.14em] text-white/40">
                  {item.name}
                </span>
              </div>
            ))}
          </motion.div>
        </div>

        {/* Fade gradients */}
        <div className="absolute inset-x-0 top-0 z-20 h-16 bg-gradient-to-b from-[#111] to-transparent pointer-events-none" />
        <div className="absolute inset-x-0 bottom-0 z-20 h-16 bg-gradient-to-t from-[#111] to-transparent pointer-events-none" />

        {/* Checkout counter label */}
        <div className="absolute bottom-5 left-5 right-5 z-30 rounded-3xl bg-[#f0ede5] p-5 text-[#111] shadow-2xl">
          <div className="flex items-center gap-3 text-2xl font-black">
            <PiStorefrontBold />
            Checkout counter: unreachable
          </div>
        </div>
      </div>
    </TwoColumn>
  );
}

function SolutionSlide() {
  return (
    <div className="rounded-[2rem] bg-[#f0ede5] p-6 text-[#111] md:p-8 flex flex-col justify-between h-[63vh] w-full max-w-7xl">
      <div>
        <h1 className="text-[clamp(2.3rem,4.8vw,4.8rem)] font-black uppercase leading-[0.9]">
          One settlement layer between every chain and every store.
        </h1>
      </div>
      <div className="grid md:grid-cols-2 gap-4 mt-6 flex-1 min-h-0 items-stretch">
        <motion.div 
          className="flex flex-col justify-between rounded-3xl bg-white/70 p-6 border border-black/[0.06]"
          whileHover={{ y: -4 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          <div className="flex justify-between items-start">
            <div className="grid size-14 place-items-center rounded-2xl bg-black text-3xl text-white">
              <PiBankBold />
            </div>
            <span className="rounded-full bg-[#c8ff45] px-3 py-1 text-xs font-black uppercase tracking-wider text-[#111]">
              Infrastructure
            </span>
          </div>
          <div className="mt-8">
            <h2 className="text-3xl font-black uppercase tracking-wide">Rails</h2>
            <p className="mt-2 text-base font-bold text-black/60 leading-snug">
              A unified settlement layer that takes any chain/token and routes it directly to local currency.
            </p>
          </div>
        </motion.div>

        <motion.div 
          className="flex flex-col justify-between rounded-3xl bg-black text-[#f8f3e8] p-6 border border-white/10"
          whileHover={{ y: -4 }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
        >
          <div className="flex justify-between items-start">
            <div className="grid size-14 place-items-center rounded-2xl bg-[#c8ff45] text-3xl text-[#111]">
              <PiCreditCardBold />
            </div>
            <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-black uppercase tracking-wider text-white/80">
              Consumer / UX
            </span>
          </div>
          <div className="mt-8">
            <h2 className="text-3xl font-black uppercase tracking-wide">Tapp</h2>
            <p className="mt-2 text-base font-bold text-white/70 leading-snug">
              An instant, contactless card built on top of Rails that abstracts all Web3 complexity down to a simple, physical tap.
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

function ProductDemoSlide() {
  return (
    <div className="grid w-full max-w-7xl h-[63vh] items-stretch">
      <MediaSlot
        icon={PiMonitorPlayBold}
        title="Product usage video"
        copy="Reserved for the live Tapp flow: user taps, Rails settles, merchant sees paid."
        aspect="wide"
      />
    </div>
  );
}

function SuiSlide() {
  return (
    <TwoColumn title="Sui is the settlement layer for every chain we support.">
      <div className="grid grid-cols-2 gap-3">
        <StatCard value="fast" label="finality feel" tone="blue" />
        <StatCard value="cheap" label="everyday spend" tone="lime" />
        <StatCard value="volume" label="payment throughput" tone="violet" />
        <StatCard value="home" label="Overflow launchpad" tone="rose" />
      </div>
      <div className="rounded-[2rem] bg-[#dfeffd] p-6 text-[#0b1720] h-full flex flex-col justify-between">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.2em] text-[#186aa5]">
              supported inputs
            </p>
            <h3 className="mt-2 text-4xl font-black leading-none">Major EVMs + Starknet route into Sui settlement</h3>
          </div>
          <PiGlobeHemisphereWestBold className="hidden text-7xl md:block" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {supportedChains.map((chain) => (
            <div key={chain.name} className="flex items-center gap-2.5 rounded-2xl bg-white/70 px-3 py-2 text-sm font-black">
              <img src={chain.logo} alt="" className="size-5 object-contain" />
              <span>{chain.name}</span>
            </div>
          ))}
        </div>
      </div>
    </TwoColumn>
  );
}

function TractionSlide() {
  return (
    <TwoColumn title="Production traction, with space for proof.">
      <div className="grid grid-cols-2 gap-3">
        <StatCard value="4" label="merchants onboarded" tone="lime" />
        <StatCard value="2" label="businesses integrating Rails" tone="violet" />
        <StatCard value="100+" label="daily customers through one partner" tone="blue" />
        <StatCard value="next" label="restaurants and stores" tone="rose" />
      </div>
      <div className="grid gap-3 h-full">
        <MediaSlot
          icon={PiImageSquareBold}
          title="Merchant screenshots"
          copy="Drop phone screenshots, POS receipts, or merchant dashboard captures here."
          aspect="thin"
        />
        <MediaSlot
          icon={PiVideoCameraBold}
          title="Integration proof video"
          copy="Reserved for short clips from business onboarding or settlement confirmation."
          aspect="thin"
        />
      </div>
    </TwoColumn>
  );
}

function CloseSlide() {
  return (
    <div className="grid w-full max-w-7xl gap-4 lg:grid-cols-[1fr_0.82fr] h-[63vh] items-stretch">
      <div className="rounded-[2rem] bg-[#f0ede5] p-6 text-[#111] md:p-8 flex flex-col justify-between h-full">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.24em] text-[#6b6b2f]">
            monetization
          </p>
          <h1 className="mt-2 text-[clamp(2.5rem,5.5vw,5.5rem)] font-black uppercase leading-[0.9]">
            Revenue scales with real economic activity.
          </h1>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <FlowNode icon={PiCreditCardBold} title="Card sale fee" copy="When value enters the card" />
          <FlowNode icon={PiBankBold} title="Settlement fee" copy="When merchants get paid" />
        </div>
      </div>
      <MediaSlot
        icon={PiPlayBold}
        title="Live demo handoff"
        copy="Place the merchant-phone video here, or keep it as a blank stage cue for the live demo."
        aspect="tall"
      />
    </div>
  );
}

function TwoColumn({
  title,
  children,
}: {
  title: string;
  children: [React.ReactNode, React.ReactNode];
}) {
  return (
    <div className="grid w-full max-w-7xl gap-4 lg:grid-cols-[1.15fr_0.85fr] h-[63vh] items-stretch">
      <div className="rounded-[2rem] bg-[#f0ede5] p-6 text-[#111] md:p-8 flex flex-col justify-between h-full">
        <h1 className="text-[clamp(2rem,4.5vw,4.5rem)] font-black uppercase leading-[0.9]">
          {title}
        </h1>
        <div className="mt-4 flex-1 flex flex-col justify-center">{children[0]}</div>
      </div>
      <div className="h-full overflow-hidden">{children[1]}</div>
    </div>
  );
}

function Tile({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <motion.div
      className={`relative flex min-h-36 overflow-hidden rounded-2xl p-5 ${className}`}
      whileHover={{ scale: 0.985, rotate: -0.4 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
    >
      {children}
    </motion.div>
  );
}

function ChainRoll() {
  const rows = [...supportedChains, ...supportedChains];

  return (
    <div className="relative flex h-full min-h-36 w-full overflow-hidden">
      <div className="absolute inset-x-0 top-0 z-10 h-12 bg-gradient-to-b from-[#c6c05b] to-transparent" />
      <div className="absolute inset-x-0 bottom-0 z-10 h-12 bg-gradient-to-t from-[#c6c05b] to-transparent" />
      <div className="grid w-[46%] place-items-center border-r-4 border-black/10 px-5">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] opacity-60">
            supported inputs
          </p>
          <h2 className="mt-1 text-[clamp(1.45rem,2.55vw,2.75rem)] font-black uppercase leading-[0.9]">
            EVMs
            <br />
            Starknet
            <br />
            Sui
          </h2>
        </div>
      </div>
      <div className="relative h-full flex-1 overflow-hidden">
        <div className="deck-chain-roll grid gap-2 p-3">
          {rows.map((chain, index) => (
            <div
              key={`${chain.name}-${index}`}
              className="flex items-center justify-between gap-3 rounded-2xl bg-[#f0ede5]/75 px-3 py-2 shadow-sm"
            >
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-white">
                  <img
                    src={chain.logo}
                    alt={`${chain.name} logo`}
                    className="size-6 object-contain"
                  />
                </span>
                <span className="text-sm font-black uppercase leading-none">
                  {chain.name}
                </span>
              </div>
              <span className="rounded-full bg-black px-2 py-1 text-[10px] font-black uppercase text-[#c8ff45]">
                {chain.tag}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  value,
  label,
  tone,
}: {
  value: string;
  label: string;
  tone: "lime" | "violet" | "rose" | "blue";
}) {
  const tones = {
    lime: "bg-[#c8c85f] text-[#111]",
    violet: "bg-[#9f8dc3] text-[#111]",
    rose: "bg-[#e6a3a5] text-[#111]",
    blue: "bg-[#bed6ea] text-[#111]",
  };

  return (
    <motion.div
      className={`rounded-3xl p-4 ${tones[tone]}`}
      whileHover={{ y: -4 }}
      transition={{ type: "spring", stiffness: 300, damping: 20 }}
    >
      <div className="text-[clamp(1.8rem,4vw,3.6rem)] font-black uppercase leading-none">
        {value}
      </div>
      <p className="mt-1.5 text-xs font-black uppercase tracking-[0.08em] opacity-70">
        {label}
      </p>
    </motion.div>
  );
}

function FlowNode({
  icon: Icon,
  title,
  copy,
  active,
}: {
  icon: IconType;
  title: string;
  copy: string;
  active?: boolean;
}) {
  return (
    <motion.div
      className={`flex items-center gap-4 rounded-3xl p-5 ${
        active ? "bg-[#c8ff45] text-[#111]" : "bg-white/70 text-[#111]"
      }`}
      whileHover={{ x: 6 }}
      transition={{ type: "spring", stiffness: 260, damping: 22 }}
    >
      <div className="grid size-14 shrink-0 place-items-center rounded-2xl bg-black text-3xl text-white">
        <Icon />
      </div>
      <div>
        <h3 className="text-2xl font-black uppercase leading-none">{title}</h3>
        <p className="mt-1 text-sm font-bold opacity-65">{copy}</p>
      </div>
    </motion.div>
  );
}

function MediaSlot({
  icon: Icon,
  title,
  copy,
  aspect,
}: {
  icon: IconType;
  title: string;
  copy: string;
  aspect: "wide" | "thin" | "tall";
}) {
  return (
    <motion.div
      className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#121212] p-5 h-full min-h-0 flex flex-col justify-center items-center"
      whileHover={{ scale: 0.992 }}
      transition={{ type: "spring", stiffness: 240, damping: 24 }}
    >
      <div className="absolute inset-0 deck-grid opacity-25" />
      <div className="absolute inset-4 rounded-[1.45rem] border border-dashed border-white/25" />
      <div className="relative z-10 flex h-full flex-col items-center justify-center text-center">
        <div className="grid size-14 place-items-center rounded-full bg-[#c8ff45] text-3xl text-[#111]">
          <Icon />
        </div>
        <h3 className="mt-4 text-2xl font-black uppercase leading-none">{title}</h3>
        <p className="mt-2 max-w-md text-sm font-medium text-white/55">{copy}</p>
      </div>
    </motion.div>
  );
}

function PhoneMockup() {
  return (
    <motion.img
      src="/demo-deck/tapp_interface_actual.png"
      className="absolute left-1/2 top-[66%] -translate-x-1/2 -translate-y-1/2 w-56 rounded-2xl shadow-2xl z-10 select-none"
      alt="Tapp interface screenshot"
    />
  );
}

function FloatingCard({ className }: { className?: string }) {
  return (
    <motion.div
      className={`absolute h-20 w-32 rounded-xl border-4 border-[#111] bg-[#b8d6a8] shadow-xl ${className ?? ""}`}
      animate={{ y: [0, -10, 0], rotate: [6, 10, 6] }}
      transition={{ duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
    >
      <div className="m-3 h-4 w-8 rounded bg-[#111]/20" />
      <div className="absolute bottom-3 right-3 text-2xl font-black">$</div>
    </motion.div>
  );
}

function LineStore() {
  return (
    <svg viewBox="0 0 24 24" className="h-28 w-auto" aria-hidden>
      <path
        d="M19.8 5.4c-.2-.2-.5-.4-.8-.4 0-1.7-1.3-3-3-3H8C6.3 2 5 3.3 5 5c-.3 0-.6.2-.8.4L2.9 7.3c-.6.9-.8 2-.5 3 .3 1 .8 1.7 1.6 2.1V17c0 2.2 1.8 4 4 4h8c2.2 0 4-1.8 4-4v-4.6c.8-.5 1.3-1.2 1.6-2.1.3-1 .1-2.2-.5-3l-1.3-1.9zM8 4h8c.6 0 1 .4 1 1H7c0-.6.4-1 1-1zm6 3v2c0 1.1-.9 2-2 2s-2-.9-2-2V7h4zm-8.3 4c-.1 0-.3-.1-.4-.1-.1 0-.2-.1-.2-.1-.4-.2-.6-.5-.7-.9-.1-.5 0-1 .2-1.4l1-1.4H8v1.8c0 .9-.6 1.8-1.4 2h-.8c0 .1 0 .1-.1.1zm7.3 8h-2v-2c0-.6.4-1 1-1s1 .4 1 1v2zm5-2c0 1.1-.9 2-2 2h-1v-2c0-1.7-1.3-3-3-3s-3 1.3-3 3v2H8c-1.1 0-2-.9-2-2v-4h.4c.1 0 .2 0 .3-.1.1 0 .2 0 .3-.1.1 0 .2-.1.4-.1.2-.1.3-.1.4-.2.5-.2.9-.5 1.2-.9l.1.1.3.3c.1.1.2.1.3.2.1.1.3.2.4.3.1.1.2.1.3.2.2.1.3.1.5.2.1 0 .2.1.3.1h.8c.3 0 .6 0 .8-.1.1 0 .2-.1.3-.1.2-.1.4-.1.5-.2.1 0 .2-.1.3-.2.1-.1.3-.2.4-.3.1-.1.2-.1.3-.2l.3-.3s.1 0 .1-.1c.3.4.7.7 1.1.9.1.1.3.1.4.2.1 0 .2.1.4.1.1 0 .2 0 .3.1.1 0 .2 0 .3.1h.4V17zm1.6-7.2c-.1.4-.4.8-.7.9-.1 0-.2.1-.3.1-.1 0-.2.1-.4.1h-.9c-.8-.3-1.4-1.1-1.4-2V7h2.5l1 1.4c.3.4.4 1 .2 1.4z"
        fill="currentColor"
      />
    </svg>
  );
}

function DeckButton({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: IconType;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-11 place-items-center rounded-full border border-white/15 bg-white/10 text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-30"
    >
      <Icon />
    </button>
  );
}
