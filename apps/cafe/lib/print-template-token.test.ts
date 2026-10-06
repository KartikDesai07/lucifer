import {
  BILL_FIXTURES, FIXED_NOW_MS, BILL_FLAG_KEYS, KOT_FLAG_KEYS, KOT_PROP_SETS, flagsOf, settingsOf,
  billGstShows, forceBillLocks, withClassicWrap, withLockedTitle, type BillFixture, type KotExtra, type KotPropSet,
} from "./print-template-golden.fixtures"; // FIRST: it selects React's production renderer before react loads
import { forceKotLocks, withClassicKotWrap } from "./print-template-kot-wrap.fixtures";
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OrderReceipt } from "@/components/pos/OrderReceipt";
import { KOTReceipt } from "@/components/pos/KOTReceipt";
import { BillTokenRow, KotTokenLine } from "@/components/pos/slip-token-lines";
import { BillSlip, KotSlip } from "@/components/print/slip/SlipEngine";
import { loadSlipCode } from "@/components/print/slip/slip-code";
import { classicBillTemplate, classicKotTemplate } from "@/lib/print-template-legacy";
import { defaultBillTemplate, defaultKotTemplate } from "@/lib/print-template-designs";
import { BILL_DESIGNS, KOT_DESIGNS, type BillDesign, type BillTemplate, type KotDesign, type KotTemplate } from "@pos/shared/print-template";
import { PAPER_WIDTHS } from "@/lib/constants";
import type { Order, Settings } from "@/types";

// Print customization S6: the order's TOKEN on every slip path. Legacy OrderReceipt / KOTReceipt (the oracle), the engine's
// Classic-from-legacy template (must equal legacy + the Classic wrap, token row included), the exact markup of the shared
// token lines, and every design. Production renderer, Date mocked (the bill's "Printed ..." line).
(globalThis as { React?: typeof React }).React = React;
before(() => loadSlipCode());
before(() => mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS }));
after(() => mock.timers.reset());

const TOKEN = 4417; // distinct from every other number a fixture prints
const bill = (order: Order | null, settings: Settings): string => renderToStaticMarkup(createElement(OrderReceipt, { order, settings }));
const engineBill = (order: Order | null, settings: Settings, template: BillTemplate): string => renderToStaticMarkup(createElement(BillSlip, { order, settings, template }));
const kot = (order: Order | null, settings: Settings, extra: KotExtra): string => renderToStaticMarkup(createElement(KOTReceipt, { order, settings, ...extra }));
const engineKot = (order: Order | null, settings: Settings, extra: KotExtra, template: KotTemplate): string => renderToStaticMarkup(createElement(KotSlip, { order, settings, ...extra, template }));
const storedBill = (s: Settings, tpl: BillTemplate = classicBillTemplate(s)): Settings => ({ ...s, billTemplate: JSON.parse(JSON.stringify(tpl)) });
const storedKot = (s: Settings, tpl: KotTemplate = classicKotTemplate(s)): Settings => ({ ...s, kotTemplate: JSON.parse(JSON.stringify(tpl)) });
const withToken = (o: Order | null): Order | null => (o ? { ...o, tokenNumber: TOKEN } : o);
const fx = (id: string): BillFixture => BILL_FIXTURES.find((f) => f.id === id) as BillFixture;
const ps = (id: string): KotPropSet => KOT_PROP_SETS.find((p) => p.id === id) as KotPropSet;
const at = (html: string, needle: string): number => {
  const i = html.indexOf(needle);
  assert.ok(i >= 0, `expected ${JSON.stringify(needle)} in the markup`);
  return i;
};

function expectSame(cell: string, expected: string, actual: string): void {
  if (expected === actual) return;
  let i = 0;
  while (i < expected.length && i < actual.length && expected[i] === actual[i]) i++;
  assert.fail(`token mismatch in [${cell}] at ${i}\n  expected: ${JSON.stringify(expected.slice(Math.max(0, i - 40), i + 40))}\n  actual:   ${JSON.stringify(actual.slice(Math.max(0, i - 40), i + 40))}`);
}

// ── (a) legacy == engine Classic, with a token ───────────────────────────────────────────────────────────────────────

