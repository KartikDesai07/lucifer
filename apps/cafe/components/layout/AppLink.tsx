"use client";

import type { ComponentProps, MouseEvent, PointerEvent } from "react";
import Link from "next/link";

import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import { applyNavAction, beginNavigation } from "@/lib/navigate";

// The one link every staff screen uses (nothing else may import next/link: lib/app-link-paths.test.ts).
// It never prefetches on sight (a Link prefetch fired into a line still waking up poisons the router cache — see
// lib/warm-routes.ts), so `prefetch={false}` is forced here and cannot be overridden; instead a press or a resting
// mouse asks useIntentPrefetch, which prefetches only on a proven line. A tap tells lib/navigate.ts a page is
// opening; a tap on the page already opening is cancelled. Handlers the caller passes still run first.
export function AppLink({
  onPointerDown,
  onMouseEnter,
  onMouseLeave,
  onNavigate,
  href,
  label,
  ...rest
}: Omit<ComponentProps<typeof Link>, "prefetch" | "href"> & { href: string; label?: string }) {
  const intent = useIntentPrefetch(href);
  return (
    <Link
      {...rest}
      href={href}
      prefetch={false}
      onNavigate={(e) => {
        // Next's event has no defaultPrevented, so record whether the caller cancelled: then nothing opens.
        let prevented = false;
        onNavigate?.({
          preventDefault: () => {
            prevented = true;
            e.preventDefault();
          },
        });
        if (prevented) return;
        const result = beginNavigation(href, label, window.location.pathname, Date.now());
        applyNavAction(result, href);
        // Refuse, full load and stay all end here: Next must not navigate on its own.
        if (result.action !== "navigate") e.preventDefault();
      }}
      onPointerDown={(e: PointerEvent<HTMLAnchorElement>) => {
        intent.onPointerDown();
        onPointerDown?.(e);
      }}
      onMouseEnter={(e: MouseEvent<HTMLAnchorElement>) => {
        intent.onMouseEnter();
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e: MouseEvent<HTMLAnchorElement>) => {
        intent.onMouseLeave();
        onMouseLeave?.(e);
      }}
    />
  );
}
