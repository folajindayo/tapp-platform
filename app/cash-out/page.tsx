"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PiArrowLeftBold,
  PiBankBold,
  PiCheckCircleFill,
} from "react-icons/pi";
import { useQuery } from "@tanstack/react-query";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InputError } from "@/components/ui/InputError";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import { useHaptic } from "@/lib/motion";
import {
  formatUsdc,
  SUI_COIN_TYPE,
  USDC_COIN_TYPE,
  useWallet,
  WALLET_MOCK,
} from "@/lib/wallet";
import {
  offrampApi,
  primaryReceiveAddress,
  type OfframpInstitution,
  type OfframpOrder,
  type OfframpQuote,
  type OfframpToken,
} from "@/lib/offramp/client";

const inputClass =
  "w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-neutral-900 transition-all placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-50 dark:border-white/20 dark:bg-neutral-900 dark:text-white dark:placeholder:text-white/30";

type Phase = "form" | "creating" | "funding" | "funded" | "error";

export default function CashOutPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const wallet = useWallet();
  const haptic = useHaptic();

  const token: OfframpToken = "USDC";
  const [currency, setCurrency] = useState("NGN");
  const [amount, setAmount] = useState("");
  const [institution, setInstitution] = useState("");
  const [accountIdentifier, setAccountIdentifier] = useState("");
  const [accountName, setAccountName] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<OfframpOrder | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);
  const celebratedDigestRef = useRef<string | null>(null);
  const debouncedAmount = useDebouncedValue(amount, 450);
  const debouncedAccountIdentifier = useDebouncedValue(accountIdentifier, 650);

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/cash-out");
  }, [hydrated, session, router]);

  const currencies = useQuery({
    queryKey: ["offramp", "currencies"],
    queryFn: offrampApi.currencies,
    staleTime: 10 * 60_000,
  });

  const institutions = useQuery({
    queryKey: ["offramp", "institutions", currency],
    queryFn: () => offrampApi.institutions(currency),
    enabled: !!currency,
    staleTime: 10 * 60_000,
  });

  useEffect(() => {
    const first = institutions.data?.[0]?.code;
    if (first && !institutions.data?.some((item) => item.code === institution)) {
      setInstitution(first);
    }
  }, [institution, institutions.data]);

  useEffect(() => {
    if (!order || phase !== "funded") return;
    const timer = window.setInterval(async () => {
      try {
        const next = await offrampApi.order(order.order_id);
        setOrder((current) => ({ ...current, ...next }));
        if (["settled", "failed", "refunded", "expired"].includes(next.status)) {
          window.clearInterval(timer);
        }
      } catch {
        // Polling is a convenience. The order card still shows the last known state.
      }
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [order, phase]);

  useEffect(() => {
    if (phase !== "funded" || !digest || celebratedDigestRef.current === digest) {
      return;
    }
    celebratedDigestRef.current = digest;
    setShowConfetti(true);
    playSuccessPop();
    const timer = window.setTimeout(() => setShowConfetti(false), 1800);
    return () => window.clearTimeout(timer);
  }, [digest, phase]);

  const amountNumber = useMemo(() => Number(amount), [amount]);
  const debouncedAmountNumber = useMemo(
    () => Number(debouncedAmount),
    [debouncedAmount],
  );
  const selectedInstitution = useMemo<OfframpInstitution | undefined>(
    () => institutions.data?.find((item) => item.code === institution),
    [institution, institutions.data],
  );
  const quote = useQuery({
    queryKey: [
      "offramp",
      "quote",
      token,
      currency,
      normalizeAmount(debouncedAmount),
    ],
    queryFn: () => offrampApi.quote(token, normalizeAmount(debouncedAmount), currency),
    enabled:
      Number.isFinite(debouncedAmountNumber) &&
      debouncedAmountNumber > 0 &&
      phase !== "creating",
    staleTime: 60_000,
    retry: false,
  });
  const verifiedAccount = useQuery({
    queryKey: [
      "offramp",
      "verify-account",
      institution,
      debouncedAccountIdentifier.trim(),
    ],
    queryFn: () =>
      offrampApi.verifyAccount({
        institution,
        accountIdentifier: debouncedAccountIdentifier.trim(),
      }),
    enabled:
      !!institution &&
      debouncedAccountIdentifier.trim().length >= 6 &&
      phase !== "creating",
    staleTime: 10 * 60_000,
    retry: false,
  });
  const resolvedAccountName = verifiedAccount.data?.accountName?.trim();
  const accountVerified =
    !!resolvedAccountName &&
    !verifiedAccount.isError &&
    debouncedAccountIdentifier.trim() === accountIdentifier.trim();
  const effectiveAccountName =
    resolvedAccountName && resolvedAccountName !== "OK"
      ? resolvedAccountName
      : accountName.trim();
  const isBusy = phase === "creating" || phase === "funding";
  const amountAtomic = useMemo(() => {
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) return BigInt(0);
    return decimalToAtomic(normalizeAmount(amount), 6);
  }, [amount, amountNumber]);
  const availableUsdcSubunit = wallet.data?.usdc_subunit ?? 0;
  const hasEnoughUsdc =
    !!wallet.data &&
    amountAtomic > BigInt(0) &&
    BigInt(availableUsdcSubunit) >= amountAtomic;
  const canSubmit =
    !!session &&
    Number.isFinite(amountNumber) &&
    amountNumber > 0 &&
    !!institution &&
    !!accountIdentifier.trim() &&
    !!effectiveAccountName &&
    !!quote.data &&
    accountVerified &&
    hasEnoughUsdc &&
    !isBusy;
  const sellButtonLabel = getSellButtonLabel(phase, amount);

  useEffect(() => {
    if (resolvedAccountName && resolvedAccountName !== "OK") {
      setAccountName(resolvedAccountName);
    }
  }, [resolvedAccountName]);

  async function sellAmount() {
    const activeQuote = quote.data;
    if (!canSubmit) {
      setError("Enter an amount and verify the recipient account first.");
      return;
    }
    if (!activeQuote) {
      setError("Wait for the rate quote to load.");
      return;
    }

    setError(null);
    setPhase("creating");
    haptic.medium();
    try {
      const amountText = normalizeAmount(amount);
      const nextOrder = await offrampApi.createOrder({
        amount: amountText,
        token,
        rate: activeQuote.rate,
        rateId: activeQuote.rateId,
        recipient: {
          institution,
          currency,
          accountIdentifier: accountIdentifier.trim(),
          accountName: effectiveAccountName,
        },
      });
      setOrder(nextOrder);
      setPhase("funding");
      const nextDigest = await fundOrder(nextOrder, amountText);
      setDigest(nextDigest);
      setPhase("funded");
      haptic.success();
      setTimeout(() => wallet.refetch(), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sell USDC.");
      setPhase("error");
      haptic.error();
    }
  }

  async function fundOrder(
    orderToFund: OfframpOrder,
    tokenAmount: string,
  ): Promise<string> {
    const depositOption = primaryReceiveAddress(orderToFund);
    if (!session || !orderToFund.pay_to || !depositOption?.address) {
      throw new Error("Rails did not return a receive address for this order.");
    }
    const amountAtomic = decimalToAtomic(tokenAmount, token === "SUI" ? 9 : 6);
    if (amountAtomic <= BigInt(0)) {
      throw new Error("Rails returned an invalid deposit amount.");
    }

    if (WALLET_MOCK) {
      await new Promise((resolve) => setTimeout(resolve, 900));
      return "0xtx_mock_" + Date.now().toString(36);
    }
    if (!session.zkLoginReady) {
      throw new Error(
        "Sign in again through Google to enable on-chain cash-out funding.",
      );
    }

    const { executeZkLoginTx } = await import("@/lib/zklogin");
    const { Transaction } = await import("@mysten/sui/transactions");
    const coinType = orderToFund.pay_to?.coin_type || USDC_COIN_TYPE;
    if (coinType !== USDC_COIN_TYPE) {
      throw new Error("This cash-out route returned a different USDC coin type. Try again in a moment.");
    }

    const result = await executeZkLoginTx(
      async (tx: InstanceType<typeof Transaction>) => {
        if (token === "SUI" || orderToFund.pay_to?.coin_type === SUI_COIN_TYPE) {
          const [out] = tx.splitCoins(tx.gas, [tx.pure.u64(amountAtomic)]);
          tx.transferObjects([out], tx.pure.address(depositOption.address!));
          return;
        }

        const nonZeroCoins = await getSpendableCoinsWithRetry(
          session.suiAddress,
          coinType,
          amountAtomic,
        );
        if (nonZeroCoins.length === 0) {
          throw new Error(
            "Your USDC is still being processed by the network. Please wait a moment and try again.",
          );
        }
        const totalAtomic = nonZeroCoins.reduce(
          (sum, coin) => sum + BigInt(coin.balance),
          BigInt(0),
        );
        if (totalAtomic < amountAtomic) {
          throw new Error(
            `Available USDC is ${formatUsdc(Number(totalAtomic))}. Lower the amount or add more USDC.`,
          );
        }
        const inputs = nonZeroCoins.map((coin) => tx.object(coin.coinObjectId));
        const primary = inputs[0];
        if (inputs.length > 1) tx.mergeCoins(primary, inputs.slice(1));
        const [out] = tx.splitCoins(primary, [tx.pure.u64(amountAtomic)]);
        tx.transferObjects([out], tx.pure.address(depositOption.address!));
      },
      { selfSponsor: token === "SUI" },
    );
    return result.digest;
  }

  if (!hydrated || !session) return <Screen />;

  return (
    <Screen>
      {showConfetti && <CashOutConfetti />}
      <AnimatedComponent
        variant={slideInOut}
        className="grid gap-6 py-10 text-sm text-neutral-900 dark:text-white"
      >
        <header className="flex items-center justify-between gap-3">
          <Link href="/wallet" className="grid size-10 place-items-center rounded-full border border-gray-200 dark:border-white/10">
            <PiArrowLeftBold />
          </Link>
          <div className="text-right">
            <p className="text-xs text-gray-500 dark:text-white/50">Tapp Rails</p>
            <h1 className="text-xl font-semibold tracking-tight">Cash out</h1>
          </div>
        </header>

        <section className="grid gap-4 rounded-3xl border border-gray-200 p-5 dark:border-white/10">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs text-gray-500 dark:text-white/50">Available</p>
              <p className="text-2xl font-semibold">
                {wallet.data ? formatUsdc(availableUsdcSubunit) : "--"} USDC
              </p>
            </div>
            <div className="grid size-12 place-items-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-400">
              <PiBankBold className="text-2xl" />
            </div>
          </div>
          <RateRow
            quote={quote.data ?? null}
            loading={quote.isFetching}
            error={quote.error instanceof Error ? quote.error.message : null}
            hasAmount={Number.isFinite(amountNumber) && amountNumber > 0}
          />
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <span className="text-xs font-medium text-gray-500 dark:text-white/50">Asset</span>
              <div className="rounded-xl border border-gray-300 bg-gray-50 px-4 py-3 text-sm font-medium text-neutral-900 dark:border-white/20 dark:bg-white/5 dark:text-white">
                USDC
              </div>
            </div>
            <label className="grid gap-1">
              <span className="text-xs font-medium text-gray-500 dark:text-white/50">Currency</span>
              <select className={inputClass} value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {(currencies.data ?? fallbackCurrencies).map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.code}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-gray-500 dark:text-white/50">Amount</span>
            <input
              className={inputClass}
              inputMode="decimal"
              placeholder="25.00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </label>
        </section>

        <section className="grid gap-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-medium uppercase tracking-wider text-gray-400 dark:text-white/30">
              Recipient
            </h2>
            {institutions.isLoading && (
              <span className="text-xs text-gray-400 dark:text-white/40">Loading banks...</span>
            )}
          </div>
          <label className="grid gap-1">
            <span className="text-xs font-medium text-gray-500 dark:text-white/50">Bank</span>
            <select className={inputClass} value={institution} onChange={(e) => setInstitution(e.target.value)}>
              {(institutions.data ?? []).map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name} ({item.type})
                </option>
              ))}
            </select>
          </label>
          <input
            className={inputClass}
            inputMode="numeric"
            placeholder={selectedInstitution?.type === "mobile_money" ? "Wallet number" : "Account number"}
            value={accountIdentifier}
            onChange={(e) => setAccountIdentifier(e.target.value)}
          />
          <div className="grid gap-1">
            <input
              className={inputClass}
              placeholder="Account name"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              readOnly={!!resolvedAccountName && resolvedAccountName !== "OK"}
            />
            <AccountVerificationState
              isLoading={verifiedAccount.isFetching}
              error={verifiedAccount.error instanceof Error ? verifiedAccount.error.message : null}
              hasAccountIdentifier={accountIdentifier.trim().length >= 6}
            />
          </div>
        </section>

        {phase === "funded" && (
          <SellResultCard digest={digest} />
        )}

        {error && <InputError message={error} />}

        {wallet.data &&
          amountAtomic > BigInt(0) &&
          !hasEnoughUsdc && (
            <InputError
              message={`Available USDC is ${formatUsdc(availableUsdcSubunit)}. Lower the amount or add more USDC.`}
            />
          )}

        <Button
          onClick={sellAmount}
          loading={isBusy}
          disabled={!canSubmit || phase === "funded"}
          leadingIcon={phase === "funded" ? <PiCheckCircleFill /> : undefined}
        >
          {sellButtonLabel}
        </Button>

      </AnimatedComponent>
    </Screen>
  );
}

