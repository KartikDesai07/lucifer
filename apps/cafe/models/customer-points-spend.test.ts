import { test } from "node:test";
import assert from "node:assert/strict";

import { Customer, customerSchema } from "@/models/Customer";
import { Order } from "@/models/Order";
import { pointsSpendSchema } from "@/models/customer-points-spend";
import { assertSchemaTtlAllowed } from "@/lib/ttl-guard";
import type { PointsSpendRecord } from "@pos/shared/reward-points";

// CB-7 S6 SEAM-1: the points-spend subschema declares EVERY PointsSpendRecord path (strict mode drops an undeclared
// one silently), Customer.pointsSpends is select:false + omit-empty, and Order.rewardPoints is a plain omit-empty
// Number. DB-free: documents are built and toObject()-ed, never saved.

const AT = new Date("2026-10-14T06:30:00.000Z");
const RETURNED = new Date("2026-10-14T07:00:00.000Z");
const FULL: PointsSpendRecord = {
  orderId: "64b7f0c2a1d2e3f4a5b6c7d8",
  at: AT,
  lots: [
    { id: "a1b2c3d4e5f6", take: 30 },
    { id: "0123456789ab", take: 12 },
  ],
  returnedAt: RETURNED,
};
const objectOf = (spends: unknown[]) =>
  new Customer({ name: "N", mobile: "9999999999", pointsSpends: spends }).toObject() as unknown as {
    pointsSpends?: PointsSpendRecord[];
  };

test("every PointsSpendRecord key survives new Customer({pointsSpends}).toObject(), field for field", () => {
  const out = objectOf([FULL]).pointsSpends;
  assert.ok(out && out.length === 1, "landmark: the record was kept");
  assert.deepEqual(Object.keys(out[0]).sort(), ["at", "lots", "orderId", "returnedAt"]);
  assert.equal(out[0].orderId, FULL.orderId);
  assert.equal(out[0].at.getTime(), AT.getTime());
  assert.equal(out[0].returnedAt?.getTime(), RETURNED.getTime());
  assert.deepEqual(out[0].lots.map((l) => ({ id: l.id, take: l.take })), FULL.lots);
  assert.equal("_id" in out[0], false, "_id: false on the record");
  assert.equal("_id" in out[0].lots[0], false, "_id: false on a lot");
});

test("an undeclared key on a record is dropped (strict), and a record without returnedAt stores none", () => {
  const out = objectOf([{ ...FULL, returnedAt: undefined, sneaky: "x" }]).pointsSpends;
  assert.ok(out);
  assert.equal("sneaky" in out[0], false);
  assert.equal("returnedAt" in out[0], false, "omit-empty: not returned yet");
});

test("pointsSpends is select:false and omit-empty; the registry TTL guard still passes", () => {
  assert.equal(customerSchema.path("pointsSpends").options.select, false);
  assert.equal(Customer.schema.path("pointsSpends").options.select, false);
  const obj = new Customer({ name: "N", mobile: "9999999999" }).toObject() as unknown as Record<string, unknown>;
  assert.ok("visits" in obj, "landmark: ordinary defaults still apply");
  assert.equal("pointsSpends" in obj, false);
  assert.equal(pointsSpendSchema.indexes().length, 0);
  for (const p of Object.values(pointsSpendSchema.paths)) {
    assert.equal((p.options as { expires?: unknown }).expires, undefined, `${p.path} has no expires`);
  }
  assert.doesNotThrow(() => assertSchemaTtlAllowed("Customer", customerSchema));
});

test("Order.rewardPoints is a declared Number with no default (omit-empty)", () => {
  const p = Order.schema.path("rewardPoints");
  assert.ok(p, "landmark: the path exists");
  assert.equal(p.instance, "Number");
  assert.equal((p.options as { default?: unknown }).default, undefined);
  const obj = new Order({}).toObject() as unknown as Record<string, unknown>;
  assert.equal("rewardPoints" in obj, false, "a fresh order stores no rewardPoints key");
  assert.equal((new Order({ rewardPoints: 40 }).toObject() as { rewardPoints?: number }).rewardPoints, 40);
});
