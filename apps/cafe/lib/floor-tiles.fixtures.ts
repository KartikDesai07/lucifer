// Shared by the Floor's rule tests (lib/floor-tiles.test.ts, lib/floor-areas.test.ts, lib/floor-controls.test.ts): a
// table, an open bill, a booking and an area as the API sends them, and buildFloorTiles at a fixed clock.
import { buildFloorTiles } from "@/lib/floor-tiles";
import type { TableStatus } from "@/lib/constants";
import type { Area, Order, Reservation, Table } from "@/types";

export const NOW = Date.parse("2026-09-30T12:00:00.000Z");
export const MIN = 60_000;
export const LONG_STAY = 60;

export function table(tableNo: string, status: TableStatus, extra: Partial<Table> = {}): Table {
  return { _id: `id-${tableNo}`, tableNo, status, capacity: 4, ...extra } as Table;
}

export function tab(tableNo: string, minutesAgo: number, extra: Partial<Order> = {}): Order {
  return {
    _id: `o-${tableNo}`,
    orderId: `ORD-${tableNo}`,
    tableNo,
    customerName: "Rahul",
    total: 640,
    items: [{ qty: 2 }, { qty: 1 }],
    createdAt: new Date(NOW - minutesAgo * MIN).toISOString(),
    ...extra,
  } as Order;
}

/** The bill as the list API sends it once its first print is stamped for this same total (billPrintedNow). */
export function printed(order: Order): Order {
  return { ...order, billFirstPrintedAt: new Date(NOW).toISOString(), billFirstPrintedTotal: order.total } as Order;
}

export function reservation(tableNo: string, time: string, extra: Partial<Reservation> = {}): Reservation {
  return { _id: `r-${tableNo}-${time}`, name: "Asha", tableNo, time, status: "Booked", ...extra } as Reservation;
}

export function area(id: string, name: string): Area {
  return { _id: id, name, displayOrder: 0, createdAt: "", updatedAt: "" };
}

export function build(tables: Table[], tabs: Order[] | undefined, reservations?: Reservation[], nowMs: number | null = NOW) {
  return buildFloorTiles({ tables, tabs, reservations, nowMs, longStayMinutes: LONG_STAY });
}
