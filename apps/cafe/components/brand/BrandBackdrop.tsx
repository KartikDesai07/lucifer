import type { CSSProperties } from "react";

// The brand system's page backdrop: a fine dot grid that fades out towards the
// edges, and a soft terracotta light that drifts slowly across it. Pure
// decoration — aria-hidden, pointer-events-none, and the drifting layer is
// dropped entirely for "reduce motion" (motion-reduce:hidden), leaving only
// the still grid. Place inside a `relative isolate` parent; it paints behind.
//
// Inline styles rather than Tailwind arbitrary values: gradients and masks
// need commas and slashes that would all have to be escaped there.

const DOT_GRID = "radial-gradient(currentColor 1px, transparent 1.2px)";
const DOT_SIZE = "24px 24px";

// Static layer: ink dots, strongest in the middle, gone at the edges — the
// card sits on texture, the screen edges stay clean.
const GRID_LAYER: CSSProperties = {
  backgroundImage: DOT_GRID,
  backgroundSize: DOT_SIZE,
  maskImage: "radial-gradient(ellipse 70% 60% at 50% 45%, black 20%, transparent 75%)",
  WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 45%, black 20%, transparent 75%)",
};

// Moving layer: the same grid in the accent colour, seen only through a small
// round "light" whose position the brand-sweep keyframes animate.
const LIGHT_LAYER: CSSProperties = {
  backgroundImage: DOT_GRID,
  backgroundSize: DOT_SIZE,
  maskImage: "radial-gradient(circle, black 0%, transparent 65%)",
  WebkitMaskImage: "radial-gradient(circle, black 0%, transparent 65%)",
  maskSize: "38rem 38rem",
  WebkitMaskSize: "38rem 38rem",
  maskRepeat: "no-repeat",
  WebkitMaskRepeat: "no-repeat",
};

export function BrandBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      <div className="absolute inset-0 text-brand-ink opacity-[0.09]" style={GRID_LAYER} />
      <div
        className="absolute inset-0 text-brand-accent opacity-[0.45] motion-safe:animate-brand-sweep motion-reduce:hidden"
        style={LIGHT_LAYER}
      />
    </div>
  );
}
