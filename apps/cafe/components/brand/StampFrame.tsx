import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/utils";

// A postage-stamp frame: a white border whose outer edge is perforated —
// scalloped by a row of half-circle bites — around whatever it holds (the
// sign-in artwork today). The perforation is a CSS mask, so the frame's drop
// shadow follows each bite and the edge reads as real, torn-off paper.
//
// How the mask works: two layers, unioned. Layer 1 is a solid rectangle
// inset by the border width — the middle is always fully opaque. Layer 2 is
// a grid of holes whose centres sit ON the element's edges (tiles positioned
// half a tile out, with `round` so a whole number of tiles fits each side);
// only the parts of it outside layer 1 — the border band — show, so the
// holes bite the edge and nowhere else.

/** Border width, hole spacing and hole radius, in px. */
const EDGE = 9;
const PITCH = 14;
const HOLE = 4;

const MASK_LAYERS = `linear-gradient(#000 0 0), radial-gradient(circle, transparent ${HOLE}px, #000 ${HOLE + 0.5}px)`;
const MASK_SIZE = `calc(100% - ${EDGE * 2}px) calc(100% - ${EDGE * 2}px), ${PITCH}px ${PITCH}px`;
const MASK_POSITION = `center, ${-PITCH / 2}px ${-PITCH / 2}px`;
const MASK_REPEAT = "no-repeat, round";

const STAMP_MASK: CSSProperties = {
  padding: EDGE,
  maskImage: MASK_LAYERS,
  WebkitMaskImage: MASK_LAYERS,
  maskSize: MASK_SIZE,
  WebkitMaskSize: MASK_SIZE,
  maskPosition: MASK_POSITION,
  WebkitMaskPosition: MASK_POSITION,
  maskRepeat: MASK_REPEAT,
  WebkitMaskRepeat: MASK_REPEAT,
};

// On a wrapper, not the masked element: a filter on the masked element itself
// would be clipped away by its own mask.
const STAMP_SHADOW: CSSProperties = {
  filter: "drop-shadow(0 1px 1.5px rgb(29 27 24 / 0.22)) drop-shadow(0 6px 10px rgb(29 27 24 / 0.08))",
};

export function StampFrame({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex", className)} style={STAMP_SHADOW}>
      <div className="flex flex-1 bg-white" style={STAMP_MASK}>
        <div className="relative flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
