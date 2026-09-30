// The live Floor screen's rules as pure functions (Tables redesign, 2026-09-30):
// what each tile shows, what a tap on it does, and the summary / freshness
// text. No React, no fetching — components/tables/Floor* and the page render
// what this returns, and lib/floor-tiles.test.ts pins every row.
import type { TableStatus } from "@/lib/constants";
import { openTabForTable } from "@/lib/table-pick";
import { areaSummaryText, groupByArea, showAreaHeadings, tableAreaIdOf, tableCountText } from "@/lib/table-areas";
import { inr } from "@/lib/utils";
import type { Area, Order, OrderItem, Reservation, Table } from "@/types";

// One shared clock for the minutes-open figures: a minute-level number does not
// need a per-second tick, and the table poll itself runs every 30 s.
export const FLOOR_CLOCK_TICK_MS = 30_000;

// Measured: 6 columns on a 1366 px PC with the sidebar open, 2 on phones.
export const FLOOR_GRID_CLASS = "grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(9.5rem,1fr))]";

// Where a tile tap goes for "Open" / "New order". NEVER carries the table in the
// URL: a query string makes Next fetch the page again on every tap (see
// lib/pos-table-handoff.ts) — the table rides in the session hand-off instead.
export const FLOOR_POS_PATH = "/pos";

const MS_PER_MINUTE = 60_000;
const MINUTES_PER_HOUR = 60;
const NO_STAY_TEXT = "—";
const LIVE_LABEL_MAX_AGE_MS = 60_000;

/** What a tap on the whole tile does. "none" = the tile is only a display. */
export type FloorPrimary = "open" | "new-order" | "seat-now" | "free" | "none";
/** What the ⋯ menu offers (a sibling of the tile, never nested in it). */
export type FloorMenuAction = "reserve" | "free";
export type FloorFilter = "all" | TableStatus;

export const FLOOR_PRIMARY_LABEL: Record<FloorPrimary, string | null> = {
  open: "Open",
  "new-order": "New order",
  "seat-now": "Seat now",
  free: "Free table",
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

export function formatStayMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return NO_STAY_TEXT;
  if (minutes < 1) return "Just now";
  if (minutes < MINUTES_PER_HOUR) return `${minutes} min`;
  const hours = Math.floor(minutes / MINUTES_PER_HOUR);
  const rest = minutes % MINUTES_PER_HOUR;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
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

export function statusCounts(tables: readonly Pick<Table, "status">[]): Record<FloorFilter, number> {
  const counts: Record<FloorFilter, number> = { all: tables.length, Occupied: 0, Available: 0, Reserved: 0 };
  for (const t of tables) counts[t.status] += 1;
  return counts;
}

export function filterTiles(tiles: readonly FloorTileModel[], filter: FloorFilter): FloorTileModel[] {
  return filter === "all" ? [...tiles] : tiles.filter((t) => t.table.status === filter);
}

export interface FloorSection {
  /** An Area._id, or the trailing "Other tables" key. */
  key: string;
  name: string;
  /** "4 tables · 2 occupied", or "1 of 4 tables" while a status chip filters. */
  summary: string;
  /** The area's tiles that pass the filter (never empty). */
  tiles: FloorTileModel[];
}

export interface FloorSections {
  /** Headings show only once a table sits in a KNOWN area - judged BEFORE the filter. */
  showHeadings: boolean;
  groups: FloorSection[];
}

/**
 * The Floor's tiles laid out under their area headings. ALL tiles are grouped
 * first (so the summary counts the whole area and headings do not appear or
 * vanish as a chip is pressed), then the status filter runs inside each group;
 * an area with no matching tile is dropped. With no areas the result is one
 * group holding exactly filterTiles(tiles, filter) - today's flat list.
 */
export function floorSections(
  tiles: readonly FloorTileModel[],
  areas: readonly Area[] | undefined,
  filter: FloorFilter,
): FloorSections {
  const all = groupByArea(tiles, (tile) => tableAreaIdOf(tile.table), areas);
  const groups: FloorSection[] = [];
  for (const group of all) {
    const shown = filterTiles(group.items, filter);
    if (shown.length === 0) continue;
    const total = group.items.length;
    const summary =
      filter === "all"
        ? areaSummaryText(total, statusCounts(group.items.map((t) => t.table)).Occupied)
        : `${shown.length} of ${tableCountText(total)}`;
    groups.push({ key: group.key, name: group.name, summary, tiles: shown });
  }
  return { showHeadings: showAreaHeadings(all), groups };
}

export function emptyFilterText(filter: TableStatus): string {
  return `No ${filter.toLowerCase()} tables right now.`;
}

/** "12 tables · 5 occupied · ₹5,380 running". The running total is left out
 *  until the open bills have loaded, and when nothing is occupied. */
export function floorSummaryText(tiles: readonly FloorTileModel[], tabsKnown: boolean): string {
  const occupied = tiles.filter((t) => t.table.status === "Occupied");
  const parts = [`${tiles.length} ${tiles.length === 1 ? "table" : "tables"}`, `${occupied.length} occupied`];
  if (tabsKnown && occupied.length > 0) {
    const running = occupied.reduce((sum, t) => sum + (t.tab?.total ?? 0), 0);
    parts.push(`${inr(running)} running`);
  }
  return parts.join(" · ");
}

/** How fresh the floor is. A time in the future (clock skew) reads as fresh. */
export function updatedLabel(atMs: number, nowMs: number): string {
  const age = nowMs - atMs;
  if (age < LIVE_LABEL_MAX_AGE_MS) return "Live · updated just now";
  const minutes = Math.floor(age / MS_PER_MINUTE);
  return minutes < MINUTES_PER_HOUR ? `Updated ${minutes} min ago` : "Updated over an hour ago";
}
