// CB-7 S3 — the pure edit operations of the scratch-card editor. Every op takes a value and returns a NEW one (cfg →
// cfg, slot → slot): nothing here mutates, so a draft held in React state can be compared with the saved baseline.
// PURE, client-safe: no Mongoose, no node:crypto, never reaches lib/reward-levels-config. Option ids come from a
// counter (`o1`, `o2`, …), never from a random source — an id only has to be unique inside its box.

import { LOYALTY_CARD_SIZE_DEFAULT } from "@pos/shared/loyalty-rules";
import {
  REWARD_LEVELS_LAUNCHED,
  REWARD_LEVELS_MAX,
  REWARD_LEVELS_SCHEMA_VERSION,
  REWARD_MIN_BILL_MAX,
  REWARD_OPTIONS_PER_SLOT_MAX,
  REWARD_OPTION_ID_RE,
  REWARD_QTY_MIN,
  REWARD_SLOTS_PER_LEVEL_MAX,
  REWARD_WEIGHT_DEFAULT,
  type RewardLevelsConfig,
  type RewardOption,
  type RewardOptionKind,
  type RewardSlot,
} from "@pos/shared/reward-levels";
import type { Product } from "@/types";

// Q4 (owner answer): every new box gives 7 days to scratch and 30 days to use.
export const REWARD_SCRATCH_DAYS_DEFAULT = 7;
export const REWARD_USE_DAYS_DEFAULT = 30;
// Starting values of a fresh option, per unit: a fixed 10 %, a fixed ₹20, a fixed 10 points.
const DEFAULT_PERCENT = 10;
const DEFAULT_FLAT = 20;
const DEFAULT_POINTS = 10;
const FIRST_OPTION_ID = "o1";
const OPTION_ID_PREFIX = "o";
const OPTION_ID_COUNTER_RE = /^o(\d+)$/;

// Widened so TypeScript does not fold the lock into a constant: the editor must keep working when S4 flips it.
const LAUNCHED: boolean = REWARD_LEVELS_LAUNCHED;

// The kinds that never carry "only on bills of ₹ or more": points and "No reward" have no bill to compare.
const NO_MIN_BILL_KINDS: readonly RewardOptionKind[] = ["points", "none"];
export const kindAllowsMinBill = (kind: RewardOptionKind): boolean => !NO_MIN_BILL_KINDS.includes(kind);

// A whole-rupee minimum bill, or undefined when there is none to keep (blank, 0, NaN, negative).
export function minBillValue(minBill: number | undefined): number | undefined {
  if (minBill === undefined || !Number.isFinite(minBill) || minBill <= 0) return undefined;
  return Math.min(Math.trunc(minBill), REWARD_MIN_BILL_MAX);
}

// ── Config ops ───────────────────────────────────────────────────────────────

export function emptyConfig(minBill?: number): RewardLevelsConfig {
  const bill = minBillValue(minBill);
  return {
    v: REWARD_LEVELS_SCHEMA_VERSION,
    enabled: false,
    ...(bill !== undefined ? { minBill: bill } : {}),
    levels: [{ size: LOYALTY_CARD_SIZE_DEFAULT, slots: [] }],
  };
}

export function addLevel(cfg: RewardLevelsConfig): RewardLevelsConfig {
  if (cfg.levels.length >= REWARD_LEVELS_MAX) return cfg;
  return { ...cfg, levels: [...cfg.levels, { size: LOYALTY_CARD_SIZE_DEFAULT, slots: [] }] };
}

export function removeLevel(cfg: RewardLevelsConfig, levelIndex: number): RewardLevelsConfig {
  return { ...cfg, levels: cfg.levels.filter((_, index) => index !== levelIndex) };
}

// The size may be NaN while the owner is typing; the save gate flags it. Boxes past a smaller size are KEPT (the
// grid keeps drawing them, flagged) so shrinking a level never silently deletes a reward.
export function setLevelSize(cfg: RewardLevelsConfig, levelIndex: number, size: number): RewardLevelsConfig {
  return { ...cfg, levels: cfg.levels.map((level, index) => (index === levelIndex ? { ...level, size } : level)) };
}

export function setMinBill(cfg: RewardLevelsConfig, minBill: number | undefined): RewardLevelsConfig {
  const next: RewardLevelsConfig = { ...cfg };
  if (minBill === undefined) delete next.minBill;
  else next.minBill = minBill;
  return next;
}

// Add a box, or replace the box already on that step; always kept sorted by step. A NEW box past the per-level cap
// is refused (the grid disables it too).
export function putSlot(cfg: RewardLevelsConfig, levelIndex: number, slot: RewardSlot): RewardLevelsConfig {
  return {
    ...cfg,
    levels: cfg.levels.map((level, index) => {
      if (index !== levelIndex) return level;
      const exists = level.slots.some((s) => s.step === slot.step);
      if (!exists && level.slots.length >= REWARD_SLOTS_PER_LEVEL_MAX) return level;
      const slots = exists ? level.slots.map((s) => (s.step === slot.step ? slot : s)) : [...level.slots, slot];
      return { ...level, slots: [...slots].sort((a, b) => a.step - b.step) };
    }),
  };
}

