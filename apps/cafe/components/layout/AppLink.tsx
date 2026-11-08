"use client";

import type { ComponentProps, MouseEvent, PointerEvent } from "react";
import Link from "next/link";

import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";
import { useNavOpening } from "@/hooks/use-nav-progress";
import { applyNavAction, beginNavigation } from "@/lib/navigate";

// The one link every staff screen uses (nothing else may import next/link: lib/app-link-paths.test.ts).
// It never prefetches on sight (a Link prefetch fired into a line still waking up poisons the router cache — see
// lib/warm-routes.ts), so `prefetch={false}` is forced here and cannot be overridden; instead a press or a resting
// mouse asks useIntentPrefetch, which prefetches only on a proven line. A tap tells lib/navigate.ts a page is
// opening; a tap on the page already opening is cancelled. Handlers the caller passes still run first.
// While its own page is opening the link carries data-opening="true": the nav rows' classes light it in their active
// colour and app/nav-progress.css adds the small spinner (nav rows only; an in-page link just carries the marker).

/** For a link inside a sheet or dialog (ruling R34): call from its onClick, after its own click work, so the sheet
 *  closes when the page opens in this tab (the main button, no modifier key, not cancelled). Left open, its scrim
 *  would cover the next screen's skeleton, the line and the "Still opening…" escape. A modifier click opens a new
 *  tab and leaves the sheet as it is; `close` undefined (a column, not a sheet) does nothing. */
export function closeOnPlainClick(e: MouseEvent<HTMLAnchorElement>, close: (() => void) | undefined): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  close?.();
}

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
  const opening = useNavOpening(href);
  return (
    <Link
      {...rest}
      href={href}
      prefetch={false}
      data-opening={opening ? "true" : undefined}
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