function RateRow({
  quote,
  loading,
  error,
  hasAmount,
}: {
  quote: OfframpQuote | null;
  loading: boolean;
  error: string | null;
  hasAmount: boolean;
}) {
  const value = quote
    ? `1 ${quote.token} = ${quote.rate} ${quote.currency}`
    : error
      ? "Unavailable"
      : "--";
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-gray-500 dark:text-white/50">Rate</span>
      <span className="flex min-h-5 items-center gap-2 text-right font-medium">
        {loading && hasAmount ? <span className="loader scale-50" /> : null}
        <span className={error && !quote ? "text-amber-600 dark:text-amber-400" : ""}>
          {value}
        </span>
      </span>
    </div>
  );
}

function AccountVerificationState({
  isLoading,
  error,
  hasAccountIdentifier,
}: {
  isLoading: boolean;
  error: string | null;
  hasAccountIdentifier: boolean;
}) {
  if (!hasAccountIdentifier) {
    return (
      <p className="text-xs text-gray-400 dark:text-white/40">
        Enter the account number to verify the recipient name.
      </p>
    );
  }
  if (isLoading) {
    return (
      <p className="text-xs text-gray-400 dark:text-white/40">
        Verifying account...
      </p>
    );
  }
  if (error) {
    return <InputError message={error} />;
  }
  return null;
}

