// Shared fixtures for the dashboard's Live tables (lib/dashboard/live-tables.test.ts and the LiveFloorPanel render
// test in lib/dashboard-layout-paths.test.ts): two areas, seven tables in our three table states, the orders they
// point at (a running bill, a settled Pay Now order, a running bill whose bill has printed) and today's booking.
import type { Area, Order, Reservation, Table } from "@/types";

export const LIVE_TODAY = "2026-10-16";

const area = (id: string, name: string, displayOrder: number): Area => ({ _id: id, name, displayOrder, createdAt: "", updatedAt: "" });
export const LIVE_AREAS: Area[] = [area("a1", "AC Hall", 0), area("a2", "Garden", 1)];

export const liveTable = (
  tableNo: string,
  status: Table["status"],
  capacity: number,
  areaId?: string,
  currentOrderId?: string,
): Table => ({ _id: tableNo, tableNo, status, capacity, areaId, currentOrderId, createdAt: "", updatedAt: "" });

/** An order as GET /api/orders returns it: the first-print stamp as an ISO string beside the total it was made for. */
export const liveOrder = (
  orderId: string,
  status: Order["status"],
  total: number,
  stamp?: { at: string; total: number },
): Order =>
  ({
    _id: orderId,
    orderId,
    status,
    total,
    createdAt: "2026-10-16T06:00:00.000Z",
    tableNo: "",
    items: [],
    ...(stamp ? { billFirstPrintedAt: stamp.at, billFirstPrintedTotal: stamp.total } : {}),
  }) as unknown as Order;

export const LIVE_TABLES: Table[] = [
  liveTable("T-1", "Reserved", 2, "a1"),
  liveTable("T-2", "Available", 4, "a1"),
  liveTable("T-4", "Occupied", 6, "a1", "ORD-5"),
  liveTable("T-5", "Available", 4, "a2"),
  liveTable("T-7", "Occupied", 8, "a2", "ORD-4"),
  liveTable("T-8", "Occupied", 4, "a2", "ORD-8"),
  liveTable("T-9", "Available", 2),
];

export const LIVE_ORDERS: Order[] = [
  liveOrder("ORD-5", "Pending", 768),
  liveOrder("ORD-4", "Completed", 439),
  liveOrder("ORD-8", "Pending", 610, { at: "2026-10-16T06:20:00.000Z", total: 610 }),
];

export const LIVE_RESERVATIONS = [
  { _id: "r1", name: "Meera Vyas", mobile: "", date: LIVE_TODAY, time: "19:00", guests: 2, tableNo: "T-1", status: "Booked", createdAt: "", updatedAt: "" },
] as unknown as Reservation[];
