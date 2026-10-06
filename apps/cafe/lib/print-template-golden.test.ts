import {
  BILL_FIXTURES, FIXED_NOW_MS, FOOTER, GSTIN, BILL_FLAG_KEYS, KOT_BARE_MATRIX_IDS, KOT_FLAG_KEYS, flagsOf, KOT_PROP_SETS, KOT_SETTINGS_VARIANTS, PRINTED_LINE_RE, TAGLINE, settingsOf,
  billGstShows, forceBillLocks, withClassicWrap, withLockedTitle,
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
import { PAPER_WIDTHS, PRINT_FONT_SIZES, PRINT_LOGO_SIZES } from "@/lib/constants";
import type { BillTemplate, KotTemplate } from "@pos/shared/print-template";
import type { Order, Settings } from "@/types";

// The Classic golden (print customization S1, 01-PLAN §2.3). The LEGACY components (OrderReceipt / KOTReceipt) are the
// oracle: the engine rendering the Classic-from-legacy template must match their renderToStaticMarkup string exactly.
// BILL_LOCKS bite on the engine path only, so the bill oracle is legacy with the locked flags forced on, mapped through
// withClassicWrap (A4: the template path wraps long Classic rows) and, on a GST bill, withLockedTitle (both throw rather
// than no-op). The bill number: print-template-bill-number.test.ts. The KOT oracle: legacy with kotShowTable forced on a void /
// moved slip (S5 banner lock), mapped through withClassicKotWrap.
// jsx:"preserve" -> React.createElement, so a global React is needed at render time.
(globalThis as { React?: typeof React }).React = React;
// The bill's "Printed ..." line reads new Date(): freeze it so both sides print the same minute.
before(() => mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS }));
after(() => mock.timers.reset());
const CONTEXT_CHARS = 80;
function expectSame(cell: string, legacy: string, engine: string): void {
  if (legacy === engine) return;
  let i = 0;
  while (i < legacy.length && i < engine.length && legacy[i] === engine[i]) i++;
  const from = Math.max(0, i - CONTEXT_CHARS / 2);
  assert.fail(
    `golden mismatch in cell [${cell}] at index ${i} (legacy ${legacy.length} chars, engine ${engine.length} chars)\n` +
      `  legacy: ${JSON.stringify(legacy.slice(from, i + CONTEXT_CHARS / 2))}\n` +
      `  engine: ${JSON.stringify(engine.slice(from, i + CONTEXT_CHARS / 2))}`,
  );
}

const legacyBill = (order: Order | null, settings: Settings, banner?: string): string =>
  renderToStaticMarkup(createElement(OrderReceipt, { order, settings, banner }));
/** The bill oracle: legacy with the locks forced on, the Classic wrap (A4), plus the locked title on a GST bill. */
const oracleBill = (order: Order | null, s: Settings, banner?: string): string =>
  withLockedTitle(withClassicWrap(legacyBill(order, forceBillLocks(s, order), banner)), billGstShows(order, s));
const engineBill = (order: Order | null, settings: Settings, banner?: string, template?: BillTemplate): string =>
  renderToStaticMarkup(createElement(BillSlip, { order, settings, banner, template: template ?? classicBillTemplate(settings) }));

const legacyKot = (order: Order | null, settings: Settings, extra: KotExtra): string =>
  renderToStaticMarkup(createElement(KOTReceipt, { order, settings, ...extra }));
const engineKot = (order: Order | null, settings: Settings, extra: KotExtra, template?: KotTemplate): string =>
  renderToStaticMarkup(createElement(KotSlip, { order, settings, ...extra, template: template ?? classicKotTemplate(settings) }));
const counts = { billMatrix: 0, lockChanged: 0, titled: 0, billLogo: 0, billBanner: 0, billNull: 0, kotFlags: 0, kotBare: 0, kotPaperFont: 0 };

