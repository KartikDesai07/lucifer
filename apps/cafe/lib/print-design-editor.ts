import type { ZodIssue, ZodType } from "zod";

import {
  BILL_BLOCK_TYPES,
  BILL_LOCKS,
  BILL_REQUIRED_BLOCKS,
  KOT_BLOCK_TYPES,
  KOT_LOCKS,
  KOT_REQUIRED_BLOCKS,
  PRINT_FONT_KEYS,
  TOKEN_BLOCK_TYPES,
  TOKEN_LOCKS,
  TOKEN_REQUIRED_BLOCKS,
  billBlockLocked,
  isRepeatableBlockType,
  kotBlockLocked,
  tokenBlockLocked,
  type BillBlockType,
  type BillTemplate,
  type KotBlockType,
  type KotTemplate,
  type PrintFontKey,
  type SlipLockContext,
  type TokenBlockType,
  type TokenTemplate,
} from "@pos/shared/print-template";
import { PRINT_FONT_CATALOG, PRINT_FONT_KEY_FACE } from "@pos/shared/print-fonts";
import { billTemplateSchema, kotTemplateSchema, tokenTemplateSchema } from "@pos/shared/schemas/print-template.schema";
import { defaultBillTemplate, defaultKotTemplate, defaultTokenTemplate } from "@/lib/print-template-designs";
import {
  readBillTemplate,
  readKotTemplate,
  readTokenTemplate,
  withRequiredBlocks,
  type SlipTemplateRead,
} from "@/lib/print-template-resolve";
import { GENERIC_DESIGN_PROBLEM_TEXT, GENERIC_PROBLEM_TEXT } from "@/lib/print-design-labels";
import type { EditableTemplate, LockReason } from "@/lib/print-design-editor-ops";
import type { Settings } from "@/types";

export * from "@/lib/print-design-editor-ops";

// The slip design editor's model (print customization S4 bill, S5 kitchen ticket, S7 token slip; 04-S4-plan D8). The WRITE gate is imported HERE and
// nowhere else in the app, so the receipt and POS bundles (which only ever READ a template) never carry it.
// Pure: no React, no fetch.

export type EditorSettings = Settings | null | undefined;

interface LockTables {
  always: readonly string[];
  withGst: readonly string[];
  withFssai: readonly string[];
  withBanner: readonly string[];
}

export interface SlipKindSpec<T extends EditableTemplate> {
  kind: "bill" | "kot" | "token";
  /** Every block type of the kind (the catalog). */
  catalog: readonly string[];
  /** The lines the save gate keeps on a slip. */
  required: readonly string[];
  /** Lines the person never sees a row for (none today; up/down still step over any listed here). */
  hidden: readonly string[];
  /** Lines whose `on` is always true in the editor: another control switches them (Show bill / ticket number). */
  forcedOn: readonly string[];
  locks: LockTables;
  isLocked(type: string, ctx: SlipLockContext): boolean;
  defaultTemplate(design: T["design"], settings: EditorSettings): T;
  readTemplate(settings: EditorSettings): SlipTemplateRead<T>;
  /** The WRITE gate. */
  schema: ZodType<T>;
}

// Every line has a row. The token line (S6) prints once tokens are on; the kitchen station line prints on a ticket
// that Printer setup splits by station (stationLine). A stored row stays where it was saved (MIN-3 (a)).
export const EDITOR_HIDDEN_BLOCK_TYPES: readonly string[] = [];

const BILL_TYPE_SET: ReadonlySet<string> = new Set(BILL_BLOCK_TYPES);
const KOT_TYPE_SET: ReadonlySet<string> = new Set(KOT_BLOCK_TYPES);
const TOKEN_TYPE_SET: ReadonlySet<string> = new Set(TOKEN_BLOCK_TYPES);

export const BILL_EDITOR: SlipKindSpec<BillTemplate> = {
  kind: "bill",
  catalog: BILL_BLOCK_TYPES,
  required: BILL_REQUIRED_BLOCKS,
  hidden: EDITOR_HIDDEN_BLOCK_TYPES,
  // "Show bill number" is the only control for the bill number (owner Q1, plan Amendment A7).
  forcedOn: ["billNo"],
  locks: BILL_LOCKS,
  isLocked: (type, ctx) => BILL_TYPE_SET.has(type) && billBlockLocked(type as BillBlockType, ctx),
  defaultTemplate: (design, settings) => defaultBillTemplate(design, settings),
  readTemplate: (settings) => readBillTemplate(settings),
  schema: billTemplateSchema,
};

