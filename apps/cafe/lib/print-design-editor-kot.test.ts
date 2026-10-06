import { settingsOf } from "./print-template-golden.fixtures"; // FIRST: it selects React's production renderer before react loads
import { test } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  KOT_BLOCK_TYPES,
  KOT_DESIGNS,
  KOT_REQUIRED_BLOCKS,
  PRINT_CUSTOM_TEXT_MAX,
  PRINT_QR_BLOCKS_MAX,
  PRINT_QR_CAPTION_MAX,
  PRINT_TEMPLATE_BLOCKS_MAX,
  REPEATABLE_BLOCK_TYPES,
  isRepeatableBlockType,
  kotBlockLocked,
  type KotBlock,
  type KotTemplate,
  type SlipLockContext,
} from "@pos/shared/print-template";
import { isSafeHttpsLink } from "@pos/shared/print-qr";
import { printOrderSnapshot } from "@pos/shared/print-job";
import {
  KOT_EDITOR,
  activate,
  addCheck,
  addRepeatable,
  lockReasonOf,
  moveBlock,
  moveBlockTo,
  removeBlock,
  setBaseSize,
  setBlockOn,
  setBlockStyle,
  setCustomText,
  setDividerStyle,
  setFont,
  setKotItemsPrices,
  setLogoSize,
  setQrOptions,
  writeProblems,
  EDITOR_HIDDEN_BLOCK_TYPES,
} from "@/lib/print-design-editor";
import { BILL_KIND, KOT_KIND } from "@/lib/print-design-kinds";
import { KOT_BANNER_NOTE, KOT_PRICES_NEEDED_NOTE, KOT_VOID_ITEMS_NOTE, KITCHEN_PREVIEW_CHIPS, TOKEN_ROW_NOTE } from "@/lib/print-design-labels";
import { legacyKotSettingsOf } from "@/hooks/use-kot-design-draft";
import { sampleKitchenOrder, sampleKitchenSlip, SAMPLE_MOVED_FROM, SAMPLE_VOID_REASON } from "@/lib/bill-print-sample";
import { hostPrintSlipOf, orderFromSnapshot } from "@/lib/print-host-slips";
import { classicKotTemplate } from "@/lib/print-template-legacy";
import { printConfigOf } from "@/lib/print";
import { KOTReceipt } from "@/components/pos/KOTReceipt";
import type { SettingsInput } from "@/schemas";
import type { Settings } from "@/types";

// Print customization S5 (05-S5-plan §5): the kitchen-ticket side of the editor's model (UI pins: kot-design-editor-paths.test.ts).
(globalThis as { React?: typeof React }).React = React;

const KOT_TOGGLES = ["kotShowNumber", "kotShowLogo", "kotShowRestaurantName", "kotShowTable", "kotShowTime", "kotShowStaff", "kotShowNotes", "kotShowPrices", "kotShowTotal"] as const;
const CTXS: SlipLockContext[] = [false, true].flatMap((gst) => [false, true].flatMap((fssai) => [false, true].map((banner) => ({ gst, fssai, banner }))));
const itemsOf = (t: KotTemplate): Extract<KotBlock, { type: "items" }> => t.blocks.find((b) => b.type === "items") as Extract<KotBlock, { type: "items" }>;

test("activate: both KOT designs over all 2^9 legacy toggle masks are WRITE-valid, kotNo on, and turn nothing on (a KOT has no always-on line)", () => {
  let cells = 0;
  for (const design of KOT_DESIGNS) {
    for (let mask = 0; mask < 1 << KOT_TOGGLES.length; mask++) {
      const flags = Object.fromEntries(KOT_TOGGLES.map((k, bit) => [k, (mask & (1 << bit)) !== 0]));
      for (const lockExtras of [{}, { gstEnabled: true, gstRate: 5, fssai: "11223344556677" }]) {
        const { template, turnedOn } = activate(KOT_EDITOR, design, settingsOf({ ...flags, ...lockExtras }));
        const cell = `${design} mask=${mask} ${JSON.stringify(lockExtras)}`;
        assert.deepEqual(writeProblems(KOT_EDITOR, template), [], `${cell}: WRITE-valid`);
        assert.equal(template.design, design);
        assert.equal(template.blocks.find((b) => b.type === "kotNo")?.on, true, `${cell}: kotNo is on (Show ticket number alone decides)`);
        // The "turned on" notice copy says "bill"; a ticket must never reach it. Pinned so a future always-on KOT lock is a deliberate change.
        assert.deepEqual(turnedOn, [], `${cell}: nothing is switched on by a lock`);
        cells++;
      }
    }
  }
  assert.equal(cells, KOT_DESIGNS.length * 512 * 2);
  const noNumber = settingsOf({ kotShowNumber: false });
  assert.equal(classicKotTemplate(noNumber).blocks.find((b) => b.type === "kotNo")?.on, false, "landmark: the converter copies Show ticket number into kotNo.on");
  assert.equal(activate(KOT_EDITOR, "classic", noNumber).template.blocks.find((b) => b.type === "kotNo")?.on, true, "...and activate normalizes it on");
});

