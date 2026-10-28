// The live Floor screen's rules as pure functions (Tables redesign, 2026-09-30):
// what each tile shows, what a tap on it does, the status pills' filter and
// counts, the header's second line (summary / freshness, U3 Task 5) and the
// refresh strip's rule. No React, no fetching —
// components/tables/Floor* and the page render what this returns, and
// lib/floor-tiles.test.ts pins every row. The area tabs and the sections are
// lib/floor-areas.ts (U3 Task 2); a tile's tone, words and accessible name are
// lib/floor-view.ts (U3 Task 3).
// import cycle with lib/dashboard/live-tables.ts: use its exports only inside functions
import { billPrintedNow } from "@/lib/dashboard/live-tables";
import { openTabForTable } from "@/lib/table-pick";
import { inr } from "@/lib/utils";
import type { Order, OrderItem, Reservation, Table } from "@/types";

// One shared clock for the minutes-open figures: a minute-level number does not
// need a per-second tick, and the table poll itself runs every 30 s.
export const FLOOR_CLOCK_TICK_MS = 30_000;

// The HTML's grid (values 0.2, 3.1): auto-fill 140px tracks, 10px apart (6 x 158.33 at 1280 with the nav open). Below
// 720px 114px, not the HTML's 104 (design 5): the same 3 x 114 at 390, two columns below 390, where three tiles' 78-83px
// lines could not hold a status word and the ⋯.
export const FLOOR_GRID_CLASS =
  "grid gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(140px,1fr))] max-tab:[grid-template-columns:repeat(auto-fill,minmax(114px,1fr))]";

// Where a tile tap goes for "Open" / "New order". NEVER carries the table in the
// URL: a query string makes Next fetch the page again on every tap (see
// lib/pos-table-handoff.ts) — the table rides in the session hand-off instead.
export const FLOOR_POS_PATH = "/pos";

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const NO_STAY_TEXT = "—";

/** What a tap on the whole tile does. "none" = the tile is only a display. */
export type FloorPrimary = "open" | "new-order" | "seat-now" | "free" | "none";
/** What the ⋯ menu offers (a sibling of the tile, never nested in it). */
export type FloorMenuAction = "reserve" | "free";

/** The status pills (U3 Task 2; values 2.4, design 6.3): the HTML's five, its order and words. "Bill printed" is an
 *  Occupied table whose running bill the server knows has printed (U2 Q11); we have no "KOT pending". */
export type FloorFilter = "all" | "free" | "occupied" | "billed" | "reserved";
export const FLOOR_FILTERS: readonly { key: FloorFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "free", label: "Available" },
  { key: "occupied", label: "Occupied" },
  { key: "billed", label: "Bill printed" },
  { key: "reserved", label: "Reserved" },
];

/** The empty line when the area and the pill leave nothing (values 5.2). */
export const FLOOR_EMPTY_FILTER_TEXT = "No tables match this filter.";

/** What a tap on the tile does, in words for its accessible name (design 6.5: the action words left the tile, owner Q2);
 *  a display-only tile has none. */
export const FLOOR_TAP_HINT: Record<FloorPrimary, string | null> = {
  open: "open the bill",
  "new-order": "start a new order",
  "seat-now": "seat guests",
  free: "free the table",
  none: null,
};

export interface FloorTileModel {
  table: Table;
  /** The open bill on this table, when one is known. */
  tab: Order | undefined;
  /** True once the open-tabs list has loaded (a failed background poll keeps it). */
  tabsKnown: boolean;
  /** Minutes the bill has been open; null before the clock exists or on a bad date. */
  minutesOpen: number | null;
  itemCount: number;
  longStay: boolean;
  reservation: Reservation | undefined;
  primary: FloorPrimary;
  menu: readonly FloorMenuAction[];
}

export interface BuildFloorTilesInput {
  tables: readonly Table[];
  /** undefined = the open-tabs list has not loaded. */
  tabs: readonly Order[] | undefined;
  /** Today's reservations; undefined = not loaded (no reservation line then). */
  reservations: readonly Reservation[] | undefined;
  /** null until the client clock exists (first render). */
  nowMs: number | null;
  longStayMinutes: number;
}

