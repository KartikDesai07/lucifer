import { ITEMS, FIXED_NOW_MS, KOT_PROP_SETS, orderOf, settingsOf } from "./print-template-golden.fixtures"; // FIRST: selects React's production renderer before react loads
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import React, { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BILL_DESIGNS, KOT_DESIGNS, type BillBlock, type BillTemplate } from "@pos/shared/print-template";
import { KOTReceipt } from "@/components/pos/KOTReceipt";
import { OrderReceipt } from "@/components/pos/OrderReceipt";
import { SlipPreview } from "@/components/print/slip/SlipSkeleton";
import { useSlipView } from "@/components/print/slip/slip-view";
import { SLIP_CODE } from "@/components/print/slip/slip-code-lazy";
import { loadSlipCode, loadedSlipCode, setSlipCodeImport, slipCodeStatus, templateNeedsSlipCode } from "@/components/print/slip/slip-code";
import { defaultBillTemplate, defaultKotTemplate } from "@/lib/print-template-designs";
import { classicBillTemplate, classicKotTemplate } from "@/lib/print-template-legacy";
import type { Settings } from "@/types";

(globalThis as { React?: typeof React }).React = React;
before(() => mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS })); // the legacy bill's "Printed ..." line
after(() => mock.timers.reset());

// R6 (01-PLAN A4): the slip-code store and how a receipt reads it (slip-code.ts, slip-view.ts). node:test gives every
// file its own process, so the store is pristine at the top of this file: the tests run IN ORDER and share it
// (pre-load, the load itself, post-load). The failure path is in print-slip-code-fail.test.ts (its own process).

const QR_LINK: BillBlock = { id: "qr-1", type: "qr", on: true, options: { content: "link", url: "https://example.com/menu" } } as BillBlock;
const withQr = (t: BillTemplate, on: boolean): BillTemplate => ({ ...t, blocks: [...t.blocks, { ...QR_LINK, on }] });

// 58 mm bill / 80 mm kitchen: each skeleton must take its OWN paper width (w-[210px] vs w-[300px]).
const BASE: Settings = settingsOf({ billPaperWidth: "58mm", kotPaperWidth: "80mm" });
const BILL_58_CLASS = 'class="w-[210px] space-y-2';
const KOT_80_CLASS = 'class="w-[300px] space-y-2';
const ORDER = orderOf({});
const KOT_EXTRA = KOT_PROP_SETS.find((p) => p.id === "whole-tab")?.extra ?? {};
const MODERN: Settings = { ...BASE, billTemplate: defaultBillTemplate("modern", BASE) };
const BOLD: Settings = { ...BASE, kotTemplate: defaultKotTemplate("kitchenBold", BASE) };
const CLASSIC_QR: Settings = { ...BASE, billTemplate: withQr(classicBillTemplate(BASE), true) };

const bill = (s: Settings): ReactElement => createElement(OrderReceipt, { order: ORDER, settings: s });
const kot = (s: Settings): ReactElement => createElement(KOTReceipt, { order: ORDER, settings: s, ...KOT_EXTRA });
// What useSlipView itself says (the receipts guard `template &&` too, so only this reads the hook's own null rule).
const Probe = ({ template }: { template: Parameters<typeof useSlipView>[0] }): ReactElement => createElement("i", null, useSlipView(template));
const viewOf = (template: Parameters<typeof useSlipView>[0], preview: boolean): string => {
  const el = createElement(Probe, { template });
  return renderToStaticMarkup(preview ? createElement(SlipPreview, null, el) : el);
};
const html = (el: ReactElement): string => renderToStaticMarkup(el);
const inPreview = (el: ReactElement): string => renderToStaticMarkup(createElement(SlipPreview, null, el));
const isSkeleton = (out: string): boolean => out.includes('role="status"') && out.includes('aria-busy="true"');
const showsItems = (out: string): boolean => ITEMS.every((it) => out.includes(it.name));

