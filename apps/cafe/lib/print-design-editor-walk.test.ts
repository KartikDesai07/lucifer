import { settingsOf } from "./print-template-golden.fixtures"; // FIRST (selects React's production renderer; harmless here)
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BILL_BLOCK_TYPES,
  BILL_DESIGNS,
  BILL_REQUIRED_BLOCKS,
  BLOCK_ALIGNS,
  BLOCK_SIZES,
  DIVIDER_STYLES,
  PRINT_CUSTOM_TEXT_MAX,
  PRINT_QR_BLOCKS_MAX,
  PRINT_QR_CAPTION_MAX,
  PRINT_TEMPLATE_BLOCKS_MAX,
  REPEATABLE_BLOCK_TYPES,
  isRepeatableBlockType,
  type BillBlock,
  type BillTemplate,
  type QrOptions,
} from "@pos/shared/print-template";
import { isSafeHttpsLink } from "@pos/shared/print-qr";
import { billTemplateSchema } from "@pos/shared/schemas/print-template.schema";
import {
  BILL_EDITOR,
  activate,
  addCheck,
  addRepeatable,
  moveBlock,
  moveBlockTo,
  removeBlock,
  setBaseSize,
  setBlockOn,
  setBlockStyle,
  setCustomText,
  setDividerStyle,
  setFont,
  setLogoSize,
  setQrOptions,
  writeProblems,
  EDITOR_HIDDEN_BLOCK_TYPES,
  type BlockStylePatch,
} from "@/lib/print-design-editor";
import { legacySettingsOf } from "@/hooks/use-bill-design-draft";
import { GENERIC_DESIGN_PROBLEM_TEXT, GENERIC_PROBLEM_TEXT } from "@/lib/print-design-labels";
import type { SettingsInput } from "@/schemas";

// Print customization S4 (04-S4-plan §5): (1) a seeded random walk over every editor op, and (2) the save gate's
// problems in plain words. Operations and caps: print-design-editor-ops.test.ts.

const asTemplate = (v: unknown): BillTemplate => v as BillTemplate;
const idsOf = (t: BillTemplate): string[] => t.blocks.map((b) => b.id);

/** Words only: no zod path, no field name, never "blocks." */
function assertPlain(message: string, where: string): void {
  assert.ok(message.trim().length > 0, `${where}: a message`);
  assert.ok(!message.includes("blocks."), `${where}: never "blocks." (${message})`);
  assert.ok(!/\b(?:blocks|options)\b[.[]|\[\d+\]|\.\d+(?:\.|$)/.test(message), `${where}: no zod path (${message})`);
}

// ── The random walk ──────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WALK_STEPS = 500;
const WALK_SEED = 0x5eed4;
const TEXTS = ["Thank you!", "", "   ", "x".repeat(PRINT_CUSTOM_TEXT_MAX + 1), "  padded  ", "y".repeat(PRINT_CUSTOM_TEXT_MAX)];
const QR_CHOICES: QrOptions[] = [
  { content: "upi" },
  { content: "upi", caption: "Scan to pay" },
  { content: "upi", caption: "" },
  { content: "link", url: "https://example.com/menu" },
  { content: "link", url: "https://example.com/menu", caption: "Menu" },
  { content: "link", url: "" },
  { content: "link", url: "http://insecure.example" },
  { content: "link", url: "https://has space.example" },
];
const STYLE_PATCHES: (BlockStylePatch | null)[] = [
  null, { align: "center" }, { size: "xl" }, { bold: true }, { bold: false }, { align: null }, { size: null, bold: null },
  { align: "right", size: "xs", bold: true },
];

/** The oracle for "this row cannot be saved yet", written from the contract's limits, not from the schema. */
function contentBad(block: BillBlock): boolean {
  if (block.type === "customText") {
    const length = block.options.text.trim().length;
    return length < 1 || length > PRINT_CUSTOM_TEXT_MAX;
  }
  if (block.type === "qr") {
    const caption = block.options.caption;
    const captionBad = caption !== undefined && (caption.trim().length < 1 || caption.trim().length > PRINT_QR_CAPTION_MAX);
    return captionBad || (block.options.content === "link" && !isSafeHttpsLink(block.options.url));
  }
  return false;
}

const KNOWN_KEYS = new Set(["id", "type", "on", "align", "size", "bold", "options"]);
const pick = <T>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)];