export const KOT_EDITOR: SlipKindSpec<KotTemplate> = {
  kind: "kot",
  catalog: KOT_BLOCK_TYPES,
  required: KOT_REQUIRED_BLOCKS,
  hidden: EDITOR_HIDDEN_BLOCK_TYPES,
  // "Show ticket number" is the only control for the ticket number (owner Q1, plan Amendment A8).
  forcedOn: ["kotNo"],
  locks: KOT_LOCKS,
  isLocked: (type, ctx) => KOT_TYPE_SET.has(type) && kotBlockLocked(type as KotBlockType, ctx),
  defaultTemplate: (design, settings) => defaultKotTemplate(design, settings),
  readTemplate: (settings) => readKotTemplate(settings),
  schema: kotTemplateSchema,
};

// The token slip (S7): every line has its own switch; only the number is locked on (TOKEN_LOCKS.always).
export const TOKEN_EDITOR: SlipKindSpec<TokenTemplate> = {
  kind: "token",
  catalog: TOKEN_BLOCK_TYPES,
  required: TOKEN_REQUIRED_BLOCKS,
  hidden: [],
  forcedOn: [],
  locks: TOKEN_LOCKS,
  isLocked: (type, ctx) => TOKEN_TYPE_SET.has(type) && tokenBlockLocked(type as TokenBlockType, ctx),
  defaultTemplate: (design, settings) => defaultTokenTemplate(design, settings),
  readTemplate: (settings) => readTokenTemplate(settings),
  schema: tokenTemplateSchema,
};

// ── Locks ────────────────────────────────────────────────────────────────────

/** The lock context the editor shows: the SAVED settings' GST state (what BillPrintCard and the receipt use) and FSSAI. */
export function lockContextOf(settings: EditorSettings): SlipLockContext {
  return {
    gst: Boolean(settings?.gstEnabled) && (settings?.gstRate ?? 0) > 0,
    fssai: Boolean(settings?.fssai?.trim()),
    banner: false,
  };
}

/** Why a line is locked in this context, or null when it is free. Never disagrees with spec.isLocked. */
export function lockReasonOf<T extends EditableTemplate>(
  spec: SlipKindSpec<T>,
  type: string,
  ctx: SlipLockContext,
): LockReason | null {
  if (!spec.isLocked(type, ctx)) return null;
  if (spec.locks.always.includes(type)) return "always";
  if (ctx.banner && spec.locks.withBanner.includes(type)) return "banner";
  if (ctx.gst && spec.locks.withGst.includes(type)) return "gst";
  return "fssai";
}

// ── Starting a design ────────────────────────────────────────────────────────

export interface Activated<T extends EditableTemplate> {
  template: T;
  /** The types that were off in the design's default but are locked here, so they were switched on. */
  turnedOn: string[];
}

/**
 * The design as the editor starts it: its default list with every line locked in this context switched on, and the
 * number line on (the converter copies "Show bill number" / "Show ticket number" into it, which would strand the
 * number once the switch changes). Classic's default is Classic-from-legacy, so it follows `settings`' legacy toggles.
 */
export function activate<T extends EditableTemplate>(
  spec: SlipKindSpec<T>,
  design: T["design"],
  settings: EditorSettings,
): Activated<T> {
  const ctx = lockContextOf(settings);
  const base = spec.defaultTemplate(design, settings);
  const turnedOn: string[] = [];
  const blocks = base.blocks.map((block) => {
    if (spec.forcedOn.includes(block.type)) return block.on ? block : { ...block, on: true };
    if (!block.on && spec.isLocked(block.type, ctx)) {
      turnedOn.push(block.type);
      return { ...block, on: true };
    }
    return block;
  });
  return { template: { ...base, blocks }, turnedOn };
}

// ── Comparing ────────────────────────────────────────────────────────────────