test("lockReasonOf(KOT_EDITOR) equals kotBlockLocked for every KOT type x every lock context; only title / table / items lock, only with the banner", () => {
  let locked = 0;
  for (const type of KOT_BLOCK_TYPES) {
    for (const ctx of CTXS) {
      const reason = lockReasonOf(KOT_EDITOR, type, ctx);
      assert.equal(reason !== null, kotBlockLocked(type, ctx), `${type} ${JSON.stringify(ctx)}`);
          if (reason !== null) {
        locked++;
        assert.equal(reason, "banner", `${type}: the only KOT lock reason`);
        assert.ok(ctx.banner && ["title", "table", "items"].includes(type), `${type} locks only with the banner`);
      }
    }
  }
  assert.equal(locked, 3 * 4, "landmark: three lines x the four banner contexts");
  assert.equal(lockReasonOf(KOT_EDITOR, "billNo", { gst: true, fssai: true, banner: true }), null, "a bill-only type is never a KOT lock");
  assert.deepEqual([[...KOT_EDITOR.required], [...KOT_EDITOR.forcedOn], [...KOT_EDITOR.hidden]], [[...KOT_REQUIRED_BLOCKS], ["kotNo"], ["station"]]);
  assert.ok(KOT_BLOCK_TYPES.includes("token") && !KOT_EDITOR.hidden.includes("token"), "S6: the token line is in the catalog and now has an editor row (only station stays hidden)");
});

test("legacyKotSettingsOf touches exactly the ten fields classicKotTemplate reads, and each one really is read (none missing, none spare)", () => {
  const FIELDS = [...KOT_TOGGLES, "kotFontSize"] as const;
  const saved = settingsOf({ kotShowNumber: false, kotShowLogo: false, kotShowRestaurantName: false, kotShowTable: false, kotShowTime: false, kotShowStaff: false, kotShowNotes: false, kotShowPrices: false, kotShowTotal: false, kotFontSize: "small", kotNumberStart: 5, kotNumberVoidSlips: false, kotPaperWidth: "80mm" });
  const values = { kotShowNumber: true, kotShowLogo: true, kotShowRestaurantName: true, kotShowTable: true, kotShowTime: true, kotShowStaff: true, kotShowNotes: true, kotShowPrices: true, kotShowTotal: true, kotFontSize: "large", kotNumberStart: 99, kotNumberVoidSlips: true, kotPaperWidth: "58mm", restaurantName: "Other" } as SettingsInput;
  const merged = legacyKotSettingsOf(saved, values);
  const changed = (Object.keys(merged) as (keyof Settings)[]).filter((k) => merged[k] !== saved[k]).sort();
  assert.deepEqual(changed, [...FIELDS].sort(), "exactly the ten legacy fields change");
  for (const k of ["kotNumberStart", "kotNumberVoidSlips", "kotPaperWidth", "restaurantName"] as const) assert.equal(merged[k], saved[k], `${k} is Settings policy, not template: untouched`);
  assert.equal(saved.kotShowNumber, false, "the saved object is not mutated");
  // Semantics: every listed field changes the Classic start; the unlisted kot fields do not.
  const base = settingsOf({ ...Object.fromEntries(KOT_TOGGLES.map((k) => [k, false])), kotShowPrices: true, kotFontSize: "normal" });
  const flip = (k: keyof Settings): Settings => ({ ...base, [k]: typeof base[k] === "boolean" ? !base[k] : k === "kotFontSize" ? "large" : k === "kotPaperWidth" ? "58mm" : 99 });
  const baseJson = JSON.stringify(classicKotTemplate(base));
  for (const k of FIELDS) assert.notEqual(JSON.stringify(classicKotTemplate(flip(k))), baseJson, `${k} is read by Classic-from-legacy`);
  for (const k of ["kotNumberStart", "kotNumberVoidSlips", "kotPaperWidth"] as const) assert.equal(JSON.stringify(classicKotTemplate(flip(k))), baseJson, `${k} is not read by Classic-from-legacy`);
  assert.equal(activate(KOT_EDITOR, "classic", merged).template.blocks.find((b) => b.type === "logo")?.on, true, "Classic starts from the toggles as they stand on screen");
});

