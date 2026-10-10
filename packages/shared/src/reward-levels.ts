// CB-7 — diner-claimed scratch-card rewards ("reward levels"): the shared CONTRACT (constants + types only).
// Plan: .claude/plan/v2/cb7-plan.md §2.1 (config), §2.2 (issued card), §2.11 (Tamil Nadu guard).
// PURE, client-safe: no DB, no Node APIs, no Mongoose. The engine (reward-levels-engine.ts), the view
// (reward-levels-view.ts) and the schemas (schemas/reward-levels*.schema.ts) build on this file.

import {
  LOYALTY_MIN_BILL_MAX,
  LOYALTY_REWARD_FLAT_MAX,
  LOYALTY_REWARD_ITEM_MAX_LEN,
  LOYALTY_REWARD_PERCENT_MAX,
  LOYALTY_REWARD_QTY_MAX,
  LOYALTY_REWARD_QTY_MIN,
  LOYALTY_STAMP_ORDERS_MAX,
} from "./public-diner";

export const REWARD_LEVELS_SCHEMA_VERSION = 1;

// The launch lock (s86 review B4): while false, the WRITE schema refuses `enabled: true`, so no PUT can switch the
// feature on before the diner can scratch (S4) and use (S5) a card. Flipped to true in S4 — never earlier.
export const REWARD_LEVELS_LAUNCHED = false;

// ── Config limits (§2.1). Worst case 5 × 8 × 5 options ≈ 24 KB inside the Settings doc. ──────────────────────────
export const REWARD_LEVELS_MAX = 5;
export const REWARD_LEVEL_SIZE_MIN = 1;
export const REWARD_LEVEL_SIZE_MAX = 30;
export const REWARD_SLOTS_PER_LEVEL_MAX = 8;
export const REWARD_OPTIONS_PER_SLOT_MAX = 5;
// F7: the owner sets a chance per reward; every option carries one, the editor's default makes them all equal.
export const REWARD_WEIGHT_MIN = 1;
export const REWARD_WEIGHT_MAX = 100;
export const REWARD_WEIGHT_DEFAULT = 1;
// The two clocks (B3): days to scratch a card, then days to use what it revealed.
export const REWARD_DAYS_MIN = 1;
export const REWARD_DAYS_MAX = 365;
// A 0% / ₹0 option would be a "No reward" in disguise — that is what kind `none` is for (F9), so ranges start at 1.
export const REWARD_PERCENT_MIN = 1;
export const REWARD_PERCENT_MAX = LOYALTY_REWARD_PERCENT_MAX;
export const REWARD_FLAT_MIN = 1;
export const REWARD_FLAT_MAX = LOYALTY_REWARD_FLAT_MAX;
// F6: 1 point = ₹1 off a later bill. A generous ceiling, not a policy (same reasoning as LOYALTY_REWARD_FLAT_MAX).
export const REWARD_POINTS_MIN = 1;
export const REWARD_POINTS_MAX = 10_000;
// F8 "up to ₹X" and "bill ≥ ₹Y"; F3 the cafe-wide "bills of at least ₹X count". Rupees, never paise.
export const REWARD_CAP_RUPEES_MIN = 1;
export const REWARD_CAP_RUPEES_MAX = LOYALTY_REWARD_FLAT_MAX;
export const REWARD_MIN_BILL_MIN = 0;
export const REWARD_MIN_BILL_MAX = LOYALTY_MIN_BILL_MAX;
export const REWARD_QTY_MIN = LOYALTY_REWARD_QTY_MIN;
export const REWARD_QTY_MAX = LOYALTY_REWARD_QTY_MAX;
// F8: a product % reward applies to ONE unit of that dish — a constant, never a config field.
export const REWARD_PRODUCT_PERCENT_UNITS = 1;
// Display snapshots (D8: names are display-only, the ids are the references).
export const REWARD_NAME_MAX_LEN = LOYALTY_REWARD_ITEM_MAX_LEN;
export const REWARD_LABEL_MAX_LEN = 60;
export const REWARD_TITLE_MAX_LEN = 60;
// An option's id is a short client-made key, unique within its box (editor identity + the card's audit trail).
export const REWARD_OPTION_ID_RE = /^[a-z0-9]{1,16}$/;

// ── Issued cards (§2.2) ───────────────────────────────────────────────────────────────────────────────────────────
// How many cards one Customer keeps. The push sorts by keepUntil first, so the cards that stopped mattering
// earliest are dropped first; a live card goes only when the diner holds this many live cards that all end later.
export const REWARD_CARDS_KEEP = 60;
// The progress idempotency marker's horizon — same reasoning as the stamp marker (it only has to outlive a
// duplicate-apply window), so the same number.
export const REWARD_CARD_STEP_ORDERS_MAX = LOYALTY_STAMP_ORDERS_MAX;
export const REWARD_CARD_ID_HEX_LEN = 12;
export const REWARD_CARD_ID_RE = /^[0-9a-f]{12}$/;
// §2.4: a step's T0 CAS retries only when another bill moved the counter first.
export const REWARD_PROGRESS_CAS_ATTEMPTS = 3;

