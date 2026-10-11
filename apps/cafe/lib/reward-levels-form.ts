// CB-7 S3 — the form side of the scratch-card editor: seeding from the stored blob, dirtiness, the WRITE body, and the
// save gate's problems turned into plain sentences. This is the ONLY cafe module that imports the WRITE schema (by
// path — it is deliberately not in schemas/index.ts); the READ schema seeds the baseline. PURE, client-safe: no
// Mongoose, no node:crypto, never lib/reward-levels-config (that one reads process.env).

import type { ZodIssue } from "zod";
import { REWARD_LEVELS_LAUNCHED, type RewardLevelsConfig } from "@pos/shared/reward-levels";
import { rewardLevelsWriteSchema } from "@pos/shared/schemas/reward-levels.schema";
import { parseStoredRewardLevels } from "@pos/shared/schemas/reward-levels-read.schema";
import { POSITION_SHIFT, PROBLEM_FALLBACK_FIELD, PROBLEM_FALLBACK_GENERIC } from "@/lib/reward-levels-copy";

// Widened so TypeScript does not fold the lock into a constant: the editor must keep working when S4 flips it.
const LAUNCHED: boolean = REWARD_LEVELS_LAUNCHED;

// ── The saved blob as the editor's baseline ──────────────────────────────────

export interface RewardDraftBase {
  /** The saved setup; null when none is saved or the stored one cannot be read. */
  baseline: RewardLevelsConfig | null;
  /** Something is stored but this build cannot read it (it stays OFF), so Save must not touch it until the owner chooses. */
  unreadable: boolean;
}

// `raw` is Settings.rewardLevels as the page got it (a PUT-only blob, so its type is unknown).
export function seedRewardLevels(raw: unknown): RewardDraftBase {
  if (raw === undefined || raw === null) return { baseline: null, unreadable: false };
  const baseline = parseStoredRewardLevels(raw);
  return baseline === null ? { baseline: null, unreadable: true } : { baseline, unreadable: false };
}

// ── Equality and dirtiness ───────────────────────────────────────────────────

function deepEqual(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b || (Number.isNaN(a) && Number.isNaN(b));
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => deepEqual(item, b[index]));
  }
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  // undefined = absent, so {minBill: undefined} equals {}.
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (!deepEqual(left[key], right[key])) return false;
  }
  return true;
}

export function configsEqual(a: RewardLevelsConfig | null, b: RewardLevelsConfig | null): boolean {
  return deepEqual(a, b);
}

/**
 * Whether Save has a setup to send. `touched` matters only for an unreadable stored blob: leaving it alone sends
 * nothing, but any choice (Start over, a starter) replaces it. A draft of null on a saved setup means "cleared".
 */
export function rewardDraftDirty(base: RewardDraftBase, draft: RewardLevelsConfig | null, touched: boolean): boolean {
  if (base.unreadable) return touched;
  if (base.baseline === null) return draft !== null;
  return draft === null || !configsEqual(draft, base.baseline);
}

// ── The body the PUT carries ─────────────────────────────────────────────────

// null = cleared (the route $unsets the key). A valid draft goes through the WRITE schema so the body is exactly what
// the server will store (trimmed, lower-cased ids). An INVALID draft is returned as it is and never reaches the
// server: Save is blocked by the first problem sentence, and the route's own 400 is the second wall.
export function writeBodyOf(draft: RewardLevelsConfig | null): RewardLevelsConfig | null {
  if (draft === null) return null;
  const parsed = rewardLevelsWriteSchema.safeParse(draft);
  return parsed.success ? parsed.data : draft;
}

export function canSwitchOn(accountsOn: boolean): boolean {
  return LAUNCHED && accountsOn;
}

// A level count or size change moves where a diner stands on their card (§2.3), so the owner is warned.
export function positionShiftWarning(base: RewardLevelsConfig | null, draft: RewardLevelsConfig | null): string | null {
  if (base === null || draft === null) return null;
  if (base.levels.length !== draft.levels.length) return POSITION_SHIFT;
  const moved = base.levels.some((level, index) => !deepEqual(level.size, draft.levels[index].size));
  return moved ? POSITION_SHIFT : null;
}

// ── Number fields ────────────────────────────────────────────────────────────

// A number input shows "" for a number it cannot show (NaN / absent), never the word "NaN".
export function numberText(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? "" : String(value);
}

