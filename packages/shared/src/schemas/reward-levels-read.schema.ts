import { z } from "zod";
import { REWARD_LEVELS_SCHEMA_VERSION, type RewardLevelsConfig } from "../reward-levels";

// The READ schema of the CB-7 reward-levels config (plan §2.1: "READ schema is shape-only with its own frozen
// ceilings >= write caps, enum members never removed; unreadable -> null = OFF, fail closed").
//
// READ: the same field set and the same enums as the WRITE gate (reward-levels.schema.ts), but with NO cross-field
// rules (no min<=max, no step<=size, no unique ids, no launch lock), objects that are NOT strict (an unknown key a
// future version stored is stripped, never a parse failure) and its OWN frozen ceilings below, each at or above the
// write cap. NEVER narrow once data is stored: a stored config that stops parsing silently switches the diner's
// scratch cards OFF. Any new rule or tighter cap goes on the WRITE gate instead.
// Pure and client-safe: it carries no Mongoose and none of the write gate's messages, so a bundle that only reads
// a stored config never builds the write gate.

// Frozen. Every value is at least the matching write constant in reward-levels.ts (a test loops over both).
export const REWARD_LEVELS_READ_LIMITS = Object.freeze({
  levels: 10,
  levelSize: 60,
  slotsPerLevel: 16,
  optionsPerSlot: 10,
  weight: 10_000,
  days: 3650,
  percent: 100,
  flat: 10_000_000,
  points: 10_000_000,
  capRupees: 10_000_000,
  minBill: 10_000_000,
  qty: 1000,
  nameLen: 200,
  labelLen: 200,
  idLen: 64,
});
const L = REWARD_LEVELS_READ_LIMITS;

const whole = (min: number, max: number) => z.number().int().min(min).max(max);
const optionId = z.string().min(1).max(L.idLen);
const weight = whole(1, L.weight);
const minBill = whole(0, L.minBill).optional();
const capRupees = whole(1, L.capRupees).optional();
const refId = z.string().min(1).max(L.idLen);
const name = z.string().max(L.nameLen);
const percent = { min: whole(0, L.percent), max: whole(0, L.percent) };
const flat = { min: whole(0, L.flat), max: whole(0, L.flat) };
const points = { min: whole(0, L.points), max: whole(0, L.points) };

const optionReadSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bill-percent"), id: optionId, weight, ...percent, minBill }),
  z.object({ kind: z.literal("bill-flat"), id: optionId, weight, ...flat, minBill }),
  z.object({ kind: z.literal("product-percent"), id: optionId, weight, ...percent, productId: refId, productName: name, capRupees, minBill }),
  z.object({ kind: z.literal("category-percent"), id: optionId, weight, ...percent, categoryId: refId, categoryName: name, capRupees, minBill }),
  z.object({ kind: z.literal("category-flat"), id: optionId, weight, ...flat, categoryId: refId, categoryName: name, minBill }),
  z.object({ kind: z.literal("free-item"), id: optionId, weight, productId: refId, productName: name, qty: whole(1, L.qty), minBill }),
  z.object({ kind: z.literal("points"), id: optionId, weight, ...points }),
  z.object({ kind: z.literal("none"), id: optionId, weight, label: z.string().max(L.labelLen).optional() }),
]);

const slotReadSchema = z.object({
  step: whole(1, L.levelSize),
  scratchDays: whole(1, L.days),
  useDays: whole(1, L.days),
  options: z.array(optionReadSchema).min(1).max(L.optionsPerSlot),
});

const levelReadSchema = z.object({
  size: whole(1, L.levelSize),
  slots: z.array(slotReadSchema).max(L.slotsPerLevel),
});

export const rewardLevelsReadSchema = z.object({
  v: z.literal(REWARD_LEVELS_SCHEMA_VERSION),
  enabled: z.boolean(),
  minBill,
  levels: z.array(levelReadSchema).max(L.levels),
});

// The one reader of a stored blob: the config, or null = OFF (no cards issued, scratched or listed from it).
export function parseStoredRewardLevels(raw: unknown): RewardLevelsConfig | null {
  const parsed = rewardLevelsReadSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// The OWNER's mode (s86 §2.11): did they switch levels on? A raw read, independent of the full parse above, so a
// blob this build cannot parse still means "the owner chose levels" and stamps never quietly come back.
export function rewardLevelsChosenRaw(raw: unknown): boolean {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
  return (raw as { enabled?: unknown }).enabled === true;
}
