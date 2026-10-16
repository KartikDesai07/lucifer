"use client";

import type { ReactNode } from "react";

import { useNow } from "@/hooks/use-now";
import { VendorMark } from "@/components/brand/VendorMark";

// The frame every signed-out staff screen sits in: sign-in today, and any later set-password / invite screen, which
// drops straight into it. The look is the owner's mock-up (spec 2026-10-16 §5.3): the cafe's logo and name top-left
// and the time top-right on a soft background, one white card in the middle, "Powered by Sandbee POS" under it.
//
// Presentation ONLY: no auth, no data fetching, no session. The page owns its form and its logo (including the logo's
// own failure fallback) and hands them in, so this file can never be the reason sign-in breaks.

interface AuthShellProps {
  /** The cafe/product name beside the logo. */
  brandName: string;
  /** The logo element; it fills the tile it is given. The caller owns its src and its onError fallback. */
  logo: ReactNode;
  /** The card's headline, e.g. "Welcome back." Left out when the content brings its own (the PIN picker). */
  title?: string;
  /** One short line under the headline. */
  intro?: string;
  /** Under a closing rule at the foot of the card. */
  footer?: ReactNode;
  children: ReactNode;
}

/** "8:27 PM": the header clock, in the counter's own local time. */
export function clockLabel(now: Date): string {
  const hour = now.getHours();
  return `${hour % 12 || 12}:${String(now.getMinutes()).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

// Its own component so the once-a-second tick re-renders only the clock, never the card's content.
function HeaderClock() {
  const now = useNow();
  return (
    <span className="min-w-[4.5rem] shrink-0 text-right text-[13.5px] font-medium tabular-nums">
      {now ? clockLabel(now) : null}
    </span>
  );
}

export function AuthShell({ brandName, logo, title, intro, footer, children }: AuthShellProps) {
  return (
    // min-h-screen is this screen's document floor (the body's own floor is dvh-based; the route-parity pin in
    // lib/pos-layout-paths.test.ts keeps signed-out screens on the full 100vh they have always had).
    <main className="relative flex min-h-screen flex-col bg-background text-foreground">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-linear-to-b from-accent to-transparent"
      />

      <header className="relative flex shrink-0 items-center gap-3 px-4 py-3.5 md:px-7 md:py-5">
        <span className="flex h-[34px] min-w-[34px] max-w-[8.5rem] shrink-0 items-center justify-center overflow-hidden rounded-[9px] border border-border bg-card p-1">
          {logo}
        </span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em]">{brandName}</span>
        <HeaderClock />
      </header>

      <div className="relative flex flex-1 flex-col items-center px-3 pb-2 pt-1 md:px-6 md:py-2">
        <div className="my-auto flex w-full max-w-[520px] flex-col gap-5 rounded-2xl border border-border bg-card px-4 py-5 shadow-[0_1px_2px_rgb(0_0_0/0.04),0_12px_40px_rgb(0_0_0/0.06)] motion-safe:animate-brand-rise md:max-w-[680px] md:rounded-[20px] md:p-6 xl:max-w-[900px] xl:px-8 xl:py-7">
          {title && (
            <div className="text-center">
              <h1 className="text-[22px] font-semibold tracking-[-0.02em] md:text-[26px]">{title}</h1>
              {intro && <p className="mt-1 text-pretty text-sm text-muted-foreground">{intro}</p>}
            </div>
          )}

          {children}

          {footer && (
            <div className="border-t border-border pt-4 text-center text-xs text-pretty text-muted-foreground">
              {footer}
            </div>
          )}
        </div>
      </div>

      <footer className="relative flex justify-center px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-2.5">
        <VendorMark />
      </footer>
    </main>
  );
}
