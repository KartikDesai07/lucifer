import {
  BILL_FIXTURES, FIXED_NOW_MS, FOOTER, GSTIN, BILL_FLAG_KEYS, KOT_FLAG_KEYS, flagsOf, KOT_PROP_SETS, KOT_SETTINGS_VARIANTS, settingsOf,
  LOCKED_TITLE_HTML, TITLE_ANCHOR_HTML, billGstShows, forceBillLocks, withClassicWrap, withLockedTitle,
  type BillFixture, type KotExtra, type KotPropSet,
} from "./print-template-golden.fixtures"; // FIRST: it selects React's production renderer before react loads
import { forceKotLocks, withClassicKotWrap } from "./print-template-kot-wrap.fixtures";
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OrderReceipt } from "@/components/pos/OrderReceipt";
import { KOTReceipt } from "@/components/pos/KOTReceipt";
import { BillSlip, KotSlip } from "@/components/print/slip/SlipEngine";
import { classicBillTemplate, classicKotTemplate } from "@/lib/print-template-legacy";
import { loadSlipCode } from "@/components/print/slip/slip-code";
import { PAPER_WIDTHS, PRINT_FONT_SIZES } from "@/lib/constants";
import type { BillTemplate, KotTemplate } from "@pos/shared/print-template";
import type { Order, Settings } from "@/types";

// Print customization S2: the Classic golden through the STORED path. The S1 golden proves BillSlip/KotSlip with
// the converter's template equal the legacy components. This one proves the S2 dispatch: when Settings carries
// billTemplate / kotTemplate, OrderReceipt / KOTReceipt (the call sites every print lane uses) render through the
// engine and still equal today's bytes; an unreadable stored value falls back to the legacy slip exactly. (A
// sibling of print-template-golden.test.ts, which is at its line budget.) The bill oracle is today's legacy bytes mapped
// through withClassicWrap (A4: the template path wraps long Classic rows) and withLockedTitle. An UNREADABLE stored
// template is the dispatch printing the legacy component itself, so those legs compare bare legacy bytes, unmapped. The KOT
// legs map legacy through withClassicKotWrap with kotShowTable forced on a void / moved slip (print-template-kot-wrap.fixtures.ts).

(globalThis as { React?: typeof React }).React = React; // jsx:"preserve" -> tsx compiles to React.createElement
before(() => loadSlipCode()); // the non-Classic designs are one lazy chunk (the matrix suites load it the same way)
before(() => mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS })); // the bill's "Printed ..." line
after(() => mock.timers.reset());

const CONTEXT_CHARS = 80;
function expectSame(cell: string, expected: string, actual: string): void {
  if (expected === actual) return;
  let i = 0;
  while (i < expected.length && i < actual.length && expected[i] === actual[i]) i++;
  const from = Math.max(0, i - CONTEXT_CHARS / 2);
  assert.fail(
    `stored-golden mismatch in cell [${cell}] at index ${i} (expected ${expected.length} chars, actual ${actual.length} chars)\n` +
      `  expected: ${JSON.stringify(expected.slice(from, i + CONTEXT_CHARS / 2))}\n` +
      `  actual:   ${JSON.stringify(actual.slice(from, i + CONTEXT_CHARS / 2))}`,
  );
}

const bill = (order: Order | null, settings: Settings, banner?: string): string =>
  renderToStaticMarkup(createElement(OrderReceipt, { order, settings, banner }));
const engineBill = (order: Order | null, settings: Settings, template: BillTemplate, banner?: string): string =>
  renderToStaticMarkup(createElement(BillSlip, { order, settings, banner, template }));
const kot = (order: Order | null, settings: Settings, extra: KotExtra): string =>
  renderToStaticMarkup(createElement(KOTReceipt, { order, settings, ...extra }));
const engineKot = (order: Order | null, settings: Settings, extra: KotExtra, template: KotTemplate): string =>
  renderToStaticMarkup(createElement(KotSlip, { order, settings, ...extra, template }));

