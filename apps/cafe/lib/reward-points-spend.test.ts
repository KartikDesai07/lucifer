import { test } from "node:test";
import assert from "node:assert/strict";
import { REWARD_PROGRESS_CAS_ATTEMPTS, type RewardCardSnapshot } from "@pos/shared/reward-levels";
import { pointsRedeemedReward, POINTS_NEED_CUSTOMER, POINTS_NOT_ENOUGH, POINTS_OVER_BILL } from "@pos/shared/reward-points";
import type { ISettings } from "@/models/Settings";
import type { PointsState } from "./reward-cards-read";
import { resolvePointsSpend, returnPoints, spendPoints, type PointsSpendDeps } from "./reward-points-spend";

// CB-7 S6 slice A — the IO half over FAKE deps: gate order, the spend loop (re-plan on a miss, give up after the
// attempts), the return (pre-read + one guarded write; a no-record return is a no-op).

const CID = "60a1b2c3d4e5f60718293a4b";
const NOW = new Date("2026-10-14T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const lot = (id: string, value: number, daysLeft: number, pointsSpent = 0): RewardCardSnapshot =>
  ({
    id, kind: "points", status: "revealed", value, pointsSpent, scratchBy: new Date(NOW.getTime() - DAY),
    validUntil: new Date(NOW.getTime() + daysLeft * DAY),
  }) as RewardCardSnapshot;

const ON = { dinerAccountsEnabled: true } as unknown as ISettings;
const OFF = { dinerAccountsEnabled: false } as unknown as ISettings;
// Levels OFF must NOT matter to points (predicate 3): only dinerAccountsOn gates.
const LEVELS_OFF = { dinerAccountsEnabled: true, rewardLevelsEnabled: false } as unknown as ISettings;

interface Calls {
  reads: number;
  writes: { filter: Record<string, unknown>; update: Record<string, unknown>; arrayFilters: Record<string, unknown>[] }[];
}
function fake(states: (PointsState | null)[], matched: number[]): { deps: PointsSpendDeps; calls: Calls } {
  const calls: Calls = { reads: 0, writes: [] };
  const deps: PointsSpendDeps = {
    readState: async () => states[Math.min(calls.reads++, states.length - 1)],
    now: () => NOW,
    updatePoints: async (filter, update, arrayFilters) => {
      calls.writes.push({ filter, update, arrayFilters });
      return { matchedCount: matched[Math.min(calls.writes.length - 1, matched.length - 1)] };
    },
  };
  return { deps, calls };
}
const wallet = (...cards: RewardCardSnapshot[]): PointsState => ({ rewardCards: cards, pointsSpends: [] });
const input = (over: Partial<Parameters<typeof resolvePointsSpend>[0]> = {}) => ({
  settings: ON, customerId: CID, points: 50, subtotal: 200, now: NOW, ...over,
});

// ── resolvePointsSpend ───────────────────────────────────────────────────────

test("resolve: usable points -> the flat reward + the n and clock the claim will use; nothing written", async () => {
  const { deps, calls } = fake([wallet(lot("a", 80, 5))], [1]);
  const r = await resolvePointsSpend(input(), deps);
  assert.deepEqual(r, { ok: true, n: 50, reward: pointsRedeemedReward(50), now: NOW });
  assert.equal(calls.writes.length, 0);
});

test("resolve: accounts OFF refuses before any read", async () => {
  const { deps, calls } = fake([wallet(lot("a", 80, 5))], [1]);
  const r = await resolvePointsSpend(input({ settings: OFF }), deps);
  assert.deepEqual(r, { ok: false, message: POINTS_NOT_ENOUGH, status: 400 });
  assert.equal(calls.reads, 0);
});

test("resolve: gate order - a customer, then the bill ceiling (neither reads the wallet), then the balance", async () => {
  const { deps, calls } = fake([wallet(lot("a", 80, 5))], [1]);
  assert.deepEqual(await resolvePointsSpend(input({ customerId: undefined }), deps), { ok: false, message: POINTS_NEED_CUSTOMER, status: 400 });
  assert.deepEqual(await resolvePointsSpend(input({ points: 201 }), deps), { ok: false, message: POINTS_OVER_BILL, status: 400 });
  assert.equal(calls.reads, 0, "the first gates never read the wallet");
  assert.deepEqual(await resolvePointsSpend(input({ points: 90, subtotal: 500 }), deps), { ok: false, message: POINTS_NOT_ENOUGH, status: 409 });
  assert.equal(calls.reads, 1);
});

test("resolve: exactly the balance is allowed; one more is refused (never a clamp)", async () => {
  const { deps } = fake([wallet(lot("a", 80, 5))], [1]);
  assert.equal((await resolvePointsSpend(input({ points: 80 }), deps)).ok, true);
  assert.equal((await resolvePointsSpend(input({ points: 81 }), deps)).ok, false);
});

test("resolve: Reward Levels OFF still spends (a held lot stays usable; only dinerAccountsOn gates)", async () => {
  const { deps } = fake([wallet(lot("a", 80, 5))], [1]);
  assert.equal((await resolvePointsSpend(input({ settings: LEVELS_OFF }), deps)).ok, true);
});

test("resolve: expired lots do not count; an unknown customer reads as no points", async () => {
  const { deps } = fake([wallet(lot("old", 80, -1))], [1]);
  assert.deepEqual(await resolvePointsSpend(input(), deps), { ok: false, message: POINTS_NOT_ENOUGH, status: 409 });
  const none = fake([null], [1]);
  assert.equal((await resolvePointsSpend(input(), none.deps)).ok, false);
});

test("resolve: a non-whole or non-positive n is refused before any read", async () => {
  const { deps, calls } = fake([wallet(lot("a", 80, 5))], [1]);
  assert.equal((await resolvePointsSpend(input({ points: 0 }), deps)).ok, false);
  assert.equal((await resolvePointsSpend(input({ points: 2.5 }), deps)).ok, false);
  assert.equal(calls.reads, 0);
});

// ── spendPoints ──────────────────────────────────────────────────────────────

test("spend: read -> plan -> ONE guarded write, true when it matched", async () => {
  const { deps, calls } = fake([wallet(lot("b", 100, 9), lot("a", 30, 1))], [1]);
  assert.equal(await spendPoints(CID, "ORD-1", 50, NOW, deps), true);
  assert.equal(calls.writes.length, 1);
  const [w] = calls.writes;
  assert.equal(w.filter._id, CID);
  assert.deepEqual(w.arrayFilters, [{ "p0.id": "a" }, { "p1.id": "b" }], "FIFO: the lot expiring first is taken first");
});

test("spend: a miss re-reads and RE-PLANS from the new wallet, then lands", async () => {
  const first = wallet(lot("a", 100, 1));
  const second = wallet(lot("a", 100, 1, 70)); // a concurrent spend moved pointsSpent
  const { deps, calls } = fake([first, second], [0, 1]);
  assert.equal(await spendPoints(CID, "ORD-1", 20, NOW, deps), true);
  assert.equal(calls.reads, 2);
  assert.equal(calls.writes.length, 2);
  const filter = calls.writes[1].filter as { rewardCards: { $all: { $elemMatch: { pointsSpent: number } }[] } };
  assert.equal(filter.rewardCards.$all[0].$elemMatch.pointsSpent, 70, "the second attempt guards on the NEW pointsSpent");
});

test("spend: gives up (false) after REWARD_PROGRESS_CAS_ATTEMPTS misses", async () => {
  const { deps, calls } = fake([wallet(lot("a", 100, 1))], [0]);
  assert.equal(await spendPoints(CID, "ORD-1", 20, NOW, deps), false);
  assert.equal(calls.writes.length, REWARD_PROGRESS_CAS_ATTEMPTS);
});

test("spend: lots that went short on the re-read -> false at once (never a smaller spend)", async () => {
  const { deps, calls } = fake([wallet(lot("a", 100, 1)), wallet(lot("a", 100, 1, 95))], [0]);
  assert.equal(await spendPoints(CID, "ORD-1", 20, NOW, deps), false);
  assert.equal(calls.writes.length, 1, "no write for a plan that no longer exists");
});

test("spend: an UNRETURNED record for this order already exists -> false without a write (the fence would never match)", async () => {
  const state: PointsState = { rewardCards: [lot("a", 100, 1)], pointsSpends: [{ orderId: "ORD-1", at: NOW, lots: [{ id: "a", take: 5 }] }] };
  const { deps, calls } = fake([state], [1]);
  assert.equal(await spendPoints(CID, "ORD-1", 20, NOW, deps), false);
  assert.equal(calls.writes.length, 0);
});

test("spend: a RETURNED record for this order does not block a retry with the same orderId", async () => {
  const state: PointsState = {
    rewardCards: [lot("a", 100, 1)],
    pointsSpends: [{ orderId: "ORD-1", at: NOW, lots: [{ id: "a", take: 5 }], returnedAt: NOW }],
  };
  const { deps } = fake([state], [1]);
  assert.equal(await spendPoints(CID, "ORD-1", 20, NOW, deps), true);
});

test("spend: a read or write that THROWS propagates (the caller decides; never a silent false)", async () => {
  const deps: PointsSpendDeps = {
    readState: async () => {
      throw new Error("boom");
    },
    now: () => NOW,
    updatePoints: async () => ({ matchedCount: 1 }),
  };
  await assert.rejects(() => spendPoints(CID, "ORD-1", 20, NOW, deps), /boom/);
});

// ── returnPoints ─────────────────────────────────────────────────────────────

const spentState = (): PointsState => ({
  rewardCards: [lot("a", 40, 3, 40)],
  pointsSpends: [{ orderId: "ORD-1", at: NOW, lots: [{ id: "a", take: 40 }] }],
});

test("return: pre-read the record + wallet, then ONE guarded write; true when it matched", async () => {
  const { deps, calls } = fake([spentState()], [1]);
  assert.equal(await returnPoints(CID, "ORD-1", deps), true);
  assert.equal(calls.writes.length, 1);
  assert.deepEqual(calls.writes[0].arrayFilters, [{ "p0.id": "a" }]);
  assert.deepEqual(calls.writes[0].filter, {
    _id: CID,
    pointsSpends: { $elemMatch: { orderId: "ORD-1", returnedAt: { $exists: false } } },
  });
});

test("return: no record for this order (or already returned) -> false and NO write (a no-op)", async () => {
  const none = fake([wallet(lot("a", 40, 3))], [1]);
  assert.equal(await returnPoints(CID, "ORD-1", none.deps), false);
  assert.equal(none.calls.writes.length, 0);
  const done: PointsState = {
    rewardCards: [],
    pointsSpends: [{ orderId: "ORD-1", at: NOW, lots: [{ id: "a", take: 1 }], returnedAt: NOW }],
  };
  const again = fake([done], [1]);
  assert.equal(await returnPoints(CID, "ORD-1", again.deps), false);
  assert.equal(again.calls.writes.length, 0);
});

test("return: a lost race (the write matched 0) is false; an unknown customer is false", async () => {
  const { deps } = fake([spentState()], [0]);
  assert.equal(await returnPoints(CID, "ORD-1", deps), false);
  const gone = fake([null], [1]);
  assert.equal(await returnPoints(CID, "ORD-1", gone.deps), false);
});
