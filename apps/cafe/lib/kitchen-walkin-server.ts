// Kitchen board, paid Walk-In / parcel arm (spec 2026-11-13 kitchen-paid-walkin) — the server read (the pure filters
// live in lib/kitchen-walkin.ts). Read only: no write, no timer, no index. Order binds through the default-bound model,
// as the kitchen route always has.
import { Order } from "@/models/Order";
import { KotTick } from "@/models/KotTick";
import type { KitchenOrderInput } from "@/lib/kitchen-board";
import { walkInArmFilter } from "@/lib/kitchen-walkin";
import {
  TOKEN_DAY_SCAN_LIMIT,
  filterModeOf,
  kitchenSelectOf,
  pendingTokenIds,
  type TokenMode,
} from "@/lib/token-board";

/** The kitchen board's Walk-In arm: today's PAID no-table or parcel orders whose newest round the kitchen has not yet
 *  marked ready (and that are inside the 120 minute stale-out). Two-phase like the token arm: indexed Order candidates,
 *  their ticks by _id, then pendingTokenIds. The full read re-applies the filter so an order cancelled or edited
 *  between the two reads drops out instead of landing on the board. */
export async function readKitchenWalkInArm(mode: TokenMode): Promise<KitchenOrderInput[]> {
  const candidates = await Order.find({ ...walkInArmFilter(mode), kotRounds: { $gte: 1 } })
    .select("kotFiredAt createdAt items.kotRound items.noKot")
    .sort({ createdAt: -1 })
    .limit(TOKEN_DAY_SCAN_LIMIT)
    .lean();
  if (candidates.length === 0) return [];

  const ids = candidates.map((order) => String(order._id));
  const ticks = await KotTick.find({ _id: { $in: ids } }).select("readyAt").lean();
  const readyAtById: Record<string, Date | undefined> = {};
  for (const tick of ticks) readyAtById[tick._id] = tick.readyAt;

  const pending = pendingTokenIds(candidates, readyAtById, Date.now());
  if (pending.length === 0) return [];

  const orders = await Order.find({ _id: { $in: pending }, ...walkInArmFilter(mode) })
    .select(kitchenSelectOf(filterModeOf(mode)))
    .sort({ createdAt: 1 })
    .lean();
  return orders as unknown as KitchenOrderInput[];
}
