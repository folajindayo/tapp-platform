"use client";

import { use, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  PiCheckCircleFill,
  PiHandCoinsBold,
  PiWarningOctagonFill,
} from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { Surface } from "@/components/ui/Surface";
import { Amount } from "@/components/ui/Amount";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { HandoverCard } from "@/components/cash/HandoverCard";
import { pledgeStateLabel } from "@/components/cash/PledgeRow";
import { useSession } from "@/lib/auth";
import { usePledge } from "@/lib/ledger";
import { cashApi, ApiError } from "@/lib/api";

/** States where the pledge is still moving and worth polling. */
const LIVE = ["screening", "open", "matched", "handed_over"];

export default function PledgePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { hydrated, session } = useSession();
  const qc = useQueryClient();

  const view = usePledge(id, true);
  const pledge = view.data?.pledge;
  const handover = view.data?.handover;
  const live = !!pledge && LIVE.includes(pledge.state);

  useEffect(() => {
    if (hydrated && !session) router.replace(`/sign-in?next=/cash/${id}`);
  }, [hydrated, session, router, id]);

  // A settled pledge changed the balance, so the balance on every other screen
  // is now stale. Invalidating here rather than polling everywhere means the
  // wallet is correct the moment the user navigates back to it.
  useEffect(() => {
    if (pledge?.state === "settled") {
      void qc.invalidateQueries({ queryKey: ["ledger"] });
    }
  }, [pledge?.state, qc]);

  const match = useMutation({
    mutationFn: () => cashApi.match(id, session!.jwt),
    onSuccess: () => view.refetch(),
  });

  const confirm = useMutation({
    mutationFn: () => cashApi.confirm(handover!.id, session!.jwt),
    onSuccess: () => view.refetch(),
  });

  if (!hydrated || !session) return <Screen />;

  if (view.isLoading) {
    return (
      <Screen centered>
        <div className="loader mx-auto" />
      </Screen>
    );
  }

  if (view.error || !pledge) {
    return (
      <Screen centered>
        <InfoBanner tone="warning" icon={<PiWarningOctagonFill className="text-amber-500" />}>
          <p className="font-medium text-[var(--fg)]">Couldn&apos;t load this pledge</p>
          <p className="mt-1 text-xs">
            {view.error instanceof Error ? view.error.message : "It may have expired."}
          </p>
        </InfoBanner>
        <Link href="/cash">
          <Button variant="secondary">Back to cash</Button>
        </Link>
      </Screen>
    );
  }

  return (
    <Screen>
      <AnimatedComponent variant={slideInOut} className="grid gap-6 py-8">
        <header className="grid gap-2">
          <p className="text-xs font-medium uppercase tracking-wider text-[var(--fg-subtle)]">
            Pledge #{pledge.ref}
          </p>
          <Amount value={pledge.declared} size="hero" />
          <p className="text-sm text-[var(--fg-muted)]">
            {pledgeStateLabel[pledge.state]}
          </p>
        </header>

        {/* When recognition disagrees with the declared amount, say so plainly
            and say what it means. It is nearly always a bad photograph. */}
        {pledge.counted.minor > 0 && pledge.counted.minor !== pledge.declared.minor ? (
          <InfoBanner tone="warning">
            <p className="font-medium text-[var(--fg)]">
              The photo looks like <Amount value={pledge.counted} size="sm" />
            </p>
            <p className="mt-1 text-xs leading-relaxed">
              You said <Amount value={pledge.declared} size="sm" className="font-normal" />.
              The agent counts the notes at the counter, and what they count is
              what you are credited.
            </p>
          </InfoBanner>
        ) : null}

        {pledge.state === "refused" ? (
          <InfoBanner tone="warning" icon={<PiWarningOctagonFill className="text-amber-500" />}>
            <p className="font-medium text-[var(--fg)]">This one was not accepted</p>
            <p className="mt-1 text-xs leading-relaxed">
              {pledge.refusedReason ||
                "The photo could not be read well enough to check it."}{" "}
              Nothing has been taken from you — take another photo and try again.
            </p>
          </InfoBanner>
        ) : null}

        {pledge.state === "settled" ? (
          <Surface kind="sunken" radius="3xl" className="grid justify-items-center gap-3 py-8 text-center">
            <PiCheckCircleFill className="text-3xl text-[var(--positive)]" />
            <p className="text-sm font-medium text-[var(--fg)]">
              It&apos;s in your balance
            </p>
            <Link href="/wallet" className="w-full max-w-[16rem]">
              <Button variant="secondary">See my balance</Button>
            </Link>
          </Surface>
        ) : null}

        {handover ? (
          <HandoverCard
            handover={handover}
            onConfirm={() => confirm.mutate()}
            confirming={confirm.isPending}
            error={confirm.error}
          />
        ) : null}

        {/* Only offer the search when there is genuinely one to run. */}
        {pledge.state === "open" ? (
          <div className="grid gap-3">
            <Button
              onClick={() => match.mutate()}
              loading={match.isPending}
              leadingIcon={<PiHandCoinsBold />}
            >
              Find an agent
            </Button>
            {match.error ? <MatchError error={match.error} /> : null}
            <p className="px-1 text-center text-xs leading-relaxed text-[var(--fg-muted)]">
              We hold their cash aside while you walk over, so it is still there
              when you arrive.
            </p>
          </div>
        ) : null}

        {pledge.state === "screening" ? (
          <Surface kind="sunken" radius="3xl" className="grid justify-items-center gap-3 py-8">
            <div className="loader" />
            <p className="max-w-[26ch] text-center text-xs leading-relaxed text-[var(--fg-muted)]">
              Reading the photo. This takes a few seconds.
            </p>
          </Surface>
        ) : null}

        {!live ? (
          <Link href="/cash">
            <Button variant="ghost">Back to cash</Button>
          </Link>
        ) : null}
      </AnimatedComponent>
    </Screen>
  );
}

function MatchError({ error }: { error: unknown }) {
  const noAgent = error instanceof ApiError && error.code === "no_agent";
  return (
    <InfoBanner tone="warning">
      <p className="font-medium text-[var(--fg)]">
        {error instanceof Error ? error.message : "Couldn't find an agent"}
      </p>
      {noAgent ? (
        <p className="mt-1 text-xs leading-relaxed">
          Agents run out of cash as other people hand theirs over, and top up
          through the day. Trying again in a few minutes usually works.
        </p>
      ) : null}
    </InfoBanner>
  );
}
