import { test } from "node:test";
import assert from "node:assert/strict";

import {
  OPEN_TAB_FILTER,
  PAID_STATUS,
  TOKENS_OFF,
  kitchenOrderFilter,
  paidTokenFilter,
  pendingTokenIds,
  type TokenMode,
} from "./token-board";
import { kitchenGateFilter, paidWalkInFilter, walkInArmFilter } from "./kitchen-walkin";

// The paid Walk-In / parcel arm of the Kitchen board: pure Mongo filter builders, no DB, no clock.

const DAY = new Date("2026-11-13T00:30:00.000Z");
const OFF: TokenMode = { enabled: false, dayStart: DAY, clearMinutes: 10 };
const ON: TokenMode = { enabled: true, dayStart: DAY, clearMinutes: 10 };

test("paidWalkInFilter: status Completed, today, no table OR parcel", () => {
  const f = paidWalkInFilter(DAY);
  assert.deepStrictEqual(f, { status: "Completed", createdAt: { $gte: DAY }, $or: [{ tableNo: null }, { parcel: true }] });
  assert.deepStrictEqual(Object.keys(f), ["status", "createdAt", "$or"]);
  assert.equal(f.status, PAID_STATUS);
  assert.equal(f.createdAt.$gte, DAY, "the very day start it was given");
});

test("walkInArmFilter: tokens off is the paid Walk-In filter; tokens on skips token orders (the token arm owns them)", () => {
  assert.deepStrictEqual(walkInArmFilter(OFF), paidWalkInFilter(DAY));
  assert.deepStrictEqual(walkInArmFilter(ON), { ...paidWalkInFilter(DAY), tokenNumber: { $exists: false } });
});

test("kitchenGateFilter: tokens off = open tab OR paid Walk-In; tokens on adds the paid-token filter in between", () => {
  assert.deepStrictEqual(kitchenGateFilter(OFF), { $or: [{ status: "Pending", payment: "Unpaid" }, paidWalkInFilter(DAY)] });
  assert.deepStrictEqual(kitchenGateFilter(ON), {
    $or: [{ status: "Pending", payment: "Unpaid" }, paidTokenFilter(DAY), paidWalkInFilter(DAY)],
  });
});

test("fresh objects: mutating one result changes neither the next call nor OPEN_TAB_FILTER", () => {
  paidWalkInFilter(DAY).$or.push({ parcel: true });
  assert.equal(paidWalkInFilter(DAY).$or.length, 2);
  (kitchenGateFilter(OFF).$or[0] as Record<string, unknown>).status = "Cancelled";
  assert.equal(OPEN_TAB_FILTER.status, "Pending");
  assert.equal((kitchenGateFilter(OFF).$or[0] as Record<string, unknown>).status, "Pending");
});

test("the token pins stand", () => {
  assert.deepStrictEqual(kitchenOrderFilter(TOKENS_OFF), { status: "Pending", payment: "Unpaid" });
  assert.deepStrictEqual(kitchenOrderFilter({ tokenMode: true, dayStart: DAY }), {
    $or: [{ status: "Pending", payment: "Unpaid" }, paidTokenFilter(DAY)],
  });
});

test("pendingTokenIds serves the Walk-In arm unchanged", () => {
  const MIN = 60_000;
  const now = Date.parse("2026-11-13T10:00:00.000Z");
  const fired = (msAgo: number) => new Date(now - msAgo);
  const cand = (id: string, msAgo: number) => ({ _id: id, createdAt: fired(msAgo), kotFiredAt: [fired(msAgo)] });
  const candidates = [
    cand("a-ready", 10 * MIN),
    cand("b-open", 10 * MIN),
    cand("c-stale", 120 * MIN),
    cand("d-lost", 10 * MIN),
  ];
  const readyAtById = {
    "a-ready": fired(10 * MIN),
    "c-stale": undefined,
    "d-lost": fired(20 * MIN), // older than the newest round: does not cover it
  };
  const ids = pendingTokenIds(candidates, readyAtById, now);
  assert.equal(ids.length, 2);
  assert.ok(!ids.includes("a-ready"), "covered by Ready: dropped");
  assert.ok(!ids.includes("c-stale"), "120 minutes: stale-out");
  assert.ok(ids.includes("b-open"), "no tick: kept");
  assert.ok(ids.includes("d-lost"), "lost-ticket rule: kept");
});
