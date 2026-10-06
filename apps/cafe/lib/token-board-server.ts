// Print customization S8 — the token board's queries and KotTick writers (server-only; the pure logic lives in
// lib/token-board.ts). Order binds through the default-bound model, as the kitchen route always has (plan K7).
import { Order } from "@/models/Order";
import { KotTick } from "@/models/KotTick";
import type { KitchenOrderInput } from "@/lib/kitchen-board";
import {
  TOKEN_BOARD_SELECT,
  TOKEN_DAY_SCAN_LIMIT,
  buildTokenBoard,
  collectedUpdateOf,
  kitchenSelectOf,
  paidTokenFilter,
  pendingTokenIds,
  readyUpdateOf,
  tokenOrderFilter,
  type TokenMode,
  type TokenOrderInput,
  type TokenTickInput,
} from "@/lib/token-board";

/** The kitchen board's token arm: today's PAID token orders whose newest round the kitchen has not yet marked ready.
 *  Two-phase on purpose (plan K3): indexed Order candidates, then their ticks by _id, then the same
 *  readyAt-vs-newest-fire comparison the open-tab arm uses — so a settled tab's later round is never hidden. */
export async function readKitchenTokenArm(dayStart: Date): Promise<KitchenOrderInput[]> {
  const candidates = await Order.find({ ...paidTokenFilter(dayStart), kotRounds: { $gte: 1 } })
    .select("kotFiredAt createdAt")
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

  const orders = await Order.find({ _id: { $in: pending }, ...paidTokenFilter(dayStart) })
    .select(kitchenSelectOf({ tokenMode: true, dayStart }))
    .sort({ createdAt: 1 })
    .lean();
  return orders as unknown as KitchenOrderInput[];
}

/** The token list: today's token orders (open or paid) with their derived status. Reads numbers and fire times only
 *  (TOKEN_BOARD_SELECT) — the payload never carries a name, an amount or a dish. */
export async function readTokenBoard(mode: TokenMode, nowMs: number) {
  const orders = await Order.find({ ...tokenOrderFilter(mode.dayStart), kotRounds: { $gte: 1 } })
    .select(TOKEN_BOARD_SELECT)
    .sort({ createdAt: -1 })
    .limit(TOKEN_DAY_SCAN_LIMIT)
    .lean();
  const ids = orders.map((order) => String(order._id));
  const tickDocs = await KotTick.find({ _id: { $in: ids } }).select("readyAt readyMarkedAt collectedAt").lean();
  const ticks: Record<string, TokenTickInput | undefined> = {};
  for (const tick of tickDocs) {
    ticks[tick._id] = { readyAt: tick.readyAt, readyMarkedAt: tick.readyMarkedAt, collectedAt: tick.collectedAt };
  }
  return buildTokenBoard({
    orders: orders as unknown as TokenOrderInput[],
    ticks,
    nowMs,
    clearMinutes: mode.clearMinutes,
  });
}

/** THE one Ready writer — kitchen POST and the token route both land here (the stamp rules live in readyUpdateOf). */
export async function writeKotReady(id: string, ready: boolean, seenFiredAt?: string) {
  return KotTick.updateOne({ _id: id }, readyUpdateOf(ready, seenFiredAt, Date.now()), { upsert: true });
}

/** Collected / un-collected. Un-collecting never upserts: it mirrors the kitchen's `$pull`, and a tick doc that does
 *  not exist has no collected stamp to remove. */
export async function writeTokenCollected(id: string, collected: boolean) {
  return KotTick.updateOne({ _id: id }, collectedUpdateOf(collected, Date.now()), collected ? { upsert: true } : {});
}