test("kinds: KOT_KIND.bodyOf -> { kotTemplate }, BILL_KIND.bodyOf -> { billTemplate }; null clears; withDraft sets only its own key", () => {
  const t = activate(KOT_EDITOR, "classic", settingsOf()).template;
  assert.deepEqual(KOT_KIND.bodyOf(t), { kotTemplate: t });
  assert.deepEqual(KOT_KIND.bodyOf(null), { kotTemplate: null });
  assert.deepEqual(BILL_KIND.bodyOf(null), { billTemplate: null });
  const s = settingsOf({ billTemplate: "keep" });
  assert.deepEqual({ k: KOT_KIND.withDraft(s, t).kotTemplate, b: KOT_KIND.withDraft(s, t).billTemplate }, { k: t, b: "keep" });
  assert.equal(BILL_KIND.withDraft(s, null).billTemplate, null);
  assert.deepEqual([KOT_KIND.allowUpiQr, BILL_KIND.allowUpiQr, KOT_KIND.spec === KOT_EDITOR], [false, true, true]);
});

test("KOT_KIND.noteOf: the token note on token, the banner note on title / table, the void-only note on items (a moved ticket lists no dishes), the prices note on roundTotal only while items.prices is off, nothing else", () => {
  const t = activate(KOT_EDITOR, "classic", settingsOf({ kotShowPrices: false })).template;
  const priced = setKotItemsPrices(t, "items", true);
  assert.equal(itemsOf(t).options.prices, false, "landmark: prices start off");
  assert.equal(itemsOf(priced).options.prices, true, "landmark: and the op turned them on");
  for (const block of t.blocks) {
    const banner = block.type === "token" ? TOKEN_ROW_NOTE : block.type === "items" ? KOT_VOID_ITEMS_NOTE : ["title", "table"].includes(block.type) ? KOT_BANNER_NOTE : null;
    const expectOff = banner ?? (block.type === "roundTotal" ? KOT_PRICES_NEEDED_NOTE : null);
    assert.equal(KOT_KIND.noteOf(block, t), expectOff, `${block.type} (prices off)`);
    assert.equal(KOT_KIND.noteOf(block, priced), banner, `${block.type} (prices on)`);
  }
  assert.ok(t.blocks.some((b) => b.type === "token"), "landmark: the Classic ticket carries a token line, so the loop above pinned its note");
  assert.equal(BILL_KIND.noteOf(t.blocks[0], t as never), null, "the bill kind shows no note on an ordinary line");
});

test("addRepeatable(..., allowUpi=false) starts a LINK qr even with a valid UPI id; the default still starts UPI", () => {
  const t = activate(KOT_EDITOR, "kitchenBold", settingsOf()).template;
  const upi = { upiId: "cafe@okaxis" };
  const lastOptions = (template: KotTemplate): unknown => (template.blocks.at(-1) as { options?: unknown } | undefined)?.options;
  assert.deepEqual(lastOptions(addRepeatable(t, "qr", upi, false).template), { content: "link", url: "" });
  assert.deepEqual(lastOptions(addRepeatable(t, "qr", upi).template), { content: "upi" }, "landmark: the default (bill) still starts UPI");
  const link = addRepeatable(t, "qr", upi, false);
  assert.deepEqual(writeProblems(KOT_EDITOR, link.template).map((p) => p.blockId), [link.id], "the empty link is an unfinished row, never a UPI the KOT gate would refuse");
});