const TOKEN_ROW_RE = /<span>Token<\/span><span class="(?:ml-auto )?text-right">4417<\/span>/;
test("bill: legacy + Classic wrap == the stored Classic template with a token (paid, GST, cancelled, partial) x 64 flag masks x both papers", () => {
  let cells = 0, oracle = 0, withoutNumber = 0;
  for (const id of ["paid-cash", "incl-gst", "cancelled-reason", "partial-due"]) {
    const f = fx(id);
    const order = withToken(f.order);
    for (let mask = 0; mask < 1 << BILL_FLAG_KEYS.length; mask++) {
      for (const billPaperWidth of PAPER_WIDTHS) {
        const s: Settings = { ...f.settings, ...flagsOf(BILL_FLAG_KEYS, mask), billPaperWidth, billFontSize: "normal" };
        const stored = bill(order, storedBill(s));
        assert.match(stored, TOKEN_ROW_RE, `landmark: [${id} ${mask}] the stored Classic bill prints the Token row`);
        expectSame(`${id} ${mask} ${billPaperWidth} stored vs engine`, engineBill(order, s, classicBillTemplate(s)), stored);
        const locked = forceBillLocks(s, order);
        if (BILL_FLAG_KEYS.every((k) => locked[k] === s[k])) {
          expectSame(`${id} ${mask} ${billPaperWidth} stored vs legacy`, withLockedTitle(withClassicWrap(bill(order, s)), billGstShows(order, s)), stored);
          oracle++;
        }
        if (!s.billShowNumber) withoutNumber++;
        cells++;
      }
    }
  }
  assert.equal(cells, 4 * 64 * 2);
  assert.ok(oracle >= 8 && withoutNumber >= 4 * 64, `landmark: the legacy oracle ran (${oracle} cells) and numbering-off cells were covered (${withoutNumber})`);
});

test("kot: legacy + Classic wrap == the stored Classic template with a token (round, void, moved, cancel-notice) x 1024 flag masks, plus both papers", () => {
  let cells = 0;
  for (const id of ["round-label-number", "void-reason-by-at", "moved-from-by-at", "cancel-notice-reason", "round-banner-reprint"]) {
    const p = ps(id);
    const order = withToken(p.order);
    const run = (s: Settings): void => {
      const stored = kot(order, storedKot(s), p.extra);
      assert.ok(stored.includes(`TOKEN ${TOKEN}</div>`), `landmark: [${id}] the stored Classic ticket prints the token`);
      expectSame(`${id} stored vs engine`, engineKot(order, s, p.extra, classicKotTemplate(s)), stored);
      expectSame(`${id} stored vs legacy`, withClassicKotWrap(kot(order, forceKotLocks(s, p.extra), p.extra)), stored);
      cells++;
    };
    for (let mask = 0; mask < 1 << KOT_FLAG_KEYS.length; mask++) run(settingsOf({ ...flagsOf(KOT_FLAG_KEYS, mask), kotPaperWidth: "80mm" }));
    for (const mask of [0, (1 << KOT_FLAG_KEYS.length) - 1]) {
      for (const kotPaperWidth of PAPER_WIDTHS) run(settingsOf({ ...flagsOf(KOT_FLAG_KEYS, mask), kotPaperWidth }));
    }
  }
  assert.equal(cells, 5 * (1024 + 2 * PAPER_WIDTHS.length));
});

test("oracle helper: withClassicWrap maps the legacy Token row exactly like the Bill No. row, and the shared component's wrap twin IS that mapping", () => {
  const legacy = renderToStaticMarkup(createElement(BillTokenRow, { tokenNumber: TOKEN }));
  const root = '<div class="w-[300px] text-xs bg-white p-3 font-mono text-black">';
  const mapped = withClassicWrap(`${root}${legacy}</div>`);
  assert.equal(mapped, `${root.replace('text-black"', 'text-black break-words"')}${renderToStaticMarkup(createElement(BillTokenRow, { tokenNumber: TOKEN, wrap: true }))}</div>`);
  assert.ok(legacy.includes("<span>Token</span>") && mapped.includes("flex-wrap"), "landmark: it really was rewritten");
});

// ── (b) exact markup ─────────────────────────────────────────────────────────────────────────────────────────────────