function runBillMatrix(fx: BillFixture): void {
  for (let mask = 0; mask < 1 << BILL_FLAG_KEYS.length; mask++) {
    for (const billPaperWidth of PAPER_WIDTHS) {
      for (const billFontSize of PRINT_FONT_SIZES) {
        const s: Settings = { ...fx.settings, ...flagsOf(BILL_FLAG_KEYS, mask), billPaperWidth, billFontSize };
        const lockedS = forceBillLocks(s, fx.order);
        const forced = legacyBill(fx.order, lockedS);
        // Unchanged flags render identically, so only a really-forced cell needs the unforced oracle render.
        const flagsForced = BILL_FLAG_KEYS.some((k) => lockedS[k] !== s[k]);
        if (flagsForced && legacyBill(fx.order, s) !== forced) counts.lockChanged++;
        counts.billMatrix++;
        const engine = engineBill(fx.order, s);
        if (billGstShows(fx.order, s)) counts.titled++;
        expectSame(`bill ${fx.id} flags=${mask} ${billPaperWidth} ${billFontSize}`, oracleBill(fx.order, s), engine);
        // Both directions: a GST cell prints the title exactly once, a non-GST cell never prints it.
        assert.equal(engine.split("TAX INVOICE").length - 1, billGstShows(fx.order, s) ? 1 : 0, `TAX INVOICE count in [${fx.id} flags=${mask}]`);
      }
    }
  }
}

test("landmark: the frozen clock prints the same 'Printed' line on the oracle and the engine", () => {
  const fx = BILL_FIXTURES[0];
  const legacy = legacyBill(fx.order, fx.settings);
  assert.match(legacy, PRINTED_LINE_RE, "the legacy bill prints the frozen time");
  assert.match(engineBill(fx.order, fx.settings), PRINTED_LINE_RE, "the engine bill prints the frozen time");
  assert.ok(legacy.includes("TOTAL") && legacy.includes(fx.order.orderId), "landmark: the oracle rendered a real bill");
  const html = (id: string): string => { const f = BILL_FIXTURES.find((x) => x.id === id) as BillFixture; return legacyBill(f.order, f.settings); };
  const walkIn = html("walk-in-reward-qty-split-unset"), voided = html("cancelled-no-reason-due");
  assert.ok(walkIn.includes("Walk-In") && walkIn.includes("Cash / Online") && walkIn.includes("FREE"), "landmark: walk-in, Split ?? 0 and the qty-2 reward line are reached");
  assert.ok(voided.includes("no payment due") && !voided.includes("Reason:") && !voided.includes(">Due<"), "landmark: cancelled without reason, Due hidden");
});

for (const fx of BILL_FIXTURES) {
  test(`bill golden: ${fx.id} x 64 show-flag combos x 2 papers x 3 font sizes`, () => runBillMatrix(fx));
}

test("bill golden: the lock legs are really exercised, and a GST order keeps GSTIN with billShowGstNumber off", (t) => {
  assert.equal(counts.billMatrix, BILL_FIXTURES.length * 64 * PAPER_WIDTHS.length * PRINT_FONT_SIZES.length);
  assert.equal(counts.billMatrix, 4608, "the bill matrix is 12 fixtures x 64 flags x 2 papers x 3 sizes");
  assert.ok(counts.lockChanged > 0, "forcing the locks must change some legacy cells");
  // The title-inserted cells, pinned in BOTH directions: 6 fixtures show GST x 384 cells (counted in the matrix only).
  const gstFixtures = BILL_FIXTURES.filter((f) => billGstShows(f.order, f.settings));
  assert.deepEqual(gstFixtures.map((f) => f.id), ["split", "cancelled-reason", "excl-gst-discount-charges", "incl-gst", "gst-settings-fallback", "empty-content"]);
  assert.equal(gstFixtures.length * 64 * PAPER_WIDTHS.length * PRINT_FONT_SIZES.length, 2304, "title-inserted cells in the bill matrix");
  assert.equal(counts.titled, 2304, "the matrix inserted the oracle title in exactly the 2304 GST cells (not fewer, not more)");
  t.diagnostic(`bill matrix cells=${counts.billMatrix}, title-inserted=${counts.titled}, cells where forcing the locks changed legacy=${counts.lockChanged}`);
  const gstBill = BILL_FIXTURES.find((f) => f.id === "incl-gst");
  assert.ok(gstBill, "landmark: the inclusive-GST fixture exists");
  const s: Settings = { ...gstBill.settings, billShowGstNumber: false };
  const unforcedLegacy = legacyBill(gstBill.order, s);
  assert.ok(!unforcedLegacy.includes("GSTIN:"), "the unforced legacy bill omits GSTIN when the toggle is off");
  assert.ok(legacyBill(gstBill.order, gstBill.settings).includes(`GSTIN: ${GSTIN}`), "landmark: toggled on, legacy prints GSTIN");
  assert.ok(engineBill(gstBill.order, s).includes(`GSTIN: ${GSTIN}`), "the engine locks GSTIN on");
});