function SellResultCard({
  digest,
}: {
  digest: string | null;
}) {
  return (
    <div className="grid gap-4 rounded-3xl border border-gray-200 p-5 dark:border-white/10">
      <div className="flex items-center gap-3">
        <span className="grid size-9 place-items-center rounded-full bg-green-50 text-green-600 dark:bg-green-500/15 dark:text-green-400">
          <PiCheckCircleFill />
        </span>
        <div>
          <p className="font-medium text-neutral-900 dark:text-white">USDC sent</p>
          <p className="text-xs text-gray-400 dark:text-white/40">
            Rails will complete the bank payout as the order settles.
          </p>
        </div>
      </div>
      {digest && (
        <Link href={`/tx/${encodeURIComponent(digest)}`} className="text-xs font-medium text-blue-600 dark:text-blue-400">
          View funding transaction
        </Link>
      )}
    </div>
  );
}

const confettiPieces = Array.from({ length: 44 }, (_, index) => ({
  left: `${(index * 19) % 100}%`,
  delay: `${(index % 9) * 0.045}s`,
  duration: `${1 + (index % 5) * 0.14}s`,
  drift: `${((index % 11) - 5) * 12}px`,
  rotate: `${180 + (index % 7) * 45}deg`,
  color: ["#2563eb", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#ffffff"][
    index % 6
  ],
  width: index % 3 === 0 ? 6 : 8,
  height: index % 3 === 0 ? 14 : 8,
}));

