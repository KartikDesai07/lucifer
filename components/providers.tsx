"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Devtools are dev-only. Gating the dynamic import on NODE_ENV lets the bundler
// dead-code-eliminate the import in production, so the package never ships in
// the prod client bundle (CLAUDE.md §17).
const ReactQueryDevtools =
  process.env.NODE_ENV === "production"
    ? null
    : dynamic(
        () =>
          import("@tanstack/react-query-devtools").then(
            (m) => m.ReactQueryDevtools,
          ),
        { ssr: false },
      );

// TanStack Query defaults per CLAUDE.md §9. Per-hook overrides (e.g. orders
// use staleTime: 0) are set in the individual hooks.
export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 2 * 60 * 1000,
            gcTime: 10 * 60 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {ReactQueryDevtools && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
