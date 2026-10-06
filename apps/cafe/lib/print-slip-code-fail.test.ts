import { ITEMS, FIXED_NOW_MS, orderOf, settingsOf } from "./print-template-golden.fixtures"; // FIRST: selects React's production renderer before react loads
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import React, { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { KOTReceipt } from "@/components/pos/KOTReceipt";
import { OrderReceipt } from "@/components/pos/OrderReceipt";
import { SlipPreview } from "@/components/print/slip/SlipSkeleton";
import { loadSlipCode, loadedSlipCode, setSlipCodeImport, slipCodeStatus } from "@/components/print/slip/slip-code";
import { defaultBillTemplate, defaultKotTemplate } from "@/lib/print-template-designs";
import type { Settings } from "@/types";

(globalThis as { React?: typeof React }).React = React;
before(() => mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS }));
after(() => mock.timers.reset());

// R6 (01-PLAN A4): a chunk that will not load. The store is process-wide, so the failure path has its own file
// (print-slip-code.test.ts covers the happy path). The tests run IN ORDER: fail, retry while still failing, recover.

const BASE: Settings = settingsOf();
const MODERN: Settings = { ...BASE, billTemplate: defaultBillTemplate("modern", BASE) };
const BOLD: Settings = { ...BASE, kotTemplate: defaultKotTemplate("kitchenBold", BASE) };
const ORDER = orderOf({});
const bill = (s: Settings): ReactElement => createElement(OrderReceipt, { order: ORDER, settings: s });
const kot = (s: Settings): ReactElement => createElement(KOTReceipt, { order: ORDER, settings: s });
const html = (el: ReactElement): string => renderToStaticMarkup(el);
const inPreview = (el: ReactElement): string => renderToStaticMarkup(createElement(SlipPreview, null, el));
const isSkeleton = (out: string): boolean => out.includes('role="status"');
const showsItems = (out: string): boolean => ITEMS.every((it) => out.includes(it.name));
const realImport = () => import("@/components/print/slip/slip-code-lazy");

let calls = 0;
const failing = (): Promise<never> => {
  calls += 1;
  return Promise.reject(new Error("offline"));
};

test("a failed fetch: loadSlipCode resolves (never rejects), status is failed, nothing is loaded", async () => {
  setSlipCodeImport(failing);
  const run = loadSlipCode();
  assert.equal(slipCodeStatus(), "loading", "landmark: it was loading while the import was pending");
  assert.equal(await run, undefined, "it resolves");
  assert.equal(calls, 1);
  assert.equal(slipCodeStatus(), "failed");
  assert.equal(loadedSlipCode(), null);
});

test("failed: a print surface AND a preview both render the legacy slip (the preview shows no skeleton either)", () => {
  assert.equal(slipCodeStatus(), "failed", "landmark: the previous test left the store failed");
  const legacyBill = html(bill(BASE));
  const legacyKot = html(kot(BASE));
  assert.ok(showsItems(legacyBill) && showsItems(legacyKot), "landmark: the legacy slips print the order's items");
  assert.equal(html(bill(MODERN)), legacyBill, "print: Modern bill falls back to the legacy bill");
  assert.equal(html(kot(BOLD)), legacyKot, "print: kitchenBold kot falls back to the legacy kot");
  assert.equal(inPreview(bill(MODERN)), legacyBill, "preview: legacy too");
  assert.equal(inPreview(kot(BOLD)), legacyKot, "preview: legacy too");
  assert.ok(!isSkeleton(inPreview(bill(MODERN))) && !isSkeleton(inPreview(kot(BOLD))), "no skeleton that would spin forever");
});

test("a failure is not memoized: every later loadSlipCode() imports again (concurrent calls still share one), and a recovered import reaches ready", async () => {
  const first = loadSlipCode();
  assert.strictEqual(loadSlipCode(), first, "joins the retry in flight");
  await first;
  assert.equal(calls, 2, "the next call after a failure imported again, once");
  assert.equal(slipCodeStatus(), "failed", "still failed while the import still rejects");
  await loadSlipCode();
  assert.equal(calls, 3, "and again on the call after that");

  setSlipCodeImport(realImport);
  await loadSlipCode();
  assert.equal(slipCodeStatus(), "ready");
  assert.equal(calls, 3, "the real importer was used, not the failing one");
  assert.ok(loadedSlipCode() !== null);
  const legacyBill = html(bill(BASE));
  for (const out of [html(bill(MODERN)), inPreview(bill(MODERN))]) {
    assert.ok(showsItems(out) && !isSkeleton(out) && out !== legacyBill, "recovered: the Modern bill is the design again");
  }
});
