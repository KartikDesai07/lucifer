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
    fg: "#0043ce",
    bg: "#edf5ff",
    mark: "#0f62fe",
    chipClass: "bg-[#edf5ff] text-[#0043ce]",
    dotClass: "bg-[#0f62fe]",
    tileClass: "border-[#a6c8ff] bg-[#edf5ff]",
    textClass: "text-[#0043ce]",
    borderClass: "border-[#a6c8ff]",
  },
  Available: {
    label: "Available",
    fg: "#16733a",
    bg: "#defbe6",
    mark: "#24a148",
    chipClass: "bg-[#defbe6] text-[#16733a]",
    dotClass: "bg-[#24a148]",
    tileClass: "border-[#a8e0b8] bg-[#defbe6]",
    textClass: "text-[#16733a]",
    borderClass: "border-[#a8e0b8]",
  },
  Reserved: {
    label: "Reserved",
    fg: "#6929c4",
    bg: "#f6f2ff",
    mark: "#8a3ffc",
    chipClass: "bg-[#f6f2ff] text-[#6929c4]",
    dotClass: "bg-[#8a3ffc]",
    tileClass: "border-[#d4bbff] bg-[#f6f2ff]",
    textClass: "text-[#6929c4]",
    borderClass: "border-[#d4bbff]",
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
