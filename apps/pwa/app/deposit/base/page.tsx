"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCode } from "react-qrcode-logo";
import {
  PiCopyBold,
  PiCheckBold,
  PiShareNetworkBold,
  PiWarningOctagonFill,
} from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { Surface } from "@/components/ui/Surface";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import { useDepositAddress, useBalances, balanceIn } from "@/lib/ledger";

export default function BaseDepositPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const address = useDepositAddress();
  const balances = useBalances();
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/deposit/base");
  }, [hydrated, session, router]);

  // A deposit lands as a ledger credit once it has enough confirmations, so
  // the balance is what tells the user it arrived. Polled while this page is
  // open, which is exactly when somebody is waiting for it.
  const usd = balanceIn(balances.data, "USD");

  async function copy() {
    if (!address.data) return;
    try {
      await navigator.clipboard.writeText(address.data.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be refused; the address is on screen to read.
    }
  }

  async function share() {
    if (!address.data) return;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({
          title: "My USDC deposit address",
          text: address.data.address,
        });
      } catch {
        // The user dismissed the sheet.
      }
    }
  }

  if (!hydrated || !session) return <Screen />;

  return (
    <Screen>
      <AnimatedComponent variant={slideInOut} className="grid gap-6 py-8">
        <header className="grid gap-1">
          <h1 className="text-xl font-medium text-[var(--fg)]">Receive USDC</h1>
          <p className="text-sm leading-relaxed text-[var(--fg-muted)]">
            Send USDC on Base to this address. It becomes dollars in your
            balance once the network confirms it.
          </p>
        </header>

        {address.isLoading ? (
          <Surface kind="sunken" radius="3xl" className="grid place-items-center py-16">
            <div className="loader" />
          </Surface>
        ) : address.error ? (
          <InfoBanner tone="warning" icon={<PiWarningOctagonFill className="text-amber-500" />}>
            <p className="font-medium text-[var(--fg)]">
              Couldn&apos;t get your address
            </p>
            <p className="mt-1 text-xs leading-relaxed">
              {address.error instanceof Error
                ? address.error.message
                : "Try again in a moment."}{" "}
              Don&apos;t send anything until this loads — an address you got
              somewhere else will not be yours.
            </p>
          </InfoBanner>
        ) : address.data ? (
          <>
            {/* The warning is the server's own words, shown before the
                address rather than under it. Sending the wrong token on the
                wrong chain is the one mistake on this screen that cannot be
                undone. */}
            {address.data.warning ? (
              <InfoBanner tone="warning" icon={<PiWarningOctagonFill className="text-amber-500" />}>
                <p className="text-xs leading-relaxed">{address.data.warning}</p>
              </InfoBanner>
            ) : null}

            <Surface radius="3xl" className="grid justify-items-center gap-4">
              <div className="rounded-2xl bg-white p-3">
                <QRCode
                  value={address.data.address}
                  size={180}
                  quietZone={0}
                  ecLevel="M"
                />
              </div>

              <div className="grid w-full gap-1 text-center">
                <p className="text-xs font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
                  {address.data.token} on {address.data.network}
                  {address.data.testnet ? (
                    <span className="ml-1.5 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-600 dark:text-amber-400">
                      TESTNET
                    </span>
                  ) : null}
                </p>
                <p className="break-all font-mono text-xs leading-relaxed text-[var(--fg)]">
                  {address.data.address}
                </p>
              </div>

              <div className="grid w-full grid-cols-2 gap-2">
                <Button
                  variant="secondary"
                  onClick={copy}
                  leadingIcon={copied ? <PiCheckBold /> : <PiCopyBold />}
                >
                  {copied ? "Copied" : "Copy"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={share}
                  leadingIcon={<PiShareNetworkBold />}
                >
                  Share
                </Button>
              </div>
            </Surface>

            <Surface kind="sunken" padding="md" radius="2xl" className="grid gap-1">
              <p className="text-xs font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
                Your dollars
              </p>
              <p className="text-2xl font-medium tabular-nums text-[var(--fg)]">
                {usd?.available.display ?? "—"}
              </p>
              <p className="text-xs leading-relaxed text-[var(--fg-muted)]">
                This updates by itself when a deposit confirms. You can leave
                this page.
              </p>
            </Surface>
          </>
        ) : null}
      </AnimatedComponent>
    </Screen>
  );
}
