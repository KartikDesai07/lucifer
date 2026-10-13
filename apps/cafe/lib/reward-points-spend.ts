import { REWARD_PROGRESS_CAS_ATTEMPTS } from "@pos/shared/reward-levels";
import { pointsBalance } from "@pos/shared/reward-levels-engine";
import {
  POINTS_NEED_CUSTOMER,
  POINTS_NOT_ENOUGH,
  POINTS_OVER_BILL,
  pointsRedeemedReward,
} from "@pos/shared/reward-points";
import { planPointsSpend } from "@pos/shared/reward-points-plan";
import type { RedeemedReward } from "@pos/shared/reward-redemption";
import { Customer } from "@/models/Customer";
import type { ISettings } from "@/models/Settings";
import { dinerAccountsOn } from "@/lib/diner-route-guard";
import { readPointsStateOf, type PointsState } from "@/lib/reward-cards-read";
import { pointsReturnFilter, pointsReturnUpdate, pointsSpendFilter, pointsSpendUpdate } from "@/lib/reward-points-cas";

// CB-7 S6 (§2.7) — the IO half of spending reward POINTS on a bill (1 point = Rs 1): resolve (read-only), spend, return.
// The pure shapes are lib/reward-points-cas.ts, the lot plan is @pos/shared/reward-points-plan. SERVER-ONLY (Customer
// model; registered in client-graph-guard.test.ts).
//
// GATE (plan 2.11, predicate 3): points a diner ALREADY holds stay spendable while scratch is blocked or the levels are
// switched off — the chance happened at the reveal. So this file asks only `dinerAccountsOn` plus the wallet itself, and
// must NEVER call rewardLevelsEarning / scratchCardsBlockedFor (source-pinned).
//
// CONTRACT (the writers, slice B, and the live leg call exactly these):
//   resolvePointsSpend({ settings, customerId, points, subtotal, now }, deps?) -> { ok: true, n, reward, now }
//       | { ok: false, message, status: 400 | 409 }.   READ-ONLY. `points` is exactly what the client asked for
//       (all usable points up to the food total, owner O3); `subtotal` is the bill's food total BEFORE any reward, in
//       rupees. The server spends exactly N or refuses: there is NO clamp. `now` is the ONE clock reading the spend
//       (and a renumber retry's re-spend) must reuse.
//   spendPoints(customerId, orderId, n, now, deps?) -> boolean.   read -> plan -> ONE guarded write, a miss re-reads and
//       re-plans up to REWARD_PROGRESS_CAS_ATTEMPTS times. true = spent; false = NOT spent (short lots, a concurrent
//       spend won every attempt, or an unreturned record of this orderId already exists). It never spends less than n.
//       Read / write errors PROPAGATE (the caller's 500; points stay as they are).
//   returnPoints(customerId, orderId, deps?) -> boolean.   pre-read the record + wallet, then ONE guarded write that
//       marks the record returned and restores every lot still in the wallet. true = returned; false = nothing to
//       return (no unreturned record, evicted, lost race). May throw: the caller decides (cancel swallows; the create /
//       settle paths call it ONLY on a definite non-write — a CAS miss, E11000, the slip failure — never on an unknown throw).

// The seam the tests fake: the wallet read, the one guarded write, and the clock a return stamps with.
export interface PointsSpendDeps {
  readState(customerId: string): Promise<PointsState | null>;
  updatePoints(
    filter: Record<string, unknown>,
    update: Record<string, unknown>,
    arrayFilters: Record<string, unknown>[],
  ): Promise<{ matchedCount: number }>;
  now: () => Date;
}

export const POINTS_SPEND_DEPS: PointsSpendDeps = {
  readState: readPointsStateOf,
  // `arrayFilters` goes only when there is one: an unused arrayFilters option is a server error.
  updatePoints: async (filter, update, arrayFilters) => {
    const res = await Customer.updateOne(filter, update, arrayFilters.length > 0 ? { arrayFilters } : undefined);
    return { matchedCount: res.matchedCount };
  },
  now: () => new Date(),
};

