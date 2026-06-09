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
import { PiArrowsDownUpBold, PiXBold, PiCheckCircleFill } from "react-icons/pi";
import { Button } from "@/components/ui/Button";
import {
  type SwapDirection,
  quoteSwap,
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

        <div className="fixed inset-0 grid place-items-center p-4">
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
                  Swap
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
                <div className="grid place-items-center gap-4 px-6 py-10 text-center">
                  <PiCheckCircleFill className="text-5xl text-green-500" />
                  <div>
                    <p className="text-base font-semibold text-neutral-900 dark:text-white">
                      Swap complete
                    </p>
                    <p className="mt-1 text-sm text-gray-500 dark:text-white/50">
                      Your {toSym} is in your wallet.
                    </p>
                  </div>
                  <Button onClick={onClose}>Done</Button>
                </div>
              ) : (
                <div className="grid gap-3 px-6 py-6">
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

                  {/* Flip */}
                  <div className="relative h-0">
                    <button
                      type="button"
                      onClick={flip}
                      disabled={swapping}
                      className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 rounded-xl border-4 border-white bg-blue-600 p-2 text-white shadow transition-transform hover:rotate-180 disabled:opacity-50 dark:border-neutral-800"
                      aria-label="Flip direction"
                    >
                      <PiArrowsDownUpBold />
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

                  {minOut !== null && !quoting ? (
                    <div className="grid gap-1 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500 dark:bg-white/5 dark:text-white/50">
                      <Row k={`Min received (${SLIPPAGE_PCT}% slippage)`} v={`${fromBaseUnits(minOut, outDec, 6)} ${toSym}`} />
                      <Row k="Route" v="Cetus · SUI/USDC 0.25%" />
                    </div>
                  ) : null}

                  {error ? (
                    <p className="text-center text-sm text-red-600 dark:text-red-400">{error}</p>
                  ) : null}

                  <Button
                    onClick={doSwap}
                    loading={swapping}
                    disabled={
                      swapping ||
                      quoting ||
                      amountBase <= BigInt(0) ||
                      insufficient ||
                      outBase === null
                    }
                  >
                    {insufficient
                      ? `Not enough ${fromSym}`
                      : swapping
                        ? "Swapping…"
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
    <div className="grid gap-2 rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500 dark:text-white/40">{label}</span>
        {balance != null ? (
          <span className="text-xs text-gray-400 dark:text-white/30">
            Balance: {fromBaseUnits(balance, decimals, 4)}{" "}
            {onMax ? (
              <button
                type="button"
                onClick={onMax}
                className="font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-500"
              >
                Max
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-3">
        <input
          inputMode="decimal"
          placeholder="0.0"
          value={value}
          readOnly={readOnly}
          onChange={(e) => onChange?.(e.target.value.replace(/[^0-9.]/g, ""))}
          className={`min-w-0 flex-1 bg-transparent text-2xl font-semibold tabular-nums text-neutral-900 outline-none placeholder:text-gray-300 dark:text-white dark:placeholder:text-white/20 ${
            editable ? "" : "cursor-default"
          }`}
        />
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-sm font-semibold text-neutral-900 shadow-sm dark:bg-white/10 dark:text-white">
          {symbol}
        </span>
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between">
      <span>{k}</span>
      <span className="font-medium text-neutral-700 tabular-nums dark:text-white/70">{v}</span>
    </div>
  );
}