// A required field left blank becomes NaN, which the save gate reports as "must be a whole number".
export function requiredNumber(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

// An optional field left blank becomes ABSENT (undefined), never 0.
export function optionalNumber(text: string): number | undefined {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}

// ── The save gate, in plain words ────────────────────────────────────────────

export interface RewardProblem {
  /** 0-based level index, or null for a problem with the whole setup. */
  level: number | null;
  /** The box number (1-based step), or null for a level- or setup-wide problem. */
  step: number | null;
  /** The reward the problem is about, or null when it concerns the box or level. */
  optionId: string | null;
  /** The field to mark ("min", "max", "productId", "options", …), or null. */
  field: string | null;
  message: string;
}

// The schema's own messages for these codes are written for the owner. invalid_type is mixed: the schema's own
// sentences ("The chance must be a whole number", "Use a whole number") are kept, Zod's defaults are not.
const PLAIN_ISSUE_CODES: ReadonlySet<string> = new Set(["custom", "too_small", "too_big", "invalid_string"]);
const ZOD_DEFAULT_TYPE_MESSAGE_RE = /^(Required$|Expected |Invalid )/;

function isPlain(issue: ZodIssue): boolean {
  if (PLAIN_ISSUE_CODES.has(issue.code)) return true;
  return issue.code === "invalid_type" && !ZOD_DEFAULT_TYPE_MESSAGE_RE.test(issue.message);
}

interface IssueAt {
  level: number | null;
  step: number | null;
  optionId: string | null;
  field: string | null;
}

// Paths look like levels.<li>.slots.<si>.options.<oi>.<field> (shorter for a box, level or the setup).
function locate(issue: ZodIssue, cfg: RewardLevelsConfig): IssueAt {
  const [root, li, branch, si, inner, oi, field] = issue.path;
  const none: IssueAt = { level: null, step: null, optionId: null, field: typeof root === "string" ? root : null };
  if (root !== "levels" || typeof li !== "number") return none;
  const level = cfg.levels[li];
  if (branch === undefined) return { level: li, step: null, optionId: null, field: "levels" };
  if (branch !== "slots" || typeof si !== "number") return { level: li, step: null, optionId: null, field: typeof branch === "string" ? branch : null };
  const slot = level?.slots[si];
  const step = typeof slot?.step === "number" && Number.isFinite(slot.step) ? slot.step : null;
  if (inner !== "options") return { level: li, step, optionId: null, field: typeof inner === "string" ? inner : null };
  if (typeof oi !== "number") return { level: li, step, optionId: null, field: "options" };
  return { level: li, step, optionId: slot?.options[oi]?.id ?? null, field: typeof field === "string" ? field : null };
}

export function rewardLevelsProblems(cfg: RewardLevelsConfig | null): RewardProblem[] {
  if (cfg === null) return [];
  const parsed = rewardLevelsWriteSchema.safeParse(cfg);
  if (parsed.success) return [];
  const seen = new Set<string>();
  const problems: RewardProblem[] = [];
  for (const issue of parsed.error.issues) {
    const at = locate(issue, cfg);
    const fallback = (at.field && PROBLEM_FALLBACK_FIELD[at.field]) || PROBLEM_FALLBACK_GENERIC;
    const message = isPlain(issue) ? issue.message : fallback;
    const key = `${at.level}|${at.step}|${at.optionId}|${at.field}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push({ ...at, message });
  }
  return problems;
}

export function problemsForSlot(problems: readonly RewardProblem[], level: number, step: number): RewardProblem[] {
  return problems.filter((p) => p.level === level && p.step === step);
}

// The first message for one field of one reward (optionId null = the box's own fields, e.g. "options").
export function fieldProblem(
  problems: readonly RewardProblem[],
  level: number,
  step: number,
  optionId: string | null,
  field: string,
): string | null {
  const hit = problems.find((p) => p.level === level && p.step === step && p.optionId === optionId && p.field === field);
  return hit ? hit.message : null;
}

export function boxHasProblem(problems: readonly RewardProblem[], level: number, step: number): boolean {
  return problemsForSlot(problems, level, step).length > 0;
}

// "Level 1, box 8: The highest value must not be below the lowest".
export function problemSentence(problem: RewardProblem): string {
  if (problem.level === null) return problem.message;
  const where = problem.step === null ? `Level ${problem.level + 1}` : `Level ${problem.level + 1}, box ${problem.step}`;
  return `${where}: ${problem.message}`;
}
