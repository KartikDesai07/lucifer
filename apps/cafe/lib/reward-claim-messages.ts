// The staff-facing words for a refused reward claim — the ONE copy both the
// server fence (lib/reward-claim.ts, which also funds the claim and therefore
// imports Mongoose models) and the counter's client-side preview
// (lib/reward-rungs.ts → hooks/use-customer-rewards.ts → the POS page) read.
//
// This file exists because of a production incident (2026-09-14): the preview
// value-imported `rewardClaimMessage` from reward-claim.ts, which dragged
// models/Customer.ts into the BROWSER bundle, where `mongoose.models` is
// undefined — every /pos load crashed at module evaluation. The message table
// is pure by nature and only lived in a server module by address; it now lives
// here, with NO imports at all, so it is safe from either side. Keep it that
// way: nothing in this file may import a model, lib/db, or mongoose.
// (lib/client-graph-guard.test.ts pins the whole client import graph.)

export type RewardClaimFailure =
  | "no-customer"
  | "no-such-reward"
  | "ambiguous-reward"
  | "insufficient-stamps"
  | "below-min-bill"
  | "item-not-at-settle"
  | "claim-window-closed";

// Staff-readable words, because these reach a cashier mid-service who has to
// decide what to do next — never a raw enum. Plain English per this repo's
// UI-copy rule (Hinglish is chat-only).
const CLAIM_MESSAGES: Record<RewardClaimFailure, string> = {
  "no-customer": "Select a customer before applying a reward",
  "no-such-reward": "That reward is no longer on the loyalty card",
  "ambiguous-reward": "Two rewards share that stamp count — fix the loyalty ladder in Settings",
  "insufficient-stamps": "Not enough stamps for that reward",
  "below-min-bill": "The bill is too small for that reward",
  "item-not-at-settle": "Add a free dish while taking the order, not at payment",
  // CB-5D part 2 defect fix — staff-facing counterpart of the diner-facing
  // REWARD_CLAIM_WINDOW_CLOSED (@pos/shared/public-promo): the diner's own
  // words ("keep collecting for the next one") fit a card the diner is
  // browsing, not a till screen a cashier reads mid-service — this variant
  // names the actionable fact (the window closed) the way every other row in
  // this table does.
  "claim-window-closed": "That reward's claim window has closed — the stamps are still earned, just past the deadline",
};

export function rewardClaimMessage(reason: RewardClaimFailure): string {
  return CLAIM_MESSAGES[reason];
}
