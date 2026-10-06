import { KOT_PROP_SETS, settingsOf, type KotExtra, type KotPropSet } from "./print-template-golden.fixtures"; // FIRST: it selects React's production renderer before react loads
import { forceKotLocks, withClassicKotWrap, LEGACY_KOT_ITEM_HEAD, WRAPPED_KOT_ITEM_HEAD } from "./print-template-kot-wrap.fixtures";
import { test, before } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { KOTReceipt } from "@/components/pos/KOTReceipt";
import { loadSlipCode } from "@/components/print/slip/slip-code";
import { defaultKotTemplate } from "@/lib/print-template-designs";
import { readKotTemplate } from "@/lib/print-template-resolve";
import { KOT_DESIGNS, type KotBlock, type KotDesign, type KotTemplate } from "@pos/shared/print-template";
import type { Order, Settings } from "@/types";

// Print customization S5 (05-S5-plan D1 / D2 / D6 / D8 / D9, 01-PLAN A8). The kitchen ticket's rules on the TEMPLATE path:
//   Q1  "Show ticket number" (kotShowNumber) is the SOLE control of the "#n": SlipEngine.kotBlockVisible ignores the kotNo
//       block's own `on`, and a moved slip never prints one (the renderers), which is also KOTReceipt's own gate.
//   Q2  a VOID / MOVED slip locks `table` and `items` (KOT_LOCKS.withBanner): a void lists the dishes and the table, a
//       moved slip prints FROM -> TO and still lists no dishes.
//   Q-A dish options ("NO Onion") and dish notes ("Hot please") ALWAYS print: the stored modifiers / instructions flags no
//       longer gate them, on Classic and on Kitchen Bold.
// Everything goes through KOTReceipt with a STORED kotTemplate (the call site every print lane uses; JSON round-tripped
// like a Mongo read). Kitchen Bold is the lazy chunk, preloaded like the matrix and pay-qr suites.

(globalThis as { React?: typeof React }).React = React; // jsx:"preserve" -> tsx compiles to React.createElement
before(() => loadSlipCode());

const kot = (order: Order | null, settings: Settings, extra: KotExtra): string =>
  renderToStaticMarkup(createElement(KOTReceipt, { order, settings, ...extra }));
const storedWith = (s: Settings, tpl: KotTemplate): Settings => ({ ...s, kotTemplate: JSON.parse(JSON.stringify(tpl)) });
const setOf = (id: string): KotPropSet => KOT_PROP_SETS.find((p) => p.id === id) as KotPropSet;
const withBlock = (tpl: KotTemplate, type: string, patch: (b: KotBlock) => KotBlock): KotTemplate => ({ ...tpl, blocks: tpl.blocks.map((b) => (b.type === type ? patch(b) : b)) });
const withOn = (tpl: KotTemplate, type: string, on: boolean): KotTemplate => withBlock(tpl, type, (b) => ({ ...b, on }));
const bothOff = (tpl: KotTemplate): KotTemplate => withOn(withOn(tpl, "table", false), "items", false);

// Each design's number markup (Classic: "#7" large; Kitchen Bold: a bordered "KOT" box over the number) and the legacy ticket's.
const NUMBER_RE: Record<KotDesign | "legacy", RegExp> = {
  classic: /text-\[1\.6em\] font-bold">#(\d+)</,
  kitchenBold: />KOT<\/div><div class="[^"]*">(\d+)</,
  legacy: /text-\[1\.6em\] font-bold">#(\d+)</,
};
const numberOf = (html: string, design: KotDesign | "legacy"): string | null => NUMBER_RE[design].exec(html)?.[1] ?? null;
const MODIFIER_LINES = ["+ Less sugar, Extra ginger", "NO Onion"];
const NOTE_LINES = ["Hot please"];
const DISHES = ["Masala Chai", "Pizza", "Cold Coffee"];

test("landmark: the two KOT designs exist and both carry a kotNo block (Kitchen Bold is the lazy chunk)", () => {
  assert.deepEqual([...KOT_DESIGNS], ["classic", "kitchenBold"]);
  const s = settingsOf({ kotShowNumber: true });
  for (const design of KOT_DESIGNS) assert.ok(defaultKotTemplate(design, s).blocks.some((b) => b.type === "kotNo"), design);
  const ps = setOf("round-label-number");
  assert.equal(numberOf(kot(ps.order, storedWith(s, defaultKotTemplate("kitchenBold", s)), ps.extra), "kitchenBold"), "7", "Kitchen Bold really renders through the loaded chunk");
});

