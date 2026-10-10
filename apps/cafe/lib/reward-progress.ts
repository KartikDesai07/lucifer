import { REWARD_PROGRESS_CAS_ATTEMPTS } from "@pos/shared/reward-levels";
import type { RewardRng } from "@pos/shared/reward-levels-engine";
import { Customer } from "@/models/Customer";
import type { ISettings } from "@/models/Settings";
import { planProgressStep, progressGate, type ProgressRead, type ProgressSkipReason } from "@/lib/reward-progress-plan";
import { cryptoRng, newRewardCardId } from "@/lib/reward-rng";

// CB-7 S2 — the IO half of "one counted bill moves one diner one step" (plan section 2.4). The pure half
// (lib/reward-progress-plan.ts) decides what the guarded update looks like; this file reads, runs it, and
// CLASSIFIES a miss. Best-effort like grantStampForSettledOrder: errors PROPAGATE and the caller swallows them —
// a settled bill is the source of truth and a missed step is a counter conversation, never a reason to fail
// money that was taken. SERVER-ONLY (registered in client-graph-guard.test.ts).

export type ProgressResult = { counted: true; cardIssued: boolean } | { counted: false; reason: ProgressSkipReason };

export interface ProgressOrder {
  orderId: string;
  createdAt: Date;
  total: number; // RUPEES — the v1 models/Order.ts shape, same as billTotal for the stamp grant
}

// The seam the tests fake: every database call and every source of time / randomness / environment.
export interface RewardProgressDeps {
  readProgress(customerId: string): Promise<ProgressRead | null>;
  writeStep(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<{ matchedCount: number }>;
  markerHolds(customerId: string, orderId: string): Promise<boolean>;
  rng: RewardRng;
  newCardId: () => string;
  now: () => Date;
  env: NodeJS.ProcessEnv;
}

export const REWARD_PROGRESS_DEPS: RewardProgressDeps = {
  // Projection is EXACTLY these three fields — never pinHash (select:false, a credential). pinSetAt stands in for
  // "holds a PIN": a PIN set writes both together and the reset unsets both.
  readProgress: (customerId) => Customer.findById(customerId).select("cardSteps rewardsAnchorAt pinSetAt").lean(),
  writeStep: async (filter, update) => {
    const res = await Customer.updateOne(filter, update);
    return { matchedCount: res.matchedCount };
  },
  // `cardStepOrders` is select:false, which only affects projections — a filter on it still works.
  markerHolds: async (customerId, orderId) => !!(await Customer.exists({ _id: customerId, cardStepOrders: orderId })),
  rng: cryptoRng,
  newCardId: newRewardCardId,
  now: () => new Date(),
  env: process.env,
};

/**
 * Best-effort, exactly-once-per-order progress step for a Completed bill.
 *
 * `order.total` is in RUPEES. Errors PROPAGATE — the caller decides (and must swallow).
 *
 * A CAS miss is CLASSIFIED rather than blindly retried (plan 2.4, review A6): the filter is the guard, and a miss
 * can mean "this bill already counted" (the marker holds — stop), "nothing moved the counter yet the filter still
 * missed" (a retry would miss identically — stop), or "another bill moved cardSteps first" (the only case worth a
 * retry, bounded by REWARD_PROGRESS_CAS_ATTEMPTS). Row gone / diner not anchored / bill older than the anchor are
 * caught by the re-read inside the loop, the same way as on the first attempt.
 */
export async function advanceRewardProgress(
  settings: ISettings | null,
  customerId: string | null | undefined,
  order: ProgressOrder,
  deps: RewardProgressDeps = REWARD_PROGRESS_DEPS,
): Promise<ProgressResult> {
  const gate = progressGate(settings, customerId, order.total, deps.env);
  if (!gate.ok) return { counted: false, reason: gate.reason };

  // ONE clock reading per call: every attempt's card is stamped with the same instant.
  const now = deps.now();
  let lastT0: number | null = null;

  for (let attempt = 0; attempt < REWARD_PROGRESS_CAS_ATTEMPTS; attempt++) {
    // The read is NOT the guard — it only supplies the candidate step key (t0) and the anchor; the filter below
    // re-checks everything atomically.
    const read = await deps.readProgress(gate.customerId);
    if (!read) return { counted: false, reason: "no-row" };

    const plan = planProgressStep({
      read,
      cfg: gate.cfg,
      customerId: gate.customerId,
      orderId: order.orderId,
      orderCreatedAt: order.createdAt,
      now,
      rng: deps.rng,
      newCardId: deps.newCardId,
    });
    if ("skip" in plan) return { counted: false, reason: plan.skip };

    // Same t0 as the attempt that just missed: nothing moved the counter, so the same filter would miss again.
    // Stop instead of burning attempts (and rolling cards) on a miss we cannot explain.
    if (lastT0 !== null && plan.t0 === lastT0) return { counted: false, reason: "unexplained-miss" };

    const res = await deps.writeStep(plan.filter, plan.update);
    if (res.matchedCount > 0) return { counted: true, cardIssued: plan.card !== null };

    // A miss. If the marker holds this order, a twin (replayed settle / Pay-Now) already counted it — done.
    if (await deps.markerHolds(gate.customerId, order.orderId)) return { counted: false, reason: "already-counted" };
    lastT0 = plan.t0;
  }
  return { counted: false, reason: "contended" };
}