/** The stored form: Settings carrying the converter's template, JSON round-tripped like a real Mongo read. */
const storedBill = (s: Settings): Settings => ({ ...s, billTemplate: JSON.parse(JSON.stringify(classicBillTemplate(s))) });
const storedKot = (s: Settings): Settings => ({ ...s, kotTemplate: JSON.parse(JSON.stringify(classicKotTemplate(s))) });

const counts = { bill: 0, billToday: 0, billTitled: 0, billBanner: 0, billNull: 0, kot: 0, unreadableBill: 0, unreadableKot: 0 };

function billCell(label: string, order: Order | null, s: Settings, banner?: string): void {
  const stored = bill(order, storedBill(s), banner);
  expectSame(`bill ${label} (stored vs engine)`, engineBill(order, s, classicBillTemplate(s), banner), stored);
  counts.bill++;
  // The locked "TAX INVOICE" title is the one line today's legacy bill never prints (planned 01-PLAN §6 divergence).
  const gstShows = billGstShows(order, s);
  if (gstShows) counts.billTitled++;
  const locked = forceBillLocks(s, order);
  if (BILL_FLAG_KEYS.every((k) => locked[k] === s[k])) {
    expectSame(`bill ${label} (stored vs today's legacy bytes + the Classic wrap + the locked title)`, withLockedTitle(withClassicWrap(bill(order, s, banner)), gstShows), stored);
    counts.billToday++;
  }
}

for (const fx of BILL_FIXTURES) {
  test(`stored bill: ${fx.id} x 64 flag masks (80mm, normal) + papers x fonts at all-on / all-off`, () => {
    for (let mask = 0; mask < 1 << BILL_FLAG_KEYS.length; mask++) {
      billCell(`${fx.id} flags=${mask}`, fx.order, { ...fx.settings, ...flagsOf(BILL_FLAG_KEYS, mask), billPaperWidth: "80mm", billFontSize: "normal" });
    }
    for (const mask of [0, (1 << BILL_FLAG_KEYS.length) - 1]) {
      for (const billPaperWidth of PAPER_WIDTHS) {
        for (const billFontSize of PRINT_FONT_SIZES) {
          billCell(`${fx.id} flags=${mask} ${billPaperWidth} ${billFontSize}`, fx.order, { ...fx.settings, ...flagsOf(BILL_FLAG_KEYS, mask), billPaperWidth, billFontSize });
        }
      }
    }
  });
}

test("stored bill: banner DUPLICATE on every fixture, and order null (bare root), equal the engine and today's bytes", () => {
  for (const fx of BILL_FIXTURES) {
    assert.ok(bill(fx.order, storedBill(fx.settings), "DUPLICATE").includes("DUPLICATE"), `landmark: [${fx.id}] the banner prints`);
    billCell(`${fx.id} DUPLICATE`, fx.order, fx.settings, "DUPLICATE");
    counts.billBanner++;
    for (const billPaperWidth of PAPER_WIDTHS) {
      const s: Settings = { ...fx.settings, billPaperWidth };
      expectSame(`bill null ${fx.id} ${billPaperWidth}`, withClassicWrap(bill(null, s, "DUPLICATE")), bill(null, storedBill(s), "DUPLICATE"));
      counts.billNull++;
    }
  }
  assert.ok(!bill(null, storedBill(settingsOf())).includes("TOTAL"), "landmark: a null order is a bare root");
});

test("stored kot: every real prop set x flags all-on/all-off x papers x fonts x 4 settings variants equals the engine AND legacy", () => {
  const allOn = Object.fromEntries(KOT_FLAG_KEYS.map((k) => [k, true]));
  const allOff = Object.fromEntries(KOT_FLAG_KEYS.map((k) => [k, false]));
  for (const variant of KOT_SETTINGS_VARIANTS) {
    for (const [label, flags] of [["all-on", allOn], ["all-off", allOff]] as const) {
      for (const kotPaperWidth of PAPER_WIDTHS) {
        for (const kotFontSize of PRINT_FONT_SIZES) {
          const s: Settings = { ...variant.settings, ...flags, kotPaperWidth, kotFontSize };
          for (const ps of KOT_PROP_SETS) {
            const cell = `${ps.id} ${variant.id} ${label} ${kotPaperWidth} ${kotFontSize}`;
            const stored = kot(ps.order, storedKot(s), ps.extra);
            expectSame(`kot ${cell} (stored vs engine)`, engineKot(ps.order, s, ps.extra, classicKotTemplate(s)), stored);
            expectSame(`kot ${cell} (stored vs legacy + the S5 wrap and banner lock)`, withClassicKotWrap(kot(ps.order, forceKotLocks(s, ps.extra), ps.extra)), stored);
            counts.kot++;
          }
        }
      }
    }
  }
  const first = KOT_PROP_SETS[0];
  assert.ok(kot(first.order, storedKot({ ...settingsOf(), ...allOn }), first.extra).includes("KITCHEN ORDER"), "landmark: the stored path prints a real ticket");
});

