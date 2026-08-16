import { test } from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { settingsSchema, updateSettingsSchema } from "@pos/shared/schemas/settings.schema";
import { createOrderSchema } from "@pos/shared/schemas/order.schema";
import { updateTableSchema } from "@pos/shared/schemas/table.schema";
import {
  IMAGE_REF_MAX_LEN,
  SETTINGS_FSSAI_MAX_LEN,
  ORDER_NOTES_MAX_LEN,
} from "@pos/shared/constants";
import { settingsSchema as settingsMongooseSchema } from "@/models/Settings";
import { printSettingsFields } from "@/lib/print";

// CR1.5 Slice 0 — foundation contracts for cafe branding (logo/FSSAI on
// Settings) and two stale-view guards (order notes bound, table pointer
// echo). DB-free: Zod shape checks + static Mongoose schema introspection
// only, mirroring the `defaultOf` technique in models/order.ledger.test.ts.

function defaultOf(schema: mongoose.Schema, field: string): unknown {
  return (schema.path(field) as unknown as { defaultValue?: unknown }).defaultValue;
}

// settingsSchema requires every print field (deliberately — once an admin saves,
// each toggle is written explicitly and "absent means default" stops being a
// question for that cafe). Rather than restate 23 literals here, the fixture is
// built from the SAME resolver the receipts read through, so it can never drift
// from the app's own defaults — and a new print setting added to the schema
// without a matching default in printConfigOf fails this file rather than
// surfacing as a form that quietly refuses to save.
const PRINT_DEFAULTS = printSettingsFields();

// ── settings.schema.ts: logo / fssai ─────────────────────────────────────────

test("settingsSchema accepts logo/fssai within their length limits", () => {
  const base = {
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
    ...PRINT_DEFAULTS,
  };
  const r = settingsSchema.safeParse({
    ...base,
    logo: "r2:products/abc123",
    fssai: "12345678901234",
  });
  assert.equal(r.success, true);
});

test("settingsSchema rejects a logo ref over IMAGE_REF_MAX_LEN", () => {
  const r = settingsSchema.safeParse({
    restaurantName: "Cafe",
    tagline: "",
    mobile: "",
    address: "",
    receiptHeader: "",
    receiptFooter: "",
    gstEnabled: false,
    gstNumber: "",
    gstRate: 5,
    gstMode: "inclusive",
    kotShowPrices: false,
    logo: "x".repeat(IMAGE_REF_MAX_LEN + 1),
    fssai: "",
  });
  assert.equal(r.success, false);
});

test("settingsSchema rejects an fssai number over SETTINGS_FSSAI_MAX_LEN", () => {
  const r = settingsSchema.safeParse({
    restaurantName: "Cafe",
    tagline: "",
    mobile: "",
    address: "",
    receiptHeader: "",
    receiptFooter: "",
    gstEnabled: false,
    gstNumber: "",
    gstRate: 5,
    gstMode: "inclusive",
    kotShowPrices: false,
    logo: "",
    fssai: "x".repeat(SETTINGS_FSSAI_MAX_LEN + 1),
  });
  assert.equal(r.success, false);
});

test("updateSettingsSchema (the PUT/partial surface) still accepts an empty patch", () => {
  assert.equal(updateSettingsSchema.safeParse({}).success, true);
});

// ── models/Settings.ts: string defaults ──────────────────────────────────────

test("Settings model: restaurantName/tagline/receiptFooter default to empty string, not a placeholder", () => {
  assert.equal(defaultOf(settingsMongooseSchema, "restaurantName"), "");
  assert.equal(defaultOf(settingsMongooseSchema, "tagline"), "");
  assert.equal(defaultOf(settingsMongooseSchema, "receiptFooter"), "");
});

test("Settings model: logo/fssai paths exist and default to empty string", () => {
  assert.ok(settingsMongooseSchema.path("logo"), "logo path must exist");
  assert.ok(settingsMongooseSchema.path("fssai"), "fssai path must exist");
  assert.equal(defaultOf(settingsMongooseSchema, "logo"), "");
  assert.equal(defaultOf(settingsMongooseSchema, "fssai"), "");
});

// ── order.schema.ts: notes bound ─────────────────────────────────────────────

