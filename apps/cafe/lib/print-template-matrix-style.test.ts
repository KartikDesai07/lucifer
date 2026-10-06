import {
  FIXED_NOW_MS, KOT_ROUND, KOT_VOID, MAX_BILL, NO_GST_BILL, NO_GST_SETTINGS, UPI_ID,
  billWithQr, expectEncodes, maxSettings, qrCount, readQr, renderBill, renderKot,
} from "./print-template-matrix.fixtures"; // FIRST: it selects React's production renderer before react loads
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BILL_DESIGNS, BLOCK_ALIGNS, BLOCK_SIZES, KOT_DESIGNS, type BillBlock, type BillTemplate, type BlockAlign, type BlockSize, type KotBlock, type KotTemplate } from "@pos/shared/print-template";
import { upiPayUri } from "@pos/shared/print-qr";
import { OrderReceipt } from "@/components/pos/OrderReceipt";
import { KOTReceipt } from "@/components/pos/KOTReceipt";
import { QR_MODULE_PX, QR_QUIET_MODULES } from "@/components/print/slip/generic-blocks";
import { BLOCK_ALIGN_CLASS, BLOCK_SIZE_CLASS, BOLD_CLASS, CLASSIC_REGULAR_CLASS, THEMED_REGULAR_CLASS } from "@/components/print/slip/slip-style";
import { BILL_FIXTURES, KOT_PROP_SETS, TAGLINE, billGstShows } from "./print-template-golden.fixtures";
import { defaultBillTemplate, defaultKotTemplate } from "@/lib/print-template-designs";
import { classicBillTemplate, classicKotTemplate } from "@/lib/print-template-legacy";
import { DOTS_58MM, DOTS_80MM } from "@/lib/printer/escpos";
import { PAPER_WIDTH_CLASS } from "@/lib/print";
import type { Order, Settings } from "@/types";
import { loadSlipCode } from "@/components/print/slip/slip-code";

// Print customization S3, Amendment A1.3 (f) + (g): a block's own size / align / bold wrappers and the QR rules,
// rendered through every design.

before(() => loadSlipCode()); // R6: the non-Classic designs and the QR encoder are one lazy chunk; load it before rendering
before(() => mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS }));
after(() => mock.timers.reset());

const settings = maxSettings();
const withBlock = (tpl: BillTemplate, type: string, patch: object): BillTemplate => ({
  ...tpl,
  blocks: tpl.blocks.map((b) => (b.type === type ? ({ ...b, ...patch } as BillBlock) : b)),
});
const withKotBlock = (tpl: KotTemplate, type: string, patch: object): KotTemplate => ({
  ...tpl,
  blocks: tpl.blocks.map((b) => (b.type === type ? ({ ...b, ...patch } as KotBlock) : b)),
});
// Static markup escapes the ampersand of the [&_*] variant.
const wrapper = (classes: string): string => `<div class="${classes.replace(/&/g, "&amp;")}">`;
// How far past a wrapper's opening tag the block's own text must start: the wrapper holds the block, not a neighbour.
const NEAR_CHARS = 160;

// ── (f) size / align / bold ──────────────────────────────────────────────────

test("(f) the class maps are the literal ones (a rename or a unit change fails here)", () => {
  assert.deepEqual(BLOCK_SIZE_CLASS, { xs: "text-[0.75em]", sm: "text-[0.875em]", md: "text-[1em]", lg: "text-[1.25em]", xl: "text-[1.5em]" });
  assert.deepEqual(BLOCK_ALIGN_CLASS, { left: "text-left [&_*]:text-left", center: "text-center [&_*]:text-center", right: "text-right [&_*]:text-right" });
  assert.equal(BOLD_CLASS, "font-bold [&_*]:font-bold");
  assert.equal(CLASSIC_REGULAR_CLASS, "font-normal [&_*]:font-normal");
  assert.equal(THEMED_REGULAR_CLASS, "font-medium [&_*]:font-medium");
});