const GARBAGE: unknown[] = ["classic", 7, [], {}, { v: 2 }, { ...classicBillTemplate(settingsOf()), design: "neon" }, { ...classicBillTemplate(settingsOf()), extra: 1 }];

test("unreadable stored template: the bill and the kot print exactly as the legacy slips", () => {
  const fx = BILL_FIXTURES.find((f) => f.id === "incl-gst") as BillFixture;
  const ps = KOT_PROP_SETS.find((p) => p.id === "void-reason-by-at") as KotPropSet;
  const kotS = settingsOf({ kotShowPrices: true, kotShowTotal: true });
  for (const raw of GARBAGE) {
    expectSame(`unreadable bill ${JSON.stringify(raw).slice(0, 40)}`, bill(fx.order, fx.settings), bill(fx.order, { ...fx.settings, billTemplate: raw }));
    expectSame(`unreadable bill null-order`, bill(null, fx.settings), bill(null, { ...fx.settings, billTemplate: raw }));
    expectSame(`unreadable kot ${JSON.stringify(raw).slice(0, 40)}`, kot(ps.order, kotS, ps.extra), kot(ps.order, { ...kotS, kotTemplate: raw }, ps.extra));
    counts.unreadableBill++;
    counts.unreadableKot++;
  }
  assert.ok(bill(fx.order, fx.settings).includes("TOTAL") && kot(ps.order, kotS, ps.extra).includes("VOID"), "landmark: real slips were compared");
  assert.notEqual(bill(fx.order, storedBill(fx.settings)), "", "landmark: the stored path renders");
});

test("re-insert end to end: a stored template with the gstin block removed still prints GSTIN on a GST order (the lock bites)", () => {
  const fx = BILL_FIXTURES.find((f) => f.id === "incl-gst") as BillFixture;
  const s: Settings = { ...fx.settings, billShowGstNumber: false };
  const classic = classicBillTemplate(s);
  assert.ok(classic.blocks.some((b) => b.type === "gstin" && b.on === false), "landmark: gstin is present and off");
  assert.ok(!bill(fx.order, s).includes("GSTIN:"), "landmark: today's legacy slip omits GSTIN with the toggle off");
  const stored: Settings = { ...s, billTemplate: { ...classic, blocks: classic.blocks.filter((b) => b.type !== "gstin") } };
  const html = bill(fx.order, stored);
  assert.ok(html.includes(`GSTIN: ${GSTIN}`), "the re-inserted gstin block prints");
  expectSame("gstin re-insert vs full classic template", engineBill(fx.order, s, classic), html);
});

