// CB-7 — the pure reward-levels ENGINE (plan §2.2-§2.5, §2.7, §2.11; S1 item 2).
// Everything here is a pure function of its arguments: randomness arrives as an injected `RewardRng` (the server
// passes a CSPRNG, tests pass a script — no ambient randomness is used in this file, pinned by a source test), and the
// clock arrives as `now`. Client-safe: the cafe's diner UI and the server's issue/scratch/spend paths share one
// definition of "where am I", "what did I roll", "is it still valid" and "how many points do I hold".

import { ONE_DAY_MS } from "./public-promo";
import {
  SCRATCH_BLOCKED_GST_STATE_CODES,
  SCRATCH_BLOCK_ENV_OFF_VALUES,
  type CardState,
  type LevelPosition,
  type RewardCardSnapshot,
  type RewardCardSource,
  type RewardLevel,
  type RewardLevelsConfig,
  type RewardOption,
  type RewardSlot,
} from "./reward-levels";
import { optionLabel } from "./reward-levels-label";
import { dayRange } from "./utils";

// An integer in [0, maxExclusive). Injected so the engine never reaches for a randomness source itself.
export type RewardRng = (maxExclusive: number) => number;

// How many characters of a GSTIN name its state (the first two digits are the GST state code).
const GSTIN_STATE_CODE_LEN = 2;

// ── Progress (§2.3) ───────────────────────────────────────────────────────────────────────────────────────────────

// Where the n-th counted bill lands. n is 1-based. Past the last level the LAST level repeats forever (F5), so
// repeat counts how many times it has already been completed. null = nothing to earn (no levels, or a bad n).
export function positionOf(n: number, levels: readonly RewardLevel[]): LevelPosition | null {
  if (levels.length === 0 || !Number.isInteger(n) || n < 1) return null;
  const lastIndex = levels.length - 1;
  let start = 0; // bills consumed by the levels before the one being looked at
  for (let levelIndex = 0; levelIndex < lastIndex; levelIndex++) {
    const size = levels[levelIndex].size;
    if (!Number.isInteger(size) || size < 1) return null;
    if (n <= start + size) return { levelIndex, step: n - start, repeat: 0 };
    start += size;
  }
  const sizeOfLast = levels[lastIndex].size;
  if (!Number.isInteger(sizeOfLast) || sizeOfLast < 1) return null;
  const into = n - start - 1; // 0-based offset into the (repeating) last level
  return { levelIndex: lastIndex, step: (into % sizeOfLast) + 1, repeat: Math.floor(into / sizeOfLast) };
}

// The box at a position, or null when the owner left that step without a reward.
export function slotAt(levels: readonly RewardLevel[], pos: LevelPosition): RewardSlot | null {
  const level = levels[pos.levelIndex];
  if (!level) return null;
  return level.slots.find((slot) => slot.step === pos.step) ?? null;
}

// F3: a bill counts when it reaches the owner's minimum, in RUPEES, `>=` (mirrors billEarnsStamp).
export function billCountsForLevels(billTotal: number, cfg: Pick<RewardLevelsConfig, "minBill">): boolean {
  return cfg.minBill == null || billTotal >= cfg.minBill;
}

// ── Roll (§2.4) ───────────────────────────────────────────────────────────────────────────────────────────────────

// One weighted pick: the option whose cumulative-weight band holds r. Throws on anything that would make the pick
// biased or undefined — a silent fallback here would hand out a wrong prize.
export function pickWeighted<T extends { weight: number }>(options: readonly T[], rng: RewardRng): T {
  if (options.length === 0) throw new Error("pickWeighted: no options to pick from");
  const total = options.reduce((sum, option) => sum + option.weight, 0);
  if (!Number.isInteger(total) || total <= 0) throw new Error("pickWeighted: weights must add up to a positive whole number");
  const r = rng(total);
  if (!Number.isInteger(r) || r < 0 || r >= total) throw new Error("pickWeighted: the random number was outside the range");
  let cumulative = 0;
  for (const option of options) {
    cumulative += option.weight;
    if (cumulative > r) return option;
  }
  throw new Error("pickWeighted: no option matched"); // unreachable: r < total
}

