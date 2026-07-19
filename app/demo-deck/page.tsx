"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState, useRef } from "react";
import dynamic from "next/dynamic";

const QRCode = dynamic(() => import("react-qrcode-logo").then((mod) => mod.QRCode), { ssr: false });
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
import { TappMark } from "@/components/ui/Logo";

const CreditCardIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    xmlSpace="preserve"
    viewBox="0 0 24 24"
    id="credit-card"
    className={className}
    fill="currentColor"
  >
    <g id="Layer_2">
      <path
        d="M8,14H7c-0.55225,0-1,0.44727-1,1s0.44775,1,1,1h1c0.55225,0,1-0.44727,1-1S8.55225,14,8,14z"
        fill="currentColor"
      />
      <path
        d="M17.78467,4.62402c-3.78516-0.83008-7.78564-0.83008-11.56885,0C4.53369,4.99121,3.18506,6.14844,2.69678,7.64453    c-0.93018,2.84961-0.93018,5.86133,0,8.71094c0.48828,1.49609,1.83691,2.65332,3.51855,3.02051    C8.10742,19.79102,10.05371,19.99805,12,19.99805s3.89258-0.20703,5.78467-0.62207    c1.68213-0.36719,3.03027-1.52441,3.51855-3.02051c0.93018-2.84961,0.93018-5.86133,0-8.71094    C20.81494,6.14844,19.46631,4.99121,17.78467,4.62402z M6.64307,6.57715C8.39551,6.19336,10.19727,6.00195,12,6.00195    c1.80225,0,3.60498,0.19238,5.35742,0.5752c0.99219,0.2168,1.77539,0.86426,2.04443,1.68848    C19.48126,8.50885,19.54669,8.75433,19.61029,9H4.38971c0.0636-0.24567,0.12903-0.49115,0.20844-0.73438    C4.86719,7.44141,5.65039,6.79395,6.64307,6.57715z M19.40186,15.73438c-0.26904,0.82422-1.05225,1.47168-2.04443,1.68848    h-0.00049c-3.50439,0.76758-7.20898,0.76562-10.71436,0c-0.99219-0.2168-1.77539-0.86426-2.04443-1.68848    C4.09332,14.18829,3.9101,12.58685,4.04413,11h15.91174C20.0899,12.58685,19.90668,14.18829,19.40186,15.73438z"
        fill="currentColor"
      />
    </g>
  </svg>
);

const BankIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    xmlSpace="preserve"
    viewBox="0 0 24 24"
    id="bank"
    className={className}
    fill="currentColor"
  >
    <path
      id="Layer_2"
      d="M21.940002 7.702393c-.019409-.061218-.042725-.117004-.072998-.172485-.029846-.055298-.063721-.105103-.104126-.154541-.044067-.053833-.091553-.09967-.145752-.14325-.026428-.021362-.042114-.051025-.071228-.070007-.230469-.149902-5.679688-3.692871-8.817383-4.947754-.46875-.1875-.988281-.1875-1.457031 0-3.161133 1.26416-6.145508 2.941406-8.871094 4.98584-.01886.01416-.027588.0354-.045166.050598-.053711.046204-.096069.09906-.138916.155518-.037476.0495-.074341.096252-.101562.150818-.02771.055054-.043152.11322-.060425.173584-.019165.067322-.03595.13208-.04071.201843C2.011963 7.956055 2 7.976074 2 8c0 .039856.018127.073669.022644.112305.007751.068542.01825.133789.040466.200317.022095.066223.052795.124451.087585.183655.019653.033752.025452.071838.0495.103821.014282.019104.035889.028015.05127.045776C2.296936 8.698608 2.34906 8.740173 2.404541 8.782471 2.454468 8.820435 2.50177 8.857727 2.557007 8.885254c.055115.02771.113342.043091.173706.060364C2.797668 8.9646 2.861938 8.981384 2.931335 8.986145 2.955261 8.987854 2.975647 9 3 9h18c.000549 0 .000916-.000305.001465-.000305.119019-.000305.234924-.028503.346191-.069885.02301-.008606.045349-.015564.067505-.025757.101196-.046204.195007-.1073.277283-.186951.014771-.014221.025269-.031006.039124-.046082.036804-.040161.075623-.077942.106323-.125122.016296-.024963.017883-.053833.031677-.079651.03186-.059143.05426-.119873.073792-.185364.019714-.066223.034241-.129944.039856-.197571C21.985718 8.054443 22 8.029541 22 8c0-.034546-.016235-.063782-.019653-.097412C21.97345 7.833435 21.960938 7.768616 21.940002 7.702393zM11.986328 4.071777C13.519287 4.684692 15.722717 5.933594 17.499512 7H6.261597C8.089722 5.862671 10.002808 4.872131 11.986328 4.071777zM6 10c-.552734 0-1 .447754-1 1v6.999512H4c-.552734 0-1 .447754-1 1s.447266 1 1 1h1.997559C5.998413 19.999512 5.999146 20 6 20s.001587-.000488.002441-.000488h5.995117C11.998413 19.999512 11.999146 20 12 20s.001587-.000488.002441-.000488h5.995117C17.998413 19.999512 17.999146 20 18 20s.001587-.000488.002441-.000488H20c.552734 0 1-.447754 1-1s-.447266-1-1-1h-1V11c0-.552246-.447266-1-1-1s-1 .447754-1 1v6.999512h-4V11c0-.552246-.447266-1-1-1s-1 .447754-1 1v6.999512H7V11C7 10.447754 6.552734 10 6 10z"
      fill="currentColor"
    />
  </svg>
);

