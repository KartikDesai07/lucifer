import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

// The brand system's surface for a single focused task (sign-in today). Warm
// white on the paper background, a soft paper-on-counter shadow, and — as the
// one signature detail — an optional torn saw-tooth bottom edge, the cut of a
// printed bill: the motif every food business shares. Presentation only.

interface BrandCardProps {
  children: ReactNode;
  /** Cut the bottom edge like a torn-off bill. */
  tornEdge?: boolean;
  className?: string;
}

// Two diagonal gradients per 12px tile leave a V-shaped gap open at the
// bottom, so the card colour hangs down in teeth.
const TORN_EDGE: CSSProperties = {
  background:
    "linear-gradient(135deg, var(--brand-slip) 50%, transparent 50%) 0 0 / 12px 12px repeat-x, " +
    "linear-gradient(225deg, var(--brand-slip) 50%, transparent 50%) 0 0 / 12px 12px repeat-x",
};

// drop-shadow (a filter), not box-shadow: it follows the teeth. Low and soft —
// paper resting on a counter, not a card floating in space.
const PAPER_SHADOW: CSSProperties = {
  filter:
    "drop-shadow(0 1px 1px rgb(29 27 24 / 0.07)) drop-shadow(0 18px 28px rgb(29 27 24 / 0.10))",
};

export function BrandCard({ children, tornEdge = false, className }: BrandCardProps) {
  return (
    <div className="w-full" style={PAPER_SHADOW}>
      <div
        className={cn(
          "bg-brand-slip px-6 py-8 sm:px-9 sm:py-10",
          tornEdge ? "rounded-t-2xl" : "rounded-2xl",
          className,
        )}
      >
        {children}
      </div>
      {tornEdge && <div aria-hidden="true" className="h-3 w-full" style={TORN_EDGE} />}
    </div>
  );
}
