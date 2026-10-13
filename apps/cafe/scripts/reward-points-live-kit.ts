/**
 * CB-7 S6 live legs of verify-reward-points-live.ts (kit file: the points helpers). (ops CLI support module, not app code.)
 *
 * The harness itself (stubs, the REAL route handlers, menu, settings, diners, tab helpers, barrier) is the S5 card kit
 * (reward-card-use-live-kit.ts), re-used as is; this file adds only what points need: a lot seeder, raw wallet readers
 * and the three fault-injection seams (before the points CAS, before the order CAS, at Order.create).
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { Customer } from "@/models/Customer";
import { Order } from "@/models/Order";
import { POINTS_SPEND_DEPS } from "@/lib/reward-points-spend";
import type { RewardCardSnapshot } from "@pos/shared/reward-levels";
import type { PointsSpendRecord } from "@pos/shared/reward-points";
import { rawOrder, revealed, settleBody, tabBody, type Api, type Diner, type Line, type Rec, type Res } from "./reward-card-use-live-kit";

export const oid = (id: string) => new mongoose.Types.ObjectId(id);

/** A REVEALED points lot as the engine writes it at the scratch (pointsSpent: 0, keepUntil = validUntil). */
export function lot(value: number, validUntil: Date, over: Partial<RewardCardSnapshot> = {}): RewardCardSnapshot {
  return revealed({ kind: "points", value, validUntil, pointsSpent: 0, ...over });
}

/** The customer row exactly as stored, hidden paths included (a raw read; never a Mongoose projection). */
export const rawCustomer = async (d: Diner): Promise<Rec> => ((await Customer.collection.findOne({ _id: oid(d.id) })) ?? {}) as Rec;
export const lotsOf = async (d: Diner): Promise<RewardCardSnapshot[]> => ((await rawCustomer(d)).rewardCards ?? []) as RewardCardSnapshot[];
export const spendsOf = async (d: Diner): Promise<PointsSpendRecord[]> => ((await rawCustomer(d)).pointsSpends ?? []) as PointsSpendRecord[];
export async function lotOf(d: Diner, id: string): Promise<RewardCardSnapshot> {
  const found = (await lotsOf(d)).find((c) => c.id === id);
  assert.ok(found, `landmark: lot ${id} is on the diner's row`);
  return found;
}
/** Total points taken across the wallet's points lots (what the discounts must add up to). */
export const pointsSpentTotal = async (d: Diner): Promise<number> =>
  (await lotsOf(d)).filter((c) => c.kind === "points").reduce((sum, c) => sum + (c.pointsSpent ?? 0), 0);

/** A lot exactly as seeded: revealed, nothing spent, keepUntil = validUntil, no usedAt. */
export async function assertLotUntouched(d: Diner, seeded: RewardCardSnapshot, what: string): Promise<void> {
  const stored = await lotOf(d, seeded.id);
  assert.equal(stored.status, "revealed", `${what}: the lot must still be revealed`);
  assert.equal(stored.pointsSpent, 0, `${what}: nothing may be spent from the lot`);
  assert.equal("usedAt" in stored, false, `${what}: the lot must carry no usedAt`);
  assert.deepEqual(stored.keepUntil, seeded.validUntil, `${what}: keepUntil must still equal validUntil`);
}

/**
 * Runs `before` just before every points-spend CAS (the guarded Customer update whose filter carries the per-lot `$all`)
 * and then performs it: two racers held at the same instant, or a writer landing in the read-to-CAS window. Patches the
 * deps object the lib reads at call time, so the route's own call goes through it. Returns the restore function.
 */
export function beforePointsSpend(before: () => Promise<void>): () => void {
  const real = POINTS_SPEND_DEPS.updatePoints;
  POINTS_SPEND_DEPS.updatePoints = async (filter, update, arrayFilters) => {
    if (filter.rewardCards) await before();
    return real(filter, update, arrayFilters);
  };
  return () => {
    POINTS_SPEND_DEPS.updatePoints = real;
  };
}

type Writer = (filter: unknown, ...rest: unknown[]) => unknown;
/**
 * Runs `before` once, just before the NEXT Order.findOneAndUpdate(...).lean() executes (the settle's order CAS): a writer
 * landing between the route's read and its write. Later calls pass straight through. Returns the restore function.
 */
export function beforeOrderCas(before: () => Promise<void>): () => void {
  const model = Order as unknown as { findOneAndUpdate: Writer };
  const real = model.findOneAndUpdate.bind(Order);
  let fired = false;
  model.findOneAndUpdate = (filter, ...rest) => {
    if (fired) return real(filter, ...rest);
    fired = true;
    return { lean: () => before().then(() => (real(filter, ...rest) as { lean: () => unknown }).lean()) };
  };
  return () => {
    model.findOneAndUpdate = real;
  };
}

type CreateFn = (...args: unknown[]) => Promise<unknown>;
/**
 * Wraps Order.create for ONE create request: `onFirst` runs at the first call (the insert of the first attempt) before
 * the real insert; later calls (the renumber retry) pass through. Returns the restore function.
 */
export function atFirstInsert(onFirst: (doc: Rec) => Promise<void>): () => void {
  const model = Order as unknown as { create: CreateFn };
  const real = model.create.bind(Order);
  let calls = 0;
  model.create = async (...args) => {
    calls += 1;
    if (calls === 1) await onFirst(args[0] as Rec);
    return real(...args);
  };
  return () => {
    model.create = real;
  };
}

/** A parked gate: `entered` resolves when the first insert reaches it; `release()` lets it go. */
export function gate(): { entered: Promise<void>; release: () => void; hold: () => Promise<void> } {
  let release: () => void = () => undefined;
  let enter: () => void = () => undefined;
  const open = new Promise<void>((resolve) => (release = resolve));
  const entered = new Promise<void>((resolve) => (enter = resolve));
  return { entered, release, hold: async () => { enter(); await open; } };
}

/** The POS settle with points ticked (use-pos-tab settlePayload): the preview amount as `discount`, kind null, rewardPoints N. */
export async function settlePoints(api: Api, id: string, n: number, extra: Rec = {}): Promise<Res> {
  return api.settle(id, settleBody(await rawOrder(id), { discount: n, rewardPoints: n, ...extra }));
}

/** The POS Pay-Now sale with points ticked (buildCreatePayload): Completed + Cash, paidAmount omitted, the preview as `discount`. */
export function payNowBody(d: Diner, lines: Line[], n: number, extra: Rec = {}): Rec {
  const sum = lines.reduce((s, l) => s + l.price * l.qty, 0);
  return tabBody(d, lines, { status: "Completed", payment: "Cash", paidAmount: undefined, discount: n, discountKind: null, total: sum - n, rewardPoints: n, ...extra });
}