const sampleOrder = {
  customerName: "Walk-in",
  items: [{ productId: "p1", name: "Chai", price: 20, qty: 1 }],
  subtotal: 20,
  total: 20,
  paidAmount: 20,
  payment: "Cash",
  receiver: "cashier",
};

test("createOrderSchema rejects notes longer than ORDER_NOTES_MAX_LEN", () => {
  const r = createOrderSchema.safeParse({
    ...sampleOrder,
    notes: "x".repeat(ORDER_NOTES_MAX_LEN + 1),
  });
  assert.equal(r.success, false);
});

test("createOrderSchema accepts a trimmed ORDER_NOTES_MAX_LEN-character note", () => {
  const notes = "x".repeat(ORDER_NOTES_MAX_LEN);
  const r = createOrderSchema.safeParse({ ...sampleOrder, notes });
  assert.equal(r.success, true, "an exactly-at-limit note must be accepted");
  assert.equal(r.success && r.data.notes, notes);
});

// ── table.schema.ts: expectedCurrentOrderId ──────────────────────────────────

test("updateTableSchema accepts an expectedCurrentOrderId echo", () => {
  const r = updateTableSchema.safeParse({
    status: "Occupied",
    expectedCurrentOrderId: "ORD-20260811-001",
  });
  assert.equal(r.success, true);
});

test("updateTableSchema rejects an expectedCurrentOrderId over 40 characters", () => {
  const r = updateTableSchema.safeParse({
    status: "Occupied",
    expectedCurrentOrderId: "x".repeat(41),
  });
  assert.equal(r.success, false);
});

// ── lib/settings.ts: getSettings() must connect before its DB query ─────────
// Arbiter-confirmed (probe): a page-render call to getSettings() with no prior
// connectDB() buffers on the un-connected mongoose default connection and
// times out after 10s (bufferCommands defaults true). The fix connects INSIDE
// getSettings(), after the cache hit-return (a cached read needs no
// connection) and before the DB query — connectDB is idempotent, so route
// callers that already connected pay nothing extra.

test("PIN: getSettings() calls connectDB() before its DB query", () => {
  const src = readFileSync(
    fileURLToPath(new URL("./settings.ts", import.meta.url)),
    "utf8",
  );
  const fnStart = src.indexOf("export async function getSettings");
  assert.ok(fnStart >= 0, "getSettings() must exist");
  const fnBody = src.slice(fnStart);
  assert.match(
    fnBody,
    /connectDB\(/,
    "getSettings() must call connectDB() — the render path's only connect discipline",
  );
});

// ── AppSidebar.tsx: the sidebar half of the logo spec (item 1) ──────────────
// The phase spec says the logo renders on "receipt header + sidebar" — the
// receipt half shipped, but the sidebar kept a hardcoded UtensilsCrossed tile.
// Pinning both identifiers so the sidebar branch can't silently vanish again.

test("PIN: AppSidebar.tsx renders the cafe's logo via productImageUrl", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../components/layout/AppSidebar.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(src, /\blogo\b/);
  assert.match(src, /productImageUrl\(/);
});

// ── PosPrompts.tsx: the free-table dialog copy must not claim "paid in full" ─
// False for Due/Credit/partial counter sales (PaymentModal defaults to all
// SETTLEMENT_PAY_MODES) — replaced with neutral copy.

test('PIN: PosPrompts.tsx does not claim a sale is "paid in full"', () => {
  const src = readFileSync(
    fileURLToPath(new URL("../components/pos/PosPrompts.tsx", import.meta.url)),
    "utf8",
  );
  assert.doesNotMatch(src, /paid in full/);
});

// ── CartNotes.tsx: useId() instead of a hardcoded duplicate-prone id ────────
// A hardcoded id="order-notes" collides when the desktop Cart (CSS-hidden)
// and the mobile Sheet's Cart are both mounted — the label ends up targeting
// the hidden textarea.

test("PIN: CartNotes.tsx uses useId() instead of a hardcoded id", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../components/pos/CartNotes.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(src, /useId/);
  assert.doesNotMatch(src, /"order-notes"/);
});

// ── upload route: DELETE must be admin-gated ────────────────────────────────
// The products/ scope now holds the admin-owned Settings logo; arbiter
// verified there is ZERO in-app DELETE caller (ImageUpload only POSTs;
// product deletion goes through /api/products), so a staff session could
// otherwise destroy it via a direct API call.

