// CB-7 S4 — the diner's scratch-card wallet over the wire (plan §2.2 allowlist, §2.5 scratch, §2.10 diner UI, F14).
// PURE, client-safe: endpoints, DTO types and plain-English copy. Dates are epoch milliseconds (the /me precedent).
// Imported by path (`@pos/shared/public-diner-cards`), never through the barrel.

import type { CardState, RewardCardSource, RewardOptionKind } from "./reward-levels";

export const DINER_CARDS_ENDPOINT = "/api/public/diner/cards";

export function dinerScratchPath(id: string): string {
  return `${DINER_CARDS_ENDPOINT}/${encodeURIComponent(id)}/scratch`;
}

// One choice inside a box, as the diner sees the odds (F7/F14). Built from the CONFIG label, never a rolled value.
export interface DinerPoolChoice {
  kind: RewardOptionKind;
  label: string;
  chance: number; // whole percent; a box's chances add up to exactly 100
}

// A card whose STORED status is "ready" — including one past its scratch-by date. This is an ALLOWLIST (§2.2 s86
// A11/B5): the outcome (option, kind, value, product/category, caps, min bill) is NEVER on it. `state` and the pool's
// `chance` are derived from data the diner may already see. Pinned key-for-key by DINER_READY_CARD_KEYS.
export interface DinerReadyCardDto {
  id: string;
  source: RewardCardSource;
  level?: number;
  step?: number;
  issuedAt: number;
  scratchBy: number;
  status: "ready";
  state: "ready" | "expired";
  pool: DinerPoolChoice[];
}

export const DINER_READY_CARD_KEYS = [
  "id",
  "source",
  "level",
  "step",
  "issuedAt",
  "scratchBy",
  "status",
  "state",
  "pool",
] as const satisfies readonly (keyof DinerReadyCardDto)[];

// What a scratched card holds. `label` is the plain-English reward ("12% off the bill"); `condition` is the cap /
// minimum-bill sentence, null when there is none; `pointsLeft` only on a points card.
export interface DinerOutcomeDto {
  kind: RewardOptionKind;
  value: number;
  label: string;
  condition: string | null;
  pointsLeft?: number;
}

export interface DinerRevealedCardDto {
  id: string;
  source: RewardCardSource;
  level?: number;
  step?: number;
  issuedAt: number;
  scratchBy: number;
  status: "revealed" | "used";
  state: CardState;
  pool: DinerPoolChoice[];
  revealedAt?: number;
  validUntil?: number;
  usedAt?: number;
  outcome: DinerOutcomeDto;
}

export type DinerCardDto = DinerReadyCardDto | DinerRevealedCardDto;

// Where the diner stands: Level `level` of `levelCount` (1-based), `filled` of `size` boxes done; `round` counts
// re-runs of the repeating last level (F5; 0 on the first pass). `nextBox` = the box (1-based level + step) the
// next card comes from — computed by the engine's positionOf on the server, because boxes sit on any step and the
// next one may be in a later level (s90 review B1); null when no box lies ahead.
export interface DinerLevelProgress {
  level: number;
  levelCount: number;
  round: number;
  size: number;
  filled: number;
  stepsToNextCard: number | null;
  nextBox: { level: number; step: number } | null;
}

export interface DinerLadderBox {
  step: number;
  choices: DinerPoolChoice[];
  everyCardWins: boolean;
}

export interface DinerLadderLevel {
  level: number;
  size: number;
  boxes: DinerLadderBox[];
}

// GET /api/public/diner/cards. `progress` + `ladder` exist only while the cafe is EARNING (§2.11 predicate 2);
// the wallet and the points balance always follow the diner's own cards (predicate 3).
export interface DinerCardsData {
  earning: boolean;
  progress: DinerLevelProgress | null;
  ladder: DinerLadderLevel[] | null;
  cards: DinerCardDto[];
  pointsBalance: number;
}

// POST /api/public/diner/cards/[id]/scratch.
export interface DinerScratchData {
  card: DinerCardDto;
}

// F14 / F9: "Every card has a reward" may be said ONLY when no choice in the box is "No reward".
export function everyCardWins(kinds: readonly RewardOptionKind[]): boolean {
  return kinds.length > 0 && !kinds.includes("none");
}

// ── Diner-facing copy (plain English, never a cafe name) ─────────────────────────────────────────────────────────
// ONE refusal for an expired card, an unknown id and another diner's card — telling them apart would be an oracle.
export const CARD_NOT_SCRATCHABLE = "This card can't be scratched.";
export const SCRATCH_PAUSED = "Scratch cards are paused right now.";
export const SCRATCH_BUSY = "Couldn't open your card just now. Please try again.";
export const SCRATCH_OFFLINE = "Couldn't reach the cafe. Check your internet and try again.";
export const CARDS_SIGN_IN = "Sign in to see your scratch cards.";
export const CARDS_LOAD_FAILED = "Couldn't load your cards. Pull down or try again.";
export const EVERY_CARD_WINS = "Every card has a reward.";
export const CARD_TERMS =
  "The reward is fixed when the card is given to you; the chances are shown above. One reward per bill. " +
  "It can't be exchanged for cash.";
export const POINTS_RULE = "1 point = ₹1 off a later bill.";

export const CARD_STATE_WORDS: Readonly<Record<CardState | "locked", string>> = {
  locked: "Locked",
  ready: "Ready to scratch",
  revealed: "Revealed",
  used: "Used",
  expired: "Expired",
};