/** Today's earliest still-"Booked" reservation for this table, if any. */
export function reservationForTable(
  tableNo: string,
  reservations: readonly Reservation[] | undefined,
): Reservation | undefined {
  let best: Reservation | undefined;
  for (const r of reservations ?? []) {
    if (r.status !== "Booked" || r.tableNo !== tableNo) continue;
    if (!best || r.time < best.time) best = r;
  }
  return best;
}

export function itemCountOf(items: readonly Pick<OrderItem, "qty">[]): number {
  return items.reduce((sum, i) => sum + i.qty, 0);
}

/** Whole minutes since the bill opened. A bad date is null; a clock that runs
 *  behind the server (skew) clamps to 0 rather than showing a negative stay. */
export function minutesOpen(createdAt: string, nowMs: number): number | null {
  const opened = Date.parse(createdAt);
  if (Number.isNaN(opened)) return null;
  return Math.max(0, Math.floor((nowMs - opened) / MS_PER_MINUTE));
}

export function longStay(minutes: number | null, thresholdMinutes: number): boolean {
  return minutes !== null && minutes >= thresholdMinutes;
}

/** The stay words (design 6.5): "Just now", "{m} min" under an hour (the HTML's), then "{h}h {m}m" ("1h 0m", "1h 8m", U2's
 *  Orders age shape; the HTML's "68 min" has no hour rollover, values 12 #11). The hour form is the stay from 720px; below
 *  720px the tile shows formatStayMinutesShort ("68m", the owner's answer 2026-10-28). */
export function formatStayMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return NO_STAY_TEXT;
  if (minutes < 1) return "Just now";
  if (minutes < MINUTES_PER_HOUR) return `${minutes} min`;
  return `${Math.floor(minutes / MINUTES_PER_HOUR)}h ${minutes % MINUTES_PER_HOUR}m`;
}

/** The phone's stay words, below 720px (the owner's answer 2026-10-28, design 6.5): whole minutes and "m", no hour
 *  rollover ("0m", "72m", "125m"), so a 4-digit bill and its stay fit the 88px phone line. The same dash without a
 *  clock, and under a minute (a negative skew included) "0m" where formatStayMinutes says "Just now". */
export function formatStayMinutesShort(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return NO_STAY_TEXT;
  if (minutes < 1) return "0m";
  return `${Math.floor(minutes)}m`;
}

// The tap rules. Free / Reserve / Seat now are NEVER offered while a matching
// bill exists or the bills are unknown: freeing a table that still holds a bill
// orphans it. A Pay Now sale leaves its table Occupied pointing at a Completed
// order, so "Occupied with no open bill" is the COMMON case and gets "free".
function decide(
  table: Table,
  tab: Order | undefined,
  tabsKnown: boolean,
): { primary: FloorPrimary; menu: readonly FloorMenuAction[] } {
  if (tab) {
    // An Available table that still has an open bill resumes it (R18); a
    // Reserved one with a bill is odd enough to leave alone.
    return { primary: table.status === "Reserved" ? "none" : "open", menu: [] };
  }
  switch (table.status) {
    case "Occupied":
      return { primary: tabsKnown ? "free" : "open", menu: [] };
    case "Available":
      return { primary: "new-order", menu: tabsKnown ? ["reserve"] : [] };
    case "Reserved":
      return tabsKnown ? { primary: "seat-now", menu: ["free"] } : { primary: "none", menu: [] };
  }
}

export function buildFloorTiles(input: BuildFloorTilesInput): FloorTileModel[] {
  const { tables, tabs, reservations, nowMs, longStayMinutes } = input;
  const tabsKnown = tabs !== undefined;
  return tables.map((table) => {
    const tab = openTabForTable(table.tableNo, tabs);
    const minutes = tab && nowMs !== null ? minutesOpen(tab.createdAt, nowMs) : null;
    return {
      table,
      tab,
      tabsKnown,
      minutesOpen: minutes,
      itemCount: tab ? itemCountOf(tab.items) : 0,
      longStay: longStay(minutes, longStayMinutes),
      reservation: table.status === "Reserved" ? reservationForTable(table.tableNo, reservations) : undefined,
      ...decide(table, tab, tabsKnown),
    };
  });
}