test("setKotItemsPrices writes only `prices`: modifiers / instructions stay as stored; other blocks and a missing id are untouched", () => {
  const t = activate(KOT_EDITOR, "classic", settingsOf()).template;
  const odd: KotTemplate = { ...t, blocks: t.blocks.map((b) => (b.type === "items" ? { ...b, options: { prices: false, modifiers: false, instructions: true } } : b)) };
  const on = setKotItemsPrices(odd, "items", true);
  assert.deepEqual(itemsOf(on).options, { prices: true, modifiers: false, instructions: true });
  assert.deepEqual(itemsOf(setKotItemsPrices(on, "items", false)).options, { prices: false, modifiers: false, instructions: true });
  assert.deepEqual(on.blocks.filter((b) => b.type !== "items"), odd.blocks.filter((b) => b.type !== "items"));
  assert.equal(setKotItemsPrices(odd, "nope", true), odd, "unknown id: same object");
  assert.deepEqual(setKotItemsPrices(odd, "notes", true), odd, "a non-items block: nothing changes");
});

// ── sampleKitchenSlip == the real slips ─────────────────────────────────────────────────────────────────────────────

const render = (order: Parameters<typeof orderFromSnapshot>[0] & object, props: object): string =>
  renderToStaticMarkup(createElement(KOTReceipt, { order: order as never, settings: settingsOf({ kotShowNumber: true, kotShowPrices: true }), ...props }));

test("sampleKitchenSlip(chip) equals what lib/print-host-slips.ts builds for a fired round, a voided line and a table move (fields and rendered ticket)", () => {
  assert.deepEqual([...KITCHEN_PREVIEW_CHIPS], ["kot", "void", "moved"]);
  const order = sampleKitchenOrder("2026-10-05T09:30:00.000Z");
  for (const numberVoidSlips of [true, false]) {
    for (const numberStart of [1, 41]) {
      const cfg = printConfigOf(settingsOf({ kotNumberStart: numberStart, kotNumberVoidSlips: numberVoidSlips })).kot;
      assert.equal(cfg.numberStart, numberStart, "landmark: the live config carries the start");
      const numbered = { ...order, kotNumbers: [numberStart] };
      const snapshot = printOrderSnapshot(numbered);
      const slipOf = (payload: Parameters<typeof hostPrintSlipOf>[0]) => {
        const slip = hostPrintSlipOf(payload, "2026-10-05");
        assert.equal(slip.surface, "kot");
        return slip.surface === "kot" ? slip : (null as never);
      };
      const cell = `start=${numberStart} numberVoidSlips=${numberVoidSlips}`;

      const kot = slipOf({ kind: "kot", snapshot, round: 1 });
      const sampleKot = sampleKitchenSlip("kot", order, cfg);
      assert.deepEqual([sampleKot.roundLabel, sampleKot.roundNumber], [kot.kotRoundLabel, kot.kotRoundNumber], `${cell}: kot round label and number`);
      assert.deepEqual(kot.kotRoundItems?.map((i) => i.name), order.items.map((i) => i.name), `${cell}: a fired round lists the order's items`);
          assert.equal(render(order, sampleKot), render(orderFromSnapshot(snapshot), { roundItems: kot.kotRoundItems, roundLabel: kot.kotRoundLabel, roundNumber: kot.kotRoundNumber, variant: kot.kotVariant }), `${cell}: kot renders the same ticket`);

      const sampleVoid = sampleKitchenSlip("void", order, cfg);
      const line = { ...(sampleVoid.roundItems?.[0] as NonNullable<typeof sampleVoid.roundItems>[number]), kotNumber: numberVoidSlips ? numberStart : undefined };
      assert.deepEqual(sampleVoid.roundItems?.map((i) => [i.name, i.qty]), [[order.items[0].name, 1]], `${cell}: a void slip is one line, one unit`);
      const voided = slipOf({ kind: "void", snapshot, line, reason: SAMPLE_VOID_REASON, voidedBy: order.receiver, voidedAt: order.createdAt });
      assert.deepEqual(
        { v: sampleVoid.variant, l: sampleVoid.roundLabel, n: sampleVoid.roundNumber, r: sampleVoid.reason, by: sampleVoid.voidedBy, at: sampleVoid.voidedAt },
        { v: voided.kotVariant, l: voided.kotRoundLabel, n: voided.kotRoundNumber, r: voided.voidReason, by: voided.voidedBy, at: voided.voidedAt },
        `${cell}: void fields`,
      );
      assert.equal(voided.kotRoundNumber, numberVoidSlips ? numberStart : undefined, `${cell}: a void is numbered only when voids are numbered`);
      assert.equal(render(order, sampleVoid), render(orderFromSnapshot(snapshot), { roundItems: voided.kotRoundItems, roundLabel: voided.kotRoundLabel, roundNumber: voided.kotRoundNumber, variant: voided.kotVariant, reason: voided.voidReason, voidedBy: voided.voidedBy, voidedAt: voided.voidedAt }), `${cell}: void renders the same ticket`);

      const sampleMoved = sampleKitchenSlip("moved", order, cfg);
      const moved = slipOf({ kind: "moved", snapshot, from: SAMPLE_MOVED_FROM, movedBy: order.receiver, movedAt: order.createdAt });
      assert.deepEqual(
        { v: sampleMoved.variant, f: sampleMoved.movedFrom, by: sampleMoved.movedBy, at: sampleMoved.movedAt, l: sampleMoved.roundLabel, n: sampleMoved.roundNumber, i: sampleMoved.roundItems },
        { v: moved.kotVariant, f: moved.movedFrom, by: moved.movedBy, at: moved.movedAt, l: moved.kotRoundLabel, n: moved.kotRoundNumber, i: moved.kotRoundItems },
        `${cell}: moved fields (no round line, no number, no items)`,
      );
      assert.equal(render(order, sampleMoved), render(orderFromSnapshot(snapshot), { variant: moved.kotVariant, movedFrom: moved.movedFrom, movedBy: moved.movedBy, movedAt: moved.movedAt }), `${cell}: moved renders the same ticket`);
    }
  }
});

