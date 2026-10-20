// The product's table-status vocabulary (Tables redesign, 2026-09-30) — ONE
// source for the live floor tiles, the Setup rows and the Dashboard's live
// floor panel (they used to carry three copies). The POS table picker and the
// Move table dialog keep their own palette (pinned there; not touched).
//
// Colours are the theme's status tokens (hex in app/globals.css, never the
// Tailwind v4 oklch palette, which the contrast test cannot measure). Every
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
  /** The theme's status token the classes use: --status-{token}, -ink, -tint (and -border where it has one). */
  token: "ok" | "info" | "reserved";
  /** Text colour on `bg` (≥ 4.5:1, pinned) — the token's -ink value. */
  fg: string;
  /** Chip / tint background — the token's -tint value. */
  bg: string;
  /** Dot and legend-swatch colour (≥ 3:1 on white, pinned) — the token's base value. */
  mark: string;
  chipClass: string;
  dotClass: string;
  /** The live floor tile's surface: the status tint plus its border. */
  tileClass: string;
  /** Status text on the tint (`fg`). */
  textClass: string;
  borderClass: string;
}

// U0 match Task 7 (Task 1's carry): the classes are the theme's status tokens (the HTML's ok / info / res set, values
// 1.1), so Available's text is the HTML's --ok-i #198038 (was #16733a). The hex fields mirror the tokens' light values
// for the contrast maths (lib/table-status.test.ts reads them against app/globals.css). Available's tile border has no
// HTML token (the HTML's free tile is plain): it keeps the Floor's own #a8e0b8.
export const TABLE_STATUS_META: Record<TableStatus, TableStatusMeta> = {
  Occupied: {
    label: "Occupied",
    token: "info",
    fg: "#0043ce",
    bg: "#edf5ff",
    mark: "#0f62fe",
    chipClass: "bg-status-info-tint text-status-info-ink",
    dotClass: "bg-status-info",
    tileClass: "border-status-info-border bg-status-info-tint",
    textClass: "text-status-info-ink",
    borderClass: "border-status-info-border",
  },
  Available: {
    label: "Available",
    token: "ok",
    fg: "#198038",
    bg: "#defbe6",
    mark: "#24a148",
    chipClass: "bg-status-ok-tint text-status-ok-ink",
    dotClass: "bg-status-ok",
    tileClass: "border-[#a8e0b8] bg-status-ok-tint",
    textClass: "text-status-ok-ink",
    borderClass: "border-[#a8e0b8]",
  },
  Reserved: {
    label: "Reserved",
    token: "reserved",
    fg: "#6929c4",
    bg: "#f6f2ff",
    mark: "#8a3ffc",
    chipClass: "bg-status-reserved-tint text-status-reserved-ink",
    dotClass: "bg-status-reserved",
    tileClass: "border-status-reserved-border bg-status-reserved-tint",
    textClass: "text-status-reserved-ink",
    borderClass: "border-status-reserved-border",
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
