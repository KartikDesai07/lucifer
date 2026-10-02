import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { sampleBillOrder, SAMPLE_BILL_ITEMS } from "@/lib/bill-print-sample";
import { computeOrderTotals, receiptGst } from "@/lib/receipt";
import type { GstConfig } from "@/lib/receipt";
import { stripComments } from "@/lib/source-pin-utils";

// Settings > Bill print shows a live sample bill (BillPrintPreview.tsx) that
// is the REAL receipt renderer over a priced sample order
// (lib/bill-print-sample.ts). Pinned here: the sample's money is the real bill
// maths, the preview renders OrderReceipt rather than a copy of it, and every
// bill/receipt field the page edits is also watched by the preview. Source-read
// pins, the same technique as gst-sample-bill.test.ts.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const HELPER = "apps/cafe/lib/bill-print-sample.ts";
const PREVIEW = "apps/cafe/components/settings/BillPrintPreview.tsx";
const PAGE = "apps/cafe/app/(dashboard)/settings/bill-print/page.tsx";
// Landmarks only: the tripwire scans every settings component the page reaches
// (editorFiles below), so a new editor is scanned without being listed here.
const KNOWN_EDITORS = [
  "apps/cafe/components/settings/BillPrintCard.tsx",
  "apps/cafe/components/settings/BillPaperFields.tsx",
  "apps/cafe/components/settings/ReceiptTextCard.tsx",
];
const SETTINGS_IMPORT = /from "@\/components\/settings\/([A-Za-z]+)"/g;
const RECEIPT = "apps/cafe/components/pos/OrderReceipt.tsx";
const ORDERS_ROUTE = "apps/cafe/app/api/orders/route.ts";

const CREATED_AT = "2026-10-03T10:00:00.000Z";
const BILL_NUMBER = 501;
const cfg = (gstRate: number, gstMode: GstConfig["gstMode"], gstEnabled = true): GstConfig => ({
  gstEnabled,
  gstRate,
  gstMode,
});

const CASES: ReadonlyArray<readonly [string, GstConfig]> = [
  ["GST off", cfg(18, "inclusive", false)],
  ["5% inclusive", cfg(5, "inclusive")],
  ["5% exclusive", cfg(5, "exclusive")],
  ["18% exclusive", cfg(18, "exclusive")],
];

// ── (a) the sample order's numbers ──────────────────────────────────────────

test("the sample bill has two lines", () => {
  assert.equal(SAMPLE_BILL_ITEMS.length, 2);
});

test("the sample order is priced by computeOrderTotals over the sample items", () => {
  for (const [name, c] of CASES) {
    const totals = computeOrderTotals({
      items: SAMPLE_BILL_ITEMS,
      discount: 0,
      discountKind: undefined,
      charge: 0,
      cfg: c,
    });
    const order = sampleBillOrder(c, BILL_NUMBER, CREATED_AT);
    assert.equal(order.subtotal, totals.subtotal, `${name}: subtotal`);
    assert.equal(order.discount, totals.discount, `${name}: discount`);
    assert.equal(order.total, totals.total, `${name}: total`);
    assert.equal(order.gstAmount, totals.gstAmount, `${name}: gstAmount`);
    assert.ok(order.total > 0, `${name}: landmark - the sample has a real total`);
  }
});

test("the GST snapshot is 0 when GST is off and the rate when on, with the mode kept", () => {
  for (const [name, c] of CASES) {
    const order = sampleBillOrder(c, BILL_NUMBER, CREATED_AT);
    assert.equal(order.gstRate, c.gstEnabled ? c.gstRate : 0, `${name}: gstRate`);
    assert.equal(order.gstMode, c.gstMode, `${name}: gstMode`);
  }
  assert.equal(sampleBillOrder(cfg(18, "inclusive", false), BILL_NUMBER, CREATED_AT).gstRate, 0);
  assert.equal(sampleBillOrder(cfg(5, "exclusive"), BILL_NUMBER, CREATED_AT).gstRate, 5);
});