function CashOutConfetti() {
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-72 overflow-hidden">
      {confettiPieces.map((piece, index) => (
        <span
          key={index}
          className="cashout-confetti-piece"
          style={{
            left: piece.left,
            animationDelay: piece.delay,
            animationDuration: piece.duration,
            backgroundColor: piece.color,
            width: piece.width,
            height: piece.height,
            ["--cashout-confetti-drift" as string]: piece.drift,
            ["--cashout-confetti-rotate" as string]: piece.rotate,
          }}
        />
      ))}
    </div>
  );
}

function playSuccessPop() {
  try {
    const AudioContextCtor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = "triangle";
    osc.frequency.setValueAtTime(360, now);
    osc.frequency.exponentialRampToValueAtTime(720, now + 0.045);
    osc.frequency.exponentialRampToValueAtTime(520, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.17);
    window.setTimeout(() => void ctx.close(), 260);
  } catch {
    // Browser audio may be disabled. Confetti still provides the success cue.
  }
}

function normalizeAmount(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toFixed(2);
}

function decimalToAtomic(value: string, decimals: number): bigint {
  const [wholeRaw, fractionRaw = ""] = value.split(".");
  const whole = wholeRaw.replace(/\D/g, "") || "0";
  const fraction = fractionRaw.replace(/\D/g, "").slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole) * BigInt(10 ** decimals) + BigInt(fraction || "0");
}