const slides = [
  {
    kicker: "0:00",
    title: "Major chains in. Local currency out.",
    note: "Open with the uncomfortable truth: crypto moves everywhere except the checkout counter.",
  },
  {
    kicker: "Problem",
    title: "Fragmented twice.",
    note: "Trillions of dollars sit on 50+ blockchains, yet almost none can be spent in the real world. Existing fiat rails are clunky, fragmented, and region-locked. Money remains scattered across chains and cut off from everyday life.",
  },
  {
    kicker: "Solution",
    title: "Rails settles. Tapp spends.",
    note: "We fix both: Rails connects any blockchain directly to local currency, and Tapp lets users tap-to-pay instantly. Merchants are paid in local fiat without touching crypto—abstracting all Web3 complexity down to spending.",
  },
  {
    kicker: "Demo",
    title: "Product Usage.",
    note: "Live product usage demo: user taps, Rails settles, merchant sees paid.",
  },
  {
    kicker: "Why Sui",
    title: "Sui is the payments home base.",
    note: "Live on Sui, major EVMs, and Starknet, but Sui is home. The tech is a step up—fast, cheap, and built for volume—and Overflow is our launchpad to scale.",
  },
  {
    kicker: "Traction",
    title: "Live in production today.",
    note: "Not a prototype. Merchants are onboarded and businesses are integrating Rails.",
  },
  {
    kicker: "Testimonials",
    title: "Real-world feedback.",
    note: "Early merchant offramp speed validation, consumer tap payment clips, and integration proof.",
  },
  {
    kicker: "Team",
    title: "The team built for this.",
    note: "Ex-Coinbase, ex-Base, Zerocard core team, hardware engineers, and Sui devs who built Zoracle ($1.5M+ volume) and dev tools.",
  },
  {
    kicker: "Revenue",
    title: "We earn when real value moves.",
    note: "Close by handing off to the live merchant-phone demo.",
  },
  {
    kicker: "Thank You",
    title: "Tap into the future.",
    note: "Thank you! Scan to test the Tapp PWA, or reach out to labs@zoracle.xyz.",
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
      case 6:
        return <TestimonialSlide />;
      case 7:
        return <TeamSlide />;
      case 8:
        return <CloseSlide />;
      default:
        return <ThankYouMosaic />;
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

function FallingFlags() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return;

    let isCancelled = false;
    let engine: any;
    let runner: any;
    let animationFrameId: number;
    let spawnTimer: NodeJS.Timeout;
    let MatterInstance: any = null;

    import("matter-js").then((Matter) => {
      if (isCancelled || !containerRef.current) return;
      MatterInstance = Matter;

      const { Engine, Runner, Bodies, Composite, Body } = Matter;

      // Adjust dimensions based on the card bounding rect
      const width = containerRef.current.clientWidth || 180;
      const height = containerRef.current.clientHeight || 150;

      // Create engine with low gravity for a nice floating fall feel
      engine = Engine.create({
        gravity: { y: 0.2 }
      });

      runner = Runner.create();
      Runner.run(runner, engine);

      // Boundaries (floor and side walls)
      const wallThickness = 100;
      const floor = Bodies.rectangle(
        width / 2, 
        height + wallThickness / 2, 
        width + 200, 
        wallThickness, 
        { isStatic: true }
      );
      const leftWall = Bodies.rectangle(
        -wallThickness / 2, 
        height / 2, 
        wallThickness, 
        height + 200, 
        { isStatic: true }
      );
      const rightWall = Bodies.rectangle(
        width + wallThickness / 2, 
        height / 2, 
        wallThickness, 
        height + 200, 
        { isStatic: true }
      );

      Composite.add(engine.world, [floor, leftWall, rightWall]);

      const flagList = ["ng", "us", "eu", "gb", "ke", "ae", "ca", "jp"];
      const spawnedElements: { body: any; element: HTMLDivElement }[] = [];
      let flagIndex = 0;

      const spawnFlag = () => {
        if (isCancelled || !containerRef.current || spawnedElements.length >= 10) return;

        const el = document.createElement("div");
        el.className = "absolute rounded-full overflow-hidden border border-black/15 bg-white shadow-md pointer-events-none";
        
        // Large circles as requested (48px diameter)
        const diameter = 48;
        el.style.width = `${diameter}px`;
        el.style.height = `${diameter}px`;
        el.style.left = "0px";
        el.style.top = "0px";
        el.style.transformOrigin = "center";

        const img = document.createElement("img");
        const code = flagList[flagIndex % flagList.length];
        flagIndex++;
        img.src = `https://flagcdn.com/w80/${code}.png`;
        img.className = "w-full h-full object-cover scale-110";
        el.appendChild(img);

        containerRef.current.appendChild(el);

        const radius = diameter / 2;
        const startX = Math.random() * (width - diameter) + radius;
        const body = Bodies.circle(startX, -radius - 10, radius, {
          restitution: 0.65, // high bounce
          friction: 0.05,
          density: 0.01,
        });

        // Push slight initial forces
        Body.setVelocity(body, { x: (Math.random() - 0.5) * 1.5, y: 0.8 });
        Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.08);

        Composite.add(engine.world, body);
        spawnedElements.push({ body, element: el });
      };

      // Spawn initial flags
      for (let i = 0; i < 3; i++) {
        setTimeout(spawnFlag, i * 400);
      }

      spawnTimer = setInterval(spawnFlag, 1400);

      // Animation synchronization loop
      const updateSync = () => {
        if (isCancelled) return;

        spawnedElements.forEach(({ body, element }) => {
          const { x, y } = body.position;
          const angle = body.angle;
          const diameter = 48;
          const radius = diameter / 2;
          const tx = x - radius;
          const ty = y - radius;

          element.style.transform = `translate3d(${tx}px, ${ty}px, 0) rotate(${angle}rad)`;
        });

        animationFrameId = requestAnimationFrame(updateSync);
      };

      updateSync();
    });

    return () => {
      isCancelled = true;
      clearInterval(spawnTimer);
      cancelAnimationFrame(animationFrameId);
      if (engine && MatterInstance) {
        MatterInstance.Composite.clear(engine.world, false);
        MatterInstance.Engine.clear(engine);
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
    };
  }, []);

  return (
    <div 
      ref={containerRef} 
      className="absolute right-0 top-0 bottom-0 w-[45%] overflow-hidden pointer-events-none"
    />
  );
}