// The value a card carries: a number in [min, max], BOTH ends inclusive. free-item and none have no value.
// The READ schema deliberately accepts a stored min > max (it never narrows), so the bounds are ordered here first:
// an inverted range must still ask the rng for a POSITIVE span (node:crypto randomInt throws on 0 or less, and in
// the issue path that throw would abort the one atomic progress update). A bad answer throws like pickWeighted does.
export function rollValue(option: RewardOption, rng: RewardRng): number {
  if (option.kind === "free-item" || option.kind === "none") return 0;
  const lo = Math.min(option.min, option.max);
  const hi = Math.max(option.min, option.max);
  const r = rng(hi - lo + 1);
  if (!Number.isInteger(r) || r < 0 || r > hi - lo) throw new Error("rollValue: the random number was outside the range");
  return lo + r;
}

// ── Clocks (§2.2, B9) ─────────────────────────────────────────────────────────────────────────────────────────────

// A deadline is the END of the cafe (IST) day `days` days after `fromMs`, so "Scratch by 12 Nov" holds all of 12 Nov.
export function deadlineFrom(fromMs: number, days: number): Date {
  return dayRange(new Date(fromMs + days * ONE_DAY_MS)).end;
}

// What a diner sees for a card at an instant. Expired is DERIVED, never stored. Strict `>`: the deadline instant
// itself is still valid (mirrors public-promo.ts isAssignedRewardExpired).
export function cardStateAt(card: Pick<RewardCardSnapshot, "status" | "scratchBy" | "validUntil">, now: Date): CardState {
  if (card.status === "used") return "used";
  if (card.status === "ready") return now.getTime() > card.scratchBy.getTime() ? "expired" : "ready";
  return !card.validUntil || now.getTime() > card.validUntil.getTime() ? "expired" : "revealed";
}

// ── Issue (§2.2) ──────────────────────────────────────────────────────────────────────────────────────────────────

export interface BuildCardInput {
  id: string;
  issueKey: string;
  source: RewardCardSource;
  level?: number;
  step?: number;
  campaignId?: string;
  title?: string;
  slot: Pick<RewardSlot, "scratchDays" | "useDays" | "options">;
  rng: RewardRng;
  now: Date;
}

// Only the PICKED option's kind-specific fields go on the card — the other options stay in `pool` as label + weight.
// Optional fields are left ABSENT (not undefined keys) so the stored subdoc stays small and deepEqual-stable.
function optionFields(option: RewardOption): Partial<RewardCardSnapshot> {
  switch (option.kind) {
    case "bill-percent":
    case "bill-flat":
      return option.minBill !== undefined ? { minBill: option.minBill } : {};
    case "product-percent":
      return {
        productId: option.productId,
        productName: option.productName,
        ...(option.capRupees !== undefined ? { capRupees: option.capRupees } : {}),
        ...(option.minBill !== undefined ? { minBill: option.minBill } : {}),
      };
    case "category-percent":
      return {
        categoryId: option.categoryId,
        categoryName: option.categoryName,
        ...(option.capRupees !== undefined ? { capRupees: option.capRupees } : {}),
        ...(option.minBill !== undefined ? { minBill: option.minBill } : {}),
      };
    case "category-flat":
      return {
        categoryId: option.categoryId,
        categoryName: option.categoryName,
        ...(option.minBill !== undefined ? { minBill: option.minBill } : {}),
      };
    case "free-item":
      return {
        productId: option.productId,
        productName: option.productName,
        qty: option.qty,
        ...(option.minBill !== undefined ? { minBill: option.minBill } : {}),
      };
    case "points":
      return {};
    case "none":
      return option.label?.trim() ? { label: option.label.trim() } : {}; // blank = no key (the pool shows the default)
  }
}

