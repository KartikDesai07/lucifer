import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  sampleKitchenOrder,
  SAMPLE_BILL_ITEMS,
  SAMPLE_KITCHEN_INSTRUCTION,
  SAMPLE_KITCHEN_NOTE,
  SAMPLE_KITCHEN_TABLE,
} from "@/lib/bill-print-sample";
import { computeOrderTotals } from "@/lib/receipt";
import { stripComments } from "@/lib/source-pin-utils";

// Settings > Kitchen ticket shows a live sample ticket (KitchenTicketPreview.tsx)
// that is the REAL kitchen renderer over a priced sample order
// (sampleKitchenOrder in lib/bill-print-sample.ts). Pinned here: the sample's
// money is the real order maths, it carries what every "show" toggle prints,
// the preview renders KOTReceipt rather than a copy of it, and every kot field
// the page edits is also watched by the preview. Source-read pins, the same
// technique as bill-print-preview-paths.test.ts.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const HELPER = "apps/cafe/lib/bill-print-sample.ts";
const PREVIEW = "apps/cafe/components/settings/KitchenTicketPreview.tsx";
const PAGE = "apps/cafe/app/(dashboard)/settings/kitchen-ticket/page.tsx";
const RECEIPT = "apps/cafe/components/pos/KOTReceipt.tsx";
// Landmarks only: the tripwire scans every settings component the page reaches
// (editorFiles below), so a new editor is scanned without being listed here.
const KNOWN_EDITORS = [
  "apps/cafe/components/settings/KotPrintCard.tsx",
  "apps/cafe/components/settings/KotPaperFields.tsx",
];
const SETTINGS_IMPORT = /from "@\/components\/settings\/([A-Za-z]+)"/g;

const CREATED_AT = "2026-10-03T10:00:00.000Z";

// ── (a) the sample order ────────────────────────────────────────────────────

test("the sample ticket is priced by computeOrderTotals over its own items, GST off", () => {
  const order = sampleKitchenOrder(CREATED_AT);
  const totals = computeOrderTotals({
    items: order.items,
    discount: 0,
    discountKind: undefined,
    charge: 0,
    cfg: { gstEnabled: false, gstRate: 0, gstMode: "inclusive" },
  });
  assert.equal(order.subtotal, totals.subtotal, "subtotal");
  assert.equal(order.discount, totals.discount, "discount");
  assert.equal(order.gstAmount, totals.gstAmount, "gstAmount");
  assert.equal(order.total, totals.total, "total");
  assert.equal(order.gstRate, 0, "no GST snapshot on a ticket");
  assert.ok(order.total > 0, "landmark: the sample has a real total");
});

test("the sample ticket has the same two dishes as the bill sample", () => {
  const order = sampleKitchenOrder(CREATED_AT);
  assert.equal(order.items.length, SAMPLE_BILL_ITEMS.length);
  assert.deepEqual(
    order.items.map((i) => [i.productId, i.name, i.price, i.qty]),
    SAMPLE_BILL_ITEMS.map((i) => [i.productId, i.name, i.price, i.qty]),
  );
});

test("the sample ticket carries a table, an order note, a dish note, a staff name and the time given", () => {
  const order = sampleKitchenOrder(CREATED_AT);
  assert.equal(order.tableNo, SAMPLE_KITCHEN_TABLE);
  assert.equal(order.notes, SAMPLE_KITCHEN_NOTE);
  assert.equal(SAMPLE_KITCHEN_INSTRUCTION, "Less sugar");
  assert.ok(order.items.some((i) => i.instructions === SAMPLE_KITCHEN_INSTRUCTION), "a dish carries the instruction");
  assert.ok(order.items.some((i) => !i.instructions), "landmark: only one dish carries it");
  assert.ok(order.receiver.length > 0, "a staff name to print");
  assert.equal(order.createdAt, CREATED_AT, "createdAt");
  assert.equal(order.status, "Pending", "still in the kitchen");
});

test("the sample bill's own dishes are untouched by the kitchen sample", () => {
  sampleKitchenOrder(CREATED_AT);
  assert.ok(SAMPLE_BILL_ITEMS.every((i) => i.instructions === ""), "the shared dishes stay note-free");
});

