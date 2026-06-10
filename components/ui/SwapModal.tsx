"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import { PiArrowsDownUpBold, PiXBold, PiCheckCircleFill, PiSpinnerBold } from "react-icons/pi";
import { Button } from "@/components/ui/Button";
import { InputError } from "@/components/ui/InputError";
import {
  type SwapDirection,
  quoteSwap,
  getCachedQuote,
  executeSwap,
  coinBalanceBase,
  inCoinType,
  inDecimals,
  outDecimals,
  toBaseUnits,
  fromBaseUnits,
} from "@/lib/swap";

const SLIPPAGE_PCT = 1;
// Keep a little SUI aside for gas when the holder taps "Max" on a SUI swap.
const SUI_GAS_BUFFER = BigInt(50_000_000); // 0.05 SUI

function symbolFor(direction: SwapDirection, side: "in" | "out"): "SUI" | "USDC" {
  const isSui =
    (side === "in" && direction === "SUI_TO_USDC") ||
    (side === "out" && direction === "USDC_TO_SUI");
  return isSui ? "SUI" : "USDC";
}

export function SwapModal({
  open,
  onClose,
  onSwapped,
  initialDirection = "SUI_TO_USDC",
}: {
  open: boolean;
  onClose: () => void;
  onSwapped?: () => void;
  initialDirection?: SwapDirection;
}) {
  const [direction, setDirection] = useState<SwapDirection>(initialDirection);
  const [amount, setAmount] = useState("");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [outBase, setOutBase] = useState<bigint | null>(null);
  const [quoting, setQuoting] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneDigest, setDoneDigest] = useState<string | null>(null);

  const inDec = inDecimals(direction);
  const outDec = outDecimals(direction);
  const amountBase = toBaseUnits(amount, inDec);
  const insufficient = balance !== null && amountBase > balance;

  // Load the "from" balance whenever the modal opens or direction flips.
  const loadBalance = useCallback(() => {
    setBalance(null);
    coinBalanceBase(inCoinType(direction))
      .then(setBalance)
      .catch(() => setBalance(BigInt(0)));
  }, [direction]);

  useEffect(() => {
    if (open) {
      loadBalance();
      setError(null);
      setDoneDigest(null);
    }
  }, [open, loadBalance]);

  // Debounced live quote.
  useEffect(() => {
    if (!open || amountBase <= BigInt(0)) {
      setOutBase(null);
      setQuoting(false);
      return;
    }

    const cached = getCachedQuote(direction, amountBase);
    if (cached) {
      if (cached.isExceed) {
        setError("Amount is larger than the pool can fill.");
        setOutBase(null);
      } else {
        setError(null);
        setOutBase(cached.amountOutBase);
      }
      setQuoting(false);
      return;
    }

    setQuoting(true);
    const id = setTimeout(async () => {
      try {
        const q = await quoteSwap(direction, amountBase);
        if (q.isExceed) {
          setError("Amount is larger than the pool can fill.");
          setOutBase(null);
        } else {
          setError(null);
          setOutBase(q.amountOutBase);
        }
      } catch {
        setOutBase(null);
      } finally {
        setQuoting(false);
      }
    }, 400);
    return () => clearTimeout(id);
    // amount drives amountBase; direction changes re-quote too.
  }, [open, amount, direction, amountBase]);

  function flip() {
    setDirection((d) => (d === "SUI_TO_USDC" ? "USDC_TO_SUI" : "SUI_TO_USDC"));
    setAmount("");
    setOutBase(null);
    setError(null);
  }

  function setMax() {
    if (balance === null) return;
    // Reserve a little SUI for gas when maxing a SUI -> USDC swap.
    const usable =
      direction === "SUI_TO_USDC"
        ? balance > SUI_GAS_BUFFER
          ? balance - SUI_GAS_BUFFER
          : BigInt(0)
        : balance;
    setAmount(fromBaseUnits(usable, inDec, 6));
  }

  async function doSwap() {
    if (amountBase <= BigInt(0) || insufficient) return;
    setSwapping(true);
    setError(null);
    try {
      const { digest } = await executeSwap(direction, amountBase, SLIPPAGE_PCT);
      setDoneDigest(digest);
      onSwapped?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Swap failed — try again.");
    } finally {
      setSwapping(false);
    }
  }

  const fromSym = symbolFor(direction, "in");
  const toSym = symbolFor(direction, "out");
  const minOut =
    outBase !== null
      ? (outBase * BigInt(Math.round((100 - SLIPPAGE_PCT) * 100))) / BigInt(10000)
      : null;

  return (
    <Transition show={open} as={Fragment}>
      <Dialog onClose={swapping ? () => {} : onClose} className="relative z-[120]">
        <TransitionChild
          as={Fragment}
          enter="ease-out duration-200"
          enterFrom="opacity-0"
          enterTo="opacity-100"
          leave="ease-in duration-150"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <DialogBackdrop className="fixed inset-0 bg-black/25 backdrop-blur-sm" />
        </TransitionChild>

        <div className="fixed inset-0 flex w-screen items-center justify-center p-4">
          <TransitionChild
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <DialogPanel className="w-full max-w-sm transform overflow-hidden rounded-2xl bg-white text-left align-middle shadow-xl transition-all dark:bg-neutral-800">
              <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-6 py-4 dark:border-white/10 dark:bg-white/5">
                <DialogTitle className="text-lg font-semibold leading-6 text-neutral-900 dark:text-white">
                  Swap Assets
                </DialogTitle>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={swapping}
                  className="text-gray-400 transition-colors hover:text-gray-500 disabled:opacity-40 dark:text-white/40 dark:hover:text-white/60"
                  aria-label="Close"
                >
                  <PiXBold />
                </button>
              </div>

              {doneDigest ? (
                <div className="grid place-items-center gap-6 px-4 py-10 text-center sm:px-6">
                  <div className="grid size-16 place-items-center rounded-full bg-green-50 text-3xl text-green-700 dark:bg-green-900/20 dark:text-green-500">
                    <PiCheckCircleFill />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">
                      Swap Complete
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-white/50">
                      Your {toSym} is now available in your wallet.
                    </p>
                  </div>
                  <Button onClick={onClose} className="mt-2">Done</Button>
                </div>
              ) : (
                <div className="grid gap-4 px-4 py-5 sm:gap-5 sm:px-6 sm:py-6">
                  <div className="relative grid gap-1.5">
                    {/* From */}
                    <CoinField
                      label="From"
                      symbol={fromSym}
                      value={amount}
                      onChange={(v) => setAmount(v)}
                      balance={balance}
                      decimals={inDec}
                      onMax={setMax}
                      editable
                    />

                    {/* Flip Button */}
                    <div className="relative -my-5 z-10 flex justify-center">
                      <button
                        type="button"
                        onClick={flip}
                        disabled={swapping}
                        className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-white text-neutral-600 hover:bg-gray-50 shadow-sm transition-colors dark:border-white/10 dark:bg-neutral-800 dark:text-white dark:hover:bg-white/5"
                        aria-label="Flip direction"
                      >
                        <PiArrowsDownUpBold className="h-3.5 w-3.5" />
                      </button>
                    </div>

                    {/* To (estimated) */}
                    <CoinField
                      label="To (estimated)"
                      symbol={toSym}
                      value={
                        quoting
                          ? "…"
                          : outBase !== null
                            ? fromBaseUnits(outBase, outDec, 6)
                            : ""
                      }
                      decimals={outDec}
                      readOnly
                    />
                  </div>

                  {minOut !== null && !quoting ? (
                    <div className="grid gap-1 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-white/5 dark:text-white/50">
                      <Row k={`Minimum Received (${SLIPPAGE_PCT}%)`} v={`${fromBaseUnits(minOut, outDec, 6)} ${toSym}`} />
                      <Row k="Route" v="Cetus Protocol · SUI/USDC 0.25%" />
                    </div>
                  ) : null}

                  {error ? (
                    <div className="flex justify-center">
                      <InputError message={error} />
                    </div>
                  ) : null}

                  <Button
                    onClick={doSwap}
                    loading={swapping}
                    disabled={
                      swapping ||
                      quoting ||
                      amountBase <= BigInt(0) ||
                      insufficient ||
                      (outBase === null && !quoting)
                    }
                    leadingIcon={
                      quoting ? (
                        <PiSpinnerBold className="animate-spin text-base" />
                      ) : undefined
                    }
                  >
                    {insufficient
                      ? `Not enough ${fromSym}`
                      : swapping
                        ? "Swapping…"
                        : quoting
                          ? "Fetching rate…"
                          : `Swap ${fromSym} → ${toSym}`}
                  </Button>
                </div>
              )}
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}