test("routing is real: a stored template with footerText moved to the top changes the slip and equals the engine", () => {
  const fx = BILL_FIXTURES[0];
  const classic = classicBillTemplate(fx.settings);
  const footer = classic.blocks.find((b) => b.type === "footerText");
  assert.ok(footer, "landmark: Classic has a footerText block");
  const moved: BillTemplate = { ...classic, blocks: [footer, ...classic.blocks.filter((b) => b !== footer)] };
  const html = bill(fx.order, { ...fx.settings, billTemplate: moved });
  assert.notEqual(html, bill(fx.order, fx.settings), "differs from the legacy slip");
  assert.ok(html.indexOf(FOOTER) < html.indexOf("Test Cafe"), "the footer prints above the name");
  expectSame("moved footer vs engine", engineBill(fx.order, fx.settings, moved), html);

  const ps = KOT_PROP_SETS[0];
  const kotClassic = classicKotTemplate(settingsOf());
  const count = kotClassic.blocks.find((b) => b.type === "itemCount");
  assert.ok(count, "landmark: Classic KOT has an itemCount block");
  const kotMoved: KotTemplate = { ...kotClassic, blocks: [count, ...kotClassic.blocks.filter((b) => b !== count)] };
  const kotHtml = kot(ps.order, { ...settingsOf(), kotTemplate: kotMoved }, ps.extra);
  assert.notEqual(kotHtml, kot(ps.order, settingsOf(), ps.extra), "kot: differs from the legacy ticket");
  expectSame("moved itemCount vs engine", engineKot(ps.order, settingsOf(), ps.extra, kotMoved), kotHtml);
});

const BILL_TITLE_HTML = LOCKED_TITLE_HTML.replace("TAX INVOICE", "BILL");
const withTitleOn = (tpl: BillTemplate): BillTemplate => ({ ...tpl, blocks: tpl.blocks.map((b) => (b.type === "title" ? { ...b, on: true } : b)) });

test("bill engine: Classic with title on over a NON-GST order prints exactly one BILL title after the first rule and never TAX INVOICE", () => {
  const plain = BILL_FIXTURES.filter((f) => !billGstShows(f.order, f.settings));
  assert.equal(plain.length, 6, "landmark: six non-GST fixtures");
  for (const fx of plain) {
    const tpl = classicBillTemplate(fx.settings);
    assert.equal(tpl.blocks.find((b) => b.type === "title")?.on, false, "landmark: the converter's title is off");
    const on = engineBill(fx.order, fx.settings, withTitleOn(tpl));
    assert.equal(on.split(BILL_TITLE_HTML).length - 1, 1, `[${fx.id}] exactly one BILL title`);
    assert.ok(on.includes(TITLE_ANCHOR_HTML + BILL_TITLE_HTML), `[${fx.id}] the title sits right after the first rule`);
    assert.ok(!on.includes("TAX INVOICE"), `[${fx.id}] never TAX INVOICE without GST`);
    // The default (title off) is today's bytes: no title at all.
    assert.ok(!engineBill(fx.order, fx.settings, tpl).includes(BILL_TITLE_HTML), `[${fx.id}] title off prints no BILL`);
  }
  // Positive control: a GST order prints the locked title once even with the block off, and never "BILL".
  const gst = BILL_FIXTURES.find((f) => f.id === "incl-gst") as BillFixture;
  for (const tpl of [classicBillTemplate(gst.settings), withTitleOn(classicBillTemplate(gst.settings))]) {
    const html = engineBill(gst.order, gst.settings, tpl);
    assert.equal(html.split(LOCKED_TITLE_HTML).length - 1, 1, "GST: exactly one TAX INVOICE");
    assert.ok(!html.includes(BILL_TITLE_HTML) && html.includes(TITLE_ANCHOR_HTML + LOCKED_TITLE_HTML));
  }
});

test("oracle helper: withLockedTitle inserts at the pinned spot, leaves non-GST untouched, and throws instead of no-op", () => {
  const html = `<div>x</div>${TITLE_ANCHOR_HTML}<div>y</div>${TITLE_ANCHOR_HTML}`;
  assert.equal(withLockedTitle(html, true), `<div>x</div>${TITLE_ANCHOR_HTML}${LOCKED_TITLE_HTML}<div>y</div>${TITLE_ANCHOR_HTML}`, "after the FIRST rule only");
  assert.equal(withLockedTitle(html, false), html, "non-GST is exact");
  assert.equal(withLockedTitle("no rule here", false), "no rule here", "non-GST never needs an anchor");
  assert.throws(() => withLockedTitle("<div>no rule</div>", true), /no header rule/, "an absent anchor throws");
  assert.throws(() => withLockedTitle(`${LOCKED_TITLE_HTML}${TITLE_ANCHOR_HTML}`, true), /already prints the title/, "a legacy that already has the title throws");
});

