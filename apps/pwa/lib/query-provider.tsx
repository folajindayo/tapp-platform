"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * Wraps the app in a TanStack Query client. We instantiate it inside a
 * state hook so the client lives in the React tree (not the module
 * scope) — that way each user session gets its own cache and we don't
 * leak state between SSR-warmed clients in dev/HMR.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // PWA users tap once, check a result, move on. No need to
            // refetch on window focus — it just adds load + UI jank.
            refetchOnWindowFocus: false,
            staleTime: 30_000,
            retry: (failureCount, err) => {
              const status = (err as { status?: number })?.status;
              if (status && status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
