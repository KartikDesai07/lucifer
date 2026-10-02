// The product's table-status vocabulary (Tables redesign, 2026-09-30) — ONE
// source for the live floor tiles, the Setup rows and the Dashboard's live
// floor panel (they used to carry three copies). The POS table picker and the
// Move table dialog keep their own palette (pinned there; not touched).
//
// Colours are literal hex arbitrary classes, not Tailwind palette names: the
// Tailwind v4 palette is oklch, which the contrast test cannot measure. Every
// class string is written out in full so Tailwind's scanner sees it.
// Client-safe: no Mongoose import (lib/table-admin imports the model).
import {
  TABLE_LONG_STAY_DEFAULT_MINUTES,
  TABLE_LONG_STAY_MAX_MINUTES,
  TABLE_LONG_STAY_MIN_MINUTES,
  type TableStatus,
} from "@/lib/constants";
import type { Settings, Table } from "@/types";

export interface TableStatusMeta {
  /** Always shown next to the colour — colour is never the only signal. */
  label: string;
  /** Text colour on `bg` (≥ 4.5:1, pinned). */
  fg: string;
  /** Chip / tint background. */
  bg: string;
  /** Dot and legend-swatch colour (≥ 3:1 on white, pinned). */
  mark: string;
  chipClass: string;
  dotClass: string;
  /** The live floor tile's surface: the status tint plus its border. */
  tileClass: string;
  /** Status text on the tint (`fg`). */
  textClass: string;
  borderClass: string;
}

export const TABLE_STATUS_META: Record<TableStatus, TableStatusMeta> = {
  Occupied: {
    label: "Occupied",
    fg: "#b91c1c",
    bg: "#fdecec",
    mark: "#dc2626",
    chipClass: "bg-[#fdecec] text-[#b91c1c]",
    dotClass: "bg-[#dc2626]",
    tileClass: "border-[#f5c2c2] bg-[#fdecec]",
    textClass: "text-[#b91c1c]",
    borderClass: "border-[#f5c2c2]",
  },
  Available: {
    label: "Available",
    fg: "#166534",
    bg: "#e8f6ee",
    mark: "#16a34a",
    chipClass: "bg-[#e8f6ee] text-[#166534]",
    dotClass: "bg-[#16a34a]",
    tileClass: "border-[#bfe3cc] bg-[#e8f6ee]",
    textClass: "text-[#166534]",
    borderClass: "border-[#bfe3cc]",
  },
  Reserved: {
    label: "Reserved",
    fg: "#92400e",
    bg: "#fdf3e2",
    mark: "#d97706",
    chipClass: "bg-[#fdf3e2] text-[#92400e]",
    dotClass: "bg-[#d97706]",
    tileClass: "border-[#f3d9a8] bg-[#fdf3e2]",
    textClass: "text-[#92400e]",
    borderClass: "border-[#f3d9a8]",
  },
};

/** Free = Available with no order pointer (the server's delete/rename guard,
 *  FREE_TABLE_FILTER in lib/table-admin, which this file must not import). */
export function isFreeTable(table: Pick<Table, "status" | "currentOrderId">): boolean {
  return table.status === "Available" && !table.currentOrderId;
}

/** The long-stay threshold in minutes. A document written before the field
 *  (lean read) or any out-of-range value falls back to the default. */
export function longStayMinutesOf(settings: Pick<Settings, "tableLongStayMinutes"> | undefined): number {
  const stored = settings?.tableLongStayMinutes;
  if (
    typeof stored === "number" &&
    Number.isInteger(stored) &&
    stored >= TABLE_LONG_STAY_MIN_MINUTES &&
    stored <= TABLE_LONG_STAY_MAX_MINUTES
  ) {
    return stored;
  }
  return TABLE_LONG_STAY_DEFAULT_MINUTES;
}
