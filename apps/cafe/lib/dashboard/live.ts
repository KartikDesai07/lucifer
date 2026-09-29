// buildDashboardLive — the "Needs attention" strip: point-in-time counts that
// never depend on the chosen range. Server-side counts on indexed filters,
// never a count of a capped client list (an open-tabs page stops at 50).
import { Order } from "@/models/Order";
import { OrderRequest } from "@/models/OrderRequest";
import { Customer } from "@/models/Customer";
import { Product } from "@/models/Product";
import { Reservation } from "@/models/Reservation";
import { cafeDateString } from "@/lib/utils";
import type { DashboardLive } from "@/types/dashboard";

/** How many unavailable dish names the strip spells out (the count covers the rest). */
export const UNAVAILABLE_NAMES_LIMIT = 3;

/** The POS's own open-tabs filter (OPEN_TABS query): still running, not yet paid. */
export const OPEN_TAB_FILTER = { status: "Pending", payment: "Unpaid" } as const;
const PENDING_REQUEST = { status: "pending" } as const;
const UNAVAILABLE_PRODUCT = { isActive: true, available: false } as const;
const BOOKED = "Booked";

export async function buildDashboardLive(now: Date = new Date()): Promise<DashboardLive> {
  const [tabs, pendingRequests, dues, unavailableCount, unavailableNames, bookingsToday] = await Promise.all([
    Order.aggregate<{ count: number; value: number }>([
      { $match: OPEN_TAB_FILTER },
      { $group: { _id: null, count: { $sum: 1 }, value: { $sum: "$total" } } },
    ]),
    OrderRequest.countDocuments(PENDING_REQUEST),
    Customer.aggregate<{ total: number; customers: number }>([
      { $match: { totalDue: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: "$totalDue" }, customers: { $sum: 1 } } },
    ]),
    Product.countDocuments(UNAVAILABLE_PRODUCT),
    Product.find(UNAVAILABLE_PRODUCT).select("name").sort({ name: 1 }).limit(UNAVAILABLE_NAMES_LIMIT).lean<Array<{ name: string }>>(),
    Reservation.countDocuments({ date: cafeDateString(now), status: BOOKED }),
  ]);
  return {
    openTabs: { count: tabs[0]?.count ?? 0, value: tabs[0]?.value ?? 0 },
    pendingRequests,
    dues: { total: dues[0]?.total ?? 0, customers: dues[0]?.customers ?? 0 },
    unavailable: { count: unavailableCount, names: unavailableNames.map((p) => p.name) },
    bookingsToday,
  };
}