function OpeningMosaic() {
  return (
    <div className="deck-mosaic grid w-full max-w-7xl grid-cols-6 grid-rows-4 gap-2 md:h-[63vh]">
      <Tile className="col-span-3 row-span-1 bg-[#c6c05b] p-0 text-[#16130f]">
        <ChainRoll />
      </Tile>
      <Tile className="col-span-3 row-span-2 bg-[#f0ede5] text-[#111]">
        <div className="max-w-xl text-[clamp(2.4rem,4.8vw,4.8rem)] font-black uppercase leading-[0.88]">
          Sui settles every chain <span className="bg-[#c8ff45] px-2">to local currency</span>
        </div>
        <FloatingCard className="right-8 top-8 rotate-6" />
      </Tile>
      <Tile className="col-span-2 row-span-2 bg-[#84a17d] text-[#10140f] relative">
        <PhoneMockup />
      </Tile>
      {/* Tapp Logo Tile to fill the 1x1 gap in Row 1, Column 2 */}
      <Tile className="col-span-1 row-span-1 bg-black flex items-center justify-center p-0">
        <TappMark className="text-[90px]" />
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
        <FallingFlags />
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
  { name: "Base", logo: "/demo-deck/logos/base.svg" },
  { name: "Ethereum", logo: "/demo-deck/logos/ethereum.svg" },
  { name: "Polygon", logo: "/demo-deck/logos/polygon.svg" },
  { name: "Starknet", logo: "/demo-deck/logos/starknet.svg" },
  { name: "Arbitrum", logo: "/demo-deck/logos/arbitrum.svg" },
  { name: "Optimism", logo: "/demo-deck/logos/optimism.svg" },
  { name: "Avalanche", logo: "/demo-deck/logos/avalanche.svg" },
];

const problemCol2 = [
  { name: "USD", logo: "https://flagcdn.com/80x60/us.png" },
  { name: "NGN", logo: "https://flagcdn.com/80x60/ng.png" },
  { name: "EUR", logo: "https://flagcdn.com/80x60/eu.png" },
  { name: "GBP", logo: "https://flagcdn.com/80x60/gb.png" },
  { name: "KES", logo: "https://flagcdn.com/80x60/ke.png" },
  { name: "JPY", logo: "https://flagcdn.com/80x60/jp.png" },
  { name: "CAD", logo: "https://flagcdn.com/80x60/ca.png" },
  { name: "AED", logo: "https://flagcdn.com/80x60/ae.png" },
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
            <div className="grid size-14 place-items-center rounded-2xl bg-black text-white">
              <BankIcon className="size-7" />
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
            <div className="grid size-14 place-items-center rounded-2xl bg-[#c8ff45] text-[#111]">
              <CreditCardIcon className="size-7" />
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
    <div className="w-full max-w-7xl h-[63vh] relative rounded-[2rem] overflow-hidden border border-white/10 bg-black flex items-center justify-center">
      <video
        src="/demo video.mp4"
        className="w-full h-full object-contain scale-[1.46] bg-black"
        controls
        playsInline
        preload="auto"
      />
    </div>
  );
}

function SuiSlide() {
  return (
    <TwoColumn title="Sui is the settlement layer for every chain we support.">
      <div className="grid grid-cols-2 gap-3">
        <StatCard value="Instant" label="Sub-second tap-to-pay" tone="blue" />
        <StatCard value="< $0.01" label="Everyday spend fees" tone="lime" />
        <StatCard value="Scalable" label="Built for transaction volume" tone="violet" />
        <StatCard value="Overflow" label="Launchpad to real scale" tone="rose" />
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
      <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#121212] h-full flex items-center justify-center">
        <div className="absolute inset-0 deck-grid opacity-25" />
        <PhoneMockup className="w-80 top-[50%]" />
      </div>
    </TwoColumn>
  );
}

