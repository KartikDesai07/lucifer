// Shared by the Orders lanes tests (U2 Task 2: lib/orders-lanes.test.ts, orders-lanes-summary.test.ts,
// orders-lanes-view.test.ts): the mock's clock and list rows as GET /api/orders sends them.
import { DEFAULT_ORDERS_FILTERS, type OrdersFilterState } from "./orders-lanes";
import type { Order } from "@/types";

/** The mock's clock (values 0.1): Monday 19 October 2026, 9:30 PM IST. */
export const NOW = new Date("2026-10-19T21:30:00+05:30");
export const minutesBefore = (m: number, now = NOW): string => new Date(now.getTime() - m * 60_000).toISOString();

/** A list row: an open tab of 100 at a walk-in, opened 5 minutes before NOW, unless `over` says otherwise. */
export const order = (id: string, over: Record<string, unknown> = {}): Order =>
  ({
    _id: id,
    orderId: `ORD-20261019-${id}`,
    customerName: "Walk-in",
    items: [],
    subtotal: 0,
    discount: 0,
    total: 100,
    paidAmount: 0,
    payment: "Unpaid",
    status: "Pending",
    receiver: "",
    kotRounds: 1,
    createdAt: minutesBefore(5),
    updatedAt: "",
    ...over,
  }) as unknown as Order;

/** An open tab whose bill printed for its current total (billPrintedNow). */
export const printed = (id: string, over: Record<string, unknown> = {}): Order => {
  const total = (over.total as number | undefined) ?? 100;
  return order(id, { billFirstPrintedAt: minutesBefore(2), billFirstPrintedTotal: total, ...over });
};

/** A settled bill. */
export const settled = (id: string, total: number, paidAmount: number, payment = "Cash"): Order =>
  order(id, { status: "Completed", total, paidAmount, payment });

/** The first view with some fields changed. */
export const state = (over: Partial<OrdersFilterState>): OrdersFilterState => ({ ...DEFAULT_ORDERS_FILTERS, ...over });
