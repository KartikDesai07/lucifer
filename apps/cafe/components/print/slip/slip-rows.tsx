import type { ReactNode } from "react";

import { BANNER_STYLE } from "@/components/pos/PrintBanner";

// Row and band primitives of the S3 design themes. Amounts carry tabular-nums: Inter and Barlow digits are
// proportional by default, and a column of amounts must line up. 1-bit thermal rules apply: no opacity, no grey.

interface RowProps {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}

/** label left, value right. A pair too wide for the paper wraps: the value drops to its own line, still flush
 *  right, and only a value wider than the whole line breaks inside itself (the design root's wrap-anywhere). */
export function SplitRow({ label, value, className = "" }: RowProps) {
  return (
    <div className={`flex flex-wrap justify-between gap-x-2 ${className}`}>
      <span className="min-w-0 text-left">{label}</span>
      <span className="ml-auto min-w-0 text-right tabular-nums">{value}</span>
    </div>
  );
}

/** label, a dotted leader, then the value flush right. */
export function LeaderRow({ label, value, className = "" }: RowProps) {
  return (
    <div className={`flex items-baseline ${className}`}>
      <span className="min-w-0 text-left">{label}</span>
      <span className="mx-1 min-w-[1em] flex-1 border-b-2 border-dotted border-black" />
      <span className="whitespace-nowrap tabular-nums">{value}</span>
    </div>
  );
}

/** A small uppercase label in a fixed-width column, the value beside it (flex, no grid: older WebViews). */
export function LabelledRow({ label, value, className = "" }: RowProps) {
  return (
    <div className={`flex items-baseline gap-2 ${className}`}>
      <span className="w-[6.5em] shrink-0 whitespace-nowrap text-[0.75em] font-bold uppercase tracking-wider">{label}</span>
      <span className="min-w-0 flex-1 break-words tabular-nums">{value}</span>
    </div>
  );
}

/** White on black. print-color-adjust keeps a browser's own print dialog from dropping the black. */
export function Band({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`bg-black text-white ${className}`} style={BANNER_STYLE}>
      {children}
    </div>
  );
}
