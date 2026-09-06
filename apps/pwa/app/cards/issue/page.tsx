"use client";

import { useState } from "react";
import Link from "next/link";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InputError } from "@/components/ui/InputError";
import {
  PiArrowLeftBold,
  PiCheckBold,
  PiCopyBold,
  PiCreditCardBold,
  PiBroadcastBold,
  PiArrowSquareOutBold,
} from "react-icons/pi";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { webNfcSupported } from "@/lib/webnfc";

export default function IssueCardPage() {
  const [loading, setLoading] = useState(false);
  const [issuedUrl, setIssuedUrl] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nfcWriting, setNfcWriting] = useState(false);
  const [nfcSuccess, setNfcSuccess] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setCopied(false);
    setNfcSuccess(false);
    try {
      const res = await fetch("/api/cards/issue", { method: "POST" });
      const json = await res.json();
      if (!res.ok || !json.url) {
        throw new Error(json.error || "Failed to issue card URL");
      }
      setIssuedUrl(json.url);
      setToken(json.rawToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mint card link");
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    if (!issuedUrl) return;
    await navigator.clipboard.writeText(issuedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleWriteNfc() {
    if (!issuedUrl) return;
    setError(null);
    setNfcWriting(true);
    setNfcSuccess(false);
    try {
      if (!("NDEFReader" in window)) {
        throw new Error("Web NFC is not supported on this browser (Chrome for Android required). Use NFC Tools to write the copied URL.");
      }
      // @ts-expect-error Web NFC API
      const ndef = new window.NDEFReader();
      await ndef.write({
        records: [
          {
            recordType: "url",
            data: issuedUrl,
          },
        ],
      });
      setNfcSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to write NFC tag");
    } finally {
      setNfcWriting(false);
    }
  }

  return (
    <Screen centered>
      <AnimatedComponent
        variant={slideInOut}
        className="flex w-full max-w-sm flex-col items-center gap-6 text-center"
      >
        <Link
          href="/settings/card"
          className="self-start inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-neutral-900 dark:text-white/50 dark:hover:text-white"
        >
          <PiArrowLeftBold /> Back
        </Link>

        <div className="grid size-14 place-items-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-400">
          <PiCreditCardBold className="size-7" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-medium text-neutral-900 dark:text-white">
            Mint Card Linking URL
          </h1>
          <p className="text-xs text-gray-500 dark:text-white/50">
            Generate an activation URL for a physical NTAG215 card. Write it to your card using NFC Tools or Web NFC.
          </p>
        </div>

        <Button onClick={handleGenerate} loading={loading}>
          {issuedUrl ? "Mint Another Card URL" : "Generate Activation URL"}
        </Button>

        {error && <InputError message={error} />}

        {issuedUrl && (
          <div className="w-full space-y-4 rounded-2xl border border-gray-200 bg-gray-50/50 p-4 text-left dark:border-white/10 dark:bg-white/5">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-white/50">
                Card Activation URL
              </span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  readOnly
                  value={issuedUrl}
                  className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-xs font-mono text-neutral-900 dark:border-white/10 dark:bg-neutral-900 dark:text-white"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 shrink-0 rounded-xl bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
                >
                  {copied ? <PiCheckBold /> : <PiCopyBold />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-gray-200 dark:border-white/10">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-white/50">
                Next Steps
              </span>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-gray-600 dark:text-white/70">
                <li>Copy the URL above.</li>
                <li>Open <strong>NFC Tools</strong> on your phone.</li>
                <li>Tap <strong>Write</strong> &gt; <strong>Add a record</strong> &gt; <strong>URL</strong>.</li>
                <li>Paste this URL and tap your physical card to write.</li>
              </ol>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              {webNfcSupported() && (
                <Button
                  variant="secondary"
                  onClick={handleWriteNfc}
                  loading={nfcWriting}
                >
                  <PiBroadcastBold className="mr-1.5" />
                  {nfcWriting ? "Hold card to phone…" : "Write with Web NFC"}
                </Button>
              )}
              {nfcSuccess && (
                <p className="text-center text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  Card successfully written!
                </p>
              )}
              <Link
                href={`/link?token=${token}`}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-2xl border border-gray-200 py-2.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 dark:border-white/10 dark:text-white/80 dark:hover:bg-white/10"
              >
                Simulate Tap (Open Link Directly) <PiArrowSquareOutBold />
              </Link>
            </div>
          </div>
        )}
      </AnimatedComponent>
    </Screen>
  );
}
