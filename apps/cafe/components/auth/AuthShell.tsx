"use client";

import type { ReactNode } from "react";

import { useNow } from "@/hooks/use-now";
import { brandFontVariables } from "@/lib/brand-fonts";
import { dayPartOf, greetingFor } from "@/lib/brand-time";
import { BrandCard } from "@/components/brand/BrandCard";
import { PointillistScene } from "@/components/brand/PointillistScene";
import { Postmark } from "@/components/brand/Postmark";
import { StampFrame } from "@/components/brand/StampFrame";
import { VendorMark } from "@/components/brand/VendorMark";

// The frame every signed-out staff screen sits in — sign-in today, and any
// later set-password / invite screen, which drops straight into it. Built on
// the "Paper & Ink" brand system (tokens + motion in app/globals.css, type in
// lib/brand-fonts.ts, pieces in components/brand).
//
// Presentation ONLY: no auth, no data fetching, no session. The page owns its
// form and its logo (including the logo's own failure fallback) and hands
// them in, so this file can never be the reason sign-in breaks.
//
// One centred card on plain paper. On large screens it splits: a perforated
// "stamp" holding a computed pointillist painting (hills, a sun, a steaming
// bowl — its colours follow the time of day; it paints itself in on load and
// is postmarked with today's date) on the left, the form on the right. On phones the
// painting becomes a short strip across the top of the same card, and on a
// short screen it steps aside entirely so the form never needs a scroll.

interface AuthShellProps {
  /** The cafe/product name beside the logo. */
  brandName: string;
  /** The logo element; it fills the box it is given. The caller owns its src
   *  and its onError fallback. */
  logo: ReactNode;
  /** The card's headline, e.g. "Welcome back." */
  title: string;
  /** One short line under the headline. */
  intro: string;
  /** Under a closing rule at the foot of the form. */
  footer?: ReactNode;
  children: ReactNode;
}

export function AuthShell({ brandName, logo, title, intro, footer, children }: AuthShellProps) {
  // ONE clock for the screen: the greeting and the painting's palette both
  // read it, so they always agree. null until mounted (see useNow) — nothing
  // time-dependent is rendered on the server.
  const now = useNow();
  const dayPart = now ? dayPartOf(now) : null;
  const greeting = now ? greetingFor(now) : null;

  return (
    // min-h-screen is this screen's document floor (the body's own floor is
    // dvh-based; the route-parity pin in lib/pos-layout-paths.test.ts keeps
    // signed-out screens on the full 100vh they have always had).
    <main className="min-h-screen bg-brand-paper text-brand-ink">
      {/* Font variables live on this wrapper, not <main>, so the brand faces
          resolve for everything inside and nowhere else. */}
      <div
        className={`${brandFontVariables} flex min-h-screen flex-col font-brand-sans`}
      >
        <div className="flex flex-1 items-center justify-center px-4 py-5 sm:px-6 sm:py-8 lg:py-12">
          <div className="w-full max-w-md motion-safe:animate-brand-rise lg:max-w-[58rem]">
            <BrandCard className="p-3 sm:p-3">
              <div className="lg:grid lg:min-h-[35rem] lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1fr)]">
                {/* The painting: a strip on phones (gone on short screens),
                    the whole left half on large ones. */}
                <StampFrame className="h-40 [@media(max-height:700px)]:hidden lg:h-auto lg:[@media(max-height:700px)]:flex">
                  <PointillistScene dayPart={dayPart} className="absolute inset-0 bg-brand-paper" />
                  {/* Large screens only: on the phone strip it crowds the bowl. */}
                  {now && dayPart && (
                    <Postmark
                      now={now}
                      dayPart={dayPart}
                      className="pointer-events-none absolute left-4 top-4 hidden w-40 motion-safe:animate-brand-stamp lg:block"
                    />
                  )}
                </StampFrame>

                <div className="flex flex-col px-4 pb-5 pt-7 sm:px-7 lg:px-12 lg:py-10">
                  {/* The lockup: the cafe's logo at its own shape (a wide
                      wordmark gets its width, a square mark stays square),
                      a hairline, then the product name in the UI face. */}
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 max-w-[8.5rem] shrink-0 items-center">{logo}</div>
                    <span aria-hidden="true" className="h-5 w-px shrink-0 bg-brand-rule" />
                    <span className="truncate text-[15px] font-semibold tracking-[-0.01em]">{brandName}</span>
                  </div>

                  <div className="flex flex-1 flex-col justify-center">
                    <p className="mt-6 h-5 text-sm font-medium text-brand-accent sm:mt-8 lg:mt-10">
                      {greeting && (
                        // key: a new part of the day re-runs the fade, once.
                        <span key={greeting} className="motion-safe:animate-brand-fade">
                          {greeting}
                        </span>
                      )}
                    </p>
                    <h1 className="mt-1 font-brand-display text-[2rem] font-medium leading-tight tracking-tight sm:text-4xl">
                      {title}
                    </h1>
                    <p className="mt-2 text-pretty text-sm leading-relaxed text-brand-muted">{intro}</p>

                    <div className="mt-7">{children}</div>
                  </div>

                  {footer && (
                    <>
                      <div aria-hidden="true" className="mt-6 border-t border-dashed border-brand-rule sm:mt-8" />
                      <div className="text-pretty pt-4 text-center text-xs text-brand-muted">{footer}</div>
                    </>
                  )}
                </div>
              </div>
            </BrandCard>
          </div>
        </div>

        <footer className="flex justify-center px-4 pb-6">
          <VendorMark />
        </footer>
      </div>
    </main>
  );
}