function step(r: () => number, t: BillTemplate, tally: Record<string, number>): BillTemplate {
  const block = pick(r, t.blocks);
  const ofType = (type: string): BillBlock | undefined => {
    const found = t.blocks.filter((b) => b.type === type);
    return found.length === 0 ? undefined : pick(r, found);
  };
  const kind = Math.floor(r() * 14);
  const label = ["on", "style", "logo", "divider", "text", "qr", "font", "size", "up", "down", "drag", "add", "add", "remove"][kind];
  tally[label] = (tally[label] ?? 0) + 1;
  switch (label) {
    case "on": return setBlockOn(t, block.id, r() < 0.5);
    case "style": return setBlockStyle(t, block.id, pick(r, STYLE_PATCHES));
    case "logo": return setLogoSize(t, "logo", pick(r, ["small", "medium", "large"] as const));
    case "divider": return setDividerStyle(t, ofType("divider")?.id ?? "x", r() < 0.3 ? null : pick(r, DIVIDER_STYLES));
    case "text": return setCustomText(t, ofType("customText")?.id ?? "x", pick(r, TEXTS));
    case "qr": return setQrOptions(t, ofType("qr")?.id ?? "x", pick(r, QR_CHOICES));
    case "font": return setFont(t, pick(r, ["geistMono", "mono", "sans", "condensed", "slab"] as const));
    case "size": return setBaseSize(t, pick(r, ["small", "normal", "large"] as const));
    case "up": return moveBlock(t, block.id, -1, EDITOR_HIDDEN_BLOCK_TYPES);
    case "down": return moveBlock(t, block.id, 1, EDITOR_HIDDEN_BLOCK_TYPES);
    case "drag": return moveBlockTo(t, block.id, pick(r, t.blocks).id);
    case "add": {
      const type = pick(r, REPEATABLE_BLOCK_TYPES);
      if (!addCheck(t, type).ok) {
        tally.refused = (tally.refused ?? 0) + 1;
        return t;
      }
      return addRepeatable(t, type, { upiId: r() < 0.5 ? "cafe@upi" : "" }).template;
    }
    default: return removeBlock(t, block.id);
  }
}

function invariants(t: BillTemplate, where: string, messages: Set<string>, tally: Record<string, number>): void {
  const ids = idsOf(t);
  assert.equal(new Set(ids).size, ids.length, `${where}: unique ids`);
  assert.ok(t.blocks.length <= PRINT_TEMPLATE_BLOCKS_MAX, `${where}: within the block cap`);
  assert.ok(t.blocks.filter((b) => b.type === "qr").length <= PRINT_QR_BLOCKS_MAX, `${where}: within the QR cap`);
  const types = new Set(t.blocks.map((b) => b.type));
  for (const required of BILL_REQUIRED_BLOCKS) assert.ok(types.has(required), `${where}: ${required} is still there`);
  for (const type of BILL_BLOCK_TYPES.filter((x) => !isRepeatableBlockType(x))) {
    assert.equal(t.blocks.filter((b) => b.type === type).length, 1, `${where}: ${type} exactly once`);
  }
  for (const block of t.blocks) {
    for (const [key, value] of Object.entries(block)) {
      assert.ok(KNOWN_KEYS.has(key) && value !== undefined, `${where}: ${block.id} carries no stray or undefined key (${key})`);
    }
    if (block.align !== undefined) assert.ok(BLOCK_ALIGNS.includes(block.align));
    if (block.size !== undefined) assert.ok(BLOCK_SIZES.includes(block.size));
  }
  const bad = new Set(t.blocks.filter(contentBad).map((b) => b.id));
  const problems = writeProblems(BILL_EDITOR, t);
  for (const p of problems) {
    assertPlain(p.message, where);
    messages.add(p.message);
  }
  assert.deepEqual(new Set(problems.flatMap((p) => (p.blockId === null ? [] : [p.blockId]))), bad, `${where}: problems sit on exactly the unfinished rows`);
  assert.equal(problems.some((p) => p.blockId === null), false, `${where}: no whole-design problem arises from an editor op`);
  assert.equal(billTemplateSchema.safeParse(t).success, bad.size === 0, `${where}: WRITE-valid exactly when no row is unfinished`);
  if (bad.size > 0) tally.unfinishedStates = (tally.unfinishedStates ?? 0) + 1;
}

test("random walk: 500 seeded steps per design keep the template WRITE-valid except unfinished text/QR rows, which writeProblems marks on the right row id", () => {
  const messages = new Set<string>();
  const tally: Record<string, number> = {};
  BILL_DESIGNS.forEach((design, index) => {
    const r = mulberry32(WALK_SEED + index);
    let t = activate(BILL_EDITOR, design, settingsOf({ gstEnabled: index % 2 === 0, gstRate: index % 2 === 0 ? 5 : 0 })).template;
    invariants(t, `${design} start`, messages, tally);
    for (let i = 0; i < WALK_STEPS; i++) {
      t = step(r, t, tally);
      invariants(t, `${design} step ${i}`, messages, tally);
    }
  });
  const kinds = ["on", "style", "logo", "divider", "text", "qr", "font", "size", "up", "down", "drag", "add", "remove"];
  for (const kind of kinds) assert.ok((tally[kind] ?? 0) > 0, `landmark: the walk ran a "${kind}" op`);
  assert.ok((tally.unfinishedStates ?? 0) > 0, "landmark: the walk reached unfinished-row states (else the problem check is vacuous)");
  assert.ok((tally.refused ?? 0) > 0, "landmark: the walk hit a cap and was refused");
  assert.ok(messages.size >= 2, `landmark: more than one kind of plain message was seen (${[...messages].join(" | ")})`);
});