test("templateNeedsSlipCode: Classic without a QR line is false; a QR line (on OR off) makes Classic true; every other design is true", () => {
  const classic = classicBillTemplate(BASE);
  assert.ok(classic.design === "classic" && classic.blocks.length > 0 && classic.blocks.every((b) => b.type !== "qr"), "landmark: a Classic fixture with no qr line");
  assert.equal(templateNeedsSlipCode(classic), false, "Classic bill, no QR");
  assert.equal(templateNeedsSlipCode(classicKotTemplate(BASE)), false, "Classic kot, no QR");
  assert.equal(templateNeedsSlipCode(withQr(classic, true)), true, "Classic + an ON qr line");
  assert.equal(templateNeedsSlipCode(withQr(classic, false)), true, "Classic + an OFF qr line (still saved, so the encoder must be loaded)");
  assert.equal(templateNeedsSlipCode({ design: "classic", blocks: [{ type: "qr" }] }), true, "a kot-shaped Classic with a qr line");
  assert.equal(templateNeedsSlipCode({ design: "classic", blocks: [] }), false, "an empty Classic");
  const bills = BILL_DESIGNS.filter((d) => d !== "classic");
  const kots = KOT_DESIGNS.filter((d) => d !== "classic");
  assert.ok(bills.length === 3 && kots.length === 1, "landmark: modern/express/cafe + kitchenBold");
  for (const design of bills) assert.equal(templateNeedsSlipCode(defaultBillTemplate(design, BASE)), true, `bill ${design}`);
  for (const design of kots) assert.equal(templateNeedsSlipCode(defaultKotTemplate(design, BASE)), true, `kot ${design}`);
});

test("before any load, a PRINT surface renders the LEGACY slip (byte for byte the no-template markup), never a skeleton", () => {
  assert.equal(loadedSlipCode(), null, "the chunk is not loaded in a fresh process");
  assert.equal(slipCodeStatus(), "idle");
  const legacyBill = html(bill(BASE));
  const legacyKot = html(kot(BASE));
  assert.ok(showsItems(legacyBill) && showsItems(legacyKot), "landmark: the no-template slips print the order's items");
  assert.equal(html(bill(MODERN)), legacyBill, "a Modern bill is exactly the legacy bill until the chunk is in");
  assert.equal(html(kot(BOLD)), legacyKot, "a kitchenBold kot is exactly the legacy kot until the chunk is in");
  assert.equal(html(bill(CLASSIC_QR)), legacyBill, "a Classic bill WITH a QR line waits for the encoder too (legacy meanwhile)");
  assert.ok(!isSkeleton(html(bill(MODERN))) && !isSkeleton(html(kot(BOLD))), "no role=status on a print surface");
});

test("before any load, inside <SlipPreview> the lazy designs show the skeleton at their OWN paper width; Classic (no QR) shows its slip at once", () => {
  const b = inPreview(bill(MODERN));
  const k = inPreview(kot(BOLD));
  assert.ok(isSkeleton(b) && b.includes(BILL_58_CLASS), "Modern bill: skeleton at the bill width (58mm)");
  assert.ok(isSkeleton(k) && k.includes(KOT_80_CLASS), "kitchenBold kot: skeleton at the kot width (80mm)");
  assert.ok(!b.includes(ITEMS[0].name) && !k.includes(ITEMS[0].name), "a skeleton prints no order line");
  assert.ok(isSkeleton(inPreview(bill(CLASSIC_QR))), "a Classic bill with a QR line shows the skeleton in a preview");
  for (const [label, el] of [["classic bill", bill({ ...BASE, billTemplate: classicBillTemplate(BASE) })], ["classic kot", kot({ ...BASE, kotTemplate: classicKotTemplate(BASE) })], ["no template", bill(BASE)]] as const) {
    for (const [where, out] of [["print", html(el)], ["preview", inPreview(el)]] as const) {
      assert.ok(!isSkeleton(out) && showsItems(out), `${label} (${where}): the slip at once`);
    }
  }
  assert.equal(slipCodeStatus(), "idle", "rendering never fetches the chunk (the effects are the only fetchers)");
});

