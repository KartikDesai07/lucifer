import type { DinerCardDto } from "@pos/shared/public-diner-cards";
import { REWARD_CARD_ID_RE, type RewardCardSnapshot } from "@pos/shared/reward-levels";
import { cardStateAt, revealPatch, type RewardRevealPatch } from "@pos/shared/reward-levels-engine";
import { Customer } from "@/models/Customer";
import type { ISettings } from "@/models/Settings";
import { cardDtoOf } from "@/lib/reward-cards-view";
import { rewardLevelsEarning } from "@/lib/reward-levels-config";

// CB-7 S4 — the diner's scratch: the ONLY place a stored ready card turns into its revealed outcome (plan 2.5).
// The reveal is a compare-and-set on the card's own row: it matches only while the card is still "ready" AND not
// past its scratch-by instant, so two taps / two phones / a replay can never reveal twice, and an expired card can
// never be opened. SERVER-ONLY (Customer model + the env-reading config; registered in client-graph-guard.test.ts).

// A miss means a twin got there first (or the card went away): re-read once and let the read classify it.
export const SCRATCH_CAS_ATTEMPTS = 2;

export type ScratchResult =
  | { ok: true; card: DinerCardDto }
  | { ok: false; reason: "refused" | "paused" | "busy" };

// The seam the tests fake: both database calls and the two ambient inputs.
export interface RewardScratchDeps {
  // THIS diner's cards (the read is keyed on the session customer's id, so another diner's card id is simply
  // absent), or null when the account is gone.
  readCard(customerId: string): Promise<readonly RewardCardSnapshot[] | null>;
  revealCard(filter: Record<string, unknown>, update: Record<string, unknown>): Promise<{ matchedCount: number }>;
  now: () => Date;
  env: NodeJS.ProcessEnv;
}

export const REWARD_SCRATCH_DEPS: RewardScratchDeps = {
  readCard: async (customerId) => {
    // A bare "+rewardCards" keeps every default field (name, notes, totals...); this form returns only _id, cardSteps and
    // the cards, and keeps the "+" so the pin on where select:false cards are read still sees every reader.
    const row = await Customer.findById(customerId).select("cardSteps +rewardCards").lean();
    return row ? (row.rewardCards ?? []) : null;
  },
  revealCard: async (filter, update) => {
    const res = await Customer.updateOne(filter, update);
    return { matchedCount: res.matchedCount };
  },
  now: () => new Date(),
  env: process.env,
};

// The guard: this diner's row, holding THIS card, still ready, and not past its scratch-by. `$gte` pairs with the
// engine's strict `>` expiry (cardStateAt): the deadline instant itself is still scratchable.
export function scratchFilter(customerId: string, cardId: string, now: Date): Record<string, unknown> {
  return {
    _id: customerId,
    rewardCards: { $elemMatch: { id: cardId, status: "ready", scratchBy: { $gte: now } } },
  };
}

// The write comes ONLY from the engine's revealPatch (what a scratch sets per kind); optional fields stay absent.
export function scratchUpdate(patch: RewardRevealPatch): Record<string, unknown> {
  const set: Record<string, unknown> = {
    "rewardCards.$.status": patch.status,
    "rewardCards.$.revealedAt": patch.revealedAt,
    "rewardCards.$.keepUntil": patch.keepUntil,
  };
  if (patch.validUntil !== undefined) set["rewardCards.$.validUntil"] = patch.validUntil;
  if (patch.usedAt !== undefined) set["rewardCards.$.usedAt"] = patch.usedAt;
  if (patch.pointsSpent !== undefined) set["rewardCards.$.pointsSpent"] = patch.pointsSpent;
  return { $set: set };
}

/**
 * Scratch one of the signed-in diner's cards. Errors PROPAGATE (the route answers a fixed 500).
 *
 * Order matters: a malformed id and a switched-off / blocked cafe are answered BEFORE any database call. Then ONE
 * clock reading feeds every attempt. Each attempt reads this diner's cards, finds the card in code and classifies
 * it: absent (unknown id, another diner's card, an erased card) and expired are one and the same refusal; an
 * already revealed / used card returns its stored outcome with NO write (a replay is idempotent); a ready card
 * gets the guarded write. A matched write returns the revealed card; a miss loops, and the re-read then reports
 * what the winner stored (or that the card is gone). Still missing after the last attempt -> busy.
 */
export async function scratchRewardCard(
  settings: ISettings | null,
  customerId: string,
  cardId: string,
  deps: RewardScratchDeps = REWARD_SCRATCH_DEPS,
): Promise<ScratchResult> {
  if (!REWARD_CARD_ID_RE.test(cardId)) return { ok: false, reason: "refused" };
  if (!rewardLevelsEarning(settings, deps.env)) return { ok: false, reason: "paused" };

  const now = deps.now();
  for (let attempt = 0; attempt < SCRATCH_CAS_ATTEMPTS; attempt++) {
    const cards = await deps.readCard(customerId);
    const card = cards?.find((c) => c.id === cardId);
    if (!card) return { ok: false, reason: "refused" };
    if (card.status !== "ready") return { ok: true, card: cardDtoOf(card, now) };
    if (cardStateAt(card, now) === "expired") return { ok: false, reason: "refused" };

    const patch = revealPatch(card, now);
    const res = await deps.revealCard(scratchFilter(customerId, cardId, now), scratchUpdate(patch));
    if (res.matchedCount > 0) return { ok: true, card: cardDtoOf({ ...card, ...patch }, now) };
  }
  return { ok: false, reason: "busy" };
}
