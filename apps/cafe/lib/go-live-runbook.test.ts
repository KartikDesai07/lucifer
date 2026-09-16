import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createStaffSchema, settingsSchema, importProductRowSchema } from "@/schemas";
import {
  TABLE_NO_PATTERN,
  TABLE_NO_MAX_LEN,
  TABLE_CAPACITY_MIN,
  TABLE_CAPACITY_MAX,
  TABLE_CHARGE_MAX,
  TABLE_CHARGE_LABEL_MAX_LEN,
  TABLE_NUMBERS,
  ADMIN_ROUTES,
  DUES_RECEIPT_MODES,
  GST_RATES,
  IMAGE_MAX_DIMENSION_PX,
  MAX_IMAGE_BYTES,
  MAX_BRANDING_BYTES,
  MOBILE_VISIBLE_PREFIX,
  MOBILE_MASK_CHAR,
  HERO_MAX_DIMENSION_PX,
  BRANDING_SLOT_MAX_BYTES,
} from "@/lib/constants";
import { maskMobile } from "@pos/shared/utils";
import { TABLE_BUSY_ERROR } from "@/lib/table-admin";
import { computeOrderTotals, tableChargeOf } from "@/lib/receipt";
import { printSettingsFields } from "@/lib/print";
import { IMPORT_COLUMNS, MODIFIER_SEPARATOR, MAX_IMPORT_ROWS } from "@/lib/product-import";
import { RECEIPT_PAGE_STYLE } from "./print";
import { RESERVED_SUBDOMAINS } from "@/lib/platform";
import { readDevicePrefs } from "@/lib/pos-device-prefs";
import { SELF_ORDER_ALERT_LIMITATION } from "@pos/shared/self-order-alert";
import {
  TELEGRAM_SECRET_HEADER,
  TELEGRAM_ALLOWED_UPDATES,
  TELEGRAM_INVITE_TTL_MS,
} from "@pos/shared/telegram-alert";
import { PRESET_IDS } from "@pos/shared/appearance";
import {
  PUBLIC_MENU_PATH,
  PUBLIC_TOKEN_LENGTH,
  PUBLIC_CODE_LENGTH,
  PUBLIC_ORDER_MAX_ITEMS,
  PUBLIC_ORDER_MAX_QTY,
  PUBLIC_ORDER_RATE_MAX,
  PUBLIC_ORDER_RATE_MAX_PARCEL,
  PUBLIC_ORDER_RATE_WINDOW_MS,
  PUBLIC_STATUS_REFRESH_COOLDOWN_MS,
  PUBLIC_STATUS_READ_MAX,
  SELF_ORDER_MODES,
} from "@pos/shared/public";
// PUBLIC_REQUEST_PENDING_TTL_MS lives in this cafe-app file, NOT
// @pos/shared/public — the phase plan's scout read named the wrong module;
// verified against source (order-request-intake.ts:28) before importing.
import { PUBLIC_REQUEST_PENDING_TTL_MS } from "@/lib/order-request-intake";
import { SOLD_OUT_ERROR } from "@/lib/public-pricing";
import { MANIFEST_PATH, MANIFEST_START_URL, MANIFEST_DISPLAY } from "@/lib/pos-install";
import {
  PRINT_HOST_MAX_AGE_MS,
  PRINT_HOST_OFFLINE_MS,
  PRINT_JOB_PULSE_LIMIT,
  PRINT_JOB_STALE_LIMIT,
  PRINT_JOB_QUEUED_RETENTION_MS,
  PRINT_HOST_SILENT_OFF_WARNING,
  PRINT_HOST_ACTIVE_NOTE,
  PRINT_WAKE_FAST_MS,
  PRINT_WAKE_SLOW_MS,
  PRINT_WAKE_ACTIVE_WINDOW_MS,
  PRINT_WAKE_DAILY_CAP,
} from "@pos/shared/print-job";
import { SESSION_MAX_AGE_SECONDS, SESSION_REVALIDATE_MS } from "@pos/shared/constants";
import { KIOSK_PRINTING_FLAG } from "@/lib/print-host-setup";

// Doc<->source parity for docs/GO-LIVE-CHECKLIST.md §A "Pinned facts" — an
// operator following a stale runbook does the wrong thing on a client's live
// system. Every constant/schema below is IMPORTED (not regexed), so a rename
// or deletion fails compilation here, not just at runtime (testing.md rule 3:
// parity pins read the OTHER side and drift must fail the suite).
//
// NOT duplicated here — already pinned elsewhere:
//   - settings-branding.test.ts already pins settingsSchema's fssai
//     OVER-the-limit rejection (SETTINGS_FSSAI_MAX_LEN) and logo's
//     IMAGE_REF_MAX_LEN. This file's settingsSchema loop below re-touches
//     fssai's over-limit case too (kept in the loop rather than special-cased
//     out, because the go-live doc's §A row lists all 8 branding fields as
//     ONE uniform fact and splitting fssai out would fragment that pin) — the
//     AT-the-limit-accepts sub-case for fssai is coverage that did not exist
//     before. Flagged here rather than silently duplicated.
//   - due-payment.test.ts already pins DUES_RECEIPT_MODES's own shape
//     (Cash/Online only) via duePaymentSchema; this file additionally checks
//     the DOC's stated list matches that same array — a different failure mode
//     (doc drift, not schema drift).

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const DOC_PATH = path.join(REPO_ROOT, "docs/GO-LIVE-CHECKLIST.md");
const doc = readFileSync(DOC_PATH, "utf8");

