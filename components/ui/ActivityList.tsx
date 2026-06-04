"use client";

import type { ReactNode } from "react";
import { ActivityRow } from "./ActivityRow";
import { type ActivityEvent } from "@/lib/wallet";

interface ActivityListProps {
  items: ActivityEvent[];
  ngnRate: number;
  hrefFor?: (tx: ActivityEvent) => string;
  emptyState?: ReactNode;
}

export function ActivityList({ items, ngnRate, hrefFor, emptyState }: ActivityListProps) {

  console.log(items, 'hi');
  
  if (items.length === 0) {
    return (
      <div className="rounded-3xl border border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-400 dark:border-white/10 dark:bg-white/5 dark:text-white/40">
        {emptyState ?? "No activity yet."}
      </div>
    );
  }
  return (
    <div className="grid divide-y divide-dashed divide-gray-200 overflow-hidden rounded-3xl border border-gray-200 dark:divide-white/10 dark:border-white/10">
      {items.map((tx) => (
        <ActivityRow
          key={tx.digest}
          tx={tx}
          ngnRate={ngnRate}
          href={hrefFor?.(tx)}
        />
      ))}
    </div>
  );
}