test("(f) a block's size xs/sm/md/lg/xl wraps THAT block in its size class, in every bill design", () => {
  for (const design of BILL_DESIGNS) {
    const base = defaultBillTemplate(design, settings);
    const plain = renderBill(MAX_BILL, settings, withBlock(base, "tagline", { on: true }));
    assert.ok(plain.includes(TAGLINE), `${design}: landmark: the tagline prints`);
    for (const size of BLOCK_SIZES) {
      const html = renderBill(MAX_BILL, settings, withBlock(base, "tagline", { on: true, size }));
      const at = html.indexOf(wrapper(BLOCK_SIZE_CLASS[size]));
      assert.ok(at >= 0, `${design} ${size}: the size wrapper is there`);
      const text = html.indexOf(TAGLINE, at);
      assert.ok(text > at && text - at < NEAR_CHARS, `${design} ${size}: the wrapper holds the tagline`);
      assert.ok(!plain.includes(wrapper(BLOCK_SIZE_CLASS[size])), `${design} ${size}: and without the size there is no such wrapper`);
    }
  }
  for (const design of KOT_DESIGNS) {
    const base = defaultKotTemplate(design, settings);
    const html = renderKot(KOT_ROUND.order, settings, KOT_ROUND.extra, withKotBlock(base, "itemCount", { size: "xl" }));
    assert.ok(html.includes(wrapper(BLOCK_SIZE_CLASS.xl)), `kot ${design}: the item count is wrapped`);
  }
});

test("(f) a LOCKED block asked for xs prints at sm; larger sizes and unlocked blocks are untouched", () => {
  const sm = BLOCK_SIZE_CLASS.sm, xs = BLOCK_SIZE_CLASS.xs;
  for (const design of BILL_DESIGNS) {
    const base = defaultBillTemplate(design, settings);
    const html = (type: string, size: BlockSize, order: Order = MAX_BILL, s: Settings = settings): string =>
      renderBill(order, s, withBlock(base, type, { on: true, size }));
    for (const locked of ["total", "name", "gstin", "title", "taxes"]) {
      const out = html(locked, "xs");
      assert.ok(out.includes(wrapper(sm)) && !out.includes(wrapper(xs)), `${design}: GST order, locked ${locked} xs -> sm`);
      assert.ok(html(locked, "lg").includes(wrapper(BLOCK_SIZE_CLASS.lg)), `${design}: locked ${locked} keeps lg`);
    }
    // The GST lock only bites on a GST bill: on a no-GST bill the title is an ordinary line and keeps xs.
    assert.ok(billGstShows(MAX_BILL, settings) && !billGstShows(NO_GST_BILL, NO_GST_SETTINGS), "landmark: one GST bill, one without");
    const plainTitle = html("title", "xs", NO_GST_BILL, NO_GST_SETTINGS);
    assert.ok(plainTitle.includes(wrapper(xs)) && plainTitle.includes(">BILL<"), `${design}: no-GST title xs stays xs`);
    assert.ok(html("tagline", "xs").includes(wrapper(xs)), `${design}: an unlocked tagline keeps xs`);
  }
  const kot = defaultKotTemplate("kitchenBold", settings);
  const kotHtml = (extra: typeof KOT_ROUND, tpl: KotTemplate): string => renderKot(extra.order, settings, extra.extra, tpl);
  assert.ok(kotHtml(KOT_VOID, withKotBlock(kot, "title", { size: "xs" })).includes(wrapper(sm)), "kot: a VOID title is locked: xs -> sm");
  assert.ok(kotHtml(KOT_ROUND, withKotBlock(kot, "title", { on: true, size: "xs" })).includes(wrapper(xs)), "kot: a plain round's title is not locked");
});

test("(f) bold true / false and each align produce their classes, in size-align-bold order; unset adds nothing", () => {
  for (const design of BILL_DESIGNS) {
    const base = defaultBillTemplate(design, settings);
    const regular = design === "classic" ? CLASSIC_REGULAR_CLASS : THEMED_REGULAR_CLASS;
    const html = (patch: object): string => renderBill(MAX_BILL, settings, withBlock(base, "customer", { on: true, ...patch }));
    assert.ok(html({ bold: true }).includes(wrapper(BOLD_CLASS)), `${design}: bold true`);
    assert.ok(html({ bold: false }).includes(wrapper(regular)), `${design}: bold false is the design's regular weight`);
    for (const align of BLOCK_ALIGNS) assert.ok(html({ align }).includes(wrapper(BLOCK_ALIGN_CLASS[align as BlockAlign])), `${design}: align ${align}`);
    assert.ok(html({ size: "lg", align: "right", bold: true }).includes(wrapper(`${BLOCK_SIZE_CLASS.lg} ${BLOCK_ALIGN_CLASS.right} ${BOLD_CLASS}`)), `${design}: all three, in order`);
    assert.ok(!html({}).includes("[&amp;_*]"), `${design}: a block that sets nothing gets no wrapper`);
    assert.ok(html({}) !== html({ bold: true }), `${design}: landmark: the wrapper changes the markup`);
  }
});

