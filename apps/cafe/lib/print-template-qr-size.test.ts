import { FIXED_NOW_MS, KOT_ROUND, MAX_BILL, billWithQr, maxSettings, qrCount, readQr, renderBill, renderKot } from "./print-template-matrix.fixtures"; // FIRST: it selects React's production renderer before react loads
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";

import { BILL_DESIGNS, KOT_DESIGNS, PRINT_QR_SIZES, type BillDesign, type KotBlock, type KotTemplate, type PrintQrSize } from "@pos/shared/print-template";
import { QR_MODULE_PX } from "@/components/print/slip/generic-blocks";
import { PAPER_WIDTH_CLASS } from "@/lib/print";
import { defaultKotTemplate } from "@/lib/print-template-designs";
import { loadSlipCode } from "@/components/print/slip/slip-code";

// QR size (Normal / Large / Extra large): Normal is byte-for-byte what every older design printed; the bigger sizes scale the
// module (3 / 4 CSS px), never run wider than the slip, and stack a beside layout so the caption goes under the code.
before(() => loadSlipCode());
before(() => mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS }));
after(() => mock.timers.reset());

const settings = maxSettings();
const URL_OK = "https://example.com/menu";
const MODULE_PX: Record<PrintQrSize, number> = { normal: 2, large: 3, xlarge: 4 };
const BIG_STYLE = 'style="max-width:100%;height:auto"';
const CAPTION = "Scan me";
// The bill designs' QR layouts (bill-*-blocks.tsx): classic / cafe centre-under, express centre-beside, modern left.
const LEFT: BillDesign = "modern";
const BESIDE: BillDesign = "express";
const UNDER: readonly BillDesign[] = ["classic", "cafe"];

const bill = (design: BillDesign, options: object): string => renderBill(MAX_BILL, settings, billWithQr(design, options));
const kotLink = (design: (typeof KOT_DESIGNS)[number], options: object): string => {
  const base = defaultKotTemplate(design, settings);
  const tpl: KotTemplate = { ...base, blocks: [...base.blocks, { id: "qr-1", type: "qr", on: true, options } as KotBlock] };
  return renderKot(KOT_ROUND.order, settings, KOT_ROUND.extra, tpl);
};
const svgTag = (html: string): string => /<svg [^>]*aria-label="QR code"[^>]*>/.exec(html)?.[0] ?? "";
const rowOf = (html: string): string => {
  const at = html.indexOf('aria-label="QR code"');
  return html.slice(html.lastIndexOf("<div", at), at);
};

test("the module sizes: Normal is the exported QR_MODULE_PX floor, then 3 and 4", () => {
  assert.deepEqual([...PRINT_QR_SIZES], ["normal", "large", "xlarge"]);
  assert.equal(QR_MODULE_PX, MODULE_PX.normal);
});

test("Normal markup is unchanged: absent size and size normal print the same bytes, with no style attribute and the exact svg tag", () => {
  for (const design of BILL_DESIGNS) {
    const absent = bill(design, { content: "upi", caption: CAPTION });
    assert.equal(qrCount(absent), 1, `${design}: landmark: the code prints`);
    assert.equal(bill(design, { content: "upi", caption: CAPTION, size: "normal" }), absent, `${design}: size normal = size absent`);
    const qr = readQr(absent);
    assert.equal(qr.width, qr.span * QR_MODULE_PX, `${design}: width = span x 2`);
    assert.equal(
      svgTag(absent),
      `<svg width="${qr.width}" height="${qr.height}" viewBox="0 0 ${qr.span} ${qr.span}" shape-rendering="crispEdges" fill="black" class="shrink-0" role="img" aria-label="QR code">`,
      `${design}: the svg opening tag is the pre-size shape`,
    );
    assert.ok(!absent.includes("max-width:100%"), `${design}: no maxWidth on a normal code`);
  }
});