test("kot number: with kotShowNumber OFF no '#n' prints, kotNo on or off, every prop set (Classic and Kitchen Bold)", () => {
  let cells = 0;
  for (const design of KOT_DESIGNS) {
    const s = settingsOf({ kotShowNumber: false });
    for (const on of [true, false]) {
      const tpl = withOn(defaultKotTemplate(design, s), "kotNo", on);
      assert.equal(tpl.blocks.find((b) => b.type === "kotNo")?.on, on, `landmark: [${design}] kotNo really is on=${on}`);
      for (const ps of KOT_PROP_SETS) {
        const html = kot(ps.order, storedWith(s, tpl), ps.extra);
        if (ps.order) assert.ok(html.includes(ps.order.orderId), `landmark: [${design} ${ps.id}] the ticket rendered`);
        assert.equal(numberOf(html, design), null, `[${design} kotNo on=${on} ${ps.id}] showNumber off prints no number`);
        cells++;
      }
    }
  }
  assert.equal(cells, KOT_DESIGNS.length * 2 * KOT_PROP_SETS.length);
  // Positive landmark: with it ON the very same prop set does print one (so "null" above is the rule, not a blind regex).
  const ps = setOf("round-label-number");
  for (const design of KOT_DESIGNS) {
    const s = settingsOf({ kotShowNumber: true });
    assert.equal(numberOf(kot(ps.order, storedWith(s, defaultKotTemplate(design, s)), ps.extra), design), "7", `landmark: [${design}] showNumber on prints #7`);
  }
});

test("kot number: with kotShowNumber ON the number prints whatever kotNo's own `on` is; never on a moved slip or when the slip has none", () => {
  let printed = 0, hidden = 0;
  for (const design of KOT_DESIGNS) {
    const s = settingsOf({ kotShowNumber: true });
    for (const on of [true, false]) {
      const tpl = withOn(defaultKotTemplate(design, s), "kotNo", on);
      for (const ps of KOT_PROP_SETS) {
        const expected = ps.extra.variant === "moved" || ps.extra.roundNumber === undefined ? null : String(ps.extra.roundNumber);
        assert.equal(numberOf(kot(ps.order, storedWith(s, tpl), ps.extra), design), expected, `[${design} kotNo on=${on} ${ps.id}]`);
        if (expected === null) hidden++; else printed++;
      }
    }
  }
  assert.ok(printed > 0 && hidden > 0, `landmark: both outcomes occurred (printed=${printed}, hidden=${hidden})`);
  const stray = setOf("moved-stray-round-props");
  assert.ok(stray.extra.variant === "moved" && stray.extra.roundNumber !== undefined, "landmark: a moved prop set that DOES carry a roundNumber exists");
  const noNumber = setOf("round-no-number");
  assert.ok(noNumber.extra.roundNumber === undefined && noNumber.extra.variant === undefined, "landmark: a plain ticket with no number exists");
});

test("kot number: the engine's gate equals today's KOTReceipt over every prop set x kotShowNumber x kotNo.on (both designs)", () => {
  let printed = 0, hidden = 0;
  for (const showNumber of [true, false]) {
    const s = settingsOf({ kotShowNumber: showNumber });
    for (const ps of KOT_PROP_SETS) {
      const legacy = numberOf(kot(ps.order, s, ps.extra), "legacy");
      for (const design of KOT_DESIGNS) {
        for (const on of [true, false]) {
          const tpl = withOn(defaultKotTemplate(design, s), "kotNo", on);
          assert.equal(numberOf(kot(ps.order, storedWith(s, tpl), ps.extra), design), legacy, `[${design} showNumber=${showNumber} kotNo on=${on} ${ps.id}] engine gate equals KOTReceipt's`);
        }
      }
      if (legacy === null) hidden++; else printed++;
    }
  }
  assert.ok(printed > 0 && hidden > 0, `landmark: legacy printed ${printed} and hid ${hidden} (both outcomes reached)`);
  const ps = setOf("round-label-number");
  assert.equal(numberOf(kot(ps.order, settingsOf({ kotShowNumber: true }), ps.extra), "legacy"), "7", "landmark: legacy prints #7");
});