// Roll once, freeze the outcome. The pool labels come from CONFIG (optionLabel), never from the rolled value.
export function buildCardSnapshot(input: BuildCardInput): RewardCardSnapshot {
  const { slot, rng, now } = input;
  const option = pickWeighted(slot.options, rng);
  const scratchBy = deadlineFrom(now.getTime(), slot.scratchDays);
  return {
    id: input.id,
    issueKey: input.issueKey,
    source: input.source,
    ...(input.level !== undefined ? { level: input.level } : {}),
    ...(input.step !== undefined ? { step: input.step } : {}),
    ...(input.campaignId !== undefined ? { campaignId: input.campaignId } : {}),
    ...(input.title !== undefined ? { title: input.title } : {}),
    optionId: option.id,
    kind: option.kind,
    value: rollValue(option, rng),
    ...optionFields(option),
    pool: slot.options.map((o) => ({ kind: o.kind, label: optionLabel(o), weight: o.weight })),
    issuedAt: now,
    scratchBy,
    useDays: slot.useDays,
    keepUntil: scratchBy,
    status: "ready",
  };
}

// ── Scratch (§2.2, §2.5) ──────────────────────────────────────────────────────────────────────────────────────────

export interface RewardRevealPatch {
  status: "revealed" | "used";
  revealedAt: Date;
  keepUntil: Date;
  validUntil?: Date;
  usedAt?: Date;
  pointsSpent?: number;
}

// What the scratch writes onto the card, per kind. "No reward" is over at once; a points card becomes a LOT with
// nothing spent yet (§2.7); everything else starts its use-by clock.
export function revealPatch(card: Pick<RewardCardSnapshot, "kind" | "useDays">, now: Date): RewardRevealPatch {
  if (card.kind === "none") return { status: "used", revealedAt: now, usedAt: now, keepUntil: now };
  const validUntil = deadlineFrom(now.getTime(), card.useDays);
  const base: RewardRevealPatch = { status: "revealed", revealedAt: now, validUntil, keepUntil: validUntil };
  return card.kind === "points" ? { ...base, pointsSpent: 0 } : base;
}

// ── Points wallet (§2.7) ──────────────────────────────────────────────────────────────────────────────────────────

type PointsCard = Pick<RewardCardSnapshot, "kind" | "status" | "value" | "pointsSpent" | "scratchBy" | "validUntil">;

// One definition of "how many points can this diner spend right now": the unspent part of every revealed,
// unexpired points lot.
export function pointsBalance(cards: readonly PointsCard[], now: Date): number {
  let balance = 0;
  for (const card of cards) {
    if (card.kind !== "points" || cardStateAt(card, now) !== "revealed") continue;
    balance += Math.max(0, card.value - (card.pointsSpent ?? 0));
  }
  return balance;
}

// ── Tamil Nadu guard (§2.11) ──────────────────────────────────────────────────────────────────────────────────────

// The platform owner's env switch FAILS CLOSED: absent/blank and an explicit "off" word allow scratch cards, ANY
// other value ("true", "1", "yes", "TN") blocks them.
export function scratchEnvBlocks(value: string | undefined | null): boolean {
  const v = (value ?? "").trim().toLowerCase();
  if (v === "") return false;
  return !(SCRATCH_BLOCK_ENV_OFF_VALUES as readonly string[]).includes(v);
}

// Secondary catch: the cafe's GSTIN starts with its two-digit state code.
export function gstinBlocksScratch(gstNumber: string | undefined | null): boolean {
  const code = (gstNumber ?? "").trim().toUpperCase().slice(0, GSTIN_STATE_CODE_LEN);
  return (SCRATCH_BLOCKED_GST_STATE_CODES as readonly string[]).includes(code);
}

export function scratchCardsBlocked(input: { envFlag: string | undefined | null; gstNumber: string | undefined | null }): boolean {
  return scratchEnvBlocks(input.envFlag) || gstinBlocksScratch(input.gstNumber);
}