test("oracle helper: withClassicWrap maps the legacy bill to the Classic template path exactly, and throws instead of no-op", () => {
  const ROOT = '<div class="w-[300px] text-xs bg-white p-3 font-mono text-black">';
  const LEGACY_LINE = '<div class="flex justify-between gap-2"><span class="whitespace-pre">Order</span><span class="text-right">ORD-1</span></div>';
  const WRAPPED_LINE = '<div class="flex flex-wrap justify-between gap-x-2"><span class="max-w-full whitespace-pre-wrap">Order</span><span class="max-w-full grow basis-0 text-right">ORD-1</span></div>';
  const WRAPPED_ROOT = ROOT.replace('text-black"', 'text-black break-words"');
  assert.equal(withClassicWrap(`${ROOT}${LEGACY_LINE}<span class="pr-2">Tea</span></div>`), `${WRAPPED_ROOT}${WRAPPED_LINE}<span class="min-w-0 pr-2">Tea</span></div>`, "root, Line and item name, exactly");
  assert.equal(withClassicWrap(`${ROOT}${LEGACY_LINE}${LEGACY_LINE}</div>`), `${WRAPPED_ROOT}${WRAPPED_LINE}${WRAPPED_LINE}</div>`, "every Line row, not just the first");
  assert.equal(withClassicWrap(`${ROOT}</div>`), `${WRAPPED_ROOT}</div>`, "no Line / pr-2: only the root changes");
  const NUMBER_ROW = '<div class="flex justify-between gap-2 font-bold"><span>Bill No.</span><span class="text-right">1</span></div>';
  const WRAPPED_NUMBER = '<div class="flex flex-wrap justify-between gap-2 font-bold"><span>Bill No.</span><span class="ml-auto text-right">1</span></div>';
  const TOTAL_ROW = '<div class="flex justify-between text-[1.17em] font-bold"><span>TOTAL</span><span>₹1.00</span></div>';
  const WRAPPED_TOTAL = '<div class="flex flex-wrap justify-between text-[1.17em] font-bold"><span>TOTAL</span><span class="ml-auto whitespace-nowrap">₹1.00</span></div>';
  assert.equal(withClassicWrap(`${ROOT}${NUMBER_ROW}</div>`), `${WRAPPED_ROOT}${WRAPPED_NUMBER}</div>`, "the Bill No. row wraps (flex-wrap + ml-auto)");
  assert.equal(withClassicWrap(`${ROOT}${TOTAL_ROW}</div>`), `${WRAPPED_ROOT}${WRAPPED_TOTAL}</div>`, "the TOTAL row wraps and its amount never splits");
  assert.equal(withClassicWrap(`${ROOT}${NUMBER_ROW}${LEGACY_LINE}${TOTAL_ROW}</div>`), `${WRAPPED_ROOT}${WRAPPED_NUMBER}${WRAPPED_LINE}${WRAPPED_TOTAL}</div>`, "all three row kinds in one bill");
  assert.throws(() => withClassicWrap(`${ROOT}<div class="flex justify-between gap-2 font-bold"><span>Bill No.</span><span class="text-right">1<b>x</b></span></div></div>`), /gap-2 font-bold/, "a Bill No. row of another shape is not silently kept");
  assert.throws(() => withClassicWrap(`${ROOT}<div class="flex justify-between text-[1.17em] font-bold"><span>TOTAL</span><span class="x">1</span></div></div>`), /1\.17em/, "a TOTAL row of another shape is not silently kept");
  assert.throws(() => withClassicWrap(`<div class="p-3">${LEGACY_LINE}</div>`), /not the legacy bill root/, "a missed root anchor throws");
  const PRELOAD = '<link rel="preload" as="image" href="/api/branding/logo?v=0123456789ab"/>';
  assert.equal(withClassicWrap(`${PRELOAD}${ROOT}</div>`), `${PRELOAD}${WRAPPED_ROOT}</div>`, "a logo preload link in front of the root is kept, the root still gets the class");
  assert.throws(() => withClassicWrap(`<span></span>${ROOT}</div>`), /not the legacy bill root/, "the root must be the first tag after any preload links");
  assert.throws(() => withClassicWrap(`${PRELOAD}<div class="p-3">${LEGACY_LINE}</div>`), /not the legacy bill root/, "a preload link does not excuse a missing root");
  assert.throws(() => withClassicWrap(`${ROOT}<div class="flex justify-between gap-2"><span class="whitespace-pre">A <b>x</b></span><span class="text-right">v</span></div></div>`), /whitespace-pre/, "a Line of another shape is not silently kept");
  assert.throws(() => withClassicWrap(`${ROOT}<div class="pr-2"></div></div>`), /pr-2/, "a leftover pr-2 throws");
  // Landmark + equality with the real renderers: a real legacy bill, mapped, IS the engine's Classic render.
  const fx = BILL_FIXTURES.find((f) => f.id === "gst-off") as BillFixture;
  const legacy = bill(fx.order, fx.settings);
  const mapped = withClassicWrap(legacy);
  assert.ok(legacy.includes('class="whitespace-pre"') && legacy.includes('<span class="pr-2">'), "landmark: the real legacy bill carries both legacy markers");
  assert.ok(mapped.includes("flex flex-wrap justify-between gap-x-2") && mapped.includes("min-w-0 pr-2") && mapped.includes("text-black break-words"), "landmark: the mapped bill carries the wrap");
  assert.ok(legacy.includes('<div class="flex justify-between text-[1.17em] font-bold"><span>TOTAL</span>') && mapped.includes('text-[1.17em] font-bold"><span>TOTAL</span><span class="ml-auto whitespace-nowrap">'), "landmark: the real legacy TOTAL row is reached and mapped");
  const numbered = BILL_FIXTURES.find((f) => f.id === "incl-gst") as BillFixture;
  assert.ok(withClassicWrap(bill(numbered.order, numbered.settings)).includes('<span>Bill No.</span><span class="ml-auto text-right">12</span>'), "landmark: a real numbered legacy bill's Bill No. row is mapped");
  assert.ok(!billGstShows(fx.order, fx.settings), "landmark: no GST, so no locked title is mixed into this equality");
  expectSame("withClassicWrap(real legacy bill) vs the engine's Classic render", mapped, engineBill(fx.order, fx.settings, classicBillTemplate(fx.settings)));
});

