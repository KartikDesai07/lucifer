"use client";

import type { ComponentProps, MouseEvent, PointerEvent } from "react";
import Link from "next/link";

import { useIntentPrefetch } from "@/hooks/use-intent-prefetch";

// The one link every nav row uses. It never prefetches on sight (a Link
// prefetch fired into a line still waking up poisons the router cache — see
// lib/warm-routes.ts), so `prefetch={false}` is forced here and cannot be
// overridden; instead a press or a resting mouse asks useIntentPrefetch, which
// prefetches only on a proven line. Handlers the caller passes still run.
export function IntentLink({
  onPointerDown,
  onMouseEnter,
  onMouseLeave,
  href,
  ...rest
}: Omit<ComponentProps<typeof Link>, "prefetch"> & { href: string }) {
  const intent = useIntentPrefetch(href);
  return (
    <Link
      {...rest}
      href={href}
      prefetch={false}
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