// ── (b) the helper does no maths of its own ─────────────────────────────────

const helperRaw = readSrc(HELPER);
const helperSrc = stripComments(helperRaw);

function kitchenHelperBody(): string {
  const start = helperSrc.indexOf("export function sampleKitchenOrder(");
  assert.ok(start >= 0, "the helper must export sampleKitchenOrder");
  return helperSrc.slice(start);
}

test("PIN: the kitchen sample prices through computeOrderTotals and does none of its own", () => {
  const body = kitchenHelperBody();
  assert.ok(helperRaw.includes("computeOrderTotals"), "landmark: the raw read sees the source");
  assert.ok(body.includes("computeOrderTotals("), "sampleKitchenOrder must call computeOrderTotals(");
  assert.ok(!helperRaw.includes("Math."), "the helper must not use Math at all");
  for (const field of ["subtotal", "total", "gstAmount", "discount"]) {
    assert.match(body, new RegExp(String.raw`\b${field}: totals\.${field},`), `${field} must come straight from totals`);
  }
  // No arithmetic on prices: a price is never multiplied or summed here.
  assert.ok(!/\b(price|qty)\b\s*[*+]/.test(body), "no price/qty arithmetic in the helper");
  assert.ok(!/\.reduce\(/.test(body), "no summing in the helper");
});

// ── (c) the preview renders the real kitchen ticket ─────────────────────────

const previewSrc = stripComments(readSrc(PREVIEW));
const receiptSrc = stripComments(readSrc(RECEIPT));

test("PIN: the preview renders the real KOTReceipt with the sample order and the live settings", () => {
  assert.match(
    previewSrc,
    /import \{ KOTReceipt \} from "@\/components\/pos\/KOTReceipt";/,
    "the preview must import the real kitchen ticket",
  );
  assert.match(previewSrc, /<KOTReceipt\b[^>]*\border=\{order\}/, "the preview must render <KOTReceipt order={order}");
  assert.match(previewSrc, /<KOTReceipt\b[^>]*\bsettings=\{live\}/, "the preview must render <KOTReceipt settings={live}");
  assert.match(
    previewSrc,
    /<KOTReceipt\b[^>]*\broundNumber=\{cfg\.numberStart\}/,
    "the ticket number must follow the live start number",
  );
  assert.match(previewSrc, /\bsampleKitchenOrder\(/, "the preview must build the order with sampleKitchenOrder(");
});

test("PIN: the preview's ticket config is read from the live settings, not the saved ones", () => {
  assert.match(
    previewSrc,
    /\bconst cfg = printConfigOf\(live\)\.kot;/,
    "the number start must follow the form, so cfg must come from printConfigOf(live)",
  );
});

test("PIN: the round line is built from the print host's prefix and the sample's round count", () => {
  assert.match(
    previewSrc,
    /import \{ ROUND_LABEL_PREFIX \} from "@\/lib\/print-host-slips";/,
    "the preview must import the print host's round prefix",
  );
  assert.match(
    previewSrc,
    /\broundLabel = `\$\{ROUND_LABEL_PREFIX\}\$\{order\.kotRounds\}`;/,
    "the label must be the prefix + order.kotRounds, like the print host",
  );
  assert.match(previewSrc, /<KOTReceipt\b[^>]*\broundLabel=\{roundLabel\}/, "the ticket must be given the round label");
  assert.ok(
    stripComments(readSrc("apps/cafe/lib/print-host-slips.ts")).includes('export const ROUND_LABEL_PREFIX = "Round ";'),
    "landmark: the print host exports the prefix with the exact text",
  );
});

// String literals and JSX text of the preview, minus the import lines and the
// watched field names: whatever is left is text the preview could be printing.
function previewTextPieces(): string[] {
  const start = previewSrc.indexOf("WATCHED_KOT_FIELDS = [");
  const end = previewSrc.indexOf("] as const", start);
  assert.ok(start >= 0 && end > start, "landmark: the watched list is found");
  const body = (previewSrc.slice(0, start) + previewSrc.slice(end)).replace(/^import [^\n]*$/gm, "");
  const pieces: string[] = [];
  for (const m of body.matchAll(/"([^"\\\n]*)"/g)) pieces.push(m[1]);
  for (const m of body.matchAll(/`([^`]*)`/g)) pieces.push(m[1].replace(/\$\{[^}]*\}/g, ""));
  for (const m of body.matchAll(/>([^<>{}]+)</g)) pieces.push(m[1]);
  return pieces;
}

const TICKET_WORDS = ["KITCHEN ORDER", "Round", "Table", "Staff", "Time", "Note:", "item(s)", "₹"];

test("PIN: the preview prints no ticket text of its own", () => {
  // Landmarks first: the renderer owns these lines and the preview reads real source.
  for (const needle of ["KITCHEN ORDER", "Round total", "Note:", "item(s)", "Table", "Staff", "Time"]) {
    assert.ok(receiptSrc.includes(needle), `landmark: the ticket prints ${needle}`);
  }
  assert.match(previewSrc, /<KOTReceipt\b/, "landmark: the preview renders the ticket");
  const pieces = previewTextPieces();
  assert.ok(pieces.includes("overflow-x-auto"), "landmark: the scan sees the preview's own class strings");
  for (const piece of pieces) {
    for (const word of TICKET_WORDS) {
      assert.ok(!piece.includes(word), `the preview must not print "${word}" itself (found in "${piece}")`);
    }
    assert.ok(!/#\d/.test(piece), `the preview must not print a ticket number itself (found in "${piece}")`);
  }
});

// ── (d) tripwire: edited fields == watched fields ───────────────────────────

const NAME_PATTERNS = [/\bname="(kot[A-Za-z]+)"/g, /\bregister\("(kot[A-Za-z]+)"/g];

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

test("PIN: the tripwire's scan reaches every known Kitchen ticket editor from the page", () => {
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
  const start = previewSrc.indexOf("WATCHED_KOT_FIELDS = [");
  assert.ok(start >= 0, "the preview must declare WATCHED_KOT_FIELDS");
  const end = previewSrc.indexOf("] as const", start);
  assert.ok(end > start, "WATCHED_KOT_FIELDS must be a const tuple");
  return [...previewSrc.slice(start, end).matchAll(/"(kot[A-Za-z]+)"/g)].map((m) => m[1]);
}

function watchedFields(): Set<string> {
  return new Set(watchedList());
}

test("PIN: the kot fields the page edits are exactly the ones the preview watches", () => {
  const edited = editedFields();
  const watched = watchedFields();
  assert.ok(edited.size > 0, "landmark: the scan found edited fields");
  assert.ok(watched.size > 0, "landmark: the scan found watched fields");
  assert.equal(watchedList().length, watched.size, "no field is listed twice");
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
  // step with the list silently swaps two settings (most are booleans, so tsc
  // cannot see it).
  const destructure = previewSrc.match(
    /const \[([^\]]*)\]\s*=\s*useWatch\(\{\s*control,\s*name:\s*WATCHED_KOT_FIELDS\s*\}\)/,
  );
  assert.ok(destructure, "the preview must destructure useWatch over WATCHED_KOT_FIELDS");
  assert.deepEqual(entriesOf(destructure[1]), list, "the destructure must follow WATCHED_KOT_FIELDS's order exactly");

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

test("PIN: the Kitchen ticket page is wide, renders the preview, and has the jump target", () => {
  assert.match(pageSrc, /<SettingsSectionPage\s+slug="kitchen-ticket"\s+wide\b/, "the page must be wide");
  assert.match(pageSrc, /<KitchenTicketPreview\b/, "the page must render <KitchenTicketPreview");
  assert.match(pageSrc, /\bid="kot-preview"/, "the preview group must carry id=kot-preview");
  assert.match(pageSrc, /href="#kot-preview"/, "the jump link must point at the preview");
});

test("PIN: the page renders every known editor, not just imports it", () => {
  // The tripwire walks imports, so an import left behind after the JSX is gone
  // would keep a field in the scan that the page no longer shows.
  for (const rel of KNOWN_EDITORS) {
    const name = path.basename(rel, ".tsx");
    assert.match(pageSrc, new RegExp(String.raw`<${name}\b`), `the page must render <${name}`);
  }
});
