import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// Settings > Business details shows the top of a bill as it will print
// (components/settings/BillHeaderPreview.tsx). It is a SECOND copy of the
// header block in components/pos/OrderReceipt.tsx, so a new gate or line on
// the receipt must fail here until the preview follows. Source-read pins, the
// same technique as branding-paths.test.ts (no React test framework here).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const RECEIPT = "apps/cafe/components/pos/OrderReceipt.tsx";
const PREVIEW = "apps/cafe/components/settings/BillHeaderPreview.tsx";

const HEADER_START = '<div className="text-center">';
const HEADER_END = "<Divider />";

/** The receipt's header block: first text-center div to the first Divider after it. */
function receiptHeaderBlock(src: string): string {
  const start = src.indexOf(HEADER_START);
  assert.ok(start >= 0, "landmark: the receipt must still open its header with a text-center div");
  const end = src.indexOf(HEADER_END, start);
  assert.ok(end >= 0, "landmark: the receipt's header must still end at a Divider");
  assert.ok(end > start, "the Divider must come after the header's opening div");
  return src.slice(start, end);
}

function showGates(src: string): string[] {
  return [...new Set([...src.matchAll(/cfg\.(show\w+)/g)].map((m) => m[1]))].sort();
}

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** `const LOGO_DIMENSIONS_PX ... = { ... };` through its matching brace, whitespace-normalised. */
function logoDimensionsLiteral(src: string): string {
  const nameIdx = src.indexOf("LOGO_DIMENSIONS_PX");
  assert.ok(nameIdx >= 0, "LOGO_DIMENSIONS_PX must be declared");
  const open = src.indexOf("= {", nameIdx) + 2;
  assert.ok(open > 1, "LOGO_DIMENSIONS_PX must be assigned an object literal");
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return norm(src.slice(open, i + 1));
    }
  }
  throw new Error("LOGO_DIMENSIONS_PX: no matching closing brace");
}

const receiptSrc = stripComments(readSrc(RECEIPT));
const previewSrc = stripComments(readSrc(PREVIEW));
const receiptHeader = receiptHeaderBlock(receiptSrc);

test("PIN: the preview gates on exactly the cfg.show* flags the receipt header gates on", () => {
  const receiptGates = showGates(receiptHeader);
  assert.ok(receiptGates.length >= 5, `landmark: the receipt header has its gates, saw ${receiptGates.join(",")}`);
  assert.deepEqual(showGates(previewSrc), receiptGates);
  // The set alone would pass if a gate survived only in the preview's
  // "is anything printing" check; each gate must also wrap its JSX line.
  for (const gate of receiptGates) {
    const jsxGate = `{cfg.${gate} && `;
    assert.ok(receiptHeader.includes(jsxGate), `landmark: the receipt header wraps its line in ${jsxGate}`);
    assert.ok(previewSrc.includes(jsxGate), `the preview must wrap its line in ${jsxGate}`);
  }
});

test("PIN: logo, paper width and font size come from the same class maps as the receipt", () => {
  assert.ok(receiptSrc.includes("PRINT_LOGO_CLASS[cfg.logoSize]"));
  assert.ok(previewSrc.includes("PRINT_LOGO_CLASS[cfg.logoSize]"));
  for (const needle of ["PAPER_WIDTH_CLASS[cfg.paperWidth]", "PRINT_FONT_CLASS[cfg.fontSize]"]) {
    assert.ok(receiptSrc.includes(needle), `landmark: the receipt uses ${needle}`);
    assert.ok(previewSrc.includes(needle), `the preview must use ${needle}`);
  }
});

