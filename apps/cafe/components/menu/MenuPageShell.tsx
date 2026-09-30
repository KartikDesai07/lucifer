"use client";

import { brandFontVariables } from "@/lib/brand-fonts";

// Paper & Ink wrapper for the Menu screens (Items + Categories) — the same
// classes as the Reports layout (app/(dashboard)/reports/layout.tsx) so every
// redesigned screen shares one page surface. No AdminGuard here: Items is open
// to staff (stock only); the Categories page adds its own guard.
export function MenuPageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${brandFontVariables} -m-4 min-h-[calc(100svh-3.5rem)] bg-brand-paper p-4 font-brand-sans text-brand-ink md:-m-6 md:p-6`}>
      {/* min-w-0: a flex column's children default to min-width:auto, which
          lets any wide descendant (e.g. a horizontally scrolling row) widen
          this column — and the whole page — past its own max-width, even
          when that descendant has its own overflow-x-auto (measured: 1024px
          page width / 256px sideways scroll at 768-800px before this). */}
      <div className="mx-auto flex min-w-0 max-w-[1440px] flex-col gap-4 sm:gap-5">{children}</div>
    </div>
  );
}