test("the sample order is a paid, completed bill carrying the bill number and date given", () => {
  for (const [name, c] of CASES) {
    const order = sampleBillOrder(c, BILL_NUMBER, CREATED_AT);
    assert.equal(order.paidAmount, order.total, `${name}: paidAmount`);
    assert.equal(order.status, "Completed", `${name}: status`);
    assert.equal(order.payment, "Cash", `${name}: payment`);
    assert.equal(order.billNumber, BILL_NUMBER, `${name}: billNumber`);
    assert.equal(order.createdAt, CREATED_AT, `${name}: createdAt`);
    assert.equal(order.tableNo, undefined, `${name}: no table prints Walk-In`);
    assert.deepEqual(order.items, [...SAMPLE_BILL_ITEMS], `${name}: items`);
  }
});

test("the receipt shows GST on the sample exactly when GST is on", () => {
  for (const [name, c] of CASES) {
    const order = sampleBillOrder(c, BILL_NUMBER, CREATED_AT);
    assert.equal(receiptGst(order, c).show, c.gstEnabled, `${name}: show`);
  }
  assert.equal(receiptGst(sampleBillOrder(cfg(18, "inclusive", false), 1, CREATED_AT), cfg(18, "inclusive", false)).show, false);
});

// ── (b) the helper does no maths of its own ─────────────────────────────────

const helperRaw = readSrc(HELPER);
const helperSrc = stripComments(helperRaw);

test("PIN: the sample helper prices through computeOrderTotals and does none of its own", () => {
  assert.ok(helperRaw.includes("computeOrderTotals"), "landmark: the raw read sees the source");
  assert.ok(helperSrc.includes("computeOrderTotals("), "must call computeOrderTotals(");
  // Raw bytes, comments included: no rounding or other Math at all.
  assert.ok(!helperRaw.includes("Math."), "the helper must not use Math at all");
});

test("PIN: the sample stamps GST the way a new order snapshots it", () => {
  assert.ok(
    helperSrc.includes("gstRate: cfg.gstEnabled ? cfg.gstRate : 0"),
    "the helper must use the order snapshot rule",
  );
  assert.ok(
    stripComments(readSrc(ORDERS_ROUTE)).includes("gstRate: gstCfg.gstEnabled ? gstCfg.gstRate : 0"),
    "landmark: the orders route snapshots GST this way",
  );
});

// ── (c) the preview renders the real receipt ────────────────────────────────

const previewSrc = stripComments(readSrc(PREVIEW));
const receiptSrc = stripComments(readSrc(RECEIPT));