// ── Banner locks: table + items on a VOID / MOVED slip ─────────────────────────────────────────────────────────────

test("banner locks: a template with table + items OFF prints neither on a normal ticket, both on a VOID, FROM -> TO and no dishes on a MOVED", () => {
  const normal = setOf("round-label-number"), voided = setOf("void-reason-by-at"), moved = setOf("moved-from-by-at");
  for (const design of KOT_DESIGNS) {
    for (const showTable of [true, false]) {
      const s = settingsOf({ kotShowNumber: true, kotShowTable: showTable });
      const full = defaultKotTemplate(design, s);
      const off = bothOff(full);
      const label = `${design} kotShowTable=${showTable}`;
      for (const type of ["table", "items"]) assert.equal(off.blocks.find((b) => b.type === type)?.on, false, `landmark: [${label}] ${type} is off`);
      // Landmark: with table + items on, the same normal ticket prints both.
      const base = kot(normal.order, storedWith(s, withOn(withOn(full, "table", true), "items", true)), normal.extra);
      assert.ok(base.includes("T4") && base.includes("Masala Chai") && base.includes("Pizza"), `landmark: [${label}] table + items on prints both`);
      const n = kot(normal.order, storedWith(s, off), normal.extra);
      assert.ok(n.includes(normal.order?.orderId ?? "?") && n.includes("item(s)"), `landmark: [${label}] the normal ticket rendered (other blocks still print)`);
      assert.ok(!n.includes("T4"), `[${label}] normal: no Table line`);
      assert.ok(DISHES.every((d) => !n.includes(d)), `[${label}] normal: no dishes`);
      const v = kot(voided.order, storedWith(s, off), voided.extra);
      assert.ok(v.includes("*** VOID ***") && v.includes("T4") && v.includes("Cold Coffee"), `[${label}] void: the Table line and the dishes are locked on`);
      assert.ok(!v.includes("Masala Chai") && !v.includes("Pizza"), `[${label}] void: only the voided line, not the rest of the tab`);
      const m = kot(moved.order, storedWith(s, off), moved.extra);
      assert.ok(m.includes("*** TABLE MOVED ***") && m.includes("T2 → T4"), `[${label}] moved: FROM -> TO is locked on`);
      assert.ok(DISHES.every((d) => !m.includes(d)), `[${label}] moved: still no dishes`);
    }
  }
});

// ── Dish options + dish notes always print ─────────────────────────────────────────────────────────────────────────

test("dish options and dish notes print even with the stored items modifiers:false, instructions:false (Classic and Kitchen Bold)", () => {
  const ps = setOf("round-label-number"), voided = setOf("void-reason-by-at");
  for (const design of KOT_DESIGNS) {
    const s = settingsOf({ kotShowNumber: true });
    const tpl = defaultKotTemplate(design, s);
    const flagged = (modifiers: boolean, instructions: boolean): KotTemplate =>
      withBlock(tpl, "items", (b) => (b.type === "items" ? { ...b, options: { ...b.options, modifiers, instructions } } : b));
    const stored = storedWith(s, flagged(false, false));
    const items = (stored.kotTemplate as KotTemplate).blocks.find((b) => b.type === "items");
    assert.ok(items?.type === "items" && items.options.modifiers === false && items.options.instructions === false, `landmark: [${design}] the STORED flags are false`);
    const html = kot(ps.order, stored, ps.extra);
    for (const line of [...MODIFIER_LINES, ...NOTE_LINES]) assert.ok(html.includes(line), `[${design}] prints ${JSON.stringify(line)} with the flags false`);
    assert.ok(kot(voided.order, stored, voided.extra).includes("Extra ice"), `[${design}] a void slip's dish note prints too`);
    // The stored flags are inert: every flag combination renders the same bytes.
    for (const [m, i] of [[true, true], [true, false], [false, true]] as const) {
      assert.equal(kot(ps.order, storedWith(s, flagged(m, i)), ps.extra), html, `[${design}] modifiers=${m} instructions=${i} renders the same ticket`);
    }
  }
});

