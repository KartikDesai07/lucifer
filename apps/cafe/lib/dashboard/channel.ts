// Where an order came from, as the dashboard counts it — pure and client-safe, so a card can read an order's channel
// without the server's aggregation module (lib/dashboard/pipelines.ts, whose CHANNEL_EXPR this mirrors).
import { SELF_ORDER_SOURCE } from "@pos/shared/public";
import type { DashboardChannel } from "@/types/dashboard";

/** JS twin of CHANNEL_EXPR (the live leg asserts the two agree on real documents): a diner's QR order (source) first,
 *  then a takeaway (parcel), then a table, and a walk-in at the counter is what is left. */
export function channelOf(order: { source?: string; parcel?: boolean; tableNo?: string }): DashboardChannel {
  if (order.source === SELF_ORDER_SOURCE) return "qr";
  if (order.parcel === true) return "takeaway";
  if ((order.tableNo ?? "").length > 0) return "dine-in";
  return "counter";
}
