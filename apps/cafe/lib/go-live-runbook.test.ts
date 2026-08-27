import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { createStaffSchema, settingsSchema, createProductSchema } from "@/schemas";
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
  SELF_ORDER_MODES,
} from "@pos/shared/public";
// PUBLIC_REQUEST_PENDING_TTL_MS lives in this cafe-app file, NOT
// @pos/shared/public — the phase plan's scout read named the wrong module;
// verified against source (order-request-intake.ts:28) before importing.
import { PUBLIC_REQUEST_PENDING_TTL_MS } from "@/lib/order-request-intake";
import { SOLD_OUT_ERROR } from "@/lib/public-pricing";

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

// createProductSchema is the single source of truth for which import columns
// are required — exercised behaviourally (not by matching source text), since
// "required" here means "has no .default()", which a regex over the schema
// literal cannot distinguish from a required-but-defaulted field.
const REQUIRED_PRODUCT_ROW = { name: "Chai", category: "Beverages", price: 20 };

test("createProductSchema: name+category+price together parse, and dropping ANY ONE of them fails — none of the three carries a schema default", () => {
  assert.equal(createProductSchema.safeParse(REQUIRED_PRODUCT_ROW).success, true);

  for (const field of ["name", "category", "price"] as const) {
    const rest = { ...REQUIRED_PRODUCT_ROW };
    delete (rest as Record<string, unknown>)[field];
    assert.equal(
      createProductSchema.safeParse(rest).success,
      false,
      `dropping ${field} must fail — it has no schema default, so a blank CSV cell here is an ERROR row, not a ₹0/empty product`,
    );
  }
});

test("createProductSchema: discount/image/modifiers/isActive are genuinely optional — omitted, the schema's OWN defaults apply (0 / \"\" / [] / true), never a validation error", () => {
  const parsed = createProductSchema.safeParse(REQUIRED_PRODUCT_ROW);
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.discount, 0);
  assert.equal(parsed.data.image, "");
  assert.deepEqual(parsed.data.modifiers, []);
  assert.equal(parsed.data.isActive, true);
});

test("PIN §A: the doc states name/category/price as the required import columns, matching createProductSchema — a blank price cell must be a skipped import ERROR, not a silent ₹0", () => {
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
  const without = computeOrderTotals({ items, discount: 0, charge: 0, cfg });
  const withCharge = computeOrderTotals({ items, discount: 0, charge: 50, cfg });

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

// Poll cadence is source-pinned by regex, NOT imported — promoting three
// client-only constants into @pos/shared just for one doc row is not worth
// it (accepted trade-off, phase-CR2-public-ordering.md §23.6 Risk 3): a
// refactor that moves/renames these constants fails only this pin.
test("PIN §A: PublicOrderStatus.tsx's poll cadence (5s for 60s, then 30s) matches the doc's diner-status-poll row", () => {
  const src = readFileSync(
    path.join(REPO_ROOT, "apps/cafe/components/public/PublicOrderStatus.tsx"),
    "utf8",
  );
  assert.match(src, /POLL_FAST_MS = 5_000/, "PublicOrderStatus.tsx's fast-poll interval must still be 5s");
  assert.match(src, /POLL_FAST_WINDOW_MS = 60_000/, "PublicOrderStatus.tsx's fast-poll window must still be 60s");
  assert.match(src, /POLL_SLOW_MS = 30_000/, "PublicOrderStatus.tsx's slow-poll interval must still be 30s");

  const cell = factRow("Diner status poll");
  const nums = [...cell.matchAll(/\d+/g)].map((m) => Number(m[0]));
  assert.deepEqual(
    nums,
    [5, 60, 30],
    "the doc's poll-cadence row must state fast interval, fast window, then slow interval in seconds",
  );
});

test("PIN §3: the Self-order-mode row lists the real SELF_ORDER_MODES enum values", () => {
  assert.deepEqual([...SELF_ORDER_MODES], ["approve", "auto"]);
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
  for (const field of ["category", "price", "discount", "image", "modifiers", "isActive"]) {
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
