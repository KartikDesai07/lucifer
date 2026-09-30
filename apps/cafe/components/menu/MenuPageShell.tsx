"use client";

import { brandFontVariables } from "@/lib/brand-fonts";
import { cn } from "@/lib/utils";

// Paper & Ink wrapper for every redesigned screen — Menu, Tables and the list
// screens (Orders, Order Requests, Kitchen, Reservations, Customers, Events,
// Staff) — the same classes as the Reports layout
// (app/(dashboard)/reports/layout.tsx) so they all share one page surface. No
// AdminGuard here: most of these screens are open to staff; Categories, Setup,
// QR codes and Staff add their own.
//
// `wide` lifts the 1440px cap for the Kitchen board only: it is a wall
// display, and a capped board would fit fewer order cards per row on a big
// screen than it did before the shell.
export function MenuPageShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`${brandFontVariables} -m-4 min-h-[calc(100svh-3.5rem)] bg-brand-paper p-4 font-brand-sans text-brand-ink md:-m-6 md:p-6`}>
      {/* min-w-0: a flex column's children default to min-width:auto, which
          lets any wide descendant (e.g. a horizontally scrolling row) widen
          this column — and the whole page — past its own max-width, even
          when that descendant has its own overflow-x-auto (measured: 1024px
          page width / 256px sideways scroll at 768-800px before this). */}
      <div className={cn("mx-auto flex min-w-0 max-w-[1440px] flex-col gap-4 sm:gap-5", wide && "max-w-none")}>{children}</div>
    </div>
  );
}