// ── The seeded walk, on both KOT designs ───────────────────────────────────────────────────────────────────────────

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
const WALK_SEED = 0x5eed5;
const pick = <T,>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)];
const TEXTS = ["Thank you!", "", "   ", "x".repeat(PRINT_CUSTOM_TEXT_MAX + 1), "  padded  "];
const QR_LINKS = [{ content: "link", url: "https://example.com/menu" }, { content: "link", url: "" }, { content: "link", url: "http://insecure.example" }, { content: "link", url: "https://example.com/m", caption: "" }, { content: "link", url: "https://example.com/m", caption: "Menu" }] as const;

/** Which rows cannot be saved yet, written from the contract's limits, not from the schema. */
function unfinished(block: KotBlock): boolean {
  if (block.type === "customText") return block.options.text.trim().length < 1 || block.options.text.trim().length > PRINT_CUSTOM_TEXT_MAX;
  if (block.type === "qr") {
    const caption = (block.options as { caption?: string }).caption;
    const badCaption = caption !== undefined && (caption.trim().length < 1 || caption.trim().length > PRINT_QR_CAPTION_MAX);
    return badCaption || !isSafeHttpsLink((block.options as { url: string }).url);
  }
  return false;
}

function step(r: () => number, t: KotTemplate, tally: Record<string, number>): KotTemplate {
  const block = pick(r, t.blocks);
  const of = (type: string): string => pick(r, t.blocks.filter((b) => b.type === type).concat({ id: "x" } as KotBlock)).id;
  const label = pick(r, ["on", "style", "logo", "divider", "text", "qr", "prices", "prices", "font", "size", "up", "down", "drag", "add", "add", "remove"]);
  tally[label] = (tally[label] ?? 0) + 1;
  switch (label) {
    case "on": return setBlockOn(t, block.id, r() < 0.5);
    case "style": return setBlockStyle(t, block.id, pick(r, [null, { align: "center" }, { size: "xl" }, { bold: true }, { align: null }] as const));
    case "logo": return setLogoSize(t, "logo", pick(r, ["small", "medium", "large"] as const));
    case "divider": return setDividerStyle(t, of("divider"), r() < 0.3 ? null : pick(r, ["dashed", "solid", "double", "blank", "ornament"] as const));
    case "text": return setCustomText(t, of("customText"), pick(r, TEXTS));
    case "qr": return setQrOptions(t, of("qr"), pick(r, QR_LINKS) as never);
    case "prices": return setKotItemsPrices(t, "items", r() < 0.5);
    case "font": return setFont(t, pick(r, ["geistMono", "mono", "sans", "condensed", "slab"] as const));
    case "size": return setBaseSize(t, pick(r, ["small", "normal", "large"] as const));
    case "up": return moveBlock(t, block.id, -1, EDITOR_HIDDEN_BLOCK_TYPES);
    case "down": return moveBlock(t, block.id, 1, EDITOR_HIDDEN_BLOCK_TYPES);
    case "drag": return moveBlockTo(t, block.id, pick(r, t.blocks).id);
    case "add": {
      const type = pick(r, REPEATABLE_BLOCK_TYPES);
      if (!addCheck(t, type).ok) { tally.refused = (tally.refused ?? 0) + 1; return t; }
      return addRepeatable(t, type, { upiId: "cafe@upi" }, KOT_KIND.allowUpiQr).template;
    }
    default: return removeBlock(t, block.id);
  }
}

