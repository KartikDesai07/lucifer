// Kitchen board, paid Walk-In / parcel arm (spec 2026-11-13 kitchen-paid-walkin) — the server read (the pure filters
// live in lib/kitchen-walkin.ts). Read only: no write, no timer, no index. Order binds through the default-bound model,
// as the kitchen route always has.
//
// Twin of readKitchenTokenArm in lib/token-board-server.ts: keep the two in step. The ONE deliberate difference: this
// arm drops candidates whose every fired line is noKot (orderSkipsKitchen) before pendingTokenIds. The create route
// still writes kotRounds 1 for such an order, buildKitchenCards gives it no card, and nobody can tap Ready, so kept it
// would hold one of pendingTokenIds' oldest-first slots for 2 h (60 of them hide every newer real paid Walk-In). The
// token arm needs no such drop: a whole-skip order draws no token, so it is never a token-arm candidate.
import { Order } from "@/models/Order";
import { KotTick } from "@/models/KotTick";
import type { KitchenOrderInput } from "@/lib/kitchen-board";
import { orderSkipsKitchen } from "@/lib/kitchen-lines";
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
 *  their ticks by _id, then pendingTokenIds over the candidates that have kitchen work. The full read re-applies the
 *  filter so an order cancelled or edited between the two reads drops out instead of landing on the board. */
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

  // noKot-only orders have no card to mark Ready: they must not take pendingTokenIds' slots (see the header).
  const kept = candidates.filter(
    (order) => !(order.items !== undefined && orderSkipsKitchen({ items: order.items })),
  );
  const pending = pendingTokenIds(kept, readyAtById, Date.now());
  if (pending.length === 0) return [];

  const orders = await Order.find({ _id: { $in: pending }, ...walkInArmFilter(mode) })
    .select(kitchenSelectOf(filterModeOf(mode)))
    .sort({ createdAt: 1 })
    .lean();
  return orders as unknown as KitchenOrderInput[];
}
