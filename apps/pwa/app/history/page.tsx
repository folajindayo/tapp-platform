"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { PiWarningOctagonFill } from "react-icons/pi";
import { Screen } from "@/components/ui/Screen";
import { Button } from "@/components/ui/Button";
import { InfoBanner } from "@/components/ui/InfoBanner";
import { Surface, EmptyState } from "@/components/ui/Surface";
import { MovementList } from "@/components/ui/MovementList";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import { request, type Movement } from "@/lib/api";

interface Page {
  movements: Movement[];
  nextCursor?: string;
}

const PAGE = 30;

export default function HistoryPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();

  // Cursors seen so far. Pages accumulate rather than replacing each other,
  // because "load more" that swaps the list is a back button people did not
  // ask for.
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/history");
  }, [hydrated, session, router]);

  const pages = useQuery({
    queryKey: ["ledger", "history", session?.email ?? "", cursors],
    enabled: hydrated && !!session,
    queryFn: async () => {
      const out: Page[] = [];
      for (const cursor of cursors) {
        const params = new URLSearchParams({ limit: String(PAGE) });
        if (cursor) params.set("cursor", cursor);
        out.push(
          await request<Page>("GET", `/v1/me/activity?${params}`, {
            token: session!.jwt,
          }),
        );
      }
      return out;
    },
  });

  const movements = (pages.data ?? []).flatMap((p) => p.movements);
  const next = pages.data?.[pages.data.length - 1]?.nextCursor;

  if (!hydrated || !session) return <Screen />;

  return (
    <Screen>
      <AnimatedComponent variant={slideInOut} className="grid gap-5 py-8">
        <header className="grid gap-1">
          <h1 className="text-xl font-medium text-[var(--fg)]">Activity</h1>
          <p className="text-sm leading-relaxed text-[var(--fg-muted)]">
            Every movement of your money, in and out.
          </p>
        </header>

        {pages.isLoading ? (
          <Surface kind="sunken" radius="3xl" className="grid place-items-center py-12">
            <div className="loader" />
          </Surface>
        ) : pages.isError ? (
          <InfoBanner tone="warning" icon={<PiWarningOctagonFill className="text-amber-500" />}>
            <p className="font-medium text-[var(--fg)]">Couldn&apos;t load your activity</p>
            <p className="mt-1 text-xs">
              {pages.error instanceof Error
                ? pages.error.message
                : "Try again in a moment."}
            </p>
          </InfoBanner>
        ) : (
          <>
            <MovementList
              movements={movements}
              emptyState={
                <EmptyState title="Nothing here yet">
                  Add cash through an agent, or receive USDC on Base, and every
                  movement will be listed here.
                </EmptyState>
              }
            />

            {next ? (
              <Button
                variant="secondary"
                loading={pages.isFetching}
                onClick={() => setCursors((c) => [...c, next])}
              >
                Load more
              </Button>
            ) : movements.length ? (
              <p className="pb-4 text-center text-xs text-[var(--fg-subtle)]">
                That&apos;s everything.
              </p>
            ) : null}
          </>
        )}
      </AnimatedComponent>
    </Screen>
  );
}
