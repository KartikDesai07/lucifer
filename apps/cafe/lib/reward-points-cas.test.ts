import { test } from "node:test";
import assert from "node:assert/strict";
import { POINTS_SPENDS_KEEP } from "@pos/shared/reward-points";
import { pointsReturnUpdate, pointsReturnFilter, pointsSpendFilter, pointsSpendUpdate } from "./reward-points-cas";

// CB-7 S6 slice A — the PURE spend / return shapes, pinned by exact deep-equals (the IO is reward-points-spend.ts).

const CID = "60a1b2c3d4e5f60718293a4b";
const NOW = new Date("2026-10-14T10:00:00.000Z");
const KEEP = new Date("2026-10-30T18:29:59.999Z");
const PLAN = [
  { id: "lotA", take: 40, spentBefore: 0, value: 40 }, // reaches its value -> used up
  { id: "lotB", take: 10, spentBefore: 5, value: 100 }, // partial
];

test("spend filter: this row, no UNRETURNED record for this order, every planned lot still as planned ($gte expiry)", () => {
  assert.deepEqual(pointsSpendFilter(CID, "ORD-1", PLAN, NOW), {
    _id: CID,
    pointsSpends: { $not: { $elemMatch: { orderId: "ORD-1", returnedAt: { $exists: false } } } },
    rewardCards: {
      $all: [
        { $elemMatch: { id: "lotA", kind: "points", status: "revealed", pointsSpent: 0, validUntil: { $gte: NOW } } },
        { $elemMatch: { id: "lotB", kind: "points", status: "revealed", pointsSpent: 5, validUntil: { $gte: NOW } } },
      ],
    },
  });
});

test("spend filter: the expiry term is $gte (the instant itself is spendable), never $gt", () => {
  const f = JSON.stringify(pointsSpendFilter(CID, "ORD-1", PLAN, NOW));
  assert.ok(f.includes('"$gte"') && !f.includes('"$gt"'));
});

test("spend filter: the returnedAt term is present, so a RETURNED record of the same order does not block a retry", () => {
  const f = pointsSpendFilter(CID, "ORD-1", PLAN, NOW) as { pointsSpends: { $not: { $elemMatch: Record<string, unknown> } } };
  assert.deepEqual(f.pointsSpends.$not.$elemMatch.returnedAt, { $exists: false });
});

test("spend update: $inc per lot, $set used only for a lot that reaches its value, one $push capped by $slice, arrayFilters per lot", () => {
  assert.deepEqual(pointsSpendUpdate("ORD-1", PLAN, NOW), {
    update: {
      $inc: { "rewardCards.$[p0].pointsSpent": 40, "rewardCards.$[p1].pointsSpent": 10 },
      $set: { "rewardCards.$[p0].status": "used", "rewardCards.$[p0].usedAt": NOW, "rewardCards.$[p0].keepUntil": NOW },
      $push: {
        pointsSpends: {
          $each: [{ orderId: "ORD-1", at: NOW, lots: [{ id: "lotA", take: 40 }, { id: "lotB", take: 10 }] }],
          $slice: -POINTS_SPENDS_KEEP,
        },
      },
    },
    arrayFilters: [{ "p0.id": "lotA" }, { "p1.id": "lotB" }],
  });
});

test("spend update: no lot reaches its value -> no $set at all (an empty operator is a Mongo error)", () => {
  const { update } = pointsSpendUpdate("ORD-1", [PLAN[1]], NOW);
  assert.ok(!("$set" in update));
});

test("return filter: this row and an UNRETURNED record of this order — no rewardCards term (so $ binds to pointsSpends)", () => {
  assert.deepEqual(pointsReturnFilter(CID, "ORD-1"), {
    _id: CID,
    pointsSpends: { $elemMatch: { orderId: "ORD-1", returnedAt: { $exists: false } } },
  });
});

test("return update: marks the record returned, and per PRESENT lot undoes $inc, status, keepUntil and usedAt", () => {
  assert.deepEqual(
    pointsReturnUpdate([{ id: "lotA", take: 40 }, { id: "lotB", take: 10 }], [{ id: "lotA", validUntil: KEEP }, { id: "lotB", validUntil: KEEP }], NOW),
    {
      update: {
        $set: {
          "pointsSpends.$.returnedAt": NOW,
          "rewardCards.$[p0].status": "revealed",
          "rewardCards.$[p0].keepUntil": KEEP,
          "rewardCards.$[p1].status": "revealed",
          "rewardCards.$[p1].keepUntil": KEEP,
        },
        $inc: { "rewardCards.$[p0].pointsSpent": -40, "rewardCards.$[p1].pointsSpent": -10 },
        $unset: { "rewardCards.$[p0].usedAt": "", "rewardCards.$[p1].usedAt": "" },
      },
      arrayFilters: [{ "p0.id": "lotA" }, { "p1.id": "lotB" }],
    },
  );
});

test("return update: an EVICTED lot (not in the wallet any more) is left out; the others are restored", () => {
  const r = pointsReturnUpdate([{ id: "gone", take: 30 }, { id: "lotB", take: 10 }], [{ id: "lotB", validUntil: KEEP }], NOW);
  assert.deepEqual(r.arrayFilters, [{ "p0.id": "lotB" }]);
  assert.deepEqual(r.update.$inc, { "rewardCards.$[p0].pointsSpent": -10 });
  assert.ok(!JSON.stringify(r.update).includes("gone"));
});

test("return update: every lot evicted -> just the returnedAt mark, no arrayFilters, no $inc / $unset", () => {
  const r = pointsReturnUpdate([{ id: "gone", take: 30 }], [], NOW);
  assert.deepEqual(r, { update: { $set: { "pointsSpends.$.returnedAt": NOW } }, arrayFilters: [] });
});