export function removeSlot(cfg: RewardLevelsConfig, levelIndex: number, step: number): RewardLevelsConfig {
  return {
    ...cfg,
    levels: cfg.levels.map((level, index) =>
      index === levelIndex ? { ...level, slots: level.slots.filter((s) => s.step !== step) } : level,
    ),
  };
}

// A no-op while the launch lock is on. The stored value is never rewritten here: the switch only ever turns on what
// the lock lets through.
export function setEnabled(cfg: RewardLevelsConfig, enabled: boolean): RewardLevelsConfig {
  if (!LAUNCHED) return cfg;
  return { ...cfg, enabled };
}

// ── Box and option ops ───────────────────────────────────────────────────────

// A fresh option of a kind, ready to edit. The picker kinds start with an EMPTY pick (the save gate asks for it).
export function newOption(kind: RewardOptionKind, id: string): RewardOption {
  const base = { id, weight: REWARD_WEIGHT_DEFAULT };
  switch (kind) {
    case "bill-percent":
      return { ...base, kind, min: DEFAULT_PERCENT, max: DEFAULT_PERCENT };
    case "bill-flat":
      return { ...base, kind, min: DEFAULT_FLAT, max: DEFAULT_FLAT };
    case "product-percent":
      return { ...base, kind, min: DEFAULT_PERCENT, max: DEFAULT_PERCENT, productId: "", productName: "" };
    case "category-percent":
      return { ...base, kind, min: DEFAULT_PERCENT, max: DEFAULT_PERCENT, categoryId: "", categoryName: "" };
    case "category-flat":
      return { ...base, kind, min: DEFAULT_FLAT, max: DEFAULT_FLAT, categoryId: "", categoryName: "" };
    case "free-item":
      return { ...base, kind, productId: "", productName: "", qty: REWARD_QTY_MIN };
    case "points":
      return { ...base, kind, min: DEFAULT_POINTS, max: DEFAULT_POINTS };
    case "none":
      return { ...base, kind };
  }
}

export function newSlot(step: number): RewardSlot {
  return {
    step,
    scratchDays: REWARD_SCRATCH_DAYS_DEFAULT,
    useDays: REWARD_USE_DAYS_DEFAULT,
    options: [newOption("bill-percent", FIRST_OPTION_ID)],
  };
}

// The next free `o<n+1>`: one past the highest counter already in the box, and never an id the box already holds.
export function nextOptionId(options: readonly Pick<RewardOption, "id">[]): string {
  const taken = new Set(options.map((o) => o.id));
  let counter = options.reduce((max, o) => {
    const match = OPTION_ID_COUNTER_RE.exec(o.id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  let id = `${OPTION_ID_PREFIX}${counter + 1}`;
  while (taken.has(id) || !REWARD_OPTION_ID_RE.test(id)) {
    counter += 1;
    id = `${OPTION_ID_PREFIX}${counter + 1}`;
  }
  return id;
}

// Change an option's kind: it keeps its id and its chance, keeps "only on bills of ₹ or more" where the new kind
// has one, and starts the kind's own fields fresh (a % range means nothing as a ₹ range).
export function switchKind(option: RewardOption, kind: RewardOptionKind): RewardOption {
  if (option.kind === kind) return option;
  const fresh = newOption(kind, option.id);
  const keptMinBill = "minBill" in option ? option.minBill : undefined;
  const withBill = keptMinBill !== undefined && kindAllowsMinBill(kind) ? { ...fresh, minBill: keptMinBill } : fresh;
  return { ...withBill, weight: option.weight } as RewardOption;
}

export function withOption(slot: RewardSlot, option: RewardOption): RewardSlot {
  if (slot.options.length >= REWARD_OPTIONS_PER_SLOT_MAX) return slot;
  return { ...slot, options: [...slot.options, option] };
}

// A box always keeps at least one reward, so removing the last one does nothing.
export function withoutOption(slot: RewardSlot, optionId: string): RewardSlot {
  if (slot.options.length <= 1) return slot;
  const options = slot.options.filter((o) => o.id !== optionId);
  // A box with one reward hides its Chance field (that reward always wins), so an invalid chance left on the
  // survivor would block Save with no field to fix it — it gets the default back (s89h review).
  if (options.length === 1) options[0] = { ...options[0], weight: REWARD_WEIGHT_DEFAULT };
  return { ...slot, options };
}

export function replaceOption(slot: RewardSlot, optionId: string, option: RewardOption): RewardSlot {
  return { ...slot, options: slot.options.map((o) => (o.id === optionId ? option : o)) };
}

// ── Cost context ─────────────────────────────────────────────────────────────

type PricedProduct = Pick<Product, "_id" | "price" | "variations">;

// One unit's price for the cost line (CostContext.priceOf): the HIGHEST of the base price and every size's price,
// so a sized item is never understated. undefined = not on the menu.
export function priceOfFrom(products: readonly PricedProduct[] | undefined): (productId: string) => number | undefined {
  const prices = new Map<string, number>();
  for (const product of products ?? []) {
    const all = [product.price, ...(product.variations ?? []).map((v) => v.price)];
    prices.set(product._id.toLowerCase(), Math.max(...all));
  }
  return (productId) => prices.get(productId.trim().toLowerCase());
}