test("(f) a Classic-from-legacy template produces NO style wrapper anywhere (its blocks carry no size / align / bold)", () => {
  const wrappers = [...Object.values(BLOCK_SIZE_CLASS), ...Object.values(BLOCK_ALIGN_CLASS), BOLD_CLASS, CLASSIC_REGULAR_CLASS].map(wrapper);
  let slips = 0;
  for (const fx of BILL_FIXTURES) {
    const tpl = classicBillTemplate(fx.settings);
    for (const b of tpl.blocks) assert.ok(!("size" in b) && !("align" in b) && !("bold" in b), `bill ${fx.id}: ${b.id} carries no style key`);
    const html = renderBill(fx.order, fx.settings, tpl);
    assert.ok(!html.includes("[&amp;_*]") && wrappers.every((w) => !html.includes(w)), `bill ${fx.id}: no style wrapper`);
    slips++;
  }
  for (const ps of KOT_PROP_SETS) {
    const s = maxSettings();
    const tpl = classicKotTemplate(s);
    for (const b of tpl.blocks) assert.ok(!("size" in b) && !("align" in b) && !("bold" in b), `kot ${ps.id}: ${b.id} carries no style key`);
    const html = renderKot(ps.order, s, ps.extra, tpl);
    assert.ok(!html.includes("[&amp;_*]") && wrappers.every((w) => !html.includes(w)), `kot ${ps.id}: no style wrapper`);
    slips++;
  }
  assert.equal(slips, BILL_FIXTURES.length + KOT_PROP_SETS.length);
  // Landmark: the same check does find a wrapper once a block sets a style.
  const styled = renderBill(MAX_BILL, settings, withBlock(classicBillTemplate(settings), "customer", { size: "lg" }));
  assert.ok(styled.includes(wrapper(BLOCK_SIZE_CLASS.lg)));
});

// ── (g) QR ───────────────────────────────────────────────────────────────────

const URL_OK = "https://example.com/menu";

test("(g) a link QR with an unusable url prints nothing (bill and kot, every design); a good one prints one code", () => {
  const unsafe = ["http://example.com/menu", "https://x y", "https://a.com\\b", "https://user:pw@example.com/x", "https://user@example.com", "https:///host", "HTTPS://example.com", "", "   ", "ftp://example.com", "javascript:alert(1)", "https://example.com/menü", "example.com"];
  const billCount = (design: (typeof BILL_DESIGNS)[number], url: string): number => qrCount(renderBill(MAX_BILL, settings, billWithQr(design, { content: "link", url })));
  const kotCount = (design: (typeof KOT_DESIGNS)[number], url: string): number => {
    const base = defaultKotTemplate(design, settings);
    const tpl: KotTemplate = { ...base, blocks: [...base.blocks, { id: "qr-1", type: "qr", on: true, options: { content: "link", url } } as KotBlock] };
    return qrCount(renderKot(KOT_ROUND.order, settings, KOT_ROUND.extra, tpl));
  };
  for (const design of BILL_DESIGNS) {
    assert.equal(billCount(design, URL_OK), 1, `bill ${design}: landmark: a good link prints`);
    assert.equal(billCount(design, ` ${URL_OK} `), 1, `bill ${design}: a padded link is trimmed`);
    for (const url of unsafe) assert.equal(billCount(design, url), 0, `bill ${design}: ${JSON.stringify(url)} prints none`);
  }
  for (const design of KOT_DESIGNS) {
    assert.equal(kotCount(design, URL_OK), 1, `kot ${design}: landmark: a good link prints`);
    for (const url of unsafe) assert.equal(kotCount(design, url), 0, `kot ${design}: ${JSON.stringify(url)} prints none`);
  }
});

test("(g) through the REAL dispatch (OrderReceipt / KOTReceipt over stored Settings): an unsafe stored link is read, then prints no QR", () => {
  const stored = (url: string): Settings => ({ ...settings, billTemplate: billWithQr("modern", { content: "link", url }), kotTemplate: (() => {
    const kot = defaultKotTemplate("kitchenBold", settings);
    return { ...kot, blocks: [...kot.blocks, { id: "qr-1", type: "qr", on: true, options: { content: "link", url } }] };
  })() });
  const bill = (url: string): string => renderToStaticMarkup(createElement(OrderReceipt, { order: MAX_BILL, settings: stored(url) }));
  const kot = (url: string): string => renderToStaticMarkup(createElement(KOTReceipt, { order: KOT_ROUND.order, settings: stored(url), ...KOT_ROUND.extra }));
  assert.equal(qrCount(bill(URL_OK)), 1, "landmark: a good stored link prints on the bill");
  assert.equal(qrCount(kot(URL_OK)), 1, "landmark: and on the kitchen ticket");
  assert.ok(bill(URL_OK).includes("TOTAL") && kot(URL_OK).includes("Round 1") && !kot(URL_OK).includes("KITCHEN ORDER"), "landmark: the stored template really rendered a slip (not the legacy fallback)");
  for (const url of ["http://example.com/menu", "https://x y", "https://u:p@example.com"]) {
    assert.equal(qrCount(bill(url)), 0, `stored bill: ${url}`);
    assert.equal(qrCount(kot(url)), 0, `stored kot: ${url}`);
    assert.ok(bill(url).includes("TOTAL"), "the slip itself still prints");
  }
});

