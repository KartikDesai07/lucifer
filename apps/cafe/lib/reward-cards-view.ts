import {
  everyCardWins,
  type DinerCardDto,
  type DinerCardsData,
  type DinerLadderLevel,
  type DinerLevelProgress,
  type DinerOutcomeDto,
  type DinerPoolChoice,
  type DinerReadyCardDto,
  type DinerRevealedCardDto,
} from "@pos/shared/public-diner-cards";
import {
  REWARD_WEIGHT_DEFAULT,
  type RewardCardSnapshot,
  type RewardLevelsConfig,
  type RewardOption,
  type RewardPoolEntry,
} from "@pos/shared/reward-levels";
import { cardStateAt, pointsBalance, positionOf } from "@pos/shared/reward-levels-engine";
import { optionLabel } from "@pos/shared/reward-levels-label";
import { chancesOf, ladderView } from "@pos/shared/reward-levels-view";
import { inr } from "@pos/shared/utils";

// CB-7 S4 — the PURE half of the diner's scratch-card wallet (plan "Slice B"): a stored card becomes the wire DTO
// the phone sees. Client-safe on purpose: no Mongoose, no DB, no env (registered as NOT server-only in
// reward-paths.test.ts). The security-critical rule lives in cardDtoOf: a card whose STORED status is "ready" is
// built KEY BY KEY from an allowlist and never carries its outcome, even once it is past its scratch-by date —
// the outcome is revealed only by the scratch write, never by a clock.

// A free-dish / product / category card always snapshots its name; this only keeps the label readable if a damaged
// row has none.
const NAME_FALLBACK = "item";

export type CardInput = Pick<
  RewardCardSnapshot,
  | "id"
  | "source"
  | "level"
  | "step"
  | "issuedAt"
  | "scratchBy"
  | "status"
  | "pool"
  | "kind"
  | "value"
  | "productName"
  | "categoryName"
  | "qty"
  | "capRupees"
  | "minBill"
  | "label"
  | "pointsSpent"
  | "revealedAt"
  | "validUntil"
  | "usedAt"
>;

const ms = (d: Date): number => d.getTime();

// The box's odds as the diner sees them: kind + config label + whole-percent chance (adds up to exactly 100).
function poolOf(pool: readonly RewardPoolEntry[]): DinerPoolChoice[] {
  const chances = chancesOf(pool.map((entry) => entry.weight));
  return pool.map((entry, i) => ({ kind: entry.kind, label: entry.label, chance: chances[i] }));
}

// The option a card carries, rebuilt from its snapshot with min = max = the rolled value, so the ONE label
// function (optionLabel) words it the way the owner's config would for that single value.
function optionOf(card: CardInput): RewardOption {
  const base = { id: "", weight: REWARD_WEIGHT_DEFAULT };
  const range = { min: card.value, max: card.value };
  const minBill = card.minBill !== undefined ? { minBill: card.minBill } : {};
  const capRupees = card.capRupees !== undefined ? { capRupees: card.capRupees } : {};
  const productName = card.productName ?? NAME_FALLBACK;
  const categoryName = card.categoryName ?? NAME_FALLBACK;
  switch (card.kind) {
    case "bill-percent":
    case "bill-flat":
      return { ...base, ...range, kind: card.kind, ...minBill };
    case "product-percent":
      return { ...base, ...range, kind: card.kind, productId: "", productName, ...capRupees, ...minBill };
    case "category-percent":
      return { ...base, ...range, kind: card.kind, categoryId: "", categoryName, ...capRupees, ...minBill };
    case "category-flat":
      return { ...base, ...range, kind: card.kind, categoryId: "", categoryName, ...minBill };
    case "free-item":
      return { ...base, kind: card.kind, productId: "", productName, qty: card.qty ?? 1, ...minBill };
    case "points":
      return { ...base, ...range, kind: card.kind };
    case "none":
      return { ...base, kind: card.kind, ...(card.label !== undefined ? { label: card.label } : {}) };
  }
}

// The cap / minimum-bill terms of a revealed reward, one plain sentence, or null when it has neither.
function conditionOf(card: CardInput): string | null {
  const parts: string[] = [];
  if (card.minBill !== undefined && card.minBill > 0) parts.push(`Valid on bills of ${inr(card.minBill)} or more.`);
  if (card.capRupees !== undefined) parts.push(`Discount is capped at ${inr(card.capRupees)}.`);
  return parts.length > 0 ? parts.join(" ") : null;
}

export function outcomeOf(card: CardInput): DinerOutcomeDto {
  return {
    kind: card.kind,
    value: card.value,
    label: optionLabel(optionOf(card)),
    condition: conditionOf(card),
    ...(card.kind === "points" ? { pointsLeft: Math.max(0, card.value - (card.pointsSpent ?? 0)) } : {}),
  };
}