test("PIN: the preview renders the real OrderReceipt with the sample order and the live settings", () => {
  assert.match(
    previewSrc,
    /import \{ OrderReceipt \} from "@\/components\/pos\/OrderReceipt";/,
    "the preview must import the real receipt",
  );
  assert.match(
    previewSrc,
    /<OrderReceipt\b[^>]*\border=\{order\}/,
    "the preview must render <OrderReceipt order={order}",
  );
  assert.match(
    previewSrc,
    /<OrderReceipt\b[^>]*\bsettings=\{live\}/,
    "the preview must render <OrderReceipt settings={live}",
  );
  assert.match(previewSrc, /\bsampleBillOrder\(/, "the preview must build the order with sampleBillOrder(");
});

test("PIN: the preview prints no receipt text of its own", () => {
  // Landmarks first: the receipt owns these lines and the preview reads real source.
  for (const needle of ["Bill No.", "GSTIN:", "<span>TOTAL</span>"]) {
    assert.ok(receiptSrc.includes(needle), `landmark: the receipt prints ${needle}`);
  }
  assert.match(previewSrc, /<OrderReceipt\b/, "landmark: the preview renders the receipt");
  for (const needle of ["TOTAL", "Bill No.", "GSTIN:", "Subtotal"]) {
    assert.ok(!previewSrc.includes(needle), `the preview must not print ${needle} itself`);
  }
});

// ── (d) tripwire: edited fields == watched fields ───────────────────────────

const NAME_PATTERNS = [
  /\bname="((?:bill|receipt)[A-Za-z]+)"/g,
  /\bregister\("((?:bill|receipt)[A-Za-z]+)"/g,
];

// The page plus every components/settings file it imports, followed
// transitively, so a field editor added anywhere under the page is scanned.
function editorFiles(): string[] {
  const seen = new Set<string>([PAGE]);
  const queue = [PAGE];
  while (queue.length > 0) {
    const src = stripComments(readSrc(queue.shift() as string));
    for (const m of src.matchAll(SETTINGS_IMPORT)) {
      const rel = `apps/cafe/components/settings/${m[1]}.tsx`;
      if (!seen.has(rel)) {
        seen.add(rel);
        queue.push(rel);
      }
    }
  }
  return [...seen];
}

test("PIN: the tripwire's scan reaches every known Bill print editor from the page", () => {
  const files = editorFiles();
  for (const rel of KNOWN_EDITORS) assert.ok(files.includes(rel), `the import walk must reach ${rel}`);
});

function editedFields(): Set<string> {
  const found = new Set<string>();
  for (const rel of editorFiles()) {
    const src = stripComments(readSrc(rel));
    for (const re of NAME_PATTERNS) {
      for (const m of src.matchAll(re)) found.add(m[1]);
    }
  }
  return found;
}

function watchedList(): string[] {
  const start = previewSrc.indexOf("WATCHED_PRINT_FIELDS = [");
  assert.ok(start >= 0, "the preview must declare WATCHED_PRINT_FIELDS");
  const end = previewSrc.indexOf("] as const", start);
  assert.ok(end > start, "WATCHED_PRINT_FIELDS must be a const tuple");
  return [...previewSrc.slice(start, end).matchAll(/"((?:bill|receipt)[A-Za-z]+)"/g)].map((m) => m[1]);
}

function watchedFields(): Set<string> {
  return new Set(watchedList());
}

test("PIN: the bill/receipt fields the page edits are exactly the ones the preview watches", () => {
  const edited = editedFields();
  const watched = watchedFields();
  assert.ok(edited.size > 0, "landmark: the scan found edited fields");
  assert.ok(watched.size > 0, "landmark: the scan found watched fields");
  assert.deepEqual(
    [...edited].filter((f) => !watched.has(f)).sort(),
    [],
    "a field the page edits but the preview does not watch would stop updating the sample",
  );
  assert.deepEqual(
    [...watched].filter((f) => !edited.has(f)).sort(),
    [],
    "a field the preview watches that the page no longer edits",
  );
});

test("PIN: every watched field is read from the form AND laid over the saved settings", () => {
  for (const field of watchedFields()) {
    const uses = previewSrc.match(new RegExp(String.raw`\b${field}\b`, "g")) ?? [];
    // The list entry, the destructured value, and the overlay on `live`.
    assert.ok(uses.length >= 3, `${field} must be listed, destructured and overlaid (found ${uses.length} uses)`);
  }
});

const entriesOf = (block: string): string[] =>
  block
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

test("PIN: useWatch's values are destructured in the list's order and each lands on its own key", () => {
  const list = watchedList();
  // useWatch returns values in the order of `name`, so a destructure out of
  // step with the list silently swaps two settings (both often booleans, so
  // tsc cannot see it).
  const destructure = previewSrc.match(/const \[([^\]]*)\]\s*=\s*useWatch\(\{\s*control,\s*name:\s*WATCHED_PRINT_FIELDS\s*\}\)/);
  assert.ok(destructure, "the preview must destructure useWatch over WATCHED_PRINT_FIELDS");
  assert.deepEqual(entriesOf(destructure[1]), list, "the destructure must follow WATCHED_PRINT_FIELDS's order exactly");

  // The overlay: shorthand `field,` only, so a value can never be laid over
  // another field's key.
  const overlay = previewSrc.match(/const live: Settings = \{([^}]*)\};/);
  assert.ok(overlay, "the preview must build `live` as one object literal");
  const keys = entriesOf(overlay[1]).filter((e) => e !== "...settings");
  assert.ok(entriesOf(overlay[1]).includes("...settings"), "`live` must start from the saved settings");
  assert.deepEqual([...keys].sort(), [...list].sort(), "`live` must overlay every watched field");
  for (const key of keys) assert.match(key, /^[A-Za-z]+$/, `\`${key}\` must be shorthand (the field's own value)`);
});

// ── (e) the page ────────────────────────────────────────────────────────────

const pageSrc = stripComments(readSrc(PAGE));

test("PIN: the Bill print page is wide, renders the preview, and has the jump target", () => {
  assert.match(pageSrc, /<SettingsSectionPage\s+slug="bill-print"\s+wide\b/, "the page must be wide");
  assert.match(pageSrc, /<BillPrintPreview\b/, "the page must render <BillPrintPreview");
  assert.match(pageSrc, /\bid="bill-preview"/, "the preview group must carry id=bill-preview");
  assert.match(pageSrc, /href="#bill-preview"/, "the jump link must point at the preview");
});
