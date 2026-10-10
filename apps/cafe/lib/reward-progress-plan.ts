import mongoose from "mongoose";

import type { ISettings } from "@/models/Settings";
import { rewardLevelsEarning, resolveRewardLevels } from "@/lib/reward-levels-config";
import {
  REWARD_CARDS_KEEP,
  REWARD_CARD_STEP_ORDERS_MAX,
  type RewardCardSnapshot,
  type RewardLevelsConfig,
} from "@pos/shared/reward-levels";
import { billCountsForLevels, buildCardSnapshot, positionOf, slotAt, type RewardRng } from "@pos/shared/reward-levels-engine";

// CB-7 S2 — the PURE half of "one counted bill moves one diner one step" (plan sections 2.3 and 2.4). No DB, no
// clock, no randomness of its own: the clock and the generator arrive as arguments and the environment arrives as a
// parameter, so every branch is table-testable. lib/reward-progress.ts is the IO half that runs this plan.
// SERVER-ONLY: it reads settings through lib/reward-levels-config.ts, which is registered SERVER_ONLY in
// client-graph-guard.test.ts. It imports mongoose only for the pure isValidObjectId check.

export type ProgressGateSkip = "levels-off" | "no-customer" | "below-min-bill";
export type ProgressReadSkip = "no-row" | "not-anchored" | "before-anchor";
export type ProgressMissSkip = "already-counted" | "unexplained-miss" | "contended";
export type ProgressSkipReason = ProgressGateSkip | ProgressReadSkip | ProgressMissSkip;

export type ProgressGate =
  | { ok: true; cfg: RewardLevelsConfig; customerId: string }
  | { ok: false; reason: ProgressGateSkip };

// Everything that can be decided BEFORE touching the database, cheapest first: the feature is earning (accounts on,
// the owner chose levels, the blob parses, nothing blocks scratch cards), the bill belongs to a real customer row,
// and the bill reaches the owner's minimum. A walk-in bill is the common case and must cost zero reads.
export function progressGate(
  settings: ISettings | null,
  customerId: string | null | undefined,
  billTotal: number,
  env: NodeJS.ProcessEnv = process.env,
): ProgressGate {
  if (!rewardLevelsEarning(settings, env)) return { ok: false, reason: "levels-off" };
  if (!customerId || !mongoose.isValidObjectId(customerId)) return { ok: false, reason: "no-customer" };
  // rewardLevelsEarning already proved the blob parses, so this is never null here — but the type must say so,
  // and a null must stop the step rather than throw (the caller swallows, yet a quiet skip is cheaper).
  const cfg = resolveRewardLevels(settings);
  if (!cfg) return { ok: false, reason: "levels-off" };
  if (!billCountsForLevels(billTotal, cfg)) return { ok: false, reason: "below-min-bill" };
  return { ok: true, cfg, customerId };
}

// The pre-read projection is "cardSteps rewardsAnchorAt pinSetAt" — NEVER pinHash. A PIN set writes pinHash and
// pinSetAt together and the staff reset unsets both, so pinSetAt is the existence proxy for "this diner holds a PIN";
// the credential itself (select:false) never enters this module. The CAS filter below still checks pinHash.
export interface ProgressRead {
  cardSteps?: number | null;
  rewardsAnchorAt?: Date | null;
  pinSetAt?: Date | null;
}

// Plan 2.3 (B7): the moment counting began for this diner — the stored anchor, else the PIN date of a diner who
// held a PIN before anchors existed, else never (a diner with no PIN and no anchor is not in the programme).
export function effectiveAnchor(read: ProgressRead): Date | null {
  return read.rewardsAnchorAt ?? read.pinSetAt ?? null;
}

export interface ProgressStepPlan {
  t0: number; // cardSteps before this step (absent/null counts as 0)
  n: number; // t0 + 1 — the lifetime step this bill earns
  card: RewardCardSnapshot | null; // null when that step has no box (the owner left it without a reward)
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
}

export interface PlanProgressInput {
  read: ProgressRead;
  cfg: RewardLevelsConfig;
  customerId: string;
  orderId: string;
  orderCreatedAt: Date;
  now: Date;
  rng: RewardRng;
  newCardId: () => string;
}

// Builds the ONE guarded update for this bill. The roll happens here, before the write, on purpose: a losing CAS
// simply discards the card (nothing scarce was allocated and nothing was shown to anyone), so rolling first cannot
// be fished by retrying.
export function planProgressStep(input: PlanProgressInput): ProgressStepPlan | { skip: "not-anchored" | "before-anchor" } {
  const { read, cfg, customerId, orderId, orderCreatedAt } = input;

  const anchor = effectiveAnchor(read);
  if (!anchor) return { skip: "not-anchored" };
  // R1: a bill placed BEFORE the anchor never counts; the equal instant does.
  if (orderCreatedAt.getTime() < anchor.getTime()) return { skip: "before-anchor" };

  const t0 = read.cardSteps ?? 0;
  const n = t0 + 1;
  const pos = positionOf(n, cfg.levels);
  const slot = pos ? slotAt(cfg.levels, pos) : null;
  const card =
    pos && slot
      ? buildCardSnapshot({
          id: input.newCardId(),
          issueKey: `step:${String(n)}`,
          source: "level",
          level: pos.levelIndex + 1,
          step: pos.step,
          slot,
          rng: input.rng,
          now: input.now,
        })
      : null;

  const filter: Record<string, unknown> = {
    _id: customerId,
    // THE idempotency guard (build-rule #60): the marker is in the FILTER, so the sibling $inc is conditional.
    cardStepOrders: { $ne: orderId },
    // THE step key: only the bill that sees the counter at t0 may move it to t0 + 1, so each lifetime step is
    // earned (and each card issued) exactly once. A counter that was never written is null/absent, not 0.
    cardSteps: t0 === 0 ? { $in: [null, 0] } : t0,
    // B7: the bill counts only if it was placed at or after the anchor — the stored one, or (lazily) the PIN date.
    // pinHash is checked here, in the filter, because the pre-read never projects it.
    $or: [
      { rewardsAnchorAt: { $lte: orderCreatedAt } },
      { rewardsAnchorAt: { $exists: false }, pinHash: { $exists: true }, pinSetAt: { $lte: orderCreatedAt } },
    ],
  };

  const update: Record<string, unknown> = {
    $inc: { cardSteps: 1 },
    // Lazy anchor at the PIN date (B7): a no-op when already anchored, and $min can never move it later.
    $min: { rewardsAnchorAt: anchor },
    $push: {
      // $push + $slice, not $addToSet: the filter gives set semantics and only $slice can bound the array.
      cardStepOrders: { $each: [orderId], $slice: -REWARD_CARD_STEP_ORDERS_MAX },
      // Sorted by keepUntil so the cards that stopped mattering earliest are the ones the slice drops.
      ...(card ? { rewardCards: { $each: [card], $sort: { keepUntil: 1 }, $slice: -REWARD_CARDS_KEEP } } : {}),
    },
  };

  return { t0, n, card, filter, update };
}