test("markup: BillTokenRow (both wraps) and KotTokenLine are exactly these strings", () => {
  const render = (el: React.ReactElement): string => renderToStaticMarkup(el);
  assert.equal(render(createElement(BillTokenRow, { tokenNumber: 42 })), '<div class="flex justify-between gap-2 font-bold"><span>Token</span><span class="text-right">42</span></div>');
  assert.equal(render(createElement(BillTokenRow, { tokenNumber: 42, wrap: false })), render(createElement(BillTokenRow, { tokenNumber: 42 })), "wrap defaults to false");
  assert.equal(render(createElement(BillTokenRow, { tokenNumber: 42, wrap: true })), '<div class="flex flex-wrap justify-between gap-2 font-bold"><span>Token</span><span class="ml-auto text-right">42</span></div>');
  assert.equal(render(createElement(KotTokenLine, { tokenNumber: 42 })), '<div class="text-center text-[1.29em] font-bold">TOKEN 42</div>');
});

// ── (c) legacy placement ─────────────────────────────────────────────────────────────────────────────────────────────

test("legacy bill: the Token row follows Bill No. and precedes Order; it prints with Show bill number OFF; no token means no 'Token' text", () => {
  const f = fx("paid-cash");
  const on = bill(withToken(f.order), { ...f.settings, billShowNumber: true });
  assert.ok(at(on, "<span>Bill No.</span>") < at(on, "<span>Token</span>") && at(on, "<span>Token</span>") < at(on, '<span class="whitespace-pre">Order</span>'));
  assert.match(on, /<span>Bill No\.<\/span><span class="text-right">12<\/span><\/div><div class="flex justify-between gap-2 font-bold"><span>Token<\/span>/, "the Token row sits right after the Bill No. row");
  const off = bill(withToken(f.order), { ...f.settings, billShowNumber: false });
  assert.ok(!off.includes("Bill No.") && TOKEN_ROW_RE.test(off), "Show bill number off hides Bill No. but not the token");
  assert.ok(!bill(f.order, f.settings).includes("Token") && !bill(f.order, { ...f.settings, billShowNumber: false }).includes("Token"), "an order without a token prints no 'Token' text");
});

test("legacy kot: TOKEN sits after '#n' and before the round label, on a round, a void, a cancel notice and a moved slip (which has no '#n')", () => {
  const line = `TOKEN ${TOKEN}</div>`;
  const s = settingsOf({ kotShowNumber: true });
  const round = kot(withToken(ps("round-label-number").order), s, ps("round-label-number").extra);
  assert.ok(at(round, "#7</div>") < at(round, line) && at(round, line) < at(round, "Round 1</div>"), "title, #7, TOKEN, round label");
  assert.ok(at(round, "KITCHEN ORDER") < at(round, "#7</div>"));
  for (const id of ["void-reason-by-at", "cancel-notice-reason"]) {
    const html = kot(withToken(ps(id).order), s, ps(id).extra);
    assert.ok(at(html, "*** VOID ***") < at(html, line), `${id}: the token follows the void banner`);
    assert.ok(html.includes("CANCELLED ITEMS"), `landmark: ${id} is a void slip`);
  }
  const moved = kot(withToken(ps("moved-from-by-at").order), s, ps("moved-from-by-at").extra);
  assert.ok(!moved.includes("text-[1.6em]") && at(moved, "FOOD ALREADY ORDERED") < at(moved, line), "a moved slip has no #n, but its token follows the banner");
  assert.equal(round.split(line).length - 1, 1, "exactly one token line");
  for (const p of KOT_PROP_SETS) assert.ok(!kot(p.order, s, p.extra).includes("TOKEN"), `no token, no TOKEN text (${p.id})`);
  assert.ok(kot(withToken(ps("whole-tab").order), settingsOf({ kotShowNumber: false }), {}).includes(line), "kotShowNumber off hides '#n' but not the token");
});

// ── (d) every design ─────────────────────────────────────────────────────────────────────────────────────────────────

const BILL_TOKEN: Record<BillDesign, RegExp> = {
  classic: /<span>Token<\/span><span class="ml-auto text-right">4417<\/span>/,
  modern: /tracking-wider">Token<\/span><span class="min-w-0 flex-1 break-words tabular-nums">4417<\/span>/,
  express: /<div class="w-fit border-\[3px\] border-black px-2 py-0\.5 text-center"><div class="text-\[0\.75em\] font-bold tracking-widest">TOKEN<\/div><div class="text-\[2\.2em\] font-bold leading-none tabular-nums">4417<\/div><\/div>/,
  cafe: /<div class="text-\[0\.92em\] font-bold">Token #4417<\/div>/,
};
const KOT_TOKEN: Record<KotDesign, string> = {
  classic: `<div class="text-center text-[1.29em] font-bold">TOKEN ${TOKEN}</div>`,
  kitchenBold: `<div class="text-[1.25em] font-bold leading-none">TOKEN ${TOKEN}</div>`,
};
const withBlockOn = <T extends BillTemplate | KotTemplate>(tpl: T, on: boolean): T => ({ ...tpl, blocks: tpl.blocks.map((b) => (b.type === "token" ? { ...b, on } : b)) }) as T;

