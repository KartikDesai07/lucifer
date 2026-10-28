// The dashboard's Live tables card (values 3.6, U0 match Task 7, rulings R15 and R16) as a pure model: our table
// states mapped onto the HTML's Free / Eating / Bill printed / Reserved, the "{in use} of {all} in use · {reserved}
// reserved" line, the status bar's segments, our areas as zones and each tile's second line and title.
// components/dashboard/LiveFloorPanel.tsx draws what this returns. Client-safe: no Mongoose (lib/bill-first-print is
// server-only, so its freshness rule is mirrored here and pinned against it in live-tables.test.ts).
import { formatTime, inr } from "@/lib/utils";
// import cycle with lib/floor-tiles.ts: use its exports only inside functions
import { minutesOpen, reservationForTable } from "@/lib/floor-tiles";
import { NO_AREA_KEY, NO_AREA_LABEL, groupTablesByArea, showAreaHeadings } from "@/lib/table-areas";
import type { Area, Order, Reservation, Table } from "@/types";

/** The HTML's tile states for our data: free (Available), eating (Occupied), billed (Occupied, the running bill has
 *  printed), reserved (Reserved). We have no "KOT pending" state. */
export type LiveState = "free" | "eating" | "billed" | "reserved";

/** The HTML's legend words, in its order. */
export const LIVE_TABLE_LEGEND: ReadonlyArray<{ state: LiveState; label: string }> = [
  { state: "free", label: "Free" },
  { state: "eating", label: "Eating" },
  { state: "billed", label: "Bill printed" },
  { state: "reserved", label: "Reserved" },
];

/** The HTML's status words (the tile title's last part). */
const STATUS_WORD: Record<LiveState, string> = {
  free: "Available",
  eating: "Occupied",
  billed: "Bill printed",
  reserved: "Reserved",
};

/** The zone label when no table sits in a named area (with named areas, the rest are the Floor's "Other tables"). */
export const NO_AREAS_ZONE_LABEL = "Tables";

/** The list API returns the order as stored (lib/order-list's near-full projection), so the first-print stamp comes
 *  with the total it was made for; the shared Order type names only the first. */
type StampedOrder = Pick<Order, "total" | "billFirstPrintedAt"> & { billFirstPrintedTotal?: number };

/**
 * The bill as it is now has printed: stamped, and for this same total (a round, a void or a discount since makes a
 * new bill). The server's billFirstPrintFresh (lib/bill-first-print.ts) on the JSON the list API sends.
 */
export function billPrintedNow(order: StampedOrder): boolean {
  return Boolean(order.billFirstPrintedAt) && order.billFirstPrintedTotal === order.total;
}

const MINUTES_PER_HOUR = 60;
/** Ruling R16: a running bill's stay, "{m}m" under an hour, "{h}h {m}m" from 60 minutes. */
export function stayText(minutes: number): string {
  if (minutes < MINUTES_PER_HOUR) return `${minutes}m`;
  return `${Math.floor(minutes / MINUTES_PER_HOUR)}h ${minutes % MINUTES_PER_HOUR}m`;
}

export interface LiveTile {
  table: Table;
  state: LiveState;
  /** Line 2: "{seats} seats", "₹{bill} · {stay}", "Bill printed", the booking's time, or the state's word. */
  line: string;
  /** The HTML's tile title: "{name} · {seats} seats · {status}". */
  title: string;
  /** An occupied table's order, when we can resolve it (a tap opens it). */
  order?: Order;
}

export interface LiveTablesModel {
  sub: string;
  segments: Array<{ state: LiveState; label: string; n: number }>;
  zones: Array<{ key: string; label: string; tiles: LiveTile[] }>;
}

export function liveTablesModel(input: {
  tables: readonly Table[];
  /** Today's orders and every open tab: an occupied table's currentOrderId resolves here. */
  orders: readonly Order[];
  areas: readonly Area[] | undefined;
  reservations: readonly Reservation[] | undefined;
  /** null while the clock is not known yet (the first render). */
  nowMs: number | null;
}): LiveTablesModel {
  const { tables, areas, reservations, nowMs } = input;
  const ordersById = new Map(input.orders.map((o) => [o.orderId, o]));

  const tileOf = (table: Table): LiveTile => {
    const order = table.status === "Occupied" && table.currentOrderId ? ordersById.get(table.currentOrderId) : undefined;
    // Only a running bill has an amount, a stay and a print; a settled order (a Pay Now sale) still opens, but says
    // Occupied.
    const running = order?.status === "Pending" ? order : undefined;
    let state: LiveState = table.status === "Available" ? "free" : table.status === "Reserved" ? "reserved" : "eating";
    let line = `${table.capacity} seats`;
    if (state === "eating") {
      if (running && billPrintedNow(running)) {
        state = "billed";
        line = "Bill printed";
      } else if (running) {
        const minutes = nowMs !== null ? minutesOpen(running.createdAt, nowMs) : null;
        line = minutes === null ? inr(running.total) : `${inr(running.total)} · ${stayText(minutes)}`;
      } else {
        line = "Occupied";
      }
    } else if (state === "reserved") {
      const booking = reservationForTable(table.tableNo, reservations);
      line = booking ? formatTime(booking.time) : "Reserved";
    }
    return { table, state, line, title: `${table.tableNo} · ${table.capacity} seats · ${STATUS_WORD[state]}`, order };
  };

  const groups = groupTablesByArea(tables, areas);
  const zones = groups.map((g) => ({
    key: g.key,
    label: g.key !== NO_AREA_KEY ? g.name : showAreaHeadings(groups) ? NO_AREA_LABEL : NO_AREAS_ZONE_LABEL,
    tiles: g.items.map(tileOf),
  }));
  const count = (state: LiveState) => zones.reduce((n, z) => n + z.tiles.filter((t) => t.state === state).length, 0);
  return {
    sub: `${count("eating") + count("billed")} of ${tables.length} in use · ${count("reserved")} reserved`,
    segments: LIVE_TABLE_LEGEND.map((s) => ({ ...s, n: count(s.state) })),
    zones,
  };
}