test("PIN: /api/upload's DELETE handler requires admin", () => {
  const src = readFileSync(
    fileURLToPath(new URL("../app/api/upload/route.ts", import.meta.url)),
    "utf8",
  );
  const delStart = src.indexOf("export async function DELETE");
  assert.ok(delStart >= 0, "DELETE handler must exist");
  const delBody = src.slice(delStart);
  assert.match(
    delBody,
    /requireAdmin/,
    "DELETE must call requireAdmin — POST stays requireAuth",
  );
});

// ── EndOfDaySummary.tsx: the Outstanding dues line must qualify a past date ──
// The line prints the LIVE receivables ledger (a point-in-time balance, "as
// of NOW" per the server comment) — under a past date's header with no
// qualifier it reads as that day's figure. openTabs === null is the
// established past-date signal.

test('PIN: EndOfDaySummary.tsx labels the Outstanding dues line "as of print" for a past date', () => {
  const src = readFileSync(
    fileURLToPath(new URL("../components/reports/EndOfDaySummary.tsx", import.meta.url)),
    "utf8",
  );
  assert.match(src, /as of print/);
});

// ── Grep-pin: dead placeholder strings must not linger in source ────────────
// CR1.5 Slice 0 replaced the "My Restaurant" / "Brewed with passion" /
// "Thank you! Visit again" placeholder defaults with "" (branding is
// per-cafe, never a hardcoded product placeholder) and deleted
// DEFAULT_RESTAURANT_NAME in favor of the generic APP_NAME fallback. This
// mirrors the walk technique in lib/table-constants-pin.test.ts:14-87.
//
// EXPECTED at this stage: other CR1.5 slices (receipt/KOT components, the
// Settings form, layout metadata) still carry these strings — they are out
// of scope for THIS slice and are reported, not edited, here.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

const SCAN_ROOTS = [
  "packages/shared/src",
  "apps/cafe/app",
  "apps/cafe/components",
  "apps/cafe/hooks",
  "apps/cafe/lib",
  "apps/cafe/models",
  "apps/cafe/scripts",
  "apps/hub",
  "workers",
  "scripts",
];

const SKIP_DIRS = new Set(["node_modules", ".next"]);
const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
// Exclude THIS test file from its own scan — it necessarily quotes the
// banned strings in test fixtures/comments above.
const SELF_FILE = "apps/cafe/lib/settings-branding.test.ts";

const BANNED_STRINGS = [
  "My Restaurant",
  "Brewed with passion",
  "Thank you! Visit again",
  "DEFAULT_RESTAURANT_NAME",
];

function walk(dirAbs: string, out: string[]): void {
  for (const entry of readdirSync(dirAbs)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = path.join(dirAbs, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      walk(abs, out);
    } else if (CODE_FILE_PATTERN.test(entry)) {
      out.push(abs);
    }
  }
}

function findBannedStringHits(): string[] {
  const hits: string[] = [];
  for (const root of SCAN_ROOTS) {
    const rootAbs = path.join(REPO_ROOT, root);
    if (!existsSync(rootAbs)) continue;
    const files: string[] = [];
    walk(rootAbs, files);
    for (const fileAbs of files) {
      const rel = path.relative(REPO_ROOT, fileAbs).split(path.sep).join("/");
      if (rel === SELF_FILE) continue;
      const lines = readFileSync(fileAbs, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const needle of BANNED_STRINGS) {
          if (line.includes(needle)) {
            hits.push(`${rel}:${i + 1}: ${needle}`);
          }
        }
      });
    }
  }
  return hits;
}

test("PIN: no source file mentions the deleted placeholder strings or DEFAULT_RESTAURANT_NAME", () => {
  const hits = findBannedStringHits();
  // GREEN since CR1.5 completed (it was expected-red only mid-slice, while the
  // receipt/KOT components and layout metadata still carried the defaults).
  // If it goes red now it is a REGRESSION, not a known state — the failure
  // message is the hit list. Note the scan reads every code file except this
  // one, so quoting a banned literal in a COMMENT trips it too (CR1.6 did
  // exactly that from a neighbouring test's header).
  assert.deepEqual(hits, []);
});