test("random walk: 500 seeded steps per KOT design stay WRITE-valid except unfinished text / QR rows (reported on the right row); the items flags never move", () => {
  const tally: Record<string, number> = {};
  KOT_DESIGNS.forEach((design, index) => {
    const r = mulberry32(WALK_SEED + index);
    let t = activate(KOT_EDITOR, design, settingsOf()).template;
    const flags = { m: itemsOf(t).options.modifiers, i: itemsOf(t).options.instructions };
    for (let n = 0; n <= WALK_STEPS; n++) {
      if (n > 0) t = step(r, t, tally);
      const where = `${design} step ${n}`;
      const ids = t.blocks.map((b) => b.id);
      assert.equal(new Set(ids).size, ids.length, `${where}: unique ids`);
      assert.ok(t.blocks.length <= PRINT_TEMPLATE_BLOCKS_MAX && t.blocks.filter((b) => b.type === "qr").length <= PRINT_QR_BLOCKS_MAX, `${where}: caps`);
      for (const type of KOT_REQUIRED_BLOCKS) assert.ok(t.blocks.some((b) => b.type === type), `${where}: ${type} still there`);
      for (const type of KOT_BLOCK_TYPES.filter((x) => !isRepeatableBlockType(x))) assert.equal(t.blocks.filter((b) => b.type === type).length, 1, `${where}: ${type} exactly once`);
      assert.ok(t.blocks.filter((b) => b.type === "qr").every((b) => (b.options as { content: string }).content === "link"), `${where}: every KOT qr is a link`);
      assert.deepEqual({ m: itemsOf(t).options.modifiers, i: itemsOf(t).options.instructions }, flags, `${where}: modifiers / instructions untouched`);
      const bad = new Set(t.blocks.filter(unfinished).map((b) => b.id));
      const problems = writeProblems(KOT_EDITOR, t);
      assert.deepEqual(new Set(problems.flatMap((p) => (p.blockId === null ? [] : [p.blockId]))), bad, `${where}: problems sit on exactly the unfinished rows`);
      assert.equal(problems.some((p) => p.blockId === null), false, `${where}: no whole-design problem from an editor op`);
      assert.equal(KOT_EDITOR.schema.safeParse(t).success, bad.size === 0, `${where}: WRITE-valid exactly when nothing is unfinished`);
      if (bad.size > 0) tally.unfinishedStates = (tally.unfinishedStates ?? 0) + 1;
    }
  });
  for (const kind of ["on", "style", "logo", "divider", "text", "qr", "prices", "font", "size", "up", "down", "drag", "add", "remove"]) assert.ok((tally[kind] ?? 0) > 0, `landmark: the walk ran "${kind}"`);
  assert.ok((tally.unfinishedStates ?? 0) > 0 && (tally.refused ?? 0) > 0, "landmark: unfinished-row states and a refused cap were both reached");
});