test("every bill design prints the token (Express in its bordered box); the block off, or no number, prints nothing", () => {
  assert.deepEqual([...BILL_DESIGNS].sort(), Object.keys(BILL_TOKEN).sort(), "landmark: every design has an expectation");
  for (const design of BILL_DESIGNS) {
    for (const billPaperWidth of PAPER_WIDTHS) {
      const f = fx("paid-cash");
      const s: Settings = { ...f.settings, billPaperWidth };
      const tpl = defaultBillTemplate(design, s);
      assert.equal(tpl.blocks.find((b) => b.type === "token")?.on, true, `landmark: [${design}] the token block is on by default`);
      assert.match(bill(withToken(f.order), storedBill(s, tpl)), BILL_TOKEN[design], `[${design} ${billPaperWidth}]`);
      assert.ok(!bill(withToken(f.order), storedBill(s, withBlockOn(tpl, false))).includes(String(TOKEN)), `[${design}] block off: nothing`);
      assert.ok(!/Token|TOKEN/.test(bill(f.order, storedBill(s, tpl))), `[${design}] no number: nothing`);
    }
  }
  assert.match(bill(withToken(fx("paid-cash").order), storedBill(fx("paid-cash").settings, defaultBillTemplate("express", fx("paid-cash").settings))), /border-\[3px\]/, "Express boxes it");
});

test("every KOT design prints the token on a round, a void and a moved slip; the block off, or no number, prints nothing", () => {
  for (const design of KOT_DESIGNS) {
    const s = settingsOf({ kotShowNumber: true });
    const tpl = defaultKotTemplate(design, s);
    assert.equal(tpl.blocks.find((b) => b.type === "token")?.on, true, `landmark: [${design}] the token block is on by default`);
    for (const id of ["round-label-number", "void-reason-by-at", "moved-from-by-at"]) {
      const p = ps(id);
      assert.ok(kot(withToken(p.order), storedKot(s, tpl), p.extra).includes(KOT_TOKEN[design]), `[${design} ${id}]`);
      assert.ok(!kot(withToken(p.order), storedKot(s, withBlockOn(tpl, false)), p.extra).includes(String(TOKEN)), `[${design} ${id}] block off: nothing`);
      assert.ok(!kot(p.order, storedKot(s, tpl), p.extra).includes("TOKEN"), `[${design} ${id}] no number: nothing`);
    }
  }
});

// ── (e) a stored S4/S5-era template: the token stays where it was saved ─────────────────────────────────────────────

test("a stored template with its token line after the Order line prints it there; nothing moves it", () => {
  const f = fx("paid-cash");
  const moved = (tpl: BillTemplate): BillTemplate => {
    const token = tpl.blocks.find((b) => b.type === "token")!;
    const rest: BillTemplate["blocks"] = tpl.blocks.filter((b) => b.type !== "token");
    rest.splice(rest.findIndex((b) => b.type === "orderId") + 1, 0, token);
    return { ...tpl, blocks: rest };
  };
  const tpl = moved(defaultBillTemplate("classic", f.settings));
  const html = bill(withToken(f.order), storedBill(f.settings, tpl));
  assert.ok(at(html, "Order</span>") < at(html, "<span>Token</span>") && at(html, "<span>Token</span>") < at(html, "Date</span>"), "Token sits between Order and Date, as saved");
  const dflt = bill(withToken(f.order), storedBill(f.settings, defaultBillTemplate("classic", f.settings)));
  assert.ok(at(dflt, "<span>Token</span>") < at(dflt, "Order</span>"), "landmark: the default puts it before Order, so the saved index really differs");
  const kotTpl = defaultKotTemplate("classic", settingsOf());
  const token = kotTpl.blocks.find((b) => b.type === "token")!;
  const kotMoved: KotTemplate = { ...kotTpl, blocks: [...kotTpl.blocks.filter((b) => b.type !== "token"), token] };
  const p = ps("round-label-number");
  const k = kot(withToken(p.order), storedKot(settingsOf(), kotMoved), p.extra);
  assert.ok(at(k, "TOKEN") > at(k, "item(s)"), "a KOT token saved last prints after the item count");
});