function getSellButtonLabel(phase: Phase, amount: string): string {
  if (phase === "funded") return "Sold";
  if (phase === "creating") return "Creating order";
  if (phase === "funding") return "Sending USDC";
  return `Sell ${normalizeAmount(amount || "0")} USDC`;
}

async function getSpendableCoinsWithRetry(
  owner: string,
  coinType: string,
  requiredAtomic: bigint,
) {
  const maxAttempts = 3;
  const delayMs = 2000;
  let lastTotal = BigInt(0);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const coins = await fetchSpendableCoins(owner, coinType);
    const nonZero = coins.filter((coin) => BigInt(coin.balance) > BigInt(0));
    lastTotal = nonZero.reduce(
      (sum, coin) => sum + BigInt(coin.balance),
      BigInt(0),
    );
    if (lastTotal >= requiredAtomic) return nonZero;
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(
    `Available USDC is ${formatUsdc(Number(lastTotal))}. Lower the amount or add more USDC.`,
  );
}

async function fetchSpendableCoins(
  owner: string,
  coinType: string,
): Promise<
  {
    coinObjectId: string;
    version: string;
    digest: string;
    balance: string;
    coinType: string;
  }[]
> {
  const apiCoins = await fetchPublicCoinsViaApi(owner, coinType).catch(() => null);
  if (apiCoins) return apiCoins;

  const { fetchAllCoins } = await import("@/lib/sui-client");
  return fetchAllCoins(owner, coinType);
}

async function fetchPublicCoinsViaApi(
  owner: string,
  coinType: string,
): Promise<
  {
    coinObjectId: string;
    version: string;
    digest: string;
    balance: string;
    coinType: string;
  }[]
> {
  const res = await fetch(
    `/api/sui/coins?owner=${encodeURIComponent(owner)}&coinType=${encodeURIComponent(coinType)}&t=${Date.now()}`,
    {
      cache: "no-store",
      headers: { Accept: "application/json" },
    },
  );
  const json = (await res.json()) as {
    data?: {
      coins: {
        coinObjectId: string;
        version: string;
        digest: string;
        balance: string;
        coinType: string;
      }[];
    };
    error?: string;
  };
  if (!res.ok || !json.data) {
    throw new Error(json.error ?? "Could not fetch spendable USDC coins.");
  }
  return json.data.coins;
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const fallbackCurrencies = [
  { code: "NGN", name: "Nigerian Naira", supported_routes: ["route_a"], ceiling_rate: "" },
  { code: "KES", name: "Kenyan Shilling", supported_routes: ["route_a"], ceiling_rate: "" },
  { code: "UGX", name: "Ugandan Shilling", supported_routes: ["route_a"], ceiling_rate: "" },
  { code: "TZS", name: "Tanzanian Shilling", supported_routes: ["route_a"], ceiling_rate: "" },
  { code: "MWK", name: "Malawian Kwacha", supported_routes: ["route_a"], ceiling_rate: "" },
  { code: "BRL", name: "Brazilian Real", supported_routes: ["route_a"], ceiling_rate: "" },
];
