import { randomBytes, randomInt } from "node:crypto";

import { REWARD_CARD_ID_HEX_LEN } from "@pos/shared/reward-levels";
import type { RewardRng } from "@pos/shared/reward-levels-engine";

// CB-7 S1 — the ONLY randomness the reward engine sees: node:crypto, never the non-secure JS generator. A scratch
// card's outcome is rolled once at issue, so a guessable generator would let a diner predict the next card.
// Server-only by nature (node:crypto) — the pure engine takes the generator as an argument, so tests inject a
// fixed one.

// rng(n) = a uniform integer in [0, n) — exactly the contract RewardRng states.
export const cryptoRng: RewardRng = (maxExclusive) => randomInt(maxExclusive);

// A card's id: REWARD_CARD_ID_HEX_LEN lowercase hex chars (6 random bytes -> 12 hex), matching REWARD_CARD_ID_RE.
export function newRewardCardId(): string {
  return randomBytes(REWARD_CARD_ID_HEX_LEN / 2).toString("hex");
}