function TestimonialSlide() {
  return (
    <div className="relative flex flex-col justify-between h-[63vh] w-full max-w-7xl rounded-[2rem] bg-[#f0ede5] p-6 text-[#111] md:p-8 overflow-hidden select-none">
      <div>
        <h1 className="text-[clamp(2.5rem,5vw,5rem)] font-black uppercase tracking-tight leading-[0.9]">
          Real-world feedback<span className="text-[#c8ff45]">.</span>
        </h1>
        <p className="mt-1.5 text-xs md:text-sm font-bold text-[#111]/60">
          What merchants and early adopters say about Tapp.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6 flex-1 min-h-0 items-stretch">
        {/* Video 1: 1.MOV */}
        <div className="relative overflow-hidden rounded-[2rem] border border-black/10 bg-[#121212] flex flex-col justify-between p-3 h-full min-h-0">
          <div className="absolute inset-0 deck-grid opacity-10" />
          <div className="relative flex-1 min-h-0 w-full rounded-2xl overflow-hidden bg-black/60 flex items-center justify-center">
            <video
              src="/1.MOV"
              className="w-full h-full object-cover"
              controls
              playsInline
              preload="metadata"
            />
          </div>
          <div className="mt-2 text-center shrink-0">
            <h3 className="text-xs font-black uppercase text-[#f8f3e8]">Video 1</h3>
            <p className="text-[10px] text-white/50 font-medium">Merchant Settlement</p>
          </div>
        </div>

        {/* Video 2: 2.mp4 */}
        <div className="relative overflow-hidden rounded-[2rem] border border-black/10 bg-[#121212] flex flex-col justify-between p-3 h-full min-h-0">
          <div className="absolute inset-0 deck-grid opacity-10" />
          <div className="relative flex-1 min-h-0 w-full rounded-2xl overflow-hidden bg-black/60 flex items-center justify-center">
            <video
              src="/2.mp4"
              className="w-full h-full object-cover"
              controls
              playsInline
              preload="metadata"
            />
          </div>
          <div className="mt-2 text-center shrink-0">
            <h3 className="text-xs font-black uppercase text-[#f8f3e8]">Video 2</h3>
            <p className="text-[10px] text-white/50 font-medium">Everyday Tap Pay</p>
          </div>
        </div>

        {/* Video 3: 3.mp4 */}
        <div className="relative overflow-hidden rounded-[2rem] border border-black/10 bg-[#121212] flex flex-col justify-between p-3 h-full min-h-0">
          <div className="absolute inset-0 deck-grid opacity-10" />
          <div className="relative flex-1 min-h-0 w-full rounded-2xl overflow-hidden bg-black/60 flex items-center justify-center">
            <video
              src="/3.mp4"
              className="w-full h-full object-cover"
              controls
              playsInline
              preload="metadata"
            />
          </div>
          <div className="mt-2 text-center shrink-0">
            <h3 className="text-xs font-black uppercase text-[#f8f3e8]">Video 3</h3>
            <p className="text-[10px] text-white/50 font-medium">Integration Flow</p>
          </div>
        </div>
        
        {/* Telegram Chat Screenshot Slot */}
        <div className="relative overflow-hidden rounded-[2rem] border border-black/10 bg-[#0e1621] flex flex-col justify-start items-center h-full min-h-0">
          <img
            src="/demo-deck/feedback.png"
            className="w-full h-auto object-top select-none"
            alt="Telegram Feedback screenshot"
          />
        </div>
      </div>
    </div>
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
      <div className="relative overflow-hidden rounded-[2rem] border border-white/10 bg-[#121212] h-full flex items-center justify-center">
        <div className="absolute inset-0 deck-grid opacity-25" />
        <PhoneMockup className="w-80 top-[50%]" />
      </div>
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
        <div className="mt-4 flex-1 flex flex-col justify-end">{children[0]}</div>
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

function PhoneMockup({ className }: { className?: string }) {
  return (
    <motion.img
      src="/demo-deck/tapp_interface_actual.png"
      className={`absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl shadow-2xl z-10 select-none ${className ?? "w-56 top-[66%]"}`}
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

function TeamSlide() {
  return (
    <div className="relative flex flex-col justify-between h-[63vh] w-full max-w-7xl rounded-[2rem] bg-[#f0ede5] p-6 text-[#111] md:p-8 overflow-hidden select-none">
      <div>
        <h1 className="text-[clamp(2.5rem,5vw,5rem)] font-black uppercase tracking-tight leading-[0.9]">
          We've done this before<span className="text-[#c8ff45]">.</span>
        </h1>
        <p className="mt-1.5 text-xs md:text-sm font-bold text-[#111]/60">
          Veterans bridging blockchains and real-world local commerce.
        </p>
      </div>

      <div className="grid lg:grid-cols-[1.25fr_0.75fr] gap-6 mt-4 flex-1 min-h-0 items-center">
        {/* Left side: clean, well-spaced 2x2 grid of credentials */}
        <div className="grid grid-cols-2 gap-3 h-full max-h-[36vh]">
          <StatCard value="ex-Coinbase" label="& ex-Base builders" tone="lime" />
          <StatCard value="Zerocard" label="active core team" tone="violet" />
          <StatCard value="$1.5M+" label="volume via Zoracle" tone="blue" />
          <StatCard value="Hardware" label="NFC & Sui Dev tools" tone="rose" />
        </div>

        {/* Right side: dark verification card */}
        <div className="flex flex-col justify-center items-center rounded-3xl bg-black border border-white/10 p-2 overflow-hidden h-full max-h-[36vh]">
          <img 
            src="/demo-deck/based-africa.png" 
            className="w-full h-full object-contain rounded-2xl" 
            alt="Base Africa Zoracle $1.5M+ Volume Milestone Post"
          />
        </div>
      </div>
    </div>
  );
}

function ThankYouMosaic() {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  return (
    <div className="relative flex flex-col items-center justify-between h-[63vh] w-full max-w-7xl rounded-[2rem] bg-[#f0ede5] p-6 text-[#111] md:p-8">
      <div className="mt-2 text-center">
        <h1 className="text-[clamp(2.5rem,5vw,5rem)] font-black uppercase tracking-tight leading-none">
          Thank You<span className="text-[#c8ff45]">.</span>
        </h1>
        <p className="mt-2 text-sm md:text-base font-bold text-[#111]/60">
          Tap into the future of payments. Scan to test the Tapp PWA.
        </p>
      </div>

      {/* QR Code Container */}
      <div className="relative my-4">
        <div className="flex items-center justify-center rounded-3xl border border-black/10 bg-white p-5">
          {isMounted ? (
            <QRCode
              value="https://usetapp.xyz"
              size={180}
              bgColor="#ffffff"
              fgColor="#111111"
              qrStyle="dots"
              logoImage="/tapp-logo.svg"
              logoWidth={35}
              logoHeight={35}
              logoPadding={3}
            />
          ) : (
            <div className="size-[180px] bg-gray-100 rounded-xl animate-pulse" />
          )}
        </div>
      </div>

      {/* Footer Info Columns */}
      <div className="w-full grid grid-cols-3 gap-4 border-t border-black/10 pt-6">
        <div className="flex flex-col items-center">
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#111]/50">Website</span>
          <a
            href="https://usetapp.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 text-xs md:text-sm font-black text-[#111] hover:underline"
          >
            usetapp.xyz
          </a>
        </div>
        <div className="flex flex-col items-center border-x border-black/10">
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#111]/50">Integrate</span>
          <a
            href="https://docs.usetapp.xyz"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 text-xs md:text-sm font-black text-[#111] hover:underline"
          >
            docs.usetapp.xyz
          </a>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#111]/50">Contact</span>
          <a
            href="mailto:labs@zoracle.xyz"
            className="mt-1 text-xs md:text-sm font-black text-[#111] hover:underline"
          >
            labs@zoracle.xyz
          </a>
        </div>
      </div>
    </div>
  );
}