// Key order and an `undefined` value do not matter; the ORDER of the blocks does.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) out[key] = canonical(item);
    }
    return out;
  }
  return value;
}

export function templatesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** Whether the draft differs from its own design's starting point (a switch of design or a Reset would lose work). */
export function isEdited<T extends EditableTemplate>(spec: SlipKindSpec<T>, draft: T, settings: EditorSettings): boolean {
  return !templatesEqual(draft, activate(spec, draft.design, settings).template);
}

// ── The saved design as the editor's baseline ────────────────────────────────

export interface DraftBase<T extends EditableTemplate> {
  /** The saved design, normalized; null when none is saved or the stored one cannot be read. */
  baseline: T | null;
  /** A design is stored but cannot be read, so the page prints today's bill (the resolver's "unreadable"). */
  unreadable: boolean;
}

// The resolver only puts back the lines the save gate requires. The editor shows a row for every line of the
// catalog, so any other missing one is put back off, after its neighbour in the design's own order.
export function normalizeTemplate<T extends EditableTemplate>(spec: SlipKindSpec<T>, template: T, settings: EditorSettings): T {
  const fixed = spec.catalog.filter((type) => !isRepeatableBlockType(type));
  const filled = withRequiredBlocks(template.blocks, fixed, () => spec.defaultTemplate(template.design, settings).blocks);
  const blocks = filled.map((block) => (spec.forcedOn.includes(block.type) && !block.on ? { ...block, on: true } : block));
  return { ...template, blocks };
}

export function baselineOf<T extends EditableTemplate>(spec: SlipKindSpec<T>, settings: EditorSettings): DraftBase<T> {
  const read = spec.readTemplate(settings);
  if (read.state === "ok") return { baseline: normalizeTemplate(spec, read.template, settings), unreadable: false };
  return { baseline: null, unreadable: read.state === "unreadable" };
}

/**
 * Whether Save has a design to send. `touched` matters only for an unreadable stored design: leaving it alone sends
 * nothing, but any choice (a design, Today's bill) replaces it.
 */
export function draftDirty<T extends EditableTemplate>(base: DraftBase<T>, draft: T | null, touched: boolean): boolean {
  if (base.unreadable) return touched;
  if (base.baseline === null) return draft !== null;
  return draft === null || !templatesEqual(draft, base.baseline);
}

// ── The save gate, in plain words ────────────────────────────────────────────

export interface WriteProblem {
  /** The row to mark, or null for a problem with the design as a whole. */
  blockId: string | null;
  message: string;
}

// The schema's own messages for these three codes are written for the owner; anything else is a shape fault
// (a key or value the editor could not have produced), so it gets one fixed sentence and never a path.
const PLAIN_ISSUE_CODES: ReadonlySet<string> = new Set(["custom", "too_small", "too_big"]);

function blockIdOf(issue: ZodIssue, template: EditableTemplate): string | null {
  const [root, index] = issue.path;
  if (root !== "blocks" || typeof index !== "number") return null;
  return template.blocks[index]?.id ?? null;
}

export function writeProblems<T extends EditableTemplate>(spec: SlipKindSpec<T>, template: T): WriteProblem[] {
  const parsed = spec.schema.safeParse(template);
  if (parsed.success) return [];
  const seen = new Set<string>();
  const problems: WriteProblem[] = [];
  for (const issue of parsed.error.issues) {
    const blockId = blockIdOf(issue, template);
    const fallback = blockId === null ? GENERIC_DESIGN_PROBLEM_TEXT : GENERIC_PROBLEM_TEXT;
    const message = PLAIN_ISSUE_CODES.has(issue.code) ? issue.message : fallback;
    const key = `${blockId ?? ""}|${message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    problems.push({ blockId, message });
  }
  return problems;
}

// ── Fonts ────────────────────────────────────────────────────────────────────

/** The base faces the editor offers: the legacy face plus every face whose digits line up (a slab never prints an amount). */
export const BASE_FONT_CHOICES: readonly PrintFontKey[] = PRINT_FONT_KEYS.filter(
  (key) => key === "geistMono" || PRINT_FONT_CATALOG[PRINT_FONT_KEY_FACE[key]].numbers,
);