test("bill golden: billLogoSize small/medium/large x 2 papers x every fixture, logo on", () => {
  for (const fx of BILL_FIXTURES) {
    for (const billLogoSize of PRINT_LOGO_SIZES) {
      for (const billPaperWidth of PAPER_WIDTHS) {
        const s: Settings = { ...fx.settings, billShowLogo: true, billLogoSize, billPaperWidth };
        counts.billLogo++;
        const legacy = oracleBill(fx.order, s);
        if (fx.settings.logo) assert.ok(legacy.includes("/api/branding/logo"), `landmark: [${fx.id}] the legacy bill renders the logo`);
        expectSame(`bill-logo ${fx.id} ${billLogoSize} ${billPaperWidth}`, legacy, engineBill(fx.order, s));
      }
    }
  }
});

test("bill golden: banner DUPLICATE on every fixture; order null renders the bare root on both sides", () => {
  for (const fx of BILL_FIXTURES) {
    counts.billBanner++;
    const legacy = oracleBill(fx.order, fx.settings, "DUPLICATE");
    assert.ok(legacy.includes("DUPLICATE"), `landmark: [${fx.id}] the banner prints`);
    expectSame(`bill-banner ${fx.id}`, legacy, engineBill(fx.order, fx.settings, "DUPLICATE"));
  }
  for (const fx of BILL_FIXTURES) {
    for (const billPaperWidth of PAPER_WIDTHS) {
      counts.billNull++;
      const s: Settings = { ...fx.settings, billPaperWidth };
      const legacy = legacyBill(null, s, "DUPLICATE");
      assert.ok(legacy.includes("font-mono") && !legacy.includes("TOTAL"), "landmark: a bare root with no bill body");
      // The bare root carries the Classic wrap class too (the oracle maps it; a null order has no Line to rewrite).
      expectSame(`bill-null ${fx.id} ${billPaperWidth}`, withClassicWrap(legacy), engineBill(null, s, "DUPLICATE"));
    }
  }
});

// ── KOT ──────────────────────────────────────────────────────────────────────

function kotCell(ps: KotPropSet, s: Settings, id: string): void {
  expectSame(`kot ${ps.id} ${id}`, withClassicKotWrap(legacyKot(ps.order, forceKotLocks(s, ps.extra), ps.extra)), engineKot(ps.order, s, ps.extra));
}

test("kot golden: 1024 flag combos x every real call-site prop set (80mm, normal)", () => {
  const base = settingsOf();
  for (let mask = 0; mask < 1 << KOT_FLAG_KEYS.length; mask++) {
    const s: Settings = { ...base, ...flagsOf(KOT_FLAG_KEYS, mask), kotPaperWidth: "80mm", kotFontSize: "normal" };
    for (const ps of KOT_PROP_SETS) {
      counts.kotFlags++;
      kotCell(ps, s, `flags=${mask}`);
    }
  }
  assert.equal(counts.kotFlags, 1024 * KOT_PROP_SETS.length);
});

test("kot golden: the bare variant (logo flag on, no logo; blank name) x 1024 flags x one prop set per slip shape", () => {
  const bare = KOT_SETTINGS_VARIANTS.find((v) => v.id === "bare");
  assert.ok(bare, "landmark: the bare variant exists");
  const sets = KOT_PROP_SETS.filter((p) => KOT_BARE_MATRIX_IDS.includes(p.id));
  assert.equal(sets.length, KOT_BARE_MATRIX_IDS.length, "landmark: every named prop set exists");
  for (let mask = 0; mask < 1 << KOT_FLAG_KEYS.length; mask++) {
    const s: Settings = { ...bare.settings, ...flagsOf(KOT_FLAG_KEYS, mask) };
    for (const ps of sets) {
      counts.kotBare++;
      kotCell(ps, s, `bare flags=${mask}`);
    }
  }
});

