"use client";

import { Fragment, useState } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from "@headlessui/react";
import { QRCode } from "react-qrcode-logo";
import { HiOutlineDuplicate, HiCheck } from "react-icons/hi";
import { PiXBold } from "react-icons/pi";

interface FundCardModalProps {
  open: boolean;
  onClose: () => void;
  address: string;
  coinSymbol?: string;
  network?: string;
}

export function FundCardModal({
  open,
  onClose,
  address,
  coinSymbol = "USDC",
  network = "Sui",
}: FundCardModalProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore — best-effort copy
    }
  }

  return (
    <Transition show={open} as={Fragment}>
      <Dialog onClose={onClose} className="relative z-[120]">
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
                  Fund card
                </DialogTitle>
                <button
                  type="button"
                  onClick={onClose}
                  className="text-gray-400 transition-colors hover:text-gray-500 dark:text-white/40 dark:hover:text-white/60"
                  aria-label="Close"
                >
                  <PiXBold />
                </button>
              </div>

              <div className="grid gap-5 px-6 py-6">
                <p className="text-center text-sm text-gray-500 dark:text-white/50">
                  Send {coinSymbol} on the {network} network to the address below.
                  It will land in your card&apos;s spending cap.
                </p>

                <div className="mx-auto rounded-2xl bg-white p-3 dark:bg-white/5" style={{ borderRadius: 16 }}>
                  <QRCode
                    value={address}
                    qrStyle="fluid"
                    eyeRadius={12}
                    bgColor="#F9FAFB"
                    size={180}
                  />
                </div>

                <div className="grid gap-2 rounded-2xl border border-gray-200 bg-gray-50 p-3 dark:border-white/10 dark:bg-white/5">
                  <p className="text-xs font-medium text-gray-500 dark:text-white/50">
                    {network} wallet address
                  </p>
                  <p className="break-all font-mono text-xs text-neutral-900 dark:text-white/80">
                    {address}
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-white/10 dark:bg-white/5">
                <span className="text-xs text-gray-500 dark:text-white/50">
                  Only send {coinSymbol} on {network}.
                </span>
                <button
                  type="button"
                  onClick={copy}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 transition-colors hover:text-blue-700 dark:text-blue-500 dark:hover:text-blue-400"
                >
                  {copied ? (
                    <>
                      <HiCheck className="text-green-600 dark:text-green-500" />
                      Copied
                    </>
                  ) : (
                    <>
                      <HiOutlineDuplicate />
                      Copy address
                    </>
                  )}
                </button>
              </div>
            </DialogPanel>
          </TransitionChild>
        </div>
      </Dialog>
    </Transition>
  );
}