// The ready allowlist, key by key. `level` / `step` only when the card has them (a campaign card has neither).
function readyDtoOf(card: CardInput, now: Date): DinerReadyCardDto {
  return {
    id: card.id,
    source: card.source,
    ...(card.level !== undefined ? { level: card.level } : {}),
    ...(card.step !== undefined ? { step: card.step } : {}),
    issuedAt: ms(card.issuedAt),
    scratchBy: ms(card.scratchBy),
    status: "ready",
    state: cardStateAt(card, now) === "expired" ? "expired" : "ready",
    pool: poolOf(card.pool),
  };
}

function revealedDtoOf(card: CardInput, status: "revealed" | "used", now: Date): DinerRevealedCardDto {
  return {
    id: card.id,
    source: card.source,
    ...(card.level !== undefined ? { level: card.level } : {}),
    ...(card.step !== undefined ? { step: card.step } : {}),
    issuedAt: ms(card.issuedAt),
    scratchBy: ms(card.scratchBy),
    status,
    state: cardStateAt(card, now),
    pool: poolOf(card.pool),
    ...(card.revealedAt ? { revealedAt: ms(card.revealedAt) } : {}),
    ...(card.validUntil ? { validUntil: ms(card.validUntil) } : {}),
    ...(card.usedAt ? { usedAt: ms(card.usedAt) } : {}),
    outcome: outcomeOf(card),
  };
}

// Branches on the STORED status, never on the derived state: an expired-but-unscratched card is still "ready" here,
// so its outcome is never sent.
export function cardDtoOf(card: CardInput, now: Date): DinerCardDto {
  return card.status === "ready" ? readyDtoOf(card, now) : revealedDtoOf(card, card.status, now);
}

// Newest first; two cards issued in the same instant keep a stable order by id.
export function walletOf<T extends Pick<RewardCardSnapshot, "id" | "issuedAt">>(cards: readonly T[]): T[] {
  return [...cards].sort((a, b) => ms(b.issuedAt) - ms(a.issuedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// The box the next card comes from (1-based level + step). stepsToNextCard counts bills ahead, so the card is earned
// on counted bill number cardSteps + stepsToNextCard; positionOf maps that bill number to its level and box. Boxes sit
// on any step, so this can be in a later level (or the repeating last one) - never derived from `filled` arithmetic.
function nextBoxOf(cfg: RewardLevelsConfig, cardSteps: number, stepsToNextCard: number | null): DinerLevelProgress["nextBox"] {
  if (stepsToNextCard === null) return null;
  const pos = positionOf(cardSteps + stepsToNextCard, cfg.levels);
  return pos ? { level: pos.levelIndex + 1, step: pos.step } : null;
}

// Where the diner stands, 1-based. null when the config has nothing to earn.
function progressDtoOf(cfg: RewardLevelsConfig, cardSteps: number): DinerLevelProgress | null {
  const view = ladderView(cfg, cardSteps);
  if (!view.position) return null;
  return {
    level: view.position.levelIndex + 1,
    levelCount: cfg.levels.length,
    round: view.position.repeat,
    size: cfg.levels[view.position.levelIndex].size,
    filled: view.filled,
    stepsToNextCard: view.stepsToNextCard,
    nextBox: nextBoxOf(cfg, cardSteps, view.stepsToNextCard),
  };
}

// Every level and box with its odds, from CONFIG only. Slots are ordered by step exactly as ladderView orders them,
// so the view's labels / chances line up with the sorted slot's option kinds index by index.
function ladderDtoOf(cfg: RewardLevelsConfig, cardSteps: number): DinerLadderLevel[] {
  const view = ladderView(cfg, cardSteps);
  return view.levels.map((level) => {
    const slots = [...cfg.levels[level.levelIndex].slots].sort((a, b) => a.step - b.step);
    return {
      level: level.levelIndex + 1,
      size: level.size,
      boxes: slots.map((slot, i) => ({
        step: slot.step,
        choices: slot.options.map((option, j) => ({
          kind: option.kind,
          label: level.slots[i].labels[j],
          chance: level.slots[i].chances[j],
        })),
        everyCardWins: everyCardWins(slot.options.map((option) => option.kind)),
      })),
    };
  });
}

export interface BuildCardsInput {
  earning: boolean;
  cfg: RewardLevelsConfig | null;
  cardSteps: number;
  cards: readonly RewardCardSnapshot[];
  now: Date;
}

// The whole GET payload. Progress + ladder exist only while the cafe is earning (predicate 2); the wallet and the
// points balance always follow the diner's own cards (predicate 3).
export function buildDinerCardsData(input: BuildCardsInput): DinerCardsData {
  const { earning, cfg, cardSteps, cards, now } = input;
  const live = earning && cfg !== null ? cfg : null;
  return {
    earning: live !== null,
    progress: live ? progressDtoOf(live, cardSteps) : null,
    ladder: live ? ladderDtoOf(live, cardSteps) : null,
    cards: walletOf(cards).map((card) => cardDtoOf(card, now)),
    pointsBalance: pointsBalance(cards, now),
  };
}