function CoinField({
  label,
  symbol,
  value,
  onChange,
  balance,
  decimals,
  onMax,
  editable,
  readOnly,
}: {
  label: string;
  symbol: "SUI" | "USDC";
  value: string;
  onChange?: (v: string) => void;
  balance?: bigint | null;
  decimals: number;
  onMax?: () => void;
  editable?: boolean;
  readOnly?: boolean;
}) {
  return (
    <div className="grid gap-2 rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/5 focus-within:border-blue-500/30 focus-within:ring-2 focus-within:ring-blue-500/10 dark:focus-within:border-blue-500/30 transition-all duration-200">
      <div className="flex flex-wrap items-center justify-between gap-x-2">
        <span className="text-xs font-medium text-gray-500 dark:text-white/50">{label}</span>
        {balance != null ? (
          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-white/50">
            <span className="opacity-80">Balance:</span>
            <span className="font-semibold tabular-nums text-neutral-700 dark:text-white/80">
              {fromBaseUnits(balance, decimals, 4)}
            </span>
            {onMax ? (
              <button
                type="button"
                onClick={onMax}
                className="ml-1.5 text-[11px] font-medium text-blue-600 hover:text-blue-700 dark:text-blue-500 dark:hover:text-blue-400"
              >
                (Max)
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex items-center gap-2 min-w-0 w-full">
        <input
          inputMode="decimal"
          placeholder="0.00"
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange?.(e.target.value.replace(/[^0-9.]/g, ""))}
          className="w-full min-w-0 flex-1 bg-transparent text-xl font-semibold tabular-nums text-neutral-900 outline-none placeholder:text-gray-300 dark:text-white dark:placeholder:text-white/20 sm:text-2xl"
        />
        <div className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white px-2 py-1 text-xs font-semibold text-neutral-900 shadow-sm dark:bg-white/10 dark:text-white sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-sm">
          {symbol === "SUI" ? (
            <svg className="h-4 w-4 text-[#4DA2FF] sm:h-5 sm:w-5" fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.636 10.009a7.16 7.16 0 0 1 1.565 4.474 7.2 7.2 0 0 1-1.608 4.53l-.087.106-.023-.135a7 7 0 0 0-.07-.349c-.502-2.21-2.142-4.106-4.84-5.642-1.823-1.034-2.866-2.278-3.14-3.693-.177-.915-.046-1.834.209-2.62.254-.787.631-1.446.953-1.843l1.05-1.284a.46.46 0 0 1 .713 0l5.28 6.456zm1.66-1.283L12.26.123a.336.336 0 0 0-.52 0L4.704 8.726l-.023.029a9.33 9.33 0 0 0-2.07 5.872C2.612 19.803 6.816 24 12 24s9.388-4.197 9.388-9.373a9.32 9.32 0 0 0-2.07-5.871zM6.389 9.981l.63-.77.018.142q.023.17.055.34c.408 2.136 1.862 3.917 4.294 5.297 2.114 1.203 3.345 2.586 3.7 4.103a5.3 5.3 0 0 1 .109 1.801l-.004.034-.03.014A7.2 7.2 0 0 1 12 21.67c-3.976 0-7.2-3.218-7.2-7.188 0-1.705.594-3.27 1.587-4.503z"/>
            </svg>
          ) : (
            <svg className="h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M48 95C73.9574 95 95 73.9574 95 48C95 22.0426 73.9574 1 48 1C22.0426 1 1 22.0426 1 48C1 73.9574 22.0426 95 48 95Z" fill="#0B53BF"/>
              <path d="M56.4609 13.7778V19.8291C68.5341 23.4716 77.3759 34.6928 77.3759 47.9997C77.3759 61.3066 68.5341 72.5278 56.4609 76.1703V82.2216C71.8534 78.4616 83.2509 64.5672 83.2509 47.9997C83.2509 31.4322 71.8534 17.5378 56.4609 13.7778Z" fill="white"/>
              <path d="M18.625 47.9997C18.625 34.6928 27.4669 23.4716 39.54 19.8291V13.7778C24.1475 17.5378 12.75 31.4322 12.75 47.9997C12.75 64.5672 24.1475 78.4616 39.54 82.2216V76.1703C27.4669 72.5572 18.625 61.3066 18.625 47.9997Z" fill="white"/>
              <path d="M60.6319 54.5506C60.6319 42.5362 41.8025 47.4713 41.8025 40.8325C41.8025 38.4531 43.7119 36.9256 47.3544 36.9256C51.7019 36.9256 53.2 39.0406 53.67 41.89H59.6625C59.1279 36.5426 56.0588 33.1662 50.9382 32.1604V27.4375H45.0632V31.9918C39.4534 32.7062 35.9275 35.973 35.9275 40.8325C35.9275 52.9056 54.7863 48.3819 54.7863 54.9031C54.7863 57.3706 52.4069 59.0156 48.3825 59.0156C43.1244 59.0156 41.3913 56.695 40.745 53.4931H34.8994C35.2781 59.3502 38.8897 63.0159 45.0632 63.9307V68.5625H50.9382V63.9923C56.9633 63.2139 60.6319 59.7089 60.6319 54.5506Z" fill="white"/>
            </svg>
          )}
          <span>{symbol}</span>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-gray-500 dark:text-white/50">{k}</span>
      <span className="font-medium text-neutral-900 dark:text-white/80 tabular-nums">{v}</span>
    </div>
  );
}