test("kot golden: 4 settings variants x 2 papers x 3 font sizes x every prop set at flags all-on and all-off", () => {
  const allOn = Object.fromEntries(KOT_FLAG_KEYS.map((k) => [k, true]));
  const allOff = Object.fromEntries(KOT_FLAG_KEYS.map((k) => [k, false]));
  for (const variant of KOT_SETTINGS_VARIANTS) {
    for (const [label, flags] of [["all-on", allOn], ["all-off", allOff]] as const) {
      for (const kotPaperWidth of PAPER_WIDTHS) {
        for (const kotFontSize of PRINT_FONT_SIZES) {
          const s: Settings = { ...variant.settings, ...flags, kotPaperWidth, kotFontSize };
          for (const ps of KOT_PROP_SETS) {
            counts.kotPaperFont++;
            kotCell(ps, s, `${variant.id} ${label} ${kotPaperWidth} ${kotFontSize}`);
          }
        }
      }
    }
  }
  // Vision guard: all-on really prints the optional lines, so the compared strings are not trivially empty.
  const first = KOT_PROP_SETS[0];
  const kotOf = (v: number | null): string => legacyKot(first.order, { ...(v === null ? settingsOf() : KOT_SETTINGS_VARIANTS[v].settings), ...allOn }, first.extra);
  const on = kotOf(null);
  for (const needle of ["KITCHEN ORDER", "#7", "Test Cafe", "/api/branding/logo", "Round total:", "Note: Birthday table"]) {
    assert.ok(on.includes(needle), `landmark: all-on KOT prints ${needle}`);
  }
  // The blind-branch variants really differ: no logo element without a logo, no name line for a blank name.
  assert.ok(on.includes('tracking-wide"'), "landmark: the full variant prints the restaurant name line");
  const noLogo = kotOf(1);
  assert.ok(!noLogo.includes("/api/branding/logo") && noLogo.includes("Test Cafe"), "no-logo: no logo element, name stays");
  const blank = kotOf(2);
  assert.ok(blank.includes("/api/branding/logo") && !blank.includes("tracking-wide\""), "blank-name: logo stays, no name line");
  const empty = KOT_PROP_SETS.find((p) => p.id === "round-items-empty") as KotPropSet;
  const emptyHtml = legacyKot(empty.order, { ...settingsOf(), ...allOn }, empty.extra);
  assert.ok(emptyHtml.includes("0 item(s)") && emptyHtml.includes("Round total:"), "landmark: an empty round prints 0 item(s) and a zero total");
});

// ── Engine behaviour: the engine is not just echoing legacy ──────────────────

const bill = BILL_FIXTURES[0];
const gstFx = BILL_FIXTURES.find((f) => f.id === "incl-gst") as BillFixture;
const idx = (html: string, needle: string): number => {
  const i = html.indexOf(needle);
  assert.ok(i >= 0, `landmark: markup contains ${JSON.stringify(needle)}`);
  return i;
};

test("engine: moving footerText to the top of Classic moves that line in the output", () => {
  const tpl = classicBillTemplate(bill.settings);
  const footer = tpl.blocks.find((b) => b.type === "footerText");
  assert.ok(footer, "landmark: Classic-from-legacy carries a footerText block");
  const moved: BillTemplate = { ...tpl, blocks: [footer, ...tpl.blocks.filter((b) => b !== footer)] };
  const classicHtml = engineBill(bill.order, bill.settings);
  const movedHtml = engineBill(bill.order, bill.settings, undefined, moved);
  assert.ok(idx(classicHtml, FOOTER) > idx(classicHtml, "TOTAL"), "Classic prints the footer after the total");
  assert.ok(idx(movedHtml, FOOTER) < idx(movedHtml, "Test Cafe"), "the moved template prints the footer above the name");
  assert.ok(idx(movedHtml, "TOTAL") > 0 && movedHtml !== classicHtml);
});

test("engine: turning tagline off removes it", () => {
  const tpl = classicBillTemplate(bill.settings);
  assert.ok(engineBill(bill.order, bill.settings).includes(TAGLINE), "landmark: Classic prints the tagline");
  const off: BillTemplate = { ...tpl, blocks: tpl.blocks.map((b) => (b.type === "tagline" ? { ...b, on: false } : b)) };
  assert.ok(tpl.blocks.some((b) => b.type === "tagline"), "landmark: the template has a tagline block to turn off");
  assert.ok(!engineBill(bill.order, bill.settings, undefined, off).includes(TAGLINE), "no tagline when its block is off");
});

