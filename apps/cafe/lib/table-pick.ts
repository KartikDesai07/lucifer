// What picking a table means, as one pure rule (Tables redesign, 2026-09-30).
// Shared by the New Order table picker (components/pos/TableSelector) and the
// hand-off from the Tables floor (components/pos/PosTableHandoff), so a tap on
// the floor and a tap in the picker can never disagree. Client-safe, no React.
import type { Order, Table } from "@/types";

// The open-tabs query every screen shares (same TanStack key → one cache
// entry). Status is part of the filter, not just payment: a cancelled tab keeps
// its historical "Unpaid" mode and must never be offered as resumable. Pinned
// equal to the literal in app/(dashboard)/pos/page.tsx.
export const OPEN_TABS_FILTERS = { payment: "Unpaid", status: "Pending" } as const;

export function openTabForTable(tableNo: string, tabs: readonly Order[] | undefined): Order | undefined {
  return tabs?.find((o) => o.tableNo === tableNo);
}

export type TablePickUnavailable = "reserved" | "occupied-no-tab";

export type TablePick =
  | { kind: "resume"; tab: Order }
  | { kind: "select" }
  | { kind: "unavailable"; reason: TablePickUnavailable };

/** The picker's rule, unchanged from TableSelector: an occupied table holding a
 *  known open tab resumes it; an available table is selected for a new order;
 *  anything else cannot take a new order. */
export function tablePickAction(table: Pick<Table, "tableNo" | "status">, tabs: readonly Order[] | undefined): TablePick {
  const tab = openTabForTable(table.tableNo, tabs);
  if (table.status === "Occupied" && tab) return { kind: "resume", tab };
  if (table.status === "Available") return { kind: "select" };
  return { kind: "unavailable", reason: table.status === "Reserved" ? "reserved" : "occupied-no-tab" };
}

export type HandoffPick = TablePick | { kind: "wait" };

/** The floor hand-off's rule. Stricter than the picker in one place: an
 *  Available table that still has a known open tab (a table freed while its
 *  bill stayed open) resumes that tab instead of starting a second bill. An
 *  Occupied table needs the open tabs before it can decide (`wait`). An
 *  Available one only waits when the not-yet-confirmed cached list
 *  (`cachedTabs`, e.g. what the floor just showed) names a bill for it —
 *  otherwise it is picked at once (`tabs` undefined → select). */
export function handoffPickAction(
  table: Pick<Table, "tableNo" | "status">,
  tabs: readonly Order[] | undefined,
  cachedTabs?: readonly Order[],
): HandoffPick {
  if (table.status === "Available") {
    if (tabs === undefined) {
      return openTabForTable(table.tableNo, cachedTabs) ? { kind: "wait" } : { kind: "select" };
    }
    const tab = openTabForTable(table.tableNo, tabs);
    return tab ? { kind: "resume", tab } : { kind: "select" };
  }
  if (table.status === "Occupied" && tabs === undefined) return { kind: "wait" };
  return tablePickAction(table, tabs);
}
