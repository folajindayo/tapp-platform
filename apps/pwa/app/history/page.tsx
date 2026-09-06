"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Screen } from "@/components/ui/Screen";
import { ActivityList } from "@/components/ui/ActivityList";
import {
  AnimatedComponent,
  slideInOut,
} from "@/components/ui/AnimatedComponents";
import { useSession } from "@/lib/auth";
import { useWallet, useWalletHistory } from "@/lib/wallet";

export default function HistoryPage() {
  const router = useRouter();
  const { hydrated, session } = useSession();
  const wallet = useWallet();
  const history = useWalletHistory();

  useEffect(() => {
    if (hydrated && !session) router.replace("/sign-in?next=/history");
  }, [hydrated, session, router]);

  if (!hydrated || !session) return <Screen />;

  return (
    <Screen>
      <AnimatedComponent
        variant={slideInOut}
        className="grid gap-6 py-10 text-sm text-neutral-900 dark:text-white"
      >
        <div className="space-y-2">
          <h1 className="text-xl font-medium">Activity</h1>
          <p className="text-sm text-gray-500 dark:text-white/50">
            Every payment, deposit, and refund on this wallet.
          </p>
        </div>

        {history.isLoading || !wallet.data ? (
          <div className="flex justify-center py-16">
            <div className="loader" />
          </div>
        ) : (
          <ActivityList
            items={history.data ?? []}
            ngnRate={wallet.data.ngn_rate}
            hrefFor={(tx) => `/tx/${encodeURIComponent(tx.digest)}`}
            emptyState="No activity yet."
          />
        )}
      </AnimatedComponent>
    </Screen>
  );
}
