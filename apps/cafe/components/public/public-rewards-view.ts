import { inr } from "@/lib/utils";
import type { DinerStampCard } from "@/lib/diner-loyalty";
import type { LoyaltyRewardKind } from "@pos/shared/loyalty-rules";

// CB-6D-B — pure copy + track-geometry helpers for the Rewards tab (the
// owner's horizontal progress bar with milestone markers). Zero React here,
// same discipline as public-ui.ts: every Rewards file that needs the plural
// noun, a reward's "worth" sentence, the hero's one footer line or the
// track's marker layout imports it from HERE — this is the single home for
// all four so PublicStampCard/PublicRewardLadder/PublicRewardsTab/
// PublicRewardCodes/PublicStampTrack never re-derive them.

const PERCENT_PRECISION = 100;

export function unitWord(count: number, unitLabel: string): string {
  return count === 1 ? unitLabel : `${unitLabel}s`;
}

// MOVED from PublicRewardLadder.tsx (CB-6C) — body unchanged.
export function rewardWorth(reward: { kind: LoyaltyRewardKind; value: number; item: string }): string {
  const { kind, value, item } = reward;
  if (kind === "item") return item.length > 0 ? item : "a free item";
  if (kind === "percent") return `${value}% off your bill`;
  return `${inr(value)} off your bill`;
}

// The hero's ONE "what's next" footer sentence. `null` means the hero shows
// no footer at all — the guided empty-ladder branch on PublicRewardsTab
// speaks instead, so this never duplicates that copy.
export function nextRewardLine(card: DinerStampCard): string | null {
  if (card.ladder.length === 0) return null;

  if (card.rewardsReady > 1) return `${card.rewardsReady} rewards ready`;
  if (card.rewardsReady === 1) return "1 reward ready";

  if (card.ladder.length > 1) {
    const next = card.ladder.find((milestone) => milestone.at > card.cyclePosition);
    if (next) {
      const toNext = next.at - card.cyclePosition;
      const lead = toNext === 1 ? "one more" : `${toNext} more`;
      return `${lead} ${unitWord(toNext, card.unitLabel)} to ${rewardWorth(next)}`;
    }
    // End of the cycle — no further milestone ahead of cyclePosition; fall
    // back to the card's own toNextReward/reward (the next cycle's first
    // reward), same wording as the flat branch below.
    const lead = card.toNextReward === 1 ? "one more" : `${card.toNextReward} more`;
    return `${lead} ${unitWord(card.toNextReward, card.unitLabel)} to ${rewardWorth(card.reward)}`;
  }

  const lead = card.toNextReward === 1 ? "one more" : `${card.toNextReward} more`;
  return `${lead} ${unitWord(card.toNextReward, card.unitLabel)} to ${rewardWorth(card.reward)}`;
}

// F1 (CB-6D-B review fix, HIGH) — the hero was fed the showFull-adjusted
// `position` while the rewards LIST was fed the raw `card.cyclePosition`, so
// a diner who completed their card saw two different progress numbers on the
// same screen. Single home for the filled/position derivation so both call
// sites (PublicRewardsTab's hero AND its list) read the SAME pair.
export function cardProgress(card: DinerStampCard): { filled: number; position: number } {
  const filled = card.stampsPerReward > 0 ? card.stamps % card.stampsPerReward : 0;
  const showFull = card.rewardsReady > 0 && filled === 0;
  return {
    filled: showFull ? card.stampsPerReward : filled,
    position: showFull ? card.stampsPerReward : card.cyclePosition,
  };
}

// F1 — the server's own eligibility test (lib/reward-claim.ts decideRedemption
// / claimRewardStamps: `stamps: { $gte: cost }`) decides on the diner's TOTAL
// stamp balance, never the current cycle's display position. The ladder list
// must gate its claim control on THIS, not on `milestone.at <= cyclePosition`
// (that comparison stays for the display tick only — see PublicRewardLadder).
// minBill / claim-window checks stay server-side, surfaced by the existing
// 422 revert on a rejected claim.
export function ladderRungAffordable(stamps: number, at: number): boolean {
  return Number.isFinite(stamps) && stamps >= at;
}

export interface TrackMarker {
  at: number;
  leftPercent: number;
  reached: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// Rounds to 2 decimals — enough precision for a CSS percentage, stable
// across re-renders (no float jitter in a snapshot/pin).
function roundPercent(value: number): number {
  return Math.round(value * PERCENT_PRECISION) / PERCENT_PRECISION;
}

// The owner's horizontal bar geometry: fill percent + each milestone marker's
// left-offset percent, both clamped to [0, 100]. Pure — never mutates
// `milestones`, never throws on a degenerate cycleLength or a NaN/negative
// position (both read as 0 fill).
export function trackGeometry(
  cycleLength: number,
  position: number,
  milestones: readonly { at: number }[],
): { fillPercent: number; markers: TrackMarker[] } {
  if (cycleLength <= 0) return { fillPercent: 0, markers: [] };

  const safePosition = Number.isFinite(position) && position > 0 ? position : 0;
  const fillPercent = roundPercent(clamp((safePosition / cycleLength) * 100, 0, 100));
  const markers: TrackMarker[] = milestones.map((milestone) => ({
    at: milestone.at,
    leftPercent: roundPercent(clamp((milestone.at / cycleLength) * 100, 0, 100)),
    reached: milestone.at <= safePosition,
  }));

  return { fillPercent, markers };
}

// F4 (CB-6D-B review fix, MEDIUM) — "Fill the card to unlock a reward" was
// false for a ladder cafe, where rewards unlock at intermediate rungs, not
// only when the card is completely full. This wording is true for both flat
// and ladder mode, so it needs no props/mode branch.
export const HOW_IT_WORKS_STEPS = [
  "Pay for your order",
  "A stamp is added to your card",
  "Collect enough stamps and a reward unlocks",
] as const;