// ── Tamil Nadu guard (§2.11, F14) ─────────────────────────────────────────────────────────────────────────────────
// GST state codes whose cafes never get scratch cards until a lawyer okays it. "33 | TAMIL NADU" — GSTN master codes
// (einvoice1.gst.gov.in/Others/MasterCodes), verified 2026-10-08.
export const SCRATCH_BLOCKED_GST_STATE_CODES = ["33"] as const;
// The platform owner's per-deployment switch. ANY other non-blank value blocks (fail closed: "true", "yes", "1").
export const SCRATCH_BLOCK_ENV_VAR = "SCRATCH_CARDS_BLOCKED";
export const SCRATCH_BLOCK_ENV_OFF_VALUES = ["0", "false", "no", "off"] as const;

// ── Enums (members are never removed once stored — the READ schema must keep parsing old cards) ──────────────────
export const REWARD_OPTION_KINDS = [
  "bill-percent",
  "bill-flat",
  "product-percent",
  "category-percent",
  "category-flat",
  "free-item",
  "points",
  "none",
] as const;
export type RewardOptionKind = (typeof REWARD_OPTION_KINDS)[number];

// F4 = a cancel keeps the step and the card → no `void`. Expired is DERIVED from the clocks, never stored.
export const REWARD_CARD_STATUSES = ["ready", "revealed", "used"] as const;
export type RewardCardStatus = (typeof REWARD_CARD_STATUSES)[number];

export const REWARD_CARD_SOURCES = ["level", "campaign"] as const;
export type RewardCardSource = (typeof REWARD_CARD_SOURCES)[number];

// What a diner sees for an issued card at an instant (Locked is a future box from config, never a card).
export const REWARD_CARD_STATES = ["ready", "revealed", "used", "expired"] as const;
export type CardState = (typeof REWARD_CARD_STATES)[number];

// ── Config types (§2.1) ───────────────────────────────────────────────────────────────────────────────────────────
interface RewardOptionBase {
  id: string;
  weight: number;
}
interface RewardRange {
  min: number;
  max: number;
}

export type RewardOption =
  | (RewardOptionBase & RewardRange & { kind: "bill-percent"; minBill?: number })
  | (RewardOptionBase & RewardRange & { kind: "bill-flat"; minBill?: number })
  | (RewardOptionBase &
      RewardRange & { kind: "product-percent"; productId: string; productName: string; capRupees?: number; minBill?: number })
  | (RewardOptionBase &
      RewardRange & { kind: "category-percent"; categoryId: string; categoryName: string; capRupees?: number; minBill?: number })
  | (RewardOptionBase & RewardRange & { kind: "category-flat"; categoryId: string; categoryName: string; minBill?: number })
  // The size/variation of a free dish is picked when the card is USED, exactly like the shipped stamp claim.
  | (RewardOptionBase & { kind: "free-item"; productId: string; productName: string; qty: number; minBill?: number })
  | (RewardOptionBase & RewardRange & { kind: "points" })
  | (RewardOptionBase & { kind: "none"; label?: string });

export interface RewardSlot {
  step: number; // 1..level size — the box this reward sits on
  scratchDays: number;
  useDays: number;
  options: RewardOption[];
}

export interface RewardLevel {
  size: number;
  slots: RewardSlot[];
}

export interface RewardLevelsConfig {
  v: typeof REWARD_LEVELS_SCHEMA_VERSION;
  enabled: boolean;
  minBill?: number; // F3, rupees; absent = every bill counts
  levels: RewardLevel[];
}

// ── Issued card (§2.2) — the stored subdoc shape on Customer.rewardCards ─────────────────────────────────────────
export interface RewardPoolEntry {
  kind: RewardOptionKind;
  label: string; // from the option's CONFIG (optionLabel), never the rolled value
  weight: number;
}

export interface RewardCardSnapshot {
  id: string;
  issueKey: string; // "step:<n>" (n = lifetime step number) or "camp:<campaignId>"
  source: RewardCardSource;
  level?: number; // 1-based
  step?: number; // 1-based box within that level
  campaignId?: string;
  title?: string;
  // The outcome — rolled ONCE at issue, never re-rolled, never shown before the scratch.
  optionId: string;
  kind: RewardOptionKind;
  value: number; // percent, rupees, points or 0 (none / free-item)
  productId?: string;
  productName?: string;
  categoryId?: string;
  categoryName?: string;
  qty?: number;
  capRupees?: number;
  minBill?: number;
  label?: string;
  pool: RewardPoolEntry[]; // the box's odds, snapshotted for the F14 terms on the card
  issuedAt: Date;
  scratchBy: Date;
  useDays: number;
  keepUntil: Date; // ready → scratchBy; revealed → validUntil; used → usedAt
  status: RewardCardStatus;
  revealedAt?: Date;
  validUntil?: Date;
  usedAt?: Date;
  orderId?: string;
  pointsSpent?: number; // points lots only (§2.7)
}

// Where the n-th counted bill lands (§2.3). levelIndex is 0-based; step is 1-based; repeat counts F5 re-runs of the
// last level (0 on the first pass).
export interface LevelPosition {
  levelIndex: number;
  step: number;
  repeat: number;
}