// The gallery's "today's bill" card (DesignThumb today=true) draws billTemplate: null. That is the real legacy bill, and
// it is NOT the Classic template (whose rows wrap), so the card cannot be faked by activating Classic.
test("today's bill (billTemplate null) is the legacy bytes, and differs from a stored Classic template's wrapped rows", () => {
  const fx = BILL_FIXTURES.find((f) => f.id === "gst-off") as BillFixture;
  const legacy = bill(fx.order, fx.settings);
  assert.equal(bill(fx.order, { ...fx.settings, billTemplate: null }), legacy, "a null template prints today's bill exactly");
  const stored = bill(fx.order, storedBill(fx.settings));
  assert.ok(legacy.includes('class="flex justify-between text-[1.17em] font-bold"') && !legacy.includes("flex-wrap"), "landmark: legacy TOTAL row, no wrapping rows");
  assert.ok(stored.includes('class="flex flex-wrap justify-between text-[1.17em] font-bold"'), "landmark: the stored Classic template wraps its TOTAL row");
  assert.notEqual(stored, legacy, "so a Classic template is not today's bill");
});

test("stored golden summary", (t) => {
  t.diagnostic(`cells compared: ${JSON.stringify(counts)}`);
  // Title-inserted cells, both directions: 6 GST fixtures x (64 flag masks + 12 papers-x-fonts cells + 1 banner cell).
  assert.equal(counts.billTitled, 6 * (64 + 12 + 1), "stored bill cells that carry the locked title");
  assert.ok(counts.bill > 0 && counts.billToday > 0 && counts.billBanner > 0 && counts.billNull > 0 && counts.kot > 0);
  assert.equal(counts.kot, KOT_SETTINGS_VARIANTS.length * 2 * PAPER_WIDTHS.length * PRINT_FONT_SIZES.length * KOT_PROP_SETS.length);
});
