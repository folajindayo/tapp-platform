"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation } from "@tanstack/react-query";
import { PiMoneyWavyBold, PiMapPinLineBold, PiWarningOctagonFill } from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { Surface, SectionLabel, EmptyState } from "@/components/ui/Surface";
import { Amount } from "@/components/ui/Amount";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { CashCapture, type Capture } from "@/components/cash/CashCapture";
import { PledgeRow } from "@/components/cash/PledgeRow";
import { useSession } from "@/lib/auth";
import { usePledges } from "@/lib/ledger";
import { useLocation, locationOf } from "@/lib/geo/useLocation";
import { cashApi, parseAmount, toDecimalString, ApiError } from "@/lib/api";

export default function CashPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const { state: location, request: findMe } = useLocation();
  const here = locationOf(location);
  const pledges = usePledges();

  const [amountText, setAmountText] = useState("");
  const [photo, setPhoto] = useState<Capture | null>(null);

  const amountMinor = useMemo(
    () => (amountText ? parseAmount(amountText, "NGN") : null),
    [amountText],
  );

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/cash");
  }, [hydrated, session, router]);

  const pledge = useMutation({
    mutationFn: () =>
      cashApi.pledge(
        {
          amount: toDecimalString(amountMinor!, "NGN"),
          lat: here!.lat,
          lng: here!.lng,
          image: photo!.base64,
        },
        session!.jwt,
      ),
    onSuccess: (created) => router.push(`/cash/${created.id}`),
  });

  const ready = amountMinor !== null && amountMinor > 0 && !!photo && !!here;

  if (!hydrated || !session) return <Screen />;

  return (
    <Screen>
      <AnimatedComponent variant={slideInOut} className="grid gap-6 py-8">
        <header className="grid gap-1">
          <h1 className="text-xl font-medium text-[var(--fg)]">Turn cash into balance</h1>
          <p className="text-sm leading-relaxed text-[var(--fg-muted)]">
            Photograph what you have, walk it to an agent, and both of you
            confirm the handover. The money lands in your balance then — not
            before.
          </p>
        </header>

        <div className="grid gap-2">
          <label
            htmlFor="amount"
            className="px-1 text-xs font-medium uppercase tracking-wider text-[var(--fg-subtle)]"
          >
            How much is it?
          </label>
          <Surface kind="sunken" padding="md" radius="2xl">
            <div className="flex items-center gap-2">
              <span className="text-2xl text-[var(--fg-muted)]">₦</span>
              <input
                id="amount"
                inputMode="decimal"
                placeholder="0.00"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                className="w-full bg-transparent text-2xl font-medium tabular-nums text-[var(--fg)] outline-none placeholder:text-[var(--fg-subtle)]"
              />
            </div>
          </Surface>
          {amountText && amountMinor === null ? (
            <p className="px-1 text-xs text-[var(--negative)]">
              That is not an amount in naira.
            </p>
          ) : (
            <p className="px-1 text-xs leading-relaxed text-[var(--fg-muted)]">
              Count it yourself first. We check the photo against this number,
              and a mismatch is what tells us something is wrong.
            </p>
          )}
        </div>

        <CashCapture value={photo} onChange={setPhoto} disabled={pledge.isPending} />

        {!here ? (
          <Surface kind="sunken" padding="md" radius="2xl" className="grid gap-3">
            <div className="flex items-start gap-2.5">
              <PiMapPinLineBold className="mt-0.5 shrink-0 text-lg text-[var(--fg-subtle)]" />
              <p className="text-xs leading-relaxed text-[var(--fg-muted)]">
                {location.status === "denied"
                  ? "Location is turned off. We need it to find an agent you can actually walk to — turn it back on in your browser's site settings."
                  : location.status === "unavailable"
                    ? location.reason
                    : "We need your location to find an agent near enough to walk to."}
              </p>
            </div>
            {location.status !== "denied" ? (
              <Button
                variant="secondary"
                loading={location.status === "locating"}
                onClick={findMe}
              >
                Use my location
              </Button>
            ) : null}
          </Surface>
        ) : null}

        {pledge.error ? <PledgeError error={pledge.error} /> : null}

        <Button
          onClick={() => pledge.mutate()}
          disabled={!ready}
          loading={pledge.isPending}
          leadingIcon={<PiMoneyWavyBold />}
        >
          {amountMinor
            ? `Pledge ₦${(amountMinor / 100).toLocaleString("en-NG", { minimumFractionDigits: 2 })}`
            : "Pledge this cash"}
        </Button>

        <p className="px-1 text-center text-xs leading-relaxed text-[var(--fg-muted)]">
          Nothing is credited until an agent has the notes in their hand.
        </p>

        <div className="grid gap-3 pt-2">
          <SectionLabel
            action={
              <Link
                href="/agents"
                className="text-xs font-medium text-[var(--accent)]"
              >
                See agents
              </Link>
            }
          >
            Your pledges
          </SectionLabel>

          {pledges.isLoading ? (
            <Surface kind="sunken" radius="3xl" className="grid place-items-center py-8">
              <div className="loader" />
            </Surface>
          ) : pledges.data?.length ? (
            <div className="grid gap-2">
              {pledges.data.map((p) => (
                <PledgeRow key={p.id} pledge={p} />
              ))}
            </div>
          ) : (
            <EmptyState title="No pledges yet">
              Once you photograph some cash it will show up here until it
              settles.
            </EmptyState>
          )}
        </div>
      </AnimatedComponent>
    </Screen>
  );
}

/**
 * A refusal is not an accusation.
 *
 * Most people who see one photographed badly, or are trying an amount no agent
 * nearby can cover. The wording follows the server's code rather than treating
 * every non-200 as "something went wrong", because "these notes are already
 * pledged" and "no agent can take this" need completely different next steps.
 */
function PledgeError({ error }: { error: unknown }) {
  if (!(error instanceof ApiError)) {
    return (
      <InfoBanner tone="warning" icon={<PiWarningOctagonFill className="text-amber-500" />}>
        <p className="font-medium text-[var(--fg)]">Couldn&apos;t send that</p>
        <p className="mt-1 text-xs">
          {error instanceof Error ? error.message : "Try again in a moment."}
        </p>
      </InfoBanner>
    );
  }

  const guidance: Record<string, string> = {
    already_pledged:
      "These exact notes are already committed to another pledge. If you have handed them over, that one will settle; if not, cancel it first.",
    pledge_refused:
      "Try again in better light, with the notes flat and none overlapping. If the amount you typed does not match what is in the photo, fix that too.",
    no_agent:
      "Nobody nearby can take this amount right now. A smaller amount often works, or try again shortly.",
  };

  return (
    <InfoBanner tone="warning" icon={<PiWarningOctagonFill className="text-amber-500" />}>
      <p className="font-medium text-[var(--fg)]">{error.message}</p>
      {error.code && guidance[error.code] ? (
        <p className="mt-1 text-xs leading-relaxed">{guidance[error.code]}</p>
      ) : null}
    </InfoBanner>
  );
}