// ── The golden oracle's helpers ─────────────────────────────────────────────────────────────────────────────────────
const ROOT = '<div class="w-[300px] text-xs bg-white p-3 font-mono text-black">';
const WRAPPED_ROOT = ROOT.replace('text-black"', 'text-black break-words"');
const LEGACY_LINE = '<div class="flex justify-between gap-2"><span class="whitespace-pre">Order</span><span class="text-right">ORD-1</span></div>';
const WRAPPED_LINE = '<div class="flex flex-wrap justify-between gap-x-2"><span class="max-w-full whitespace-pre-wrap">Order</span><span class="max-w-full grow basis-0 text-right">ORD-1</span></div>';
const HEAD_REST = "2 × Tea</span></div>";
const ODD_HEAD = '<div class="flex justify-between font-bold"><span class="x">2 × Tea</span></div>';

test("oracle helper: withClassicKotWrap maps the legacy kot exactly (root, Line, item head) and throws instead of no-op", () => {
  assert.equal(withClassicKotWrap(`${ROOT}${LEGACY_LINE}${LEGACY_KOT_ITEM_HEAD}${HEAD_REST}</div>`), `${WRAPPED_ROOT}${WRAPPED_LINE}${WRAPPED_KOT_ITEM_HEAD}${HEAD_REST}</div>`, "root, Line and item head, exactly");
  assert.equal(withClassicKotWrap(`${ROOT}${LEGACY_LINE}${LEGACY_LINE}</div>`), `${WRAPPED_ROOT}${WRAPPED_LINE}${WRAPPED_LINE}</div>`, "every Line row, not just the first");
  assert.equal(withClassicKotWrap(`${ROOT}${LEGACY_KOT_ITEM_HEAD}a</span></div>${LEGACY_KOT_ITEM_HEAD}b</span></div></div>`), `${WRAPPED_ROOT}${WRAPPED_KOT_ITEM_HEAD}a</span></div>${WRAPPED_KOT_ITEM_HEAD}b</span></div></div>`, "every item head");
  assert.equal(withClassicKotWrap(`${ROOT}</div>`), `${WRAPPED_ROOT}</div>`, "no Line / item head: only the root changes");
  const PRELOAD = '<link rel="preload" as="image" href="/api/branding/logo?v=0123456789ab"/>';
  assert.equal(withClassicKotWrap(`${PRELOAD}${ROOT}</div>`), `${PRELOAD}${WRAPPED_ROOT}</div>`, "a logo preload link in front of the root is kept");
  assert.throws(() => withClassicKotWrap(`<div class="p-3">${LEGACY_LINE}</div>`), /not the legacy kot root/, "a missed root anchor throws");
  assert.throws(() => withClassicKotWrap(`<span></span>${ROOT}</div>`), /not the legacy kot root/, "the root must be the first tag");
  assert.throws(() => withClassicKotWrap(`${ROOT}<div class="flex justify-between gap-2"><span class="whitespace-pre">A <b>x</b></span><span class="text-right">v</span></div></div>`), /whitespace-pre/, "a Line of another shape is not silently kept");
  assert.throws(() => withClassicKotWrap(`${ROOT}${ODD_HEAD}</div>`), /item head/, "an item head of another shape is not silently kept");
  assert.throws(() => withClassicKotWrap(`${ROOT}${LEGACY_KOT_ITEM_HEAD}${HEAD_REST}${ODD_HEAD}</div>`), /item head/, "one bad head among good ones still throws");
});

test("oracle helper: forceKotLocks forces kotShowTable only on a void / moved slip, never mutates, and is not a no-op on real slips", () => {
  const s = settingsOf({ kotShowTable: false });
  assert.equal(forceKotLocks(s, { variant: "void" }).kotShowTable, true);
  assert.equal(forceKotLocks(s, { variant: "moved" }).kotShowTable, true);
  assert.equal(forceKotLocks(s, { variant: "kot" }), s, "a normal ticket is returned untouched (same object)");
  assert.equal(forceKotLocks(s, {}), s);
  assert.equal(s.kotShowTable, false, "the input is not mutated");
  for (const id of ["void-reason-by-at", "moved-from-by-at"]) {
    const ps = setOf(id);
    assert.ok(!kot(ps.order, s, ps.extra).includes("T4"), `landmark: [${id}] legacy hides the Table line with kotShowTable off`);
    assert.ok(kot(ps.order, forceKotLocks(s, ps.extra), ps.extra).includes("T4"), `[${id}] forced, the oracle prints it`);
  }
});