test("useSlipView itself, before any load: no template is legacy; Classic is the slip; a lazy design is legacy on a print surface and the skeleton in a preview", () => {
  const modern = defaultBillTemplate("modern", BASE);
  const classic = classicBillTemplate(BASE);
  assert.equal(slipCodeStatus(), "idle", "landmark: nothing loaded");
  for (const preview of [false, true]) {
    assert.equal(viewOf(null, preview), "<i>legacy</i>", `no template (preview=${preview}) is legacy`);
    assert.equal(viewOf(classic, preview), "<i>slip</i>", `Classic (preview=${preview}) is the slip`);
  }
  assert.equal(viewOf(modern, false), "<i>legacy</i>", "Modern on a print surface");
  assert.equal(viewOf(modern, true), "<i>skeleton</i>", "Modern in a preview");
});

test("loading: two concurrent loads are ONE promise; mid-load a print surface is still legacy and a preview still the skeleton", async () => {
  const legacyBill = html(bill(BASE));
  const first = loadSlipCode();
  const second = loadSlipCode();
  assert.strictEqual(first, second, "the second call joins the fetch in flight");
  assert.equal(slipCodeStatus(), "loading");
  assert.equal(loadedSlipCode(), null, "the import has not resolved synchronously");
  assert.equal(html(bill(MODERN)), legacyBill, "mid-load: print surface = legacy");
  assert.ok(isSkeleton(inPreview(bill(MODERN))), "mid-load: preview = skeleton");
  await first;
  assert.equal(slipCodeStatus(), "ready", "landmark: the load finished");
});

test("loaded: the chunk holds the 3 bill designs, the kitchenBold kot and a working QR encoder; a repeat load keeps it and never calls the importer", async () => {
  const code = loadedSlipCode();
  assert.ok(code, "loaded");
  assert.deepEqual(Object.keys(code.bill).sort(), ["cafe", "express", "modern"]);
  assert.deepEqual(Object.keys(code.kot), ["kitchenBold"]);
  assert.strictEqual(code, SLIP_CODE, "the store holds the chunk module's own export");
  assert.ok(code.createQr("scan me").modules.size > 0, "createQr is the working qrcode encoder");
  let calls = 0;
  setSlipCodeImport(async () => (calls += 1, { SLIP_CODE }));
  await loadSlipCode();
  assert.equal(calls, 0, "a loaded store never imports again");
  assert.strictEqual(loadedSlipCode(), code);
});

test("after the load: Modern bill, kitchenBold kot and Classic+QR bill render the REAL slip on a print surface AND in a preview (no skeleton, not legacy)", () => {
  const legacyBill = html(bill(BASE));
  const legacyKot = html(kot(BASE));
  for (const [label, el, legacy] of [["modern bill", bill(MODERN), legacyBill], ["kitchenBold kot", kot(BOLD), legacyKot], ["classic+qr bill", bill(CLASSIC_QR), legacyBill]] as const) {
    for (const [where, out] of [["print", html(el)], ["preview", inPreview(el)]] as const) {
      assert.ok(!isSkeleton(out), `${label} (${where}): no skeleton`);
      assert.ok(showsItems(out), `${label} (${where}): prints the order's items`);
      assert.notEqual(out, legacy, `${label} (${where}): it is the design, not the legacy slip`);
    }
  }
  assert.equal(viewOf(null, true), "<i>legacy</i>", "loaded or not, no template is still legacy (a ready store does not turn it into a slip)");
  assert.equal(viewOf(defaultBillTemplate("modern", BASE), false), "<i>slip</i>", "Modern is the slip once ready");
  assert.ok(html(bill(CLASSIC_QR)).includes('aria-label="QR code"'), "the Classic QR line encodes now that the chunk is loaded");
});