test("PIN: the Ph, GSTIN and FSSAI line prefixes match, and FSSAI stays a literal 10px", () => {
  for (const prefix of ["Ph: {", "GSTIN: {", "FSSAI: {"]) {
    assert.ok(receiptHeader.includes(prefix), `landmark: the receipt prints "${prefix}"`);
    assert.ok(previewSrc.includes(prefix), `the preview must print "${prefix}"`);
  }
  const fssaiLine = /<div className="text-\[10px\]">FSSAI: \{/;
  assert.match(receiptHeader, fssaiLine);
  assert.match(previewSrc, fssaiLine);
});

test("PIN: the preview reads every identity field the receipt header prints", () => {
  for (const field of ["restaurantName", "tagline", "address", "mobile", "gstNumber", "fssai", "receiptHeader"]) {
    assert.ok(receiptSrc.includes(`.${field}`), `landmark: the receipt reads .${field}`);
  }
  // The live ones arrive through useWatch by name; the rest off the saved settings.
  for (const field of ["logo", "restaurantName", "tagline", "address", "mobile", "fssai"]) {
    assert.ok(previewSrc.includes(`"${field}"`), `the preview must watch "${field}"`);
  }
  for (const field of ["gstNumber", "receiptHeader"]) {
    assert.match(previewSrc, new RegExp(String.raw`settings\.${field}\b`), `the preview must read settings.${field}`);
  }
});

test("PIN: the logo's width/height table is identical in the preview and the receipt", () => {
  const receiptLiteral = logoDimensionsLiteral(receiptSrc);
  assert.ok(receiptLiteral.includes("small") && receiptLiteral.includes("large"), "landmark: three logo sizes");
  assert.equal(logoDimensionsLiteral(previewSrc), receiptLiteral);
});

// A tripwire on the receipt side: every guard in its header block, by name. A
// new line (even an ungated one), a changed guard or a changed GST rule fails
// here, so whoever changes the bill also updates BillHeaderPreview.
const RECEIPT_HEADER_GUARDS = [
  "address", "cfg.showAddress", "cfg.showFssai", "cfg.showGstNumber", "cfg.showLogo", "cfg.showMobile",
  "fssai", "gst?.show", "header", "mobile", "name", "tagline",
];

function block(src: string, startNeedle: string, endNeedle: string): string {
  const start = src.indexOf(startNeedle);
  assert.ok(start >= 0, `landmark: ${startNeedle}`);
  const end = src.indexOf(endNeedle, start);
  assert.ok(end > start, `landmark: ${endNeedle} after ${startNeedle}`);
  return src.slice(start, end);
}

test("PIN: the receipt header's guards are exactly the ones the preview mirrors (a new or changed line fails)", () => {
  const guards = [...new Set([...receiptHeader.matchAll(/\{\s*([\w?.]+)\s*&&/g)].map((m) => m[1]))].sort();
  assert.deepEqual(guards, [...RECEIPT_HEADER_GUARDS].sort());
});

test("PIN: GSTIN shows on the same rule — the receipt's gst?.show is receiptGst's 'GST on with a rate above 0'", () => {
  assert.ok(receiptHeader.includes("{gst?.show && gstNumber && ("), "landmark: the receipt gates GSTIN on the order's GST");
  const receiptLib = stripComments(readSrc("apps/cafe/lib/receipt.ts"));
  assert.ok(receiptLib.includes("if (!eff.gstEnabled || eff.gstRate <= 0) return base;"), "landmark: receiptGst's first gate");
  assert.ok(previewSrc.includes("settings.gstEnabled && (settings.gstRate ?? 0) > 0"), "the preview must use the same rule");
  assert.ok(previewSrc.includes("{gstShows && gstNumber && ("), "the preview must gate its GSTIN line on it");
});

test("PIN: the header lines print in the same order in the receipt and the preview", () => {
  const markers = [
    "PRINT_LOGO_CLASS[cfg.logoSize]",
    'text-[1.33em] font-bold tracking-wide',
    "{cfg.showAddress && ",
    "{cfg.showMobile && ",
    "{cfg.showGstNumber && ",
    "{cfg.showFssai && ",
    "mt-1 text-[0.83em]",
  ];
  const previewHeader = block(previewSrc, HEADER_START, "border-dashed");
  for (const [label, src] of [["receipt", receiptHeader], ["preview", previewHeader]] as const) {
    let last = -1;
    for (const marker of markers) {
      const at = src.indexOf(marker);
      assert.ok(at >= 0, `${label}: ${marker} must be in the header`);
      assert.equal(src.indexOf(marker, at + 1), -1, `${label}: ${marker} must appear once`);
      assert.ok(at > last, `${label}: ${marker} must come after the line before it`);
      last = at;
    }
  }
});
