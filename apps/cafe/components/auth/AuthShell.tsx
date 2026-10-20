"use client";

import type { ReactNode } from "react";

import { useNow } from "@/hooks/use-now";
import { useOnline } from "@/hooks/use-online";
import { cn } from "@/lib/utils";
import { STATUS_CLASSES } from "@/lib/ui";
import { VendorMark } from "@/components/brand/VendorMark";
import { HtmlRulesScope } from "@/components/layout/HtmlRulesScope";

// The frame every signed-out staff screen sits in: the login page and the screen lock's cover. The look is the owner's
// HTML lock screen (values 4.2, design 5.6, ruling R27): a full-screen root over everything, a soft accent tint at the
// top, a top bar (the 34px brand tile, the cafe's name in Shrikhand over "{product} · {device}", the Online chip, a
// divider, the clock), one white card centred in the space between, and the footer line "Powered by Sandbee POS" (the
// HTML's "Demo PIN 1234" line is left out).
//
// Presentation ONLY: no auth, no data fetching, no session. The page owns its form, its tile (including the logo's
// own failure fallback) and its lines and hands them in, so this file can never be the reason sign-in breaks.

interface AuthShellProps {
  /** The cafe's name (the login page, which has no session: the product's generic name). */
  brandName: string;
  /** The 34px brand tile, ready drawn; the caller owns its image and that image's onError fallback. */
  logo: ReactNode;
  /** The line under the name: "{product} · {this device's print name}", or the product alone. */
  subline?: ReactNode;
  /** The card's headline, e.g. "Welcome back." Left out when the content brings its own (the PIN picker). */
  title?: string;
  /** One short line under the headline. */
  intro?: string;
  /** Under a closing rule at the foot of the card. */
  footer?: ReactNode;
  /** A control in the page's footer line, before "Powered by" (the lock's Sign out). */
  footerAction?: ReactNode;
  children: ReactNode;
}

/** "8:27 PM": the header clock, in the counter's own local time. */
export function clockLabel(now: Date): string {
  const hour = now.getHours();
  return `${hour % 12 || 12}:${String(now.getMinutes()).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`;
}

/** The Online chip's words (the HTML's "Online", ruling R28). Offline reads "Offline" only (ruling R32): the HTML's
 *  "· PINs still work" is untrue here, where the PIN is checked on the server. */
export function onlineChipLabel(online: boolean): string {
  return online ? "Online" : "Offline";
}

// Its own component so the once-a-second tick re-renders only the clock, never the card's content. Until the first
// tick (useNow is null) it holds the HTML's measured clock width, so the chip and divider never jump (review m6).
function HeaderClock() {
  const now = useNow();
  return (
    <span data-ui="auth-clock" className={cn("whitespace-nowrap text-[13.5px] font-medium", now === null && "min-w-[61px]")}>
      {now ? clockLabel(now) : null}
    </span>
  );
}

// The browser's own online flag (no request); none on a phone, as the HTML's lkChips.
function OnlineChip() {
  const online = useOnline();
  return (
    <span data-ui="auth-net" className="hidden items-center gap-[7px] whitespace-nowrap text-[12.5px] text-muted-foreground tab:flex">
      <span
        data-ui="auth-net-dot"
        aria-hidden="true"
        className={cn("size-[7px] rounded-[50%]", STATUS_CLASSES[online ? "ok" : "warn"].dot)}
      />
      {onlineChipLabel(online)}
    </span>
  );
}

export function AuthShell({ brandName, logo, subline, title, intro, footer, footerAction, children }: AuthShellProps) {
  return (
    <main
      data-ui="auth-root"
      className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-background leading-[normal] text-foreground motion-safe:animate-html-fade"
    >
      {/* The HTML's global rules (values 1.4, ruling R24) on the sign-in screen too. */}
      <HtmlRulesScope />
      <div
        aria-hidden="true"
        data-ui="auth-tint"
        className="pointer-events-none absolute inset-x-0 top-0 h-80 bg-[linear-gradient(180deg,var(--color-accent),transparent)]"
      />

      <header data-ui="auth-header" className="relative flex flex-none items-center gap-3 px-4 py-3.5 tab:px-7 tab:py-5">
        {logo}
        <span data-ui="auth-brand" className="flex min-w-0 flex-1 flex-col">
          <span data-ui="auth-name" className="truncate font-brand-script text-[20px] font-normal leading-[1.1] text-brand-red">
            {brandName}
          </span>
          {subline && (
            <span data-ui="auth-sub" className="text-[12px] text-muted-foreground">
              {subline}
            </span>
          )}
        </span>
        <OnlineChip />
        <span data-ui="auth-divider" aria-hidden="true" className="hidden h-5 w-px bg-border tab:block" />
        <HeaderClock />
      </header>

      <div
        data-ui="auth-main"
        className="relative flex min-h-0 flex-1 flex-col items-center overflow-auto px-3 pb-2 pt-1 tab:px-6 tab:py-2"
      >
        <div
          data-ui="auth-card"
          className="my-auto flex w-full max-w-[520px] flex-col gap-5 rounded-[16px] border border-border bg-card px-4 py-5 [box-shadow:0_1px_2px_rgba(0,0,0,.04),0_12px_40px_rgba(0,0,0,.06)] motion-safe:animate-html-rise tab:max-w-[680px] tab:rounded-[20px] tab:p-6 desk:max-w-[900px] desk:px-8 desk:py-7"
        >
          {title && (
            <div className="text-center">
              <h1 data-ui="auth-title" className="text-[22px] font-semibold tracking-[-0.02em] tab:text-[26px]">
                {title}
              </h1>
              {intro && (
                <p data-ui="auth-intro" className="mt-1 text-pretty text-[14px] text-muted-foreground">
                  {intro}
                </p>
              )}
            </div>
          )}

          {children}

          {footer && (
            <div className="border-t border-border pt-4 text-center text-[12.5px] text-pretty text-muted-foreground">
              {footer}
            </div>
          )}
        </div>
      </div>

      <footer
        data-ui="auth-footer"
        className="relative flex flex-none flex-wrap justify-center gap-x-[18px] gap-y-1.5 px-4 pb-[calc(14px+env(safe-area-inset-bottom))] pt-2.5 text-[12.5px] text-subtle-foreground"
      >
        {footerAction}
        <VendorMark />
      </footer>
    </main>
  );
}