test("Large and Extra large: width = span x 3 / x 4 with the max-width style, on a pay QR and a link QR, in every bill design", () => {
  for (const design of BILL_DESIGNS) {
    const spans = new Set<number>();
    for (const size of ["large", "xlarge"] as const) {
      for (const options of [{ content: "upi", size }, { content: "link", url: URL_OK, size }]) {
        const html = bill(design, options);
        const qr = readQr(html);
        spans.add(qr.span);
        assert.equal(qr.width, qr.span * MODULE_PX[size], `${design} ${options.content} ${size}: width = span x ${MODULE_PX[size]}`);
        assert.equal(qr.height, qr.width, `${design} ${options.content} ${size}: square`);
        assert.ok(svgTag(html).includes(BIG_STYLE), `${design} ${options.content} ${size}: never wider than the slip (${svgTag(html)})`);
      }
    }
    assert.ok(spans.size >= 1, "landmark: spans were read");
  }
});

test("a bigger code is the same code: the dark modules are identical at every size", () => {
  const dark = (size: PrintQrSize) => [...readQr(bill("modern", { content: "link", url: URL_OK, size })).dark].sort();
  assert.deepEqual(dark("large"), dark("normal"));
  assert.deepEqual(dark("xlarge"), dark("normal"));
  assert.ok(dark("normal").length > 0, "landmark: the code has modules");
});

test("a beside layout stacks at Large and Extra large; a centre-under layout is unchanged", () => {
  const withCaption = (size: PrintQrSize) => ({ content: "upi", caption: CAPTION, size });
  // left (modern): beside at Normal, caption under and left-aligned when big.
  assert.ok(rowOf(bill(LEFT, withCaption("normal"))).includes("flex items-center gap-2.5"), "landmark: left is beside at Normal");
  for (const size of ["large", "xlarge"] as const) {
    const html = bill(LEFT, withCaption(size));
    assert.ok(rowOf(html).includes("flex flex-col items-start gap-1"), `left ${size} stacks`);
    assert.ok(html.includes(`w-full min-w-0 break-words`) && html.includes(CAPTION), `left ${size}: the caption takes the full width`);
  }
  // centre-beside (express): the centre-under classes when big.
  assert.ok(rowOf(bill(BESIDE, withCaption("normal"))).includes("justify-center gap-2"), "landmark: express is beside at Normal");
  for (const size of ["large", "xlarge"] as const) {
    assert.ok(rowOf(bill(BESIDE, withCaption(size))).includes("flex flex-col items-center gap-1"), `centreBeside ${size} stacks`);
  }
  // centre-under (classic, cafe): the same row at every size.
  for (const design of UNDER) {
    for (const size of PRINT_QR_SIZES) {
      assert.ok(rowOf(bill(design, withCaption(size))).includes("flex flex-col items-center gap-1"), `${design} ${size}`);
    }
  }
});

test("the Valid till note stays under the code at every size", () => {
  for (const size of PRINT_QR_SIZES) {
    const html = bill(LEFT, { content: "upi", size });
    assert.ok(html.indexOf("Valid till") > html.indexOf('aria-label="QR code"'), `${size}: the note is under the code`);
  }
});

test("the kitchen ticket's link QR takes the size too", () => {
  for (const design of KOT_DESIGNS) {
    const normal = readQr(kotLink(design, { content: "link", url: URL_OK }));
    for (const size of ["large", "xlarge"] as const) {
      const html = kotLink(design, { content: "link", url: URL_OK, size });
      assert.equal(readQr(html).width, normal.span * MODULE_PX[size], `kot ${design} ${size}`);
      assert.ok(svgTag(html).includes(BIG_STYLE), `kot ${design} ${size}: max-width style`);
    }
    assert.ok(!svgTag(kotLink(design, { content: "link", url: URL_OK })).includes("style="), `kot ${design}: normal has no style`);
  }
});

test("an Extra large code of a long link still fits the 58 mm slip's text area once the max-width style applies", () => {
  const cssWidth = (cls: string): number => Number(/w-\[(\d+)px\]/.exec(cls)?.[1]);
  const PADDING_PX = 24;
  const long = `https://example.com/${"a".repeat(170)}`;
  const html = bill("modern", { content: "link", url: long, size: "xlarge" });
  assert.equal(qrCount(html), 1, "landmark: the long link prints");
  // The attribute width can exceed the paper; the style's max-width is what holds it inside. Pin both halves.
  assert.ok(readQr(html).width > cssWidth(PAPER_WIDTH_CLASS["58mm"]) - PADDING_PX, "landmark: the natural width is wider than the paper");
  assert.ok(svgTag(html).includes("max-width:100%"), "so the code is clamped to the container");
});