test("(g) the printed code IS the payload: the UPI pay link (amount = due) and the link text, module for module, at the pinned module size", () => {
  const due = MAX_BILL.total - MAX_BILL.paidAmount;
  const payload = upiPayUri({ upiId: UPI_ID, payee: "Test Cafe", amount: due, note: `Bill ${MAX_BILL.billNumber}` });
  assert.ok(payload.startsWith(`upi://pay?pa=${UPI_ID}&pn=Test%20Cafe&am=${due.toFixed(2)}&cu=INR`), `landmark: the pure payload carries the due amount (${payload})`);
  for (const design of BILL_DESIGNS) {
    expectEncodes(`${design} upi`, renderBill(MAX_BILL, settings, billWithQr(design, { content: "upi" })), payload);
    expectEncodes(`${design} link`, renderBill(MAX_BILL, settings, billWithQr(design, { content: "link", url: URL_OK })), URL_OK);
  }
  // No bill number yet: the note names the order instead.
  const noNumber: Order = { ...MAX_BILL, billNumber: undefined };
  expectEncodes("order note", renderBill(noNumber, settings, billWithQr("modern", { content: "upi" })), upiPayUri({ upiId: UPI_ID, payee: "Test Cafe", amount: due, note: `Order ${MAX_BILL.orderId}` }));
});

test("(g) a module is >= 3.6 printer dots at 58 mm and 80 mm (the dots come from the print lane's own constants)", () => {
  const cssWidth = (cls: string): number => Number(/w-\[(\d+)px\]/.exec(cls)?.[1]);
  const MIN_DOTS_PER_MODULE = 3.6;
  assert.equal(cssWidth(PAPER_WIDTH_CLASS["58mm"]), 210);
  assert.equal(cssWidth(PAPER_WIDTH_CLASS["80mm"]), 300);
  assert.ok((QR_MODULE_PX * DOTS_58MM) / cssWidth(PAPER_WIDTH_CLASS["58mm"]) >= MIN_DOTS_PER_MODULE, "58 mm: 384 dots / 210 px");
  assert.ok((QR_MODULE_PX * DOTS_80MM) / cssWidth(PAPER_WIDTH_CLASS["80mm"]) >= MIN_DOTS_PER_MODULE, "80 mm: 576 dots / 300 px");
  assert.ok(QR_QUIET_MODULES >= 2, "a scanner's quiet zone");
  // The code fits the paper: the widest link QR at the URL cap stays inside the 58 mm text area (210 px less the 2 x 12 px padding).
  const long = `https://example.com/${"a".repeat(170)}`;
  const html = renderBill(MAX_BILL, settings, billWithQr("modern", { content: "link", url: long }));
  assert.equal(qrCount(html), 1, "landmark: a 190-character link still prints");
  const PADDING_PX = 24;
  assert.ok(readQr(html).width <= cssWidth(PAPER_WIDTH_CLASS["58mm"]) - PADDING_PX, "a long link's code is no wider than the 58 mm text area");
});

test("(g) a 60-character Devanagari restaurant name with a valid UPI id and money due still prints a pay QR that fits the 58 mm content box", () => {
  const PAYEE_CHARS = 60;
  const name = "मसाला".repeat(PAYEE_CHARS / 5);
  assert.equal([...name].length, PAYEE_CHARS, "landmark: sixty characters");
  const CONTENT_BOX_PX = 210 - 2 * 12; // 58 mm slip width less its 12 px side padding
  for (const design of BILL_DESIGNS) {
    const s = maxSettings({ restaurantName: name });
    const html = renderBill(MAX_BILL, s, billWithQr(design, { content: "upi" }));
    assert.ok(html.includes(name), `${design}: landmark: the long name is on the slip`);
    assert.equal(qrCount(html), 1, `${design}: the pay QR still prints`);
    const qr = readQr(html);
    assert.ok(qr.width <= CONTENT_BOX_PX, `${design}: the code is ${qr.width}px wide, the 58 mm content box is ${CONTENT_BOX_PX}px`);
  }
});