export interface ResolvePointsSpendInput {
  settings: ISettings | null;
  customerId: string | undefined;
  // Exactly what the client asked to spend (whole points).
  points: number;
  // The bill's food total BEFORE any reward, in RUPEES.
  subtotal: number;
  now: Date;
}

export type PointsSpendResolution =
  | { ok: true; n: number; reward: RedeemedReward; now: Date }
  | { ok: false; message: string; status: 400 | 409 };

const refuse = (message: string, status: 400 | 409): { ok: false; message: string; status: 400 | 409 } => ({
  ok: false,
  message,
  status,
});

/**
 * Can this bill spend exactly `points`? Gates in order: diner accounts on, a whole positive N, a customer, N within the
 * food total (400), the balance covers N (409). Nothing is written. Read errors PROPAGATE.
 */
export async function resolvePointsSpend(
  input: ResolvePointsSpendInput,
  deps: PointsSpendDeps = POINTS_SPEND_DEPS,
): Promise<PointsSpendResolution> {
  if (!dinerAccountsOn(input.settings)) return refuse(POINTS_NOT_ENOUGH, 400);
  if (!Number.isInteger(input.points) || input.points <= 0) return refuse(POINTS_NOT_ENOUGH, 400);
  if (!input.customerId) return refuse(POINTS_NEED_CUSTOMER, 400);
  if (input.points > Math.floor(input.subtotal)) return refuse(POINTS_OVER_BILL, 400);

  const state = await deps.readState(input.customerId);
  if (!state || pointsBalance(state.rewardCards, input.now) < input.points) return refuse(POINTS_NOT_ENOUGH, 409);
  return { ok: true, n: input.points, reward: pointsRedeemedReward(input.points), now: input.now };
}

// An UNRETURNED record for this order: the spend fence would never match, so there is nothing to retry.
const holdsOpenRecord = (state: PointsState, orderId: string): boolean =>
  state.pointsSpends.some((r) => r.orderId === orderId && r.returnedAt === undefined);

/** Spend exactly `n` points for `orderId`. The result MUST be checked: false = not spent. See the CONTRACT above. */
export async function spendPoints(
  customerId: string,
  orderId: string,
  n: number,
  now: Date,
  deps: PointsSpendDeps = POINTS_SPEND_DEPS,
): Promise<boolean> {
  for (let attempt = 0; attempt < REWARD_PROGRESS_CAS_ATTEMPTS; attempt++) {
    // The read only supplies the plan; the filter re-checks every lot atomically, so a stale plan simply misses.
    const state = await deps.readState(customerId);
    if (!state || holdsOpenRecord(state, orderId)) return false;
    const plan = planPointsSpend(state.rewardCards, n, now);
    if (!plan) return false; // the lots went short: refuse, never spend less
    const { update, arrayFilters } = pointsSpendUpdate(orderId, plan, now);
    const res = await deps.updatePoints(pointsSpendFilter(customerId, orderId, plan, now), update, arrayFilters);
    if (res.matchedCount > 0) return true;
  }
  return false;
}

/** Give `orderId`'s points back (restoring the exact lots it took from). May throw. See the CONTRACT above. */
export async function returnPoints(
  customerId: string,
  orderId: string,
  deps: PointsSpendDeps = POINTS_SPEND_DEPS,
): Promise<boolean> {
  const state = await deps.readState(customerId);
  const record = state?.pointsSpends.find((r) => r.orderId === orderId && r.returnedAt === undefined);
  if (!state || !record) return false;
  const { update, arrayFilters } = pointsReturnUpdate(record.lots, state.rewardCards, deps.now());
  const res = await deps.updatePoints(pointsReturnFilter(customerId, orderId), update, arrayFilters);
  return res.matchedCount > 0;
}