test("engine: on a GST order a template with gstin off still prints GSTIN (lock)", () => {
  const tpl = classicBillTemplate(gstFx.settings);
  assert.ok(tpl.blocks.some((b) => b.type === "gstin"), "landmark: the template has a gstin block");
  const off: BillTemplate = { ...tpl, blocks: tpl.blocks.map((b) => (b.type === "gstin" ? { ...b, on: false } : b)) };
  assert.ok(engineBill(gstFx.order, gstFx.settings, undefined, off).includes(`GSTIN: ${GSTIN}`), "locked on");
});

test("engine: the address lock bites only on a GST order (address off prints it with GST, not without)", () => {
  const noGst = BILL_FIXTURES.find((f) => f.id === "gst-off") as BillFixture;
  const addressOff = (s: Settings): BillTemplate => {
    const tpl = classicBillTemplate(s);
    return { ...tpl, blocks: tpl.blocks.map((b) => (b.type === "address" ? { ...b, on: false } : b)) };
  };
  assert.ok(classicBillTemplate(noGst.settings).blocks.some((b) => b.type === "address"), "landmark: an address block exists");
  assert.ok(engineBill(noGst.order, noGst.settings).includes(noGst.settings.address), "landmark: Classic prints the address with GST off");
  assert.ok(!engineBill(noGst.order, noGst.settings, undefined, addressOff(noGst.settings)).includes(noGst.settings.address), "no lock without GST: address off prints no address");
  assert.ok(engineBill(gstFx.order, gstFx.settings, undefined, addressOff(gstFx.settings)).includes(gstFx.settings.address), "GST order: the address is locked on");
});

test("landmark: the Classic converters carry the forward blocks (bill title off + token, KOT station + token)", () => {
  const bt = classicBillTemplate(bill.settings).blocks;
  assert.equal(bt.find((b) => b.type === "title")?.on, false, "bill title is present and off");
  assert.ok(bt.some((b) => b.type === "token"), "bill token block present");
  const kt = classicKotTemplate(settingsOf()).blocks;
  assert.ok(kt.some((b) => b.type === "station") && kt.some((b) => b.type === "token"), "KOT station and token blocks present");
});

test("engine: a KOT template with title off prints no KITCHEN ORDER but keeps *** VOID ***", () => {
  const plain = KOT_PROP_SETS.find((p) => p.id === "round-label-number") as KotPropSet;
  const voided = KOT_PROP_SETS.find((p) => p.id === "void-reason-by-at") as KotPropSet;
  const s = settingsOf();
  const tpl = classicKotTemplate(s);
  assert.ok(tpl.blocks.some((b) => b.type === "title"), "landmark: the template has a title block");
  const off: KotTemplate = { ...tpl, blocks: tpl.blocks.map((b) => (b.type === "title" ? { ...b, on: false } : b)) };
  assert.ok(engineKot(plain.order, s, plain.extra).includes("KITCHEN ORDER"), "landmark: Classic prints the title");
  assert.ok(!engineKot(plain.order, s, plain.extra, off).includes("KITCHEN ORDER"), "no title on a plain round");
  assert.ok(engineKot(voided.order, s, voided.extra, off).includes("*** VOID ***"), "the void banner is locked on");
});

test("engine: roundTotal prints only when the visible items block shows prices", () => {
  const plain = KOT_PROP_SETS.find((p) => p.id === "round-label-number") as KotPropSet;
  const s = settingsOf({ kotShowPrices: true, kotShowTotal: true });
  const tpl = classicKotTemplate(s);
  const withPrices = (prices: boolean): KotTemplate => ({
    ...tpl,
    blocks: tpl.blocks.map((b) =>
      b.type === "items" ? { ...b, options: { ...b.options, prices } } : b.type === "roundTotal" ? { ...b, on: true } : b,
    ),
  });
  assert.ok(tpl.blocks.some((b) => b.type === "roundTotal"), "landmark: the template has a roundTotal block");
  assert.ok(engineKot(plain.order, s, plain.extra, withPrices(true)).includes("Round total:"), "prices on: the round total prints");
  assert.ok(!engineKot(plain.order, s, plain.extra, withPrices(false)).includes("Round total:"), "prices off: no round total even with the block on");
});

test("golden summary", (t) => {
  t.diagnostic(`cells compared: ${JSON.stringify(counts)}`);
  assert.ok(counts.billMatrix > 0 && counts.kotFlags > 0 && counts.kotBare > 0 && counts.kotPaperFont > 0);
});