// ── writeProblems ────────────────────────────────────────────────────────────

test("writeProblems: the three owner-worded codes pass through on the right row; everything else is one fixed sentence; never a path", () => {
  const base = activate(BILL_EDITOR, "modern", settingsOf()).template;
  assert.deepEqual(writeProblems(BILL_EDITOR, base), [], "landmark: a fresh design has no problem");

  const text = addRepeatable(base, "customText", {});
  assert.deepEqual(writeProblems(BILL_EDITOR, text.template), [{ blockId: text.id, message: "Type some text" }]);
  const tooLong = setCustomText(text.template, text.id, "z".repeat(PRINT_CUSTOM_TEXT_MAX + 1));
  assert.deepEqual(writeProblems(BILL_EDITOR, tooLong), [{ blockId: text.id, message: `Keep it under ${PRINT_CUSTOM_TEXT_MAX} characters` }]);

  const link = setQrOptions(base, "qr-1", { content: "link", url: "http://insecure.example" });
  const [linkProblem] = writeProblems(BILL_EDITOR, link);
  assert.equal(linkProblem.blockId, "qr-1");
  assert.ok(linkProblem.message.includes("https://"), linkProblem.message);
  const caption = setQrOptions(base, "qr-1", { content: "upi", caption: "" });
  assert.deepEqual(writeProblems(BILL_EDITOR, caption), [{ blockId: "qr-1", message: "Type a caption or remove it" }]);

  const missing = asTemplate({ ...base, blocks: base.blocks.filter((b) => b.type !== "gstin") });
  assert.deepEqual(writeProblems(BILL_EDITOR, missing), [{ blockId: null, message: "The gstin line has to stay on this slip" }], "a design-level problem has no row");
  const stray = asTemplate({ ...base, blocks: base.blocks.map((b) => (b.id === "name" ? { ...b, shout: true } : b)) });
  assert.deepEqual(writeProblems(BILL_EDITOR, stray), [{ blockId: "name", message: GENERIC_PROBLEM_TEXT }], "a key the editor never writes: the fixed sentence, on that row");
  const twin = asTemplate({ ...base, blocks: [...base.blocks, { ...base.blocks[1] }] });
  const twinProblems = writeProblems(BILL_EDITOR, twin);
  assert.ok(twinProblems.length > 0 && twinProblems.every((p) => p.blockId === "name"), JSON.stringify(twinProblems));
  const wrongFont = asTemplate({ ...base, font: "comic" });
  assert.deepEqual(writeProblems(BILL_EDITOR, wrongFont), [{ blockId: null, message: GENERIC_DESIGN_PROBLEM_TEXT }]);

  const corrupt: unknown[] = [missing, stray, twin, wrongFont, { ...base, blocks: "nope" }, { ...base, v: 2 }, { ...base, blocks: [null] }, {}, 7];
  for (const [i, bad] of corrupt.entries()) {
    const problems = writeProblems(BILL_EDITOR, asTemplate(bad));
    assert.ok(problems.length > 0, `corrupt #${i}: reported`);
    for (const p of problems) assertPlain(p.message, `corrupt #${i}`);
  }
});

// ── The hook's pure helper ───────────────────────────────────────────────────

test("legacySettingsOf: the form's eight unsaved legacy toggles lie over the saved settings; nothing else is touched", () => {
  const saved = settingsOf({ billShowLogo: true, billShowNumber: true, billFontSize: "small", billLogoSize: "medium" });
  // Only the eight fields it reads matter; the cast stands in for a whole form value.
  const values = {
    billShowNumber: false, billShowLogo: false, billLogoSize: "large", billShowAddress: false,
    billShowMobile: false, billShowGstNumber: false, billShowFssai: false, billFontSize: "large",
  } as SettingsInput;
  const merged = legacySettingsOf(saved, values);
  assert.deepEqual(
    [merged.billShowNumber, merged.billShowLogo, merged.billLogoSize, merged.billShowAddress, merged.billShowMobile, merged.billShowGstNumber, merged.billShowFssai, merged.billFontSize],
    [false, false, "large", false, false, false, false, "large"],
  );
  assert.equal(merged.restaurantName, saved.restaurantName, "landmark: the rest of the saved settings is kept");
  assert.equal(saved.billShowLogo, true, "the saved settings object itself is not mutated");
  const classic = activate(BILL_EDITOR, "classic", merged).template;
  assert.equal(classic.blocks.find((b) => b.type === "logo")?.on, false, "Classic starts from the toggles as they stand on screen");
});