/** The pill a tile counts in: exactly one. An Occupied table is "billed" once the server knows its running bill printed
 *  for this total (billPrintedNow, the dashboard's and Orders' rule), else "occupied"; an Available table is "free" even
 *  while it holds a bill (K7, R18); a Reserved one "reserved". */
export function floorFilterOf(tile: FloorTileModel): Exclude<FloorFilter, "all"> {
  switch (tile.table.status) {
    case "Occupied":
      return tile.tab && billPrintedNow(tile.tab) ? "billed" : "occupied";
    case "Available":
      return "free";
    case "Reserved":
      return "reserved";
  }
}

/** Each pill's count over these tiles (the page passes the area shown, design 6.3). */
export function floorCounts(tiles: readonly FloorTileModel[]): Record<FloorFilter, number> {
  const counts: Record<FloorFilter, number> = { all: tiles.length, free: 0, occupied: 0, billed: 0, reserved: 0 };
  for (const tile of tiles) counts[floorFilterOf(tile)] += 1;
  return counts;
}

export function filterTiles(tiles: readonly FloorTileModel[], filter: FloorFilter): FloorTileModel[] {
  return filter === "all" ? [...tiles] : tiles.filter((t) => floorFilterOf(t) === filter);
}

/** "3 of 10 occupied · 1 reserved · ₹1,787 running" (design 6.2, owner Q3): the HTML's counts over the whole floor
 *  (values 1.4: a table whose bill printed is still Occupied), then ours, the open bills on Occupied tables, only once
 *  the bills have loaded and above ₹0 (never "₹0 running"). */
export function floorSummaryText(tiles: readonly FloorTileModel[], tabsKnown: boolean): string {
  const occupied = tiles.filter((t) => t.table.status === "Occupied");
  const reserved = tiles.filter((t) => t.table.status === "Reserved").length;
  const summary = `${occupied.length} of ${tiles.length} occupied · ${reserved} reserved`;
  const running = tabsKnown ? occupied.reduce((sum, t) => sum + (t.tab?.total ?? 0), 0) : 0;
  return running > 0 ? `${summary} · ${inr(running)} running` : summary;
}

/** How fresh the floor is (design 6.2: today's rule, its first words shortened to fit the line). Under a minute, or a
 *  time in the future (clock skew), reads as fresh. */
export function updatedLabel(atMs: number, nowMs: number): string {
  const minutes = Math.floor((nowMs - atMs) / MS_PER_MINUTE);
  if (minutes < 1) return "Updated just now";
  return minutes < MINUTES_PER_HOUR ? `Updated ${minutes} min ago` : "Updated over an hour ago";
}

/** The header's second line (design 6.2, owner Q3): the summary, then the freshness once the floor has a stamp
 *  (updatedAtMs > 0; before the clock exists the stamp's own time, so "Updated just now"). One line, cut with an
 *  ellipsis by the header when narrow. */
export function floorHeaderLine(input: {
  tiles: readonly FloorTileModel[];
  tabsKnown: boolean;
  updatedAtMs: number;
  nowMs: number | null;
}): string {
  const summary = floorSummaryText(input.tiles, input.tabsKnown);
  return input.updatedAtMs > 0 ? `${summary} · ${updatedLabel(input.updatedAtMs, input.nowMs ?? input.updatedAtMs)}` : summary;
}

/** The refresh strip's rule (design 6.2, today's; Review Focus 5): tables on screen and a read of the tables or the open
 *  bills failed (each query's own retry included). A first load that failed is the error screen; a floor still loading
 *  or with no table shows no strip. */
export function floorRefreshFailed(input: { tables: readonly Table[] | undefined; tablesError: boolean; tabsError: boolean }): boolean {
  return input.tables !== undefined && input.tables.length > 0 && (input.tablesError || input.tabsError);
}
