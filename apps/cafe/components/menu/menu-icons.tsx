// The Menu screen's glyphs, the owner's HTML paths (values 2, 3, 4): 24x24 outlines, round caps and joins, drawn at the
// size the HTML gives each place. The shell's header rule (app/globals.css [data-header-actions]) sets a 15px size and a
// 1.8 stroke on the header's icons by itself.
import type { ReactNode } from "react";

interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

function Svg({ size = 15, strokeWidth = 1.8, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {children}
    </svg>
  );
}

/** The Items view: three bullet lines. */
export const ItemsViewIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </Svg>
);
/** Folder: the Categories view and the category select's left icon. */
export const FolderIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
);
/** Funnel: the filter select's left icon and the phone's Filters button. */
export const FunnelIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 5h16l-6 8v5l-4 2v-7z" />
  </Svg>
);
/** The search box's magnifier (also the empty box's tile at 20px). */
export const MagnifierIcon = (p: IconProps) => (
  <Svg strokeWidth={2} {...p}>
    <path d="M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5" />
  </Svg>
);
/** The rail's "All items": the 2x2 grid. */
export const GridIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />
  </Svg>
);
