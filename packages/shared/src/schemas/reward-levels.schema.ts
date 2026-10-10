import { z } from "zod";
import { LOYALTY_REWARD_PRODUCT_ID_RE } from "../public-diner";
import {
  REWARD_CAP_RUPEES_MAX,
  REWARD_CAP_RUPEES_MIN,
  REWARD_DAYS_MAX,
  REWARD_DAYS_MIN,
  REWARD_FLAT_MAX,
  REWARD_FLAT_MIN,
  REWARD_LABEL_MAX_LEN,
  REWARD_LEVELS_LAUNCHED,
  REWARD_LEVELS_MAX,
  REWARD_LEVELS_SCHEMA_VERSION,
  REWARD_LEVEL_SIZE_MAX,
  REWARD_LEVEL_SIZE_MIN,
  REWARD_MIN_BILL_MAX,
  REWARD_MIN_BILL_MIN,
  REWARD_NAME_MAX_LEN,
  REWARD_OPTIONS_PER_SLOT_MAX,
  REWARD_OPTION_ID_RE,
  REWARD_PERCENT_MAX,
  REWARD_PERCENT_MIN,
  REWARD_POINTS_MAX,
  REWARD_POINTS_MIN,
  REWARD_QTY_MAX,
  REWARD_QTY_MIN,
  REWARD_SLOTS_PER_LEVEL_MAX,
  REWARD_WEIGHT_MAX,
  REWARD_WEIGHT_MIN,
} from "../reward-levels";

// The WRITE gate of the CB-7 reward-levels config (plan §2.1, s86): every rule lives here, nowhere else.
// Imported by path (`@pos/shared/schemas/reward-levels.schema`) and deliberately NOT in schemas/index.ts: the
// config is a PUT-only blob on Settings (see settings.schema.ts), never a section field, and the cafe's client
// bundles that only READ a stored config import reward-levels-read.schema.ts instead, never this gate.
// `.strict()` everywhere (an unknown key is a typo or a stale client, never silently dropped) and integers
// everywhere (rupees/percent/points are whole numbers; a fractional box would be a rounding dispute later).
// The READ twin is deliberately looser (own ceilings, no cross-field rules) so a stored config survives any
// later tightening made here.

const WHOLE = "Use a whole number";

function int(min: number, max: number, what: string): z.ZodNumber {
  return z
    .number({ invalid_type_error: `${what} must be a whole number` })
    .int(WHOLE)
    .min(min, `${what} must be at least ${min}`)
    .max(max, `${what} can be at most ${max}`);
}

const optionId = z.string().regex(REWARD_OPTION_ID_RE, "Each reward needs a short id of letters and numbers");
const weight = int(REWARD_WEIGHT_MIN, REWARD_WEIGHT_MAX, "The chance");
const minBill = int(REWARD_MIN_BILL_MIN, REWARD_MIN_BILL_MAX, "The minimum bill").optional();
const capRupees = int(REWARD_CAP_RUPEES_MIN, REWARD_CAP_RUPEES_MAX, "The limit").optional();
// Canonicalised lowercase so the stored reference always equals the product/category the picker produced.
// One factory per picker kind so the message names what the owner is actually picking.
type PickerKind = "item" | "category";
const refId = (kind: PickerKind) =>
  z.string().trim().toLowerCase().regex(LOYALTY_REWARD_PRODUCT_ID_RE, `Pick the ${kind} from the list`);
const name = (kind: PickerKind) =>
  z
    .string()
    .trim()
    .min(1, `Pick the ${kind} from the list`)
    .max(REWARD_NAME_MAX_LEN, `The name can be at most ${REWARD_NAME_MAX_LEN} characters`);

function ranged(min: number, max: number, what: string) {
  return { min: int(min, max, `The lowest ${what}`), max: int(min, max, `The highest ${what}`) };
}
const percent = ranged(REWARD_PERCENT_MIN, REWARD_PERCENT_MAX, "percentage");
const flat = ranged(REWARD_FLAT_MIN, REWARD_FLAT_MAX, "amount");
const points = ranged(REWARD_POINTS_MIN, REWARD_POINTS_MAX, "points");

const rewardOptionWriteSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("bill-percent"), id: optionId, weight, ...percent, minBill }).strict(),
  z.object({ kind: z.literal("bill-flat"), id: optionId, weight, ...flat, minBill }).strict(),
  z
    .object({ kind: z.literal("product-percent"), id: optionId, weight, ...percent, productId: refId("item"), productName: name("item"), capRupees, minBill })
    .strict(),
  z
    .object({ kind: z.literal("category-percent"), id: optionId, weight, ...percent, categoryId: refId("category"), categoryName: name("category"), capRupees, minBill })
    .strict(),
  z.object({ kind: z.literal("category-flat"), id: optionId, weight, ...flat, categoryId: refId("category"), categoryName: name("category"), minBill }).strict(),
  z
    .object({
      kind: z.literal("free-item"),
      id: optionId,
      weight,
      productId: refId("item"),
      productName: name("item"),
      qty: int(REWARD_QTY_MIN, REWARD_QTY_MAX, "The quantity"),
      minBill,
    })
    .strict(),
  z.object({ kind: z.literal("points"), id: optionId, weight, ...points }).strict(),
  z
    .object({
      kind: z.literal("none"),
      id: optionId,
      weight,
      label: z.string().trim().max(REWARD_LABEL_MAX_LEN, `The message can be at most ${REWARD_LABEL_MAX_LEN} characters`).optional(),
    })
    .strict(),
]);

const rewardSlotWriteSchema = z
  .object({
    step: int(1, REWARD_LEVEL_SIZE_MAX, "The box number"),
    scratchDays: int(REWARD_DAYS_MIN, REWARD_DAYS_MAX, "The days to scratch"),
    useDays: int(REWARD_DAYS_MIN, REWARD_DAYS_MAX, "The days to use"),
    options: z.array(rewardOptionWriteSchema).min(1, "Add at least one reward to this box").max(REWARD_OPTIONS_PER_SLOT_MAX, `A box can hold at most ${REWARD_OPTIONS_PER_SLOT_MAX} rewards`),
  })
  .strict();

const rewardLevelWriteSchema = z
  .object({
    size: int(REWARD_LEVEL_SIZE_MIN, REWARD_LEVEL_SIZE_MAX, "The number of boxes"),
    slots: z.array(rewardSlotWriteSchema).max(REWARD_SLOTS_PER_LEVEL_MAX, `A level can have at most ${REWARD_SLOTS_PER_LEVEL_MAX} reward boxes`),
  })
  .strict();

export const rewardLevelsWriteSchema = z
  .object({
    v: z.literal(REWARD_LEVELS_SCHEMA_VERSION),
    enabled: z.boolean(),
    minBill,
    levels: z.array(rewardLevelWriteSchema).max(REWARD_LEVELS_MAX, `You can have at most ${REWARD_LEVELS_MAX} levels`),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    cfg.levels.forEach((level, li) => {
      const seenSteps = new Set<number>();
      level.slots.forEach((slot, si) => {
        const at = ["levels", li, "slots", si] as const;
        if (slot.step > level.size) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...at, "step"], message: `This box is past the end of the level (it has ${level.size} boxes)` });
        }
        if (seenSteps.has(slot.step)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...at, "step"], message: "Two reward boxes sit on the same step" });
        }
        seenSteps.add(slot.step);
        const seenIds = new Set<string>();
        slot.options.forEach((option, oi) => {
          if (seenIds.has(option.id)) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...at, "options", oi, "id"], message: "Two rewards in this box share an id" });
          }
          seenIds.add(option.id);
          if ("min" in option && option.min > option.max) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...at, "options", oi, "max"], message: "The highest value must not be below the lowest" });
          }
        });
        if (slot.options.every((option) => option.kind === "none")) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [...at, "options"], message: "Add at least one real reward to this box" });
        }
      });
    });
    if (cfg.enabled && !cfg.levels.some((level) => level.slots.length > 0)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["levels"], message: "Add at least one level with a reward box before you switch this on" });
    }
    // The launch lock (s86 review B4): no PUT can switch the feature on before the diner can scratch and use a card.
    if (cfg.enabled && !REWARD_LEVELS_LAUNCHED) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["enabled"], message: "Scratch cards are not available yet" });
    }
  });

export type RewardLevelsWriteInput = z.infer<typeof rewardLevelsWriteSchema>;