test("oracle helper: a real legacy kot mapped through withClassicKotWrap IS the engine's stored Classic ticket (void / moved / normal)", () => {
  const s = settingsOf({ kotShowTable: false, kotShowNumber: true });
  const stored = storedWith(s, defaultKotTemplate("classic", s));
  for (const id of ["round-label-number", "whole-tab", "void-reason-by-at", "cancel-notice-reason", "moved-from-by-at", "moved-no-from", "round-banner-reprint"]) {
    const ps = setOf(id);
    const legacy = kot(ps.order, forceKotLocks(s, ps.extra), ps.extra);
    const mapped = withClassicKotWrap(legacy);
    assert.ok(legacy.includes('class="whitespace-pre"'), `landmark: [${id}] the legacy kot carries the legacy Line`);
    assert.ok(mapped.includes("text-black break-words") && mapped.includes("flex flex-wrap justify-between gap-x-2") && !mapped.includes('class="whitespace-pre"'), `landmark: [${id}] the mapped kot carries the wrap`);
    assert.equal(mapped.includes(WRAPPED_KOT_ITEM_HEAD), ps.extra.variant !== "moved", `landmark: [${id}] item heads are mapped exactly where the slip lists dishes`);
    assert.equal(kot(ps.order, stored, ps.extra), mapped, `[${id}] engine Classic equals the mapped legacy ticket`);
  }
  assert.ok(kot(setOf("whole-tab").order, s, {}).includes(LEGACY_KOT_ITEM_HEAD), "landmark: legacy carries the unwrapped item head");
});

// ── Resolver: a template stored before S5 (no table / items) ──────────────────────────────────────────────────────

test("resolver: a stored kot template missing table / items READS, gets both re-inserted OFF, and prints them on a void and a moved slip only", () => {
  const normal = setOf("round-label-number"), voided = setOf("void-reason-by-at"), moved = setOf("moved-from-by-at");
  for (const design of KOT_DESIGNS) {
    const s = settingsOf({ kotShowNumber: true });
    const full = defaultKotTemplate(design, s);
    const rawBlocks = full.blocks.filter((b) => b.type !== "table" && b.type !== "items");
    assert.equal(rawBlocks.length, full.blocks.length - 2, `landmark: [${design}] two blocks were removed`);
    const raw: Settings = { ...s, kotTemplate: JSON.parse(JSON.stringify({ ...full, blocks: rawBlocks })) };
    const read = readKotTemplate(raw);
    assert.equal(read.state, "ok", `[${design}] a template without table / items still reads (never unreadable)`);
    if (read.state !== "ok") continue;
    for (const type of ["table", "items"]) {
      const found: KotBlock[] = read.template.blocks.filter((b) => b.type === type);
      assert.equal(found.length, 1, `[${design}] ${type} re-inserted exactly once`);
      assert.equal(found[0].on, false, `[${design}] ${type} comes back OFF`);
    }
    assert.equal(read.template.blocks.length, full.blocks.length, `[${design}] nothing else was added or lost`);
    const offAll = storedWith(s, bothOff(full));
    assert.equal(kot(normal.order, raw, normal.extra), kot(normal.order, offAll, normal.extra), `[${design}] a normal ticket is unchanged by the re-insert`);
    assert.ok(!kot(normal.order, raw, normal.extra).includes("Masala Chai"), `[${design}] a normal ticket lists no dishes (the client's choice stands)`);
    const v = kot(voided.order, raw, voided.extra);
    assert.ok(v.includes("T4") && v.includes("Cold Coffee"), `[${design}] a void slip prints the table and the dish`);
    const m = kot(moved.order, raw, moved.extra);
    assert.ok(m.includes("T2 → T4") && DISHES.every((d) => !m.includes(d)), `[${design}] a moved slip prints FROM -> TO and no dishes`);
  }
});
