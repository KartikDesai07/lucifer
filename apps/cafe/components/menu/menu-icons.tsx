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

// The list's glyphs (Task 2; values 5.1, 5.2, 7.1, 8): the HTML's paths.
/** Sold out (badge, bulk "Mark sold out"): a circle with a slash. */
export const CircleSlashIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8" />
  </Svg>
);
/** Back in stock (bulk): a tick. */
export const TickIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12l5 5L20 7" />
  </Svg>
);
/** Hidden on QR: the eye with a slash. */
export const EyeOffIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Svg>
);
/** Archived (badge, bulk "Archive"): the box. */
export const BoxIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7h18v13H3zM3 7l2-4h14l2 4M9 12h6" />
  </Svg>
);
/** The table head's Stock: the package. */
export const PackageIcon = (p: IconProps) => (
  <Svg strokeWidth={1.8} {...p}>
    <path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" />
  </Svg>
);
/** The table head's QR. */
export const QrIcon = (p: IconProps) => (
  <Svg strokeWidth={1.8} {...p}>
    <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2M14 18h2v2M18 18h2v2" />
  </Svg>
);
/** The row's Edit button: the pencil. */
export const PencilIcon = (p: IconProps) => (
  <Svg strokeWidth={1.9} {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
  </Svg>
);
/** No KOT: the printer (ours). */
export const PrinterIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z" />
  </Svg>
);
/** Restore (bulk, Archived view): the box with an arrow up (ours). */
export const RestoreIcon = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 7h18v13H3zM3 7l2-4h14l2 4M12 17v-6M9 13.5l3-3 3 3" />
  </Svg>
);