// Collapse all whitespace runs to a single space — makes containment checks
// robust to the doc's prose being reflowed/rewrapped.
function norm(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Generic §A row cell extractor: `| Fact | Value | Source symbol |` markdown
// rows, split on "|" (safe for every row except "Modifier separator", whose
// VALUE cell contains an escaped "\|" and is checked separately below).
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

function factRow(fact: string): string {
  for (const line of doc.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = splitRow(line);
    if (cells[0] === fact) return cells[1] ?? "";
  }
  assert.fail(`could not find the §A row "${fact}" in GO-LIVE-CHECKLIST.md — it may have been renamed or removed`);
}

// Review round 1 (lost-arbiter finding): factRow() above scans the WHOLE
// doc, and §3's Settings-fields table shares the same "label | value | ..."
// row shape as §A's own table — a fact name reused (or a stray row added)
// elsewhere in the doc could silently make factRow() read the WRONG row.
// factRowIn() scopes the search to one heading's own slice of the doc (found
// by heading text, ending at the next heading of the same or higher level, or
// a `---` rule) — used here for the "§A Pinned facts" section specifically,
// so a §A pin can never accidentally read a same-named row from elsewhere in
// the document. The shared factRow() above stays untouched (~40 existing
// pins already depend on its whole-doc behaviour); this is an ADDITIVE scoped
// variant, not a change to the shared helper.
function sectionSlice(heading: string): string {
  const start = doc.indexOf(heading);
  assert.ok(start >= 0, `could not find the heading "${heading}" in GO-LIVE-CHECKLIST.md`);
  const nextHeadingMatch = doc.slice(start + heading.length).match(/\n(#{1,3}\s|---)/);
  const end = nextHeadingMatch ? start + heading.length + nextHeadingMatch.index! : doc.length;
  return doc.slice(start, end);
}

const SECTION_A_HEADING = "## §A Pinned facts";

function factRowIn(sectionHeading: string, fact: string): string {
  const slice = sectionSlice(sectionHeading);
  for (const line of slice.split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = splitRow(line);
    if (cells[0] === fact) return cells[1] ?? "";
  }
  assert.fail(`could not find the row "${fact}" inside the "${sectionHeading}" section of GO-LIVE-CHECKLIST.md — it may have been renamed, removed, or moved outside that section`);
}

function backtickTokens(cell: string): string[] {
  return [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

// ── §A row parity: CSV import ────────────────────────────────────────────────

test("PIN §A: the doc's CSV header row equals IMPORT_COLUMNS.join(',') exactly", () => {
  const cell = backtickTokens(factRow("CSV header row"))[0];
  assert.equal(cell, IMPORT_COLUMNS.join(","), "IMPORT_COLUMNS changed shape/order — fix the doc's header row or the code");
});

test("PIN §A: MODIFIER_SEPARATOR is the pipe the doc documents (escaped as \\| in the markdown table)", () => {
  assert.equal(MODIFIER_SEPARATOR, "|");
  assert.ok(
    doc.includes("`\\|`"),
    "GO-LIVE-CHECKLIST.md must document the pipe modifier separator (as the escaped `\\|` table cell) — MODIFIER_SEPARATOR drifted from the doc",
  );
});

test("PIN §A: MAX_IMPORT_ROWS is 1000, matching the doc's stated cap", () => {
  assert.equal(MAX_IMPORT_ROWS, 1000);
  assert.equal(Number(factRow("Max import rows")), MAX_IMPORT_ROWS);
});

// CB-DL-2: createProductSchema's category link is now `categoryId` (a 24-hex
// ObjectId string), so it no longer accepts the CSV's human-typed `category`
// NAME column directly. importProductRowSchema is the schema that actually
// governs a raw CSV row -- it is createProductSchema with categoryId swapped
// back out for a `category` string (see packages/shared's product.schema.ts
// comment on importProductRowSchema) -- so it is the single source of truth
// for which import columns are required now. Moved off createProductSchema
// for exactly the two tests below (step CB-DL-2); the required-columns DOC
// pin further down still targets the same three names via importProductRowSchema.
const REQUIRED_PRODUCT_ROW = { name: "Chai", category: "Beverages", price: 20 };

test("importProductRowSchema: name+category+price together parse, and dropping ANY ONE of them fails — none of the three carries a schema default", () => {
  assert.equal(importProductRowSchema.safeParse(REQUIRED_PRODUCT_ROW).success, true);

  for (const field of ["name", "category", "price"] as const) {
    const rest = { ...REQUIRED_PRODUCT_ROW };
    delete (rest as Record<string, unknown>)[field];
    assert.equal(
      importProductRowSchema.safeParse(rest).success,
      false,
      `dropping ${field} must fail — it has no schema default, so a blank CSV cell here is an ERROR row, not a ₹0/empty product`,
    );
  }
});

test("importProductRowSchema: discount/image/modifiers/isActive are genuinely optional — omitted, the schema's OWN defaults apply (0 / \"\" / [] / true), never a validation error", () => {
  const parsed = importProductRowSchema.safeParse(REQUIRED_PRODUCT_ROW);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.discount, 0);
  assert.equal(parsed.data.image, "");
  assert.deepEqual(parsed.data.modifiers, []);
  assert.equal(parsed.data.isActive, true);
});

test("PIN §A: the doc states name/category/price as the required import columns, matching importProductRowSchema — a blank price cell must be a skipped import ERROR, not a silent ₹0", () => {
  const requiredCell = factRow("Import columns that are required");
  assert.match(
    norm(requiredCell),
    /\bprice\b/,
    "the doc's required-columns row must state price is required, or an operator would wrongly expect a blank price to default to ₹0",
  );
  const docRequired = requiredCell.split(",").map((s) => s.trim());
  assert.deepEqual(docRequired, ["name", "category", "price"]);
});

// ── §A row parity: tables ────────────────────────────────────────────────────

test("PIN §A: TABLE_NO_PATTERN.source appears verbatim in the doc's table-name-pattern row", () => {
  const cell = backtickTokens(factRow("Table name pattern"))[0];
  assert.equal(cell, TABLE_NO_PATTERN.source, "TABLE_NO_PATTERN changed — the doc's ASCII-only naming rule no longer matches what the app actually accepts");
});

test("PIN §A: TABLE_NO_MAX_LEN (24) matches the doc's table-name-max-length row", () => {
  assert.equal(Number(factRow("Table name max length")), TABLE_NO_MAX_LEN);
});

test("PIN §A: TABLE_CAPACITY_MIN/MAX match the doc's seats-range row", () => {
  const nums = [...factRow("Seats range").matchAll(/\d+/g)].map((m) => Number(m[0]));
  assert.deepEqual(nums, [TABLE_CAPACITY_MIN, TABLE_CAPACITY_MAX]);
});

test("PIN §A: TABLE_CHARGE_MAX matches the doc's table-extra-charge-max row", () => {
  assert.equal(Number(factRow("Table extra charge max")), TABLE_CHARGE_MAX);
});

test("PIN §A: TABLE_CHARGE_LABEL_MAX_LEN matches the doc's charge-name-max-length row", () => {
  assert.equal(Number(factRow("Charge name max length")), TABLE_CHARGE_LABEL_MAX_LEN);
});

// The runbook tells the operator the charge is NOT taxed. That is a claim about
// arithmetic, so it is pinned against the arithmetic: GST must come out
// identical whether or not a charge is present, and the total must differ by
// exactly the charge. A future "simplification" that folded the charge into the
// taxable base would silently make the doc — and the cafe's tax position —
// wrong, and this is what would catch it.
test("PIN §A: the doc's 'charge is not taxed' row matches computeOrderTotals — GST is identical with and without a charge", () => {
  assert.match(factRow("Charge is taxed"), /\bno\b/i);

  const items = [{ price: 1000, qty: 1 }];
  const cfg = { gstEnabled: true, gstRate: 5, gstMode: "exclusive" as const };
  const without = computeOrderTotals({ items, discount: 0, discountKind: undefined, charge: 0, cfg });
  const withCharge = computeOrderTotals({ items, discount: 0, discountKind: undefined, charge: 50, cfg });

  assert.equal(withCharge.gstAmount, without.gstAmount, "the charge must not enter the taxable base");
  assert.equal(withCharge.total - without.total, 50, "the charge must land on the total untouched by tax");
});

// Likewise the "unnamed charge is not charged at all" row — the rule the Tables
// page warns about and the order route enforces.
test("PIN §A: the doc's unnamed-charge row matches tableChargeOf — an amount with no name yields nothing", () => {
  assert.match(factRow("Unnamed charge"), /not charged/i);
  assert.equal(tableChargeOf({ chargeAmount: 50 }).amount, 0);
  assert.equal(tableChargeOf({ chargeAmount: 50, chargeLabel: "   " }).amount, 0);
  assert.equal(tableChargeOf({ chargeAmount: 50, chargeLabel: "Rooftop charge" }).amount, 50);
});

test("PIN §A: TABLE_NUMBERS is exactly 8 tables spanning T-1..T-8, matching the doc's starter-tables row", () => {
  assert.equal(TABLE_NUMBERS.length, 8);
  assert.equal(TABLE_NUMBERS[0], "T-1");
  assert.equal(TABLE_NUMBERS[TABLE_NUMBERS.length - 1], "T-8");

  const cell = factRow("Starter tables");
  const countMatch = cell.match(/\((\d+)\)/);
  assert.ok(countMatch, "the starter-tables row must state a count in parens");
  assert.equal(Number(countMatch![1]), TABLE_NUMBERS.length);
  assert.ok(cell.includes(TABLE_NUMBERS[0]) && cell.includes(TABLE_NUMBERS[TABLE_NUMBERS.length - 1]));
});

// ── §A row parity: admin routes / payment modes / GST ───────────────────────

test("PIN §A: ADMIN_ROUTES matches the doc's admin-only list exactly — every entry appears, and the doc lists no others", () => {
  const docRoutes = backtickTokens(factRow("Admin-only screens")).sort();
  const codeRoutes = [...ADMIN_ROUTES].sort();
  assert.deepEqual(
    docRoutes,
    codeRoutes,
    `ADMIN_ROUTES (${codeRoutes.join(", ")}) and the doc's admin-only list (${docRoutes.join(", ")}) must match exactly — a staff member could otherwise be silently let into (or wrongly blocked from) a screen`,
  );
});

test("PIN §A: RESERVED_SUBDOMAINS matches the doc's list exactly — a client slug of www/app/api/admin/hub 404s with nothing in the logs to explain it, so the runbook must name them before DNS is set", () => {
  const docSlugs = factRow("Slugs that never resolve to a cafe")
    .split(",")
    .map((s) => s.trim())
    .sort();
  const codeSlugs = [...RESERVED_SUBDOMAINS].sort();
  assert.deepEqual(
    docSlugs,
    codeSlugs,
    `RESERVED_SUBDOMAINS (${codeSlugs.join(", ")}) and the doc's list (${docSlugs.join(", ")}) must match exactly`,
  );
});

test("PIN §A: DUES_RECEIPT_MODES is exactly Cash + Online, matching the doc — a due is only ever RECEIVED as real money (CR1.4)", () => {
  assert.deepEqual([...DUES_RECEIPT_MODES], ["Cash", "Online"]);
  const docModes = factRow("Dues receipt modes").split(",").map((s) => s.trim());
  assert.deepEqual(docModes, [...DUES_RECEIPT_MODES]);
});

test("PIN §A: GST_RATES quick picks all appear in the doc's row", () => {
  const docRates = factRow("GST rate quick picks").split(",").map((s) => Number(s.trim()));
  assert.deepEqual(docRates, [...GST_RATES]);
});

// ── §A row parity: images / print ────────────────────────────────────────────

test("PIN §A: IMAGE_MAX_DIMENSION_PX (600) and MAX_IMAGE_BYTES (2 MB) match the doc's downscale/size-cap row", () => {
  assert.equal(IMAGE_MAX_DIMENSION_PX, 600);
  assert.equal(MAX_IMAGE_BYTES, 2 * 1024 * 1024);

  const cell = factRow("Image downscale / size cap");
  const pxMatch = cell.match(/(\d+)\s*px/);
  const mbMatch = cell.match(/(\d+)\s*MB/);
  assert.ok(pxMatch && mbMatch, "the row must state both a px dimension and an MB size cap");
  assert.equal(Number(pxMatch![1]), IMAGE_MAX_DIMENSION_PX);
  assert.equal(Number(mbMatch![1]), MAX_IMAGE_BYTES / (1024 * 1024));
});

test("PIN §A: MAX_BRANDING_BYTES (512 KB) matches the doc's branding-size-cap row — the logos are a SEPARATE cap from product-photo uploads and must not silently restate a hardcoded 512", () => {
  assert.equal(MAX_BRANDING_BYTES, 512 * 1024);

  const cell = factRow("Branding (logo) size cap");
  const kbMatch = cell.match(/(\d+)\s*KB/);
  assert.ok(kbMatch, "the row must state a KB size cap");
  assert.equal(Number(kbMatch![1]), MAX_BRANDING_BYTES / 1024);
});

test("PIN §A: RECEIPT_PAGE_STYLE appears verbatim in the doc's print-page-setup row", () => {
  const cell = backtickTokens(factRow("Print page setup"))[0];
  assert.ok(cell, "the print-page-setup row must carry a backtick-quoted value");
  assert.equal(
    norm(cell),
    norm(RECEIPT_PAGE_STYLE),
    "the doc's Print page setup row must be the FULL RECEIPT_PAGE_STYLE string, not a prefix of it — an operator diffing this row against source would wrongly conclude the @media print body-margin rule doesn't exist",
  );
});

// ── §A row parity: CR2.4 Appearance/themes ──────────────────────────────────

test("PIN §A: HERO_MAX_DIMENSION_PX (1200) matches the doc's hero-image-longest-edge row — an operator sizing a banner off a stale number would upload art that gets downscaled on the next save anyway", () => {
  assert.equal(HERO_MAX_DIMENSION_PX, 1200);
  assert.equal(Number(factRow("Hero image longest edge")), HERO_MAX_DIMENSION_PX);
});

test("PIN §A: PRESET_IDS has exactly 6 members, matching the doc's appearance-presets row", () => {
  assert.equal(PRESET_IDS.length, 6);
  assert.equal(Number(factRow("Appearance presets")), PRESET_IDS.length);
});

test("PIN §A: BRANDING_SLOT_MAX_BYTES.heroImage (1MB) matches the doc's hero-image-byte-cap row — a SEPARATE, larger cap than the two logos (MAX_BRANDING_BYTES, 512KB), pinned so the two never silently collapse to one shared literal", () => {
  assert.equal(BRANDING_SLOT_MAX_BYTES.heroImage, 1024 * 1024);
  const cell = factRow("Hero image byte cap");
  const mbMatch = cell.match(/(\d+)\s*MB/);
  assert.ok(mbMatch, "the row must state a MB size cap");
  assert.equal(Number(mbMatch![1]) * 1024 * 1024, BRANDING_SLOT_MAX_BYTES.heroImage);
});

// The §A rows above pin the SOURCE-OF-TRUTH facts against source, but an
// operator sizing a client's banner reads the §3 Settings-fields table (its
// "Hero image" row), not §A — that row's "1200 px longest edge · 1 MB" cell
// is free prose neither §A pin above ever examines, so the two constants
// above could each be bumped (updating §A, keeping the suite green) while
// this §3 row silently kept quoting the old numbers.
test('PIN §3: the Settings-fields table\'s "Hero image" row states the SAME two numbers as the §A hero-image rows (HERO_MAX_DIMENSION_PX / BRANDING_SLOT_MAX_BYTES.heroImage) — the row an operator actually reads while sizing a banner', () => {
  const cell = factRow("Hero image");
  const pxMatch = cell.match(/(\d+)\s*px longest edge/);
  assert.ok(pxMatch, 'the §3 "Hero image" row must state "<N> px longest edge"');
  assert.equal(Number(pxMatch![1]), HERO_MAX_DIMENSION_PX);

  const mbMatch = cell.match(/(\d+)\s*MB/);
  assert.ok(mbMatch, 'the §3 "Hero image" row must state a MB size cap');
  assert.equal(Number(mbMatch![1]) * 1024 * 1024, BRANDING_SLOT_MAX_BYTES.heroImage);
});

// ── §A row parity: CR2.5 QR self-ordering ───────────────────────────────────
// docs/GO-LIVE-CHECKLIST.md §23.6 Risk 1: factRow() finds the FIRST matching
// first cell in the WHOLE doc (§3 and §A share one namespace) — every label
// below was scanned for a doc-wide collision before being written.

test("PIN §A: PUBLIC_MENU_PATH/publicMenuPath match the doc's Public-menu-URLs row", () => {
  assert.equal(PUBLIC_MENU_PATH, "/m");
  const tokens = backtickTokens(factRow("Public menu URLs"));
  assert.equal(tokens[0], PUBLIC_MENU_PATH, "the doc's bare-menu URL must equal PUBLIC_MENU_PATH");
  assert.equal(tokens[1], `${PUBLIC_MENU_PATH}/<token>`, "the doc's per-table URL must equal PUBLIC_MENU_PATH + '/<token>'");
});

test("PIN §A: PUBLIC_TOKEN_LENGTH (14) matches the doc's table-QR-token-length row", () => {
  assert.equal(PUBLIC_TOKEN_LENGTH, 14);
  assert.equal(Number(factRow("Table QR token length")), PUBLIC_TOKEN_LENGTH);
});

test("PIN §A: PUBLIC_CODE_LENGTH (10) matches the doc's diner-order-code-length row", () => {
  assert.equal(PUBLIC_CODE_LENGTH, 10);
  assert.equal(Number(factRow("Diner order code length")), PUBLIC_CODE_LENGTH);
});

test("PIN §A: PUBLIC_ORDER_MAX_ITEMS/PUBLIC_ORDER_MAX_QTY match the doc's diner-order-caps row", () => {
  assert.equal(PUBLIC_ORDER_MAX_ITEMS, 30);
  assert.equal(PUBLIC_ORDER_MAX_QTY, 20);
  const cell = factRow("Diner order caps");
  const nums = [...cell.matchAll(/\d+/g)].map((m) => Number(m[0]));
  assert.deepEqual(
    nums,
    [PUBLIC_ORDER_MAX_ITEMS, PUBLIC_ORDER_MAX_QTY],
    "the doc's caps row must list max lines then max qty, matching PUBLIC_ORDER_MAX_ITEMS/PUBLIC_ORDER_MAX_QTY in that order",
  );
});

test("PIN §A: PUBLIC_ORDER_RATE_MAX/_MAX_PARCEL/_WINDOW_MS match the doc's diner-submit-rate-limit row", () => {
  assert.equal(PUBLIC_ORDER_RATE_MAX, 8);
  assert.equal(PUBLIC_ORDER_RATE_MAX_PARCEL, 20);
  assert.equal(PUBLIC_ORDER_RATE_WINDOW_MS, 10 * 60 * 1000);
  const cell = factRow("Diner submit rate limit");
  const nums = [...cell.matchAll(/\d+/g)].map((m) => Number(m[0]));
  assert.deepEqual(
    nums,
    [PUBLIC_ORDER_RATE_MAX, PUBLIC_ORDER_RATE_MAX_PARCEL, PUBLIC_ORDER_RATE_WINDOW_MS / (60 * 1000)],
    "the doc's rate-limit row must list per-table max, parcel max, then the window in minutes",
  );
});

test("PIN §A: PUBLIC_REQUEST_PENDING_TTL_MS (12h) matches the doc's pending-request-expiry row", () => {
  assert.equal(PUBLIC_REQUEST_PENDING_TTL_MS, 12 * 60 * 60 * 1000);
  const cell = factRow("Pending request expiry");
  const hoursMatch = cell.match(/(\d+)\s*hours?/);
  assert.ok(hoursMatch, "the row must state the expiry in hours");
  assert.equal(Number(hoursMatch![1]) * 60 * 60 * 1000, PUBLIC_REQUEST_PENDING_TTL_MS);
});

test('PIN §A: SOLD_OUT_ERROR("<item>") matches the doc\'s sold-out-message row EXACTLY', () => {
  const cell = backtickTokens(factRow("Sold-out message"))[0];
  assert.equal(
    cell,
    SOLD_OUT_ERROR("<item>"),
    "the doc's sold-out-message row must equal SOLD_OUT_ERROR('<item>') exactly, not a paraphrase",
  );
});

// S5: the diner's status page dropped its auto-poll for an explicit,
// server-cooldown-gated manual refresh (statusReadGate, lib/order-request-
// edit.ts). The two shared constants ARE imported (not regexed) — they are
// real cross-app contract values, unlike the retired client-only poll
// constants this test used to pin.
test("PIN §A: the shared status-refresh cooldown/read-cap match the doc's diner-status-poll row, and PublicOrderStatus.tsx references the shared cooldown", () => {
  assert.equal(PUBLIC_STATUS_REFRESH_COOLDOWN_MS, 30_000);
  assert.equal(PUBLIC_STATUS_READ_MAX, 20);

  const src = readFileSync(
    path.join(REPO_ROOT, "apps/cafe/components/public/PublicOrderStatus.tsx"),
    "utf8",
  );
  assert.match(
    src,
    /PUBLIC_STATUS_REFRESH_COOLDOWN_MS/,
    "PublicOrderStatus.tsx must reference the shared PUBLIC_STATUS_REFRESH_COOLDOWN_MS constant, not a local re-declared cooldown",
  );
  assert.match(
    src,
    /readRefreshAt\(/,
    "PublicOrderStatus.tsx must persist/read the refresh timestamp through public-cart-store's readRefreshAt — this is what keeps the countdown correct across a tab reload",
  );

  const cell = factRow("Diner status poll");
  const nums = [...cell.matchAll(/\d+/g)].map((m) => Number(m[0]));
  assert.deepEqual(
    nums,
    [30, 20, 600],
    "the doc's diner-status-poll row must state the cooldown (seconds), the read cap, and the window (seconds) the cap applies over",
  );
});

test("PIN §3: the Self-order-mode row lists the real SELF_ORDER_MODES enum values", () => {
  // A deliberate tripwire: widening SELF_ORDER_MODES must be a CONSCIOUS act
  // that also updates the operator-facing runbook row below, never a silent
  // drift. CB-4 added "menu" (browsing only, ordering gated server-side in
  // the public order-request route) and updated the doc row with it.
  assert.deepEqual([...SELF_ORDER_MODES], ["approve", "auto", "menu"]);
  const cell = factRow("Self-order mode");
  const docModes = cell.split("/").map((s) => s.trim());
  assert.deepEqual(
    docModes,
    [...SELF_ORDER_MODES],
    "the doc's Self-order-mode row must list the SAME values, in the SAME order, as SELF_ORDER_MODES",
  );
});

test("PIN: §7's new 'QR self-ordering — the diner device leg' sub-section names the QR sheet, the cafe-WiFi phone leg, and both colour schemes", () => {
  const heading = "### QR self-ordering — the diner device leg";
  const start = doc.indexOf(heading);
  assert.ok(start >= 0, "docs/GO-LIVE-CHECKLIST.md must carry the §7 QR self-ordering device-leg sub-section");
  const nextHeadingMatch = doc.slice(start + heading.length).match(/\n(#{1,3}\s|---)/);
  const end = nextHeadingMatch ? start + heading.length + nextHeadingMatch.index! : doc.length;
  const section = norm(doc.slice(start, end));

  assert.match(section, /QR sheet/i, "the device-leg sub-section must name the QR sheet");
  assert.match(section, /cafe.{0,5}WiFi/i, "the device-leg sub-section must name the cafe-WiFi phone leg");
  assert.match(section, /\blight\b/i, "the device-leg sub-section must name the light colour scheme");
  assert.match(section, /\bdark\b/i, "the device-leg sub-section must name the dark colour scheme");
});

// ── §A row parity: seed commands ─────────────────────────────────────────────

const CAFE_PKG = JSON.parse(
  readFileSync(path.join(REPO_ROOT, "apps/cafe/package.json"), "utf8"),
) as { scripts: Record<string, string> };

// ── §A row parity: CR2.3 §20 self-order alerts / auto-print ────────────────

test("PIN §A: auto-print self-orders defaults OFF, matching readDevicePrefs()'s REAL default (window is undefined in this test env, so the function's own no-window branch returns the actual DEFAULT_DEVICE_PREFS object, not a mock) — a device must be opted in before it fires tickets on its own", () => {
  const defaults = readDevicePrefs();
  assert.equal(defaults.autoPrintSelfOrders, false, "readDevicePrefs()'s real default must be autoPrintSelfOrders:false");
  assert.equal(defaults.alertSound, true, "readDevicePrefs()'s real default must be alertSound:true");
  assert.equal(defaults.printHost, false, "readDevicePrefs()'s real default must be printHost:false — a device is never silently treated as the print host");
  assert.match(factRow("Auto-print self-orders default"), /off/i, "the doc's stated default must match the real default proven above");
});

test("PIN §A: the go-live doc quotes SELF_ORDER_ALERT_LIMITATION verbatim in its self-order alerts device step — the runbook must not paraphrase the app's own wording, or an operator reading it could describe a DIFFERENT limitation than the one staff actually see in the panel", () => {
  assert.ok(doc.includes(SELF_ORDER_ALERT_LIMITATION), "GO-LIVE-CHECKLIST.md must quote SELF_ORDER_ALERT_LIMITATION's exact string");
  const cell = backtickTokens(factRow("Self-order alert limitation"))[0];
  assert.equal(cell, SELF_ORDER_ALERT_LIMITATION, "the §A row's value must equal the real constant, not a hand-typed copy");
});

// ── §A row parity: CR2.3b Telegram integration ─────────────────────────────

test("PIN §A: TELEGRAM_SECRET_HEADER matches the doc's Telegram-webhook-secret-header row — an operator debugging a 401 on the webhook needs the REAL header name Telegram sends, not a guess", () => {
  assert.equal(TELEGRAM_SECRET_HEADER, "X-Telegram-Bot-Api-Secret-Token");
  const cell = backtickTokens(factRow("Telegram webhook secret header"))[0];
  assert.equal(cell, TELEGRAM_SECRET_HEADER, "the doc's header-name row must equal the real TELEGRAM_SECRET_HEADER constant");
});

test("PIN §A: TELEGRAM_ALLOWED_UPDATES matches the doc's Telegram-allowed-updates row — setWebhook is called with this exact list, so a drift here would mislead an operator diagnosing a webhook that silently ignores everything but /start", () => {
  assert.deepEqual([...TELEGRAM_ALLOWED_UPDATES], ["message"]);
  const cell = backtickTokens(factRow("Telegram allowed updates"))[0];
  assert.equal(cell, TELEGRAM_ALLOWED_UPDATES[0], "the doc's allowed-updates row must equal the real TELEGRAM_ALLOWED_UPDATES constant");
});

test("PIN §A: TELEGRAM_INVITE_TTL_MS (24h) matches the doc's invite-link-TTL row — an operator telling a staff member their deep link is 'about to expire' must quote the REAL window", () => {
  assert.equal(TELEGRAM_INVITE_TTL_MS, 24 * 60 * 60 * 1000);
  const cell = factRow("Telegram invite link TTL");
  const hoursMatch = cell.match(/(\d+)\s*hours?/);
  assert.ok(hoursMatch, "the row must state the TTL in hours");
  assert.equal(Number(hoursMatch![1]) * 60 * 60 * 1000, TELEGRAM_INVITE_TTL_MS);
});

test("PIN §A: the doc's Telegram-webhook-path row names the route file that actually exists on disk, and that file's own source registers itself as the webhook (not a typo'd sibling path)", () => {
  const cell = backtickTokens(factRow("Telegram webhook path"))[0];
  assert.equal(cell, "/api/telegram/webhook", "the doc's webhook-path row must be exactly /api/telegram/webhook");
  const routeSrc = readFileSync(
    path.join(REPO_ROOT, "apps/cafe/app/api/telegram/webhook/route.ts"),
    "utf8",
  );
  assert.match(
    routeSrc,
    /export async function POST\(/,
    "app/api/telegram/webhook/route.ts must exist and export a POST handler — the doc's Source symbol column must name a route that is actually there",
  );
});

test("PIN: the doc's Telegram procedures block states token rotation (BotFather /token → re-paste → re-validate), AUTH_SECRET rotation recovery (re-paste, connections kept), and the live-site-only rule — all three are the operator's actual recovery paths, not paraphrased", () => {
  const normalized = norm(doc);
  assert.ok(
    normalized.includes("Telegram procedures"),
    "the doc must carry a 'Telegram procedures' section",
  );
  assert.match(normalized, /BotFather.*\/token/, "the doc must name BotFather's /token command for rotating the bot token");
  assert.ok(
    normalized.includes("Re-paste your bot token"),
    "the doc must quote the card's exact 'Re-paste your bot token' state, matching what AUTH_SECRET/NEXTAUTH_SECRET rotation actually shows",
  );
  assert.match(
    normalized,
    /stays connected|chat list/i,
    "the doc must state that reconnecting the bot after a secret rotation keeps every already-connected chat",
  );
  assert.match(
    normalized,
    /never a preview URL/i,
    "the doc must warn that Telegram setup has to run from the live deployed site, never a preview URL",
  );
});

test("PIN §A: seed:admin and seed:tables both exist in apps/cafe/package.json's scripts, matching the doc's seed-commands row", () => {
  const docCmds = backtickTokens(factRow("Seed commands"));
  assert.deepEqual(docCmds, ["seed:admin", "seed:tables"]);
  for (const cmd of docCmds) {
    assert.ok(cmd in CAFE_PKG.scripts, `apps/cafe/package.json must define a "${cmd}" script`);
  }
});

// ── §A row parity: four rows added this session ─────────────────────────────

test("PIN §A: seed-tables.ts seeds capacity 4 for every starter table, matching the doc's starter-table-capacity row", () => {
  const src = readFileSync(path.join(REPO_ROOT, "apps/cafe/scripts/seed-tables.ts"), "utf8");
  assert.match(src, /capacity:\s*4/, "seed-tables.ts must seed each starter table with capacity 4");
  assert.equal(Number(factRow("Starter table capacity")), 4);
});

test('PIN §A: TABLE_BUSY_ERROR matches the doc\'s busy-table-message row VERBATIM — the runbook used to invent "Table is in use", which is not what the app actually says', () => {
  const cell = factRow("Busy-table message");
  assert.equal(cell, TABLE_BUSY_ERROR);
});

test("PIN §A: the health route's OK contract (ok: true / db: \"up\") matches the doc, and the failover worker's own liveness check agrees — a THREE-party contract (route + worker + doc, testing.md rule 3)", () => {
  const routeSrc = readFileSync(
    path.join(REPO_ROOT, "apps/cafe/app/api/health/route.ts"),
    "utf8",
  );
  assert.match(
    routeSrc,
    /\{ ok: true, db: "up"/,
    "the health route's base success shape must be { ok: true, db: \"up\", ... }",
  );

  const cell = factRow("Health OK contract");
  assert.ok(
    cell.includes("ok: true") && cell.includes('db: "up"'),
    "the doc must state the same ok/db contract the route actually returns",
  );

  const workerSrc = readFileSync(
    path.join(REPO_ROOT, "workers/failover/src/index.ts"),
    "utf8",
  );
  assert.match(
    workerSrc,
    /body\.ok === true && body\.db === "up"/,
    "the failover worker's isHealthy() must check the SAME ok/db contract — a drift here means the poller and the app disagree about what 'healthy' means",
  );
});

test("PIN §A: seed-admin.ts's password-strength check matches the doc's seed-admin-password-policy row (>=8 chars, >=1 digit, >=1 special) — an operator quotes this to the owner before §2 and a rejected password blocks the seed", () => {
  const src = readFileSync(path.join(REPO_ROOT, "apps/cafe/scripts/seed-admin.ts"), "utf8");
  assert.match(
    src,
    /password\.length >= 8 && \/\\d\/\.test\(password\) && \/\[\^A-Za-z0-9\]\/\.test\(password\)/,
    "seed-admin.ts's strength check must require >=8 chars, at least one digit, and at least one special character",
  );
  const cell = factRow("Seed admin password policy");
  assert.match(cell, /8/, "the doc must state the 8-char minimum");
  assert.match(cell, /digit/i, "the doc must state the digit requirement");
  assert.match(cell, /special/i, "the doc must state the special-character requirement");
});

// ── §5's two CSV-import warnings, pinned against the route's own bulkWrite ──
// (product-import.test.ts, packages/shared, already pins IMPORT_COLUMNS
// lacking `available` as a secondary check; this is the ACTUAL guard the
// route enforces, plus the un-archive/overwrite hazard §5 now warns about —
// both live here rather than in the shared-package test because the route
// itself is a cafe-app file, not a shared one.)

test("PIN: the import route's product bulkWrite $set list never includes `available` (out-of-stock survives a re-import) but DOES overwrite every OTHER optional column, and its filter carries no isActive term (so an update can reach — and re-activate — an archived item) — matching §5's two warnings", () => {
  const src = readFileSync(
    path.join(REPO_ROOT, "apps/cafe/app/api/products/import/route.ts"),
    "utf8",
  );
  const productOpsStart = src.indexOf("const productOps");
  assert.ok(productOpsStart >= 0, "the product bulkWrite ops must be built as productOps");
  const productOpsEnd = src.indexOf('cache.del("products")', productOpsStart);
  assert.ok(productOpsEnd > productOpsStart, "productOps must be followed by a products cache invalidation");
  const opsBlock = src.slice(productOpsStart, productOpsEnd);

  const filterStart = opsBlock.indexOf("filter: {");
  assert.ok(filterStart >= 0, "the update must have a filter");
  const filterEnd = opsBlock.indexOf("}", filterStart);
  const filterBlock = opsBlock.slice(filterStart, filterEnd + 1);
  assert.match(filterBlock, /name:\s*e\.data\.name/, "the update must match by name");
  assert.ok(
    !/isActive/.test(filterBlock),
    "the filter must carry NO isActive term — §5 warns a re-import can reach and re-activate an archived item, which requires the filter not exclude it",
  );

  const setStart = opsBlock.indexOf("$set: {");
  assert.ok(setStart > filterEnd, "the $set block must follow the filter");
  const setEnd = opsBlock.indexOf("}", setStart);
  const setBlock = opsBlock.slice(setStart, setEnd + 1);
  assert.ok(
    !/\bavailable\b/.test(setBlock),
    "the $set block must NOT touch `available` — out-of-stock ('86') state must survive a price/menu re-import",
  );
  // CB-DL-2: the route's $set now writes the resolved link as `categoryId`
  // (the CSV's own `category` NAME column never reaches the $set -- it is
  // resolved to an id first via the Category.find({ name: { $in: ... } })
  // re-read). Moved from "category" to "categoryId".
  for (const field of ["categoryId", "price", "discount", "image", "modifiers", "isActive"]) {
    assert.match(
      setBlock,
      new RegExp(`\\b${field}\\b`),
      `the $set block must overwrite ${field} on every re-import — §5 warns a blank/missing optional column clears/resets it`,
    );
  }

  assert.match(
    opsBlock,
    /upsert:\s*true/,
    "the op must upsert — a name that doesn't exist yet must still create the product",
  );
});

// ── Behavioural limits — exercised via the schema, not matched against source
// text (so the pin tracks BEHAVIOUR, not wording) ──────────────────────────

const BASE_STAFF = { name: "Asha", mobile: "9999999999", username: "asha", password: "password1" };

test("PIN §A behaviour: createStaffSchema — password minimum is 8 (7 rejected, 8 accepted), matching the doc's stated minimum", () => {
  assert.equal(createStaffSchema.safeParse({ ...BASE_STAFF, password: "x".repeat(7) }).success, false);
  assert.equal(createStaffSchema.safeParse({ ...BASE_STAFF, password: "x".repeat(8) }).success, true);
  assert.equal(
    Number(factRow("Staff password minimum")),
    8,
    "the doc's stated password minimum must equal the schema's REAL minimum verified above, or the doc could drift free of the code",
  );
});

test("PIN §A behaviour: createStaffSchema — username minimum is 3 (2 rejected, 3 accepted), matching the doc's stated minimum", () => {
  assert.equal(createStaffSchema.safeParse({ ...BASE_STAFF, username: "ab" }).success, false);
  assert.equal(createStaffSchema.safeParse({ ...BASE_STAFF, username: "abc" }).success, true);
  assert.equal(
    Number(factRow("Username minimum")),
    3,
    "the doc's stated username minimum must equal the schema's REAL minimum verified above, or the doc could drift free of the code",
  );
});

test("PIN §A behaviour: createStaffSchema — mobile minimum is 10 (9 rejected, 10 accepted), matching the doc's stated minimum", () => {
  assert.equal(createStaffSchema.safeParse({ ...BASE_STAFF, mobile: "9".repeat(9) }).success, false);
  assert.equal(createStaffSchema.safeParse({ ...BASE_STAFF, mobile: "9".repeat(10) }).success, true);
  assert.equal(
    Number(factRow("Mobile minimum")),
    10,
    "the doc's stated mobile minimum must equal the schema's REAL minimum verified above, or the doc could drift free of the code",
  );
});

test("PIN §A: MOBILE_VISIBLE_PREFIX/MOBILE_MASK_CHAR match the doc's customer-mobile-mask row, and the doc's masked example is exactly what maskMobile produces (not a string hardcoded on both sides)", () => {
  const cell = factRow("Customer mobile mask (staff, non-admin)");

  const prefixMatch = cell.match(/first (\d+) chars/);
  assert.ok(prefixMatch, "the row must state the visible-prefix count as 'first N chars'");
  assert.equal(Number(prefixMatch![1]), MOBILE_VISIBLE_PREFIX);

  const tokens = backtickTokens(cell);
  const [maskChar, input, expectedMasked] = tokens;
  assert.equal(maskChar, MOBILE_MASK_CHAR, "the row's mask character must match MOBILE_MASK_CHAR");
  assert.ok(input && expectedMasked, "the row must carry a backtick-quoted example number and its masked result");
  assert.equal(
    expectedMasked,
    maskMobile(input),
    "the doc's masked example must equal maskMobile's REAL output for that input — a drifted MOBILE_VISIBLE_PREFIX would make the doc show staff a wrong amount of the number",
  );
});

const BASE_SETTINGS = {
  restaurantName: "Cafe",
  tagline: "",
  mobile: "",
  address: "",
  receiptHeader: "",
  receiptFooter: "",
  gstEnabled: false,
  gstNumber: "",
  gstRate: 5,
  gstMode: "inclusive" as const,
  logo: "",
  productLogo: "",
  fssai: "",
  selfOrderMode: "approve" as const,
  allowTableChange: true,
  showPastOrdersToDiner: true,
  // settingsSchema requires every print-customization field. Sourced from the
  // resolver the receipts themselves read through, so this fixture states no
  // default of its own and cannot drift from the app's.
  ...printSettingsFields(),
};

const SETTINGS_MAX_LENGTHS: Array<[keyof typeof BASE_SETTINGS, number]> = [
  ["restaurantName", 60],
  ["tagline", 80],
  ["mobile", 20],
  ["address", 200],
  ["receiptHeader", 200],
  ["receiptFooter", 120],
  ["gstNumber", 20],
  ["fssai", 20],
];

// The doc's §A cell reads "name 60 · tagline 80 · mobile 20 · address 200 ·
// header 200 · footer 120 · GSTIN 20 · FSSAI 20" — its on-screen labels differ
// from the schema's field keys, so map them before comparing.
const SETTINGS_DOC_LABELS: Record<string, keyof typeof BASE_SETTINGS> = {
  name: "restaurantName",
  tagline: "tagline",
  mobile: "mobile",
  address: "address",
  header: "receiptHeader",
  footer: "receiptFooter",
  GSTIN: "gstNumber",
  FSSAI: "fssai",
};

function parseSettingsMaxLengthsCell(
  cell: string,
): Array<[keyof typeof BASE_SETTINGS, number]> {
  return cell.split("·").map((part) => {
    const trimmed = part.trim();
    const m = trimmed.match(/^(\S+)\s+(\d+)$/);
    assert.ok(m, `could not parse settings max-length cell segment "${trimmed}"`);
    const [, label, num] = m as RegExpMatchArray;
    const field = SETTINGS_DOC_LABELS[label];
    assert.ok(field, `unrecognised settings max-length label "${label}" in the doc`);
    return [field, Number(num)];
  });
}

test("PIN §A behaviour: settingsSchema — each branding field's max length is enforced at the boundary (name 60/tagline 80/mobile 20/address 200/header 200/footer 120/GSTIN 20/FSSAI 20), AND the doc's numbers match the real per-field maximums", () => {
  const docPairs = parseSettingsMaxLengthsCell(factRow("Settings max lengths"));
  assert.deepEqual(
    docPairs,
    SETTINGS_MAX_LENGTHS,
    "the doc's §A settings-max-lengths row must list the same fields/limits, in the same order, as SETTINGS_MAX_LENGTHS — a drifted number here would let an operator believe a field accepts more (or less) than it actually does",
  );

  for (const [field, limit] of SETTINGS_MAX_LENGTHS) {
    const atLimit = settingsSchema.safeParse({ ...BASE_SETTINGS, [field]: "x".repeat(limit) });
    assert.equal(atLimit.success, true, `${field} at exactly ${limit} chars must parse`);
    const overLimit = settingsSchema.safeParse({ ...BASE_SETTINGS, [field]: "x".repeat(limit + 1) });
    assert.equal(overLimit.success, false, `${field} at ${limit + 1} chars must be rejected`);
  }
});

// ── Structural pins on the doc itself ────────────────────────────────────────

test("PIN: the doc names all four device-leg paper paths AND both browsers — this leg is §7's whole reason for existing", () => {
  assert.ok(doc.includes("**Customer receipt, with logo, over the network**"));
  assert.ok(doc.includes("**KOT**"));
  assert.ok(doc.includes("**VOID slip**"));
  assert.ok(doc.includes("**End of day, including a past date**"));
  assert.match(
    doc,
    /\|\s*#\s*\|\s*Paper path\s*\|[^\n]*\|\s*Chrome\s*\|\s*Firefox\s*\|/,
    "the device-leg matrix must have Chrome AND Firefox columns",
  );
});

test("PIN: the doc carries the 'intentionally empty until set' rule for BOTH tagline and footer message (CR1.5) — paper never prints an invented brand", () => {
  assert.ok(
    norm(doc).includes(
      "Tagline and Footer message are intentionally EMPTY until the cafe sets them.",
    ),
    "the doc must state the empty-until-set rule for BOTH tagline and footer in one place",
  );
});

test("PIN: seed-tables.ts bails out the moment any table exists — re-seeding can never resurrect a deleted table (the doc's §4/§2 promise)", () => {
  const src = readFileSync(path.join(REPO_ROOT, "apps/cafe/scripts/seed-tables.ts"), "utf8");
  assert.match(src, /const existing = await Table\.countDocuments\(\);/);
  assert.match(
    src,
    /if \(existing > 0\) \{[\s\S]{0,150}return;/,
    "seed-tables.ts must return early when tables already exist — otherwise re-running it could resurrect a cafe's deleted starter tables",
  );
});

test("PIN: deploy.mjs deploys from the REPO ROOT, never from the app directory — apps/cafe alone cannot install @pos/shared (workspace-only, never published), which is what failed a real Vercel build on 2026-08-12", () => {
  const src = readFileSync(path.join(REPO_ROOT, "scripts/deploy.mjs"), "utf8");
  const spawnIdx = src.indexOf("spawnSync(");
  assert.ok(spawnIdx >= 0, "deploy.mjs must spawn the Vercel CLI");
  const call = src.slice(spawnIdx);
  assert.match(
    call,
    /cwd:\s*ROOT\b/,
    "the Vercel CLI must run with cwd: ROOT so the whole npm workspace is uploaded and @pos/shared resolves",
  );
  assert.ok(
    !/cwd:\s*appDir\b/.test(call),
    "cwd must NOT be appDir — uploading apps/cafe alone makes the install resolve @pos/shared against the public registry, where it does not exist",
  );
  // The Root Directory requirement has to reach the operator, since the upload
  // is now the whole repo and only that project setting selects the app.
  assert.match(
    src,
    /Root Directory must be set to/,
    "deploy.mjs must tell the operator the Vercel project's Root Directory has to match the app",
  );
});

test("PIN: the runbook and DEPLOY.md both require Root Directory = apps/cafe, the setting whose absence fails the build", () => {
  assert.ok(
    norm(doc).includes("Root Directory = `apps/cafe`"),
    "GO-LIVE-CHECKLIST must state the Root Directory setting explicitly",
  );
  const deployDoc = readFileSync(path.join(REPO_ROOT, "apps/cafe/DEPLOY.md"), "utf8");
  assert.ok(
    norm(deployDoc).includes("Root Directory = `apps/cafe`"),
    "DEPLOY.md is cited as the deploy authority — it must carry the same requirement",
  );
});

test("PIN: apps/cafe/package.json defines NO deploy script of its own — npm resolves the NEAREST package.json, so a second `deploy` key here would silently shadow the guarded root scripts/deploy.mjs (and running from apps/cafe alone can't work: @pos/shared is workspace-only and would 404 against the public registry)", () => {
  assert.ok(
    !("deploy" in CAFE_PKG.scripts),
    "apps/cafe/package.json must not define a \"deploy\" script — `npm run deploy` from inside apps/cafe would bypass the root's cwd:ROOT guard entirely",
  );
});

test("PIN: a bare `npm run deploy` cannot fall back to the local .vercel link once profiles exist — the target must be named, or one cafe's deploy lands on another's project", () => {
  const src = readFileSync(path.join(REPO_ROOT, "scripts/deploy.mjs"), "utf8");
  // The empty-profile fallback is legitimate ONLY for a fresh clone with a link
  // and no profiles file. Gating it on "no profiles configured" is what makes an
  // ambiguous bare deploy impossible; without the gate, a missing "default"
  // silently resolved to {} and deployed to whatever the link pointed at.
  assert.match(
    src,
    /profileName === "default" && configuredNames\.length === 0/,
    "the {} fallback must be gated on there being NO configured profiles",
  );
  assert.ok(
    !/profileName === "default" \? \{\} : null/.test(src),
    "the ungated `profileName === \"default\" ? {} : null` fallback must not come back — it is how a bare deploy silently used the local .vercel link",
  );
  // And the refusal has to tell the operator what the valid targets are.
  assert.match(src, /Configured: \$\{configuredNames\.join\(", "\)/);
});

// ── §A row parity: installable POS (CB-1d.2) ────────────────────────────────

test("PIN §A: the doc's POS-install-manifest row is MANIFEST_PATH", () => {
  assert.deepEqual(backtickTokens(factRow("POS install manifest")), [MANIFEST_PATH]);
});

test("PIN §A: the doc's Installed-app-opens-at row is MANIFEST_START_URL", () => {
  assert.deepEqual(backtickTokens(factRow("Installed app opens at")), [MANIFEST_START_URL]);
});

test("PIN §A: the doc's Installed-display-mode row is MANIFEST_DISPLAY", () => {
  assert.deepEqual(backtickTokens(factRow("Installed display mode")), [MANIFEST_DISPLAY]);
});

test("PIN §7: the install subsection exists and tells the operator to install from the start_url", () => {
  const n = norm(doc);
  assert.ok(n.includes("### Installing the POS on the counter device"));
  assert.ok(n.includes(`\`${MANIFEST_START_URL}\``));

  const heading = "### Installing the POS on the counter device";
  const start = doc.indexOf(heading);
  assert.ok(start >= 0, "docs/GO-LIVE-CHECKLIST.md must carry the install subsection");
  const nextHeadingMatch = doc.slice(start + heading.length).match(/\n(### )/);
  const end = nextHeadingMatch ? start + heading.length + nextHeadingMatch.index! : doc.length;
  const section = norm(doc.slice(start, end));

  assert.match(section, /Chrome/, "the install subsection must name the Chrome browser family");
  assert.match(section, /iOS Safari/, "the install subsection must name the iOS Safari browser family");

  // Vision-guard: the subsection must never name a device brand/model — the
  // product is device-agnostic. Needles built by concatenation so this pin
  // doesn't itself trip a banned-string scan.
  const bannedNeedles = ["Sam" + "sung Galaxy", "i" + "Pad", "i" + "Phone"];
  for (const needle of bannedNeedles) {
    assert.ok(
      !section.includes(needle),
      `the install subsection must not name a device brand/model ("${needle}") — the product must stay device-agnostic`,
    );
  }
});

// ── §A row parity: PH-10 print host runbook facts ──────────────────────────
// All eight constants live in packages/shared/src/print-job.ts (+
// print-host-setup.ts:7 for the kiosk flag) — imported, not regexed, so a
// rename/deletion fails compilation here (testing.md rule 3).

test("PIN §A: PRINT_HOST_MAX_AGE_MS (30 minutes) matches the doc's print-host-job-max-age row", () => {
  assert.equal(PRINT_HOST_MAX_AGE_MS, 30 * 60 * 1000);
  assert.match(factRow("Print host job max age"), /30/);
});

test("PIN §A: PRINT_HOST_OFFLINE_MS (180s / 3 missed ~60s throttled beats) matches the doc's print-host-offline-threshold row", () => {
  assert.equal(PRINT_HOST_OFFLINE_MS, 180 * 1000);
  const cell = factRow("Print host offline threshold");
  assert.match(cell, /180/, "the row must state the 180-second threshold");
  assert.match(cell, /3/, "the row must state the 3-missed-beats rationale, not just the raw seconds");
});

test("PIN §A: PRINT_JOB_PULSE_LIMIT (10) matches the doc's drain-feed-cap row", () => {
  assert.equal(PRINT_JOB_PULSE_LIMIT, 10);
  assert.match(factRow("Print-job drain feed cap (per pulse)"), /10/);
});

test("PIN §A: PRINT_JOB_STALE_LIMIT (20) matches the doc's stale-band-feed-cap row", () => {
  assert.equal(PRINT_JOB_STALE_LIMIT, 20);
  assert.match(factRow("Print-job stale-band feed cap"), /20/);
});

test("PIN §A: PRINT_JOB_QUEUED_RETENTION_MS (12 hours) matches the doc's queued-print-job-retention row", () => {
  assert.equal(PRINT_JOB_QUEUED_RETENTION_MS, 12 * 60 * 60 * 1000);
  assert.match(factRow("Queued print job retention"), /12/);
});

test("PIN §A: KIOSK_PRINTING_FLAG matches the doc's kiosk-shortcut-flag row, and the row's value cell carries ONLY the backticked flag", () => {
  const cell = factRow("Kiosk shortcut flag");
  assert.equal(
    backtickTokens(cell)[0],
    KIOSK_PRINTING_FLAG,
    "the doc's kiosk-shortcut-flag row must equal the real KIOSK_PRINTING_FLAG constant",
  );
  assert.equal(
    cell.trim(),
    `\`${KIOSK_PRINTING_FLAG}\``,
    "the row's value cell must be the backticked flag ONLY, no extra prose",
  );
});

// CB-D1 — apps/desktop is outside this workspace, so its package.json is read
// via readFileSync + JSON.parse (never an import) exactly like every other
// cross-app parity pin in this file (testing.md rule 3).
test("PIN §A: the doc's Desktop app installer row equals apps/desktop/package.json's build.nsis.artifactName with ${version} substituted and \"${ext}\" resolved to \"exe\"; productName is the vendor-branded \"POS Software by sandbee\" (never a cafe name)", () => {
  const desktopPkgPath = path.join(REPO_ROOT, "apps/desktop/package.json");
  const pkg = JSON.parse(readFileSync(desktopPkgPath, "utf8")) as {
    build: { nsis: { artifactName: string }; productName: string };
  };

  const expectedArtifactName = pkg.build.nsis.artifactName.replace("${ext}", "exe");
  const cell = factRow("Desktop app installer");
  assert.equal(
    backtickTokens(cell)[0],
    expectedArtifactName,
    "the doc's Desktop app installer row must equal apps/desktop/package.json's build.nsis.artifactName with ${ext} resolved to exe",
  );

  assert.equal(
    pkg.build.productName,
    "POS Software by sandbee",
    "apps/desktop/package.json's build.productName is the vendor-branded \"POS Software by sandbee\" (sandbee = the software vendor) — never a cafe name",
  );
});

test("PIN §A: PRINT_HOST_SILENT_OFF_WARNING matches the doc's print-host-silent-off-warning row verbatim", () => {
  assert.equal(
    backtickTokens(factRow("Print host silent-off warning"))[0],
    PRINT_HOST_SILENT_OFF_WARNING,
    "the doc must quote PRINT_HOST_SILENT_OFF_WARNING exactly, not a paraphrase",
  );
});

test("PIN §A: PRINT_HOST_ACTIVE_NOTE matches the doc's print-host-active-note row verbatim, including the literal <label> placeholder", () => {
  assert.equal(
    backtickTokens(factRow("Print host active note"))[0],
    PRINT_HOST_ACTIVE_NOTE,
    "the doc must quote PRINT_HOST_ACTIVE_NOTE exactly, keeping its literal <label> placeholder unsubstituted",
  );
});

// ── §7/§11 prose: print host branch (PH-10) ─────────────────────────────────

test("PIN §7: the self-order alerts device step quotes PRINT_HOST_ACTIVE_NOTE verbatim in its host branch, AND still quotes SELF_ORDER_ALERT_LIMITATION verbatim in its non-host branch — an operator must see BOTH, since which applies depends on whether a host is set", () => {
  // Scoped to the §7 sub-section itself (review LOW, PH-10): a doc-wide
  // includes() would stay green on the §A table's copy of the same literal
  // even if the device step lost its branch — the step is what an operator
  // actually follows, so the slice is what is pinned.
  const heading = "### Self-order alerts and auto-print (CR2.3 + print host, per device)";
  const start = doc.indexOf(heading);
  assert.ok(start >= 0, "docs/GO-LIVE-CHECKLIST.md must carry the §7 self-order alerts + print host device step");
  const nextHeadingMatch = doc.slice(start + heading.length).match(/\n(#{1,3}\s|---)/);
  const end = nextHeadingMatch ? start + heading.length + nextHeadingMatch.index! : doc.length;
  // norm(): the doc wraps both quotes across lines at 80 cols; the constants
  // carry single spaces, so compare on the whitespace-collapsed slice.
  const step = norm(doc.slice(start, end));
  assert.ok(
    step.includes(PRINT_HOST_ACTIVE_NOTE),
    "the §7 device step must quote PRINT_HOST_ACTIVE_NOTE's exact string in its host branch",
  );
  assert.ok(
    step.includes(SELF_ORDER_ALERT_LIMITATION),
    "the §7 device step must still quote SELF_ORDER_ALERT_LIMITATION's exact string in its non-host branch",
  );
  // The two branches are ordered host-first, as the step reads top to bottom.
  assert.ok(
    step.indexOf(PRINT_HOST_ACTIVE_NOTE) < step.indexOf(SELF_ORDER_ALERT_LIMITATION),
    "the §7 device step lists the with-a-host branch before the without-a-host branch",
  );
});

test("PIN §7 PH-10b: the self-order alerts device step names BOTH the Device settings button (the /requests reachability path for the per-device toggles) and Settings → Printing (where the print-host card now lives) — an operator following the runbook must find both after the PH-10b UI move", () => {
  const heading = "### Self-order alerts and auto-print (CR2.3 + print host, per device)";
  const start = doc.indexOf(heading);
  assert.ok(start >= 0, "docs/GO-LIVE-CHECKLIST.md must carry the §7 self-order alerts + print host device step");
  const nextHeadingMatch = doc.slice(start + heading.length).match(/\n(#{1,3}\s|---)/);
  const end = nextHeadingMatch ? start + heading.length + nextHeadingMatch.index! : doc.length;
  const step = norm(doc.slice(start, end));

  assert.match(step, /\bDevice settings\b/, "the §7 device step must name the Device settings button (beside Refresh on /requests)");
  assert.match(step, /Settings\s*→\s*Printer setup/, "the §7 device step must name Settings → Printer setup (where the print-host card now lives)");
});

test("PIN: the runbook names the Printer setup page under Settings at EVERY occurrence (CB-UI1 renamed the sidebar label to match the page title) — a partial rename would leave an operator hunting for a 'Printing' entry that no longer exists", () => {
  const renamed = doc.match(/Settings\s*→\s*Printer setup/g) ?? [];
  assert.ok(renamed.length >= 3, `the runbook must say Settings → Printer setup at least 3 times (found ${renamed.length})`);
  assert.doesNotMatch(doc, /Settings\s*→\s*Printing\b/, "no stale 'Settings → Printing' path may remain");
  assert.doesNotMatch(doc, /Settings\s*→\s*Integrations\b/, "the Integrations tab is now the Notifications page");
});

test("PIN: §11's print-host bullet states BOTH that a configured host prints from ANY dashboard screen it has open, and that a non-host device never auto-prints without a POS/Order-requests tab open — the landmark 'Printing follows the print host' anchors the bullet itself", () => {
  const landmark = "Printing follows the print host";
  const start = doc.indexOf(landmark);
  assert.ok(start >= 0, "§11 must carry the 'Printing follows the print host' bullet lead-in");
  const nextBulletMatch = doc.slice(start).match(/\n-\s|\n---/);
  const end = nextBulletMatch ? start + nextBulletMatch.index! : doc.length;
  const bullet = norm(doc.slice(start, end));

  assert.match(
    bullet,
    /host PC prints from ANY dashboard screen/,
    "the bullet must state a configured host prints from ANY dashboard screen it has open",
  );
  assert.match(
    bullet,
    /auto-print only work on a device with a POS or Order requests tab open/,
    "the bullet must state a non-host device never auto-prints without a POS/Order-requests tab open",
  );
});

// ── §A row parity: CB-U1 staff session lifetime + print-job wake poll ─────

test("PIN §A: SESSION_MAX_AGE_SECONDS (30 days) matches the doc's staff-session-lifetime row, which also states the session is ROLLING (not a fixed 30-day countdown from login) — scoped to the §A Pinned facts section (review round 1: factRow() alone scans the whole doc, and §3/§A share one row-label namespace)", () => {
  assert.equal(SESSION_MAX_AGE_SECONDS, 30 * 24 * 60 * 60);
  const cell = factRowIn(SECTION_A_HEADING, "Staff session lifetime");
  assert.match(cell, /30 days/, "the row must state the 30-day figure with its unit word");
  assert.match(cell, /rolling/i, "the row must state the session is rolling with use, not a fixed countdown");
});

test("PIN §A: PRINT_WAKE_FAST_MS (3s) / PRINT_WAKE_SLOW_MS (15s) match the doc's print-job-wake-poll row, scoped to the §A Pinned facts section", () => {
  assert.equal(PRINT_WAKE_FAST_MS, 3000);
  assert.equal(PRINT_WAKE_SLOW_MS, 15000);
  const cell = factRowIn(SECTION_A_HEADING, "Print-job wake poll (counter PC)");
  assert.match(cell, /\b3 seconds\b/, "the row must state the 3-second busy cadence with its unit word");
  assert.match(cell, /\b15 seconds\b/, "the row must state the 15-second idle cadence with its unit word");
});

// New §A row (CB-U1 review round 1, F2): the daily cap is a distinct fact
// from the FAST/SLOW cadence pinned above — it degrades the cadence to SLOW
// for the REST of the cafe-day once spent, which an operator debugging a
// slow-printing counter PC late in a long shift needs to know about.
test("PIN §A: PRINT_WAKE_DAILY_CAP (14,400) matches the doc's print-job-wake-poll-daily-cap row, scoped to the §A Pinned facts section", () => {
  assert.equal(PRINT_WAKE_DAILY_CAP, 14400);
  const cell = factRowIn(SECTION_A_HEADING, "Print-job wake poll daily cap (per counter PC)");
  assert.match(
    cell,
    new RegExp(`${PRINT_WAKE_DAILY_CAP.toLocaleString("en-US")} quick checks per cafe-day`),
    "the row must state PRINT_WAKE_DAILY_CAP's real value, comma-formatted (14,400), as quick checks PER CAFE-DAY",
  );
  assert.match(cell, /every 15 seconds until the next day/, "the row must state the SLOW-cadence degrade that follows the cap being spent");
});

test("PIN §7: the self-order alerts device step's counter-PC wake-poll bullet states the 3-second busy cadence bounded to ONE HOUR after the last print activity, the 15-second idle cadence, the daily cap (14,400 quick checks), AND the 20-second fallback when the counter tab is hidden — the exact numbers, not a paraphrase, and pinned against the REAL constants (a constant change without a doc change fails here)", () => {
  const step = norm(sectionSlice("### Self-order alerts and auto-print (CR2.3 + print host, per device)"));

  assert.match(step, /checks for new print jobs every 3 seconds for an hour after the last print activity/, "the §7 device step must state the busy cadence AND its one-hour activity window in plain English");
  assert.match(step, /every 15 seconds when idle/, "the §7 device step must state the idle cadence in plain English");
  assert.match(step, /\(at most 14,400 quick checks a day\)/, "the §7 device step must state the daily cap, comma-formatted");
  assert.match(step, /falls back to the 20-second refresh/, "the §7 device step must state the hidden-tab 20-second fallback");

  // Pin the doc's stated numbers against the REAL constants (PRINT_WAKE_FAST_MS
  // in seconds, PRINT_WAKE_SLOW_MS in seconds, PRINT_WAKE_ACTIVE_WINDOW_MS in
  // hours, PRINT_WAKE_DAILY_CAP comma-formatted, REFETCH_INTERVALS.POS_PULSE
  // already pinned at 20s elsewhere) — a constant bump must force a doc edit.
  const busySeconds = PRINT_WAKE_FAST_MS / 1000;
  const idleSeconds = PRINT_WAKE_SLOW_MS / 1000;
  const activeWindowHours = PRINT_WAKE_ACTIVE_WINDOW_MS / (60 * 60 * 1000);
  assert.equal(activeWindowHours, 1, "PRINT_WAKE_ACTIVE_WINDOW_MS must still be exactly one hour for the doc's 'an hour' wording to stay true");
  assert.match(step, new RegExp(`every ${busySeconds} seconds for an hour after the last print activity`));
  assert.match(step, new RegExp(`every ${idleSeconds} seconds when idle`));
  assert.match(step, new RegExp(`at most ${PRINT_WAKE_DAILY_CAP.toLocaleString("en-US")} quick checks a day`));

  // CB-D1: the same bullet must scope its 20-second hidden-tab fallback to a
  // BROWSER TAB specifically (not the counter PC in general) and separately
  // name that the desktop app keeps the fast cadence in the tray — an
  // operator running the desktop app must not read this bullet as "my
  // counter falls back to 20 seconds" when it never leaves the fast lane.
  assert.match(
    step,
    /if the counter is a browser tab and that tab is hidden it falls back to the 20-second refresh/,
    "the §7 device step must scope the 20-second fallback to a browser tab specifically, not the counter PC in general (CB-D1)",
  );
  assert.match(
    step,
    /The desktop app keeps the 3-second cadence in the tray\./,
    "the §7 device step must state that the desktop app keeps the 3-second cadence in the tray (CB-D1)",
  );
});

test("PIN §6: the staff-accounts section states the 30-day signed-in lifetime and tells the operator to Log out on a shared device", () => {
  const section = norm(sectionSlice("## §6 Staff accounts (CAFE ADMIN, `Staff`, admin only)"));

  const staySignedInDays = SESSION_MAX_AGE_SECONDS / (24 * 60 * 60);
  assert.match(section, new RegExp(`signed in for ${staySignedInDays} days`), "the §6 section must state the real SESSION_MAX_AGE_SECONDS figure in days");
  assert.match(section, /Log out when handing it over/, "the §6 section must tell the operator to Log out when handing a shared device over");
});

// New §6 bullet (CB-U1 review round 1, F2 doc/pin-only fix): the owner decided
// CB-U1 only raises the session TTL — a password reset does NOT end an
// already-signed-in device's session. An operator must be told the actual
// recovery path (deactivate, wait ~1 minute, reactivate) rather than wrongly
// assume a password change alone cuts a stolen device off immediately.
test("PIN §6: the staff-accounts section also states that a password reset does NOT sign out already-signed-in devices, and names deactivate-then-reactivate as the recovery path for a lost/stolen device, with the ~1-minute figure matching the REAL SESSION_REVALIDATE_MS (lib/auth.ts's DB re-validation throttle, single-homed in @pos/shared/constants)", () => {
  const section = norm(sectionSlice("## §6 Staff accounts (CAFE ADMIN, `Staff`, admin only)"));

  assert.match(
    section,
    /A password reset does not sign out devices that are already signed in\./,
    "the §6 section must state plainly that a password reset does not end an existing device session",
  );
  assert.match(
    section,
    /deactivate that staff account/,
    "the §6 section must name deactivating the account as the actual cutoff mechanism for a lost/stolen device",
  );
  assert.match(
    section,
    /signed out within about a minute/,
    "the §6 section must state the real ~1-minute figure, matching SESSION_REVALIDATE_MS (the DB re-validation throttle that locks out a deactivated account)",
  );
  assert.match(
    section,
    /reactivate it after the reset/,
    "the §6 section must tell the operator to reactivate the account once the password reset is done",
  );

  // Pin the ~1-minute figure against the REAL constant lib/auth.ts's re-
  // validation throttle is built from, rather than a hand-typed "about a
  // minute" that could silently drift from the actual lockout window.
  assert.equal(SESSION_REVALIDATE_MS, 60 * 1000, "SESSION_REVALIDATE_MS must still be exactly one minute for the §6 '~1 minute' claim to stay true");
});

// New §9 OPS sentence (CB-U1 review round 1, F2): the corrected free-tier
// arithmetic tops out at ~80-95% of the Vercel Hobby 1,000,000-invocation
// ceiling depending on load — an owner glancing at Usage monthly, with a
// concrete one-constant remedy, is the compensating control for that margin.
test("PIN §9: the Backups and keep-alive section carries the monthly Function-Invocations glance, naming Vercel → Usage → Function Invocations, the 80% trend threshold, the free ceiling as the literal 1,000,000, and the one-constant remedy (lowering the counter PC's quick-check cap)", () => {
  const section = norm(sectionSlice("## §9 Backups and keep-alive (OWNER)"));

  const FREE_HOBBY_MONTHLY_INVOCATIONS = 1_000_000;

  assert.match(section, /Vercel → Usage → Function Invocations/, "the §9 section must name the exact Vercel dashboard path an owner would navigate");
  assert.match(section, /above 80% of the free/, "the §9 section must state the 80% trend threshold that should prompt action");
  assert.ok(
    section.includes(FREE_HOBBY_MONTHLY_INVOCATIONS.toLocaleString("en-US")),
    "the §9 section must state the free ceiling as the real 1,000,000 figure (comma-formatted), matching Vercel Hobby's documented monthly invocation limit",
  );
  assert.match(section, /tell the developer/, "the §9 section must tell the owner to escalate to the developer, not attempt the fix themselves");
  assert.match(
    section,
    /quick-check cap can be lowered in one constant/,
    "the §9 section must name the concrete one-constant remedy (PRINT_WAKE_DAILY_CAP), matching the plan's own tuning-knob note",
  );
});

// ── §7 desktop-app sub-section: operator-facing UI strings pinned to the desktop source (CB-D1 review C14) ──

test("PIN §7 desktop app: every UI string the sub-section quotes exists verbatim in the desktop shell's source, and the section names the printer-defaults rule and the log file", () => {
  // norm(): the checklist wraps prose across indented lines, so phrases are
  // matched on whitespace-collapsed text (memory: doc pins need norm()).
  const section = sectionSlice("### Desktop app on the counter PC (preferred)").replace(/\s+/g, " ");
  const menuSrc = readFileSync(path.join(REPO_ROOT, "apps/desktop/src/menu.ts"), "utf8");
  const urlHtml = readFileSync(path.join(REPO_ROOT, "apps/desktop/assets/url-window.html"), "utf8");
  const sharedSrc = readFileSync(path.join(REPO_ROOT, "apps/desktop/src/shared.ts"), "utf8");
  for (const [label, src, where] of [
    ["Open POS", menuSrc, "menu.ts"],
    ["Quit", menuSrc, "menu.ts"],
    ["Start with Windows", menuSrc, "menu.ts"],
    ["Change server address…", menuSrc, "menu.ts"],
    ["Use this address", urlHtml, "url-window.html"],
    ["Server address", urlHtml, "url-window.html"],
  ] as const) {
    assert.ok(section.includes(label), `§7 desktop sub-section must quote "${label}"`);
    assert.ok(src.includes(`"${label}"`) || src.includes(`>${label}<`), `"${label}" must exist verbatim in ${where}`);
  }
  assert.ok(section.includes("POS Software by sandbee") && sharedSrc.includes('PRODUCT_NAME = "POS Software by sandbee"'), "the product name in the doc must equal PRODUCT_NAME");
  assert.ok(/Printing preferences/i.test(section) && /80 mm/.test(section), "silent printing uses the printer's Windows defaults — the section must say where to set the roll size");
  assert.ok(section.includes("pos-desktop.log") && sharedSrc.includes('LOG_FILE_NAME = "pos-desktop.log"'), "the section must name the log file support will ask for");
  assert.ok(/notification/i.test(section), "the section must say a failed print raises a Windows notification");
});
