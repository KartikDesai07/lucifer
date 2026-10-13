import type { PointsLotTake } from "@pos/shared/reward-points-plan";
import { POINTS_SPENDS_KEEP } from "@pos/shared/reward-points";

// CB-7 S6 (§2.7) — the PURE builders for spending reward POINTS on a bill: the spend CAS, its return, and the arrayFilters
// each needs. No Mongoose / model import (the IO is lib/reward-points-spend.ts), so the exact shapes are pinned by plain
// deep-equals. A write is `{ update, arrayFilters }`: the caller passes `arrayFilters` only when it is non-empty.
//
// The lot plan lives on Customer.pointsSpends (one record per bill, keyed on orderId): it is the single thing a return
// reads. The Order stores only the cost (`rewardPoints`).

export interface PointsWrite {
  update: Record<string, unknown>;
  arrayFilters: Record<string, unknown>[];
}

// An UNRETURNED record for this order. The `returnedAt: {$exists: false}` term is load-bearing in BOTH filters: in the
// spend it lets a retry with the same orderId land once its earlier spend was returned (a one-way marker would lock it
// out); in the return it is what makes a second return match nothing.
const openRecordOf = (orderId: string) => ({ orderId, returnedAt: { $exists: false } });

// The identifier of the i-th lot in an update path ("rewardCards.$[p0].…") and in its arrayFilters entry.
const keyOf = (i: number): string => `p${i}`;

// The spend guard: this diner's row, no unreturned record for THIS order, and EVERY planned lot still exactly as the plan
// read it — a points lot, revealed, with the same pointsSpent, not past its use-by. `$gte` pairs with the engine's strict
// `>` expiry (cardStateAt): the deadline instant itself is still spendable. A concurrent spend moves pointsSpent, so the
// loser misses and re-plans.
export function pointsSpendFilter(
  customerId: string,
  orderId: string,
  plan: readonly PointsLotTake[],
  now: Date,
): Record<string, unknown> {
  return {
    _id: customerId,
    pointsSpends: { $not: { $elemMatch: openRecordOf(orderId) } },
    rewardCards: {
      $all: plan.map((lot) => ({
        $elemMatch: { id: lot.id, kind: "points", status: "revealed", pointsSpent: lot.spentBefore, validUntil: { $gte: now } },
      })),
    },
  };
}

// One atomic update: bump each lot, close a lot that reaches its value (the engine's "used -> usedAt" keepUntil rule),
// and push the record (capped by $slice, so the array is bounded).
export function pointsSpendUpdate(orderId: string, plan: readonly PointsLotTake[], now: Date): PointsWrite {
  const inc: Record<string, number> = {};
  const set: Record<string, unknown> = {};
  const arrayFilters: Record<string, unknown>[] = [];
  plan.forEach((lot, i) => {
    const key = keyOf(i);
    inc[`rewardCards.$[${key}].pointsSpent`] = lot.take;
    if (lot.spentBefore + lot.take >= lot.value) {
      set[`rewardCards.$[${key}].status`] = "used";
      set[`rewardCards.$[${key}].usedAt`] = now;
      set[`rewardCards.$[${key}].keepUntil`] = now;
    }
    arrayFilters.push({ [`${key}.id`]: lot.id });
  });
  const record = { orderId, at: now, lots: plan.map((lot) => ({ id: lot.id, take: lot.take })) };
  return {
    update: {
      $inc: inc,
      ...(Object.keys(set).length > 0 ? { $set: set } : {}),
      $push: { pointsSpends: { $each: [record], $slice: -POINTS_SPENDS_KEEP } },
    },
    arrayFilters,
  };
}

// The return guard: an unreturned record of THIS order. There is deliberately NO rewardCards term, so the positional `$`
// in the update binds to pointsSpends (the only array in the filter).
export function pointsReturnFilter(customerId: string, orderId: string): Record<string, unknown> {
  return { _id: customerId, pointsSpends: { $elemMatch: openRecordOf(orderId) } };
}

// Undo the spend: mark the record returned, and for every lot that is STILL in the wallet give the points back and put
// it back to revealed with its keepUntil = its (immutable) validUntil, read beforehand. A lot the wallet's $slice has
// evicted is simply left out — its points are gone with it. No extension: a lot returned after its deadline is expired
// again.
export function pointsReturnUpdate(
  lots: readonly { id: string; take: number }[],
  wallet: readonly { id: string; validUntil?: Date }[],
  now: Date,
): PointsWrite {
  const set: Record<string, unknown> = { "pointsSpends.$.returnedAt": now };
  const inc: Record<string, number> = {};
  const unset: Record<string, ""> = {};
  const arrayFilters: Record<string, unknown>[] = [];
  const validUntilOf = new Map(wallet.map((c) => [c.id, c.validUntil]));
  for (const lot of lots) {
    const validUntil = validUntilOf.get(lot.id);
    if (!validUntil) continue; // evicted (or never revealed): nothing to put back
    const key = keyOf(arrayFilters.length);
    inc[`rewardCards.$[${key}].pointsSpent`] = -lot.take;
    set[`rewardCards.$[${key}].status`] = "revealed";
    set[`rewardCards.$[${key}].keepUntil`] = validUntil;
    unset[`rewardCards.$[${key}].usedAt`] = "";
    arrayFilters.push({ [`${key}.id`]: lot.id });
  }
  const hasLots = arrayFilters.length > 0;
  return { update: { $set: set, ...(hasLots ? { $inc: inc, $unset: unset } : {}) }, arrayFilters };
}
