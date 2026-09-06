"use client";

import { Fragment, type ReactNode } from "react";

interface ReceiptRow {
  label: string;
  value: ReactNode;
}

interface ReceiptCardProps {
  rows: ReceiptRow[];
}

/**
 * Label-left, value-right detail card. Dashed `<hr>` between rows.
 * Matches Zap's TransactionPreview pattern.
 */
export function ReceiptCard({ rows }: ReceiptCardProps) {
  return (
    <div className="grid gap-3 rounded-3xl border border-gray-200 p-4 text-sm dark:border-white/10">
      {rows.map((r, i) => (
        <Fragment key={r.label}>
          {i > 0 ? (
            <hr className="border-dashed border-gray-200 dark:border-white/10" />
          ) : null}
          <div className="flex items-start justify-between gap-4 min-w-0 w-full">
            <span className="shrink-0 text-gray-500 dark:text-white/50">{r.label}</span>
            <span className="flex-1 min-w-0 flex items-center justify-end gap-1 text-right font-medium text-neutral-900 dark:text-white/80 break-all sm:break-normal">
              {r.value}
            </span>
          </div>
        </Fragment>
      ))}
    </div>
  );
}
