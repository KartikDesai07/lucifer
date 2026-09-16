import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import mongoose from "mongoose";

import { PRINT_NUMBER_START_MIN } from "@pos/shared/constants";
import { settingsSchema } from "@pos/shared/schemas/settings.schema";
import { settingsSchema as settingsMongooseSchema } from "@/models/Settings";
import {
  printConfigOf,
  printSettingsFields,
  printedSlipNumber,
  PRINT_FONT_CLASS,
} from "./print";

// Print customization (23 flat bill*/kot* Settings fields) + slip numbering.
// `getSettings()` reads with `.lean()`, so Mongoose defaults never apply to a
// Settings document written before this feature shipped — every one of these
// 23 keys reads back `undefined` on it. printConfigOf is the ONLY sanctioned
// resolver for them; these tests pin that an absent key resolves to the
// documented "prints exactly what it printed before" default, that a STORED
// falsy value is never mistaken for "absent" (the `??` vs `||` hazard), and
// that the numbering helpers floor/round the way the receipt actually prints.

// ── A1/A2/A3/A4 — printConfigOf ──────────────────────────────────────────────

const DEFAULT_CONFIG = {
  bill: {
    showNumber: true,
    numberStart: PRINT_NUMBER_START_MIN,
    showLogo: true,
    logoSize: "medium",
    showAddress: true,
    showMobile: true,
    showGstNumber: true,
    showFssai: true,
    paperWidth: "80mm",
    // "small" is 12px — the base the bill has always rendered at, and the base
    // every em ratio inside OrderReceipt is derived from. The KOT's default is
    // "normal" (14px) below because ITS base has always been 14px. The two
    // surfaces differ on purpose; this is the oracle for "an upgrade changes
    // nothing until someone opts in".
    fontSize: "small",
  },
  kot: {
    showPrices: true,
    showTotal: true,
    showNumber: true,
    numberStart: PRINT_NUMBER_START_MIN,
    numberVoidSlips: true,
    showLogo: false,
    showRestaurantName: false,
    showTable: true,
    showStaff: true,
    showTime: true,
    showNotes: true,
    paperWidth: "80mm",
    fontSize: "normal",
  },
};

test("printConfigOf(undefined) returns the documented defaults — a pre-feature Settings document (no keys at all) keeps printing exactly what it printed before", () => {
  assert.deepEqual(printConfigOf(undefined), DEFAULT_CONFIG);
});

test("printConfigOf({}) returns the same documented defaults as printConfigOf(undefined)", () => {
  assert.deepEqual(printConfigOf({}), DEFAULT_CONFIG);
});

test("printConfigOf defaults: bill.showLogo/showAddress/showMobile/showGstNumber/showFssai are all true — an existing cafe never silently loses its branding", () => {
  const { bill } = printConfigOf(undefined);
  assert.equal(bill.showLogo, true);
  assert.equal(bill.showAddress, true);
  assert.equal(bill.showMobile, true);
  assert.equal(bill.showGstNumber, true);
  assert.equal(bill.showFssai, true);
});

test("printConfigOf: explicit stored values win over defaults across every bill/kot field, including a full flip of every boolean", () => {
  const stored = {
    billShowNumber: false,
    billNumberStart: 50,
    billShowLogo: false,
    billLogoSize: "large" as const,
    billShowAddress: false,
    billShowMobile: false,
    billShowGstNumber: false,
    billShowFssai: false,
    billPaperWidth: "58mm" as const,
    billFontSize: "small" as const,
    kotShowPrices: false,
    kotShowTotal: false,
    kotShowNumber: false,
    kotNumberStart: 25,
    kotNumberVoidSlips: false,
    kotShowLogo: true,
    kotShowRestaurantName: true,
    kotShowTable: false,
    kotShowStaff: false,
    kotShowTime: false,
    kotShowNotes: false,
    kotPaperWidth: "58mm" as const,
    kotFontSize: "large" as const,
  };
  assert.deepEqual(printConfigOf(stored), {
    bill: {
      showNumber: false,
      numberStart: 50,
      showLogo: false,
      logoSize: "large",
      showAddress: false,
      showMobile: false,
      showGstNumber: false,
      showFssai: false,
      paperWidth: "58mm",
      fontSize: "small",
    },
    kot: {
      showPrices: false,
      showTotal: false,
      showNumber: false,
      numberStart: 25,
      numberVoidSlips: false,
      showLogo: true,
      showRestaurantName: true,
      showTable: false,
      showStaff: false,
      showTime: false,
      showNotes: false,
      paperWidth: "58mm",
      fontSize: "large",
    },
  });
});

// The bug this specifically catches: `settings?.billShowLogo ?? true` reads a
// stored `false` correctly; `settings?.billShowLogo || true` would collapse
// that same stored `false` back to `true`. Isolated to ONE field (everything
// else absent) so this test can't pass by accident off the full-object case
// above sharing the same fixture.
test("printConfigOf: a STORED false is never mistaken for absent — { billShowLogo: false } resolves to false, not the true default (the ?? vs || bug)", () => {
  const { bill } = printConfigOf({ billShowLogo: false });
  assert.equal(bill.showLogo, false);
  // Every sibling field is untouched — still the plain default.
  assert.equal(bill.showAddress, true);
  assert.equal(bill.showLogo, false, "must not have fallen back to the true default");
});

test("printConfigOf: numberStart is floored to PRINT_NUMBER_START_MIN when absent, zero, negative, or non-finite", () => {
  assert.equal(printConfigOf({}).bill.numberStart, PRINT_NUMBER_START_MIN, "absent");
  assert.equal(printConfigOf({ billNumberStart: 0 }).bill.numberStart, PRINT_NUMBER_START_MIN, "zero");
  assert.equal(printConfigOf({ billNumberStart: -5 }).bill.numberStart, PRINT_NUMBER_START_MIN, "negative");
  assert.equal(
    printConfigOf({ billNumberStart: Number.NaN }).bill.numberStart,
    PRINT_NUMBER_START_MIN,
    "NaN",
  );
  assert.equal(
    printConfigOf({ billNumberStart: Number.POSITIVE_INFINITY }).bill.numberStart,
    PRINT_NUMBER_START_MIN,
    "Infinity",
  );
  assert.equal(
    printConfigOf({ billNumberStart: Number.NEGATIVE_INFINITY }).bill.numberStart,
    PRINT_NUMBER_START_MIN,
    "-Infinity",
  );
});

test("printConfigOf: a fractional numberStart rounds rather than truncating or floating through", () => {
  // Math.round, not Math.floor/Math.trunc — 500.5 must land on 501, not 500.
  assert.equal(printConfigOf({ billNumberStart: 500.5 }).bill.numberStart, 501);
  assert.equal(printConfigOf({ billNumberStart: 500.4 }).bill.numberStart, 500);
});

test("printConfigOf: a valid numberStart at or above the minimum is preserved exactly, for both bill and kot", () => {
  assert.equal(printConfigOf({ billNumberStart: 501 }).bill.numberStart, 501);
  assert.equal(printConfigOf({ kotNumberStart: 999999 }).kot.numberStart, 999999);
  assert.equal(
    printConfigOf({ billNumberStart: PRINT_NUMBER_START_MIN }).bill.numberStart,
    PRINT_NUMBER_START_MIN,
  );
});

test("printConfigOf: kotShowPrices (the one pre-existing field) — a stored false stays false, not the true default", () => {
  assert.equal(printConfigOf({ kotShowPrices: false }).kot.showPrices, false);
  assert.equal(printConfigOf({}).kot.showPrices, true, "control: absent still defaults to true");
});

// ── B — printSettingsFields ──────────────────────────────────────────────────
// A real cross-check against settingsSchema's OWN shape, not a hand-copied
// list: adding a new bill*/kot* field to the schema without adding it to
// printConfigOf/printSettingsFields must fail THIS test, not surface later as
// a Settings form that silently drops a field on submit.

test("printSettingsFields returns exactly the bill*/kot* keys settingsSchema requires — no fewer, no extras", () => {
  const schemaKeys = Object.keys(settingsSchema.shape).filter(
    (k) => k.startsWith("bill") || k.startsWith("kot"),
  );
  const fieldKeys = Object.keys(printSettingsFields());
  assert.deepEqual([...fieldKeys].sort(), [...schemaKeys].sort());
});

test("printSettingsFields(): passing nothing yields the documented defaults, flattened", () => {
  const fields = printSettingsFields();
  assert.equal(fields.billShowLogo, true);
  assert.equal(fields.billNumberStart, PRINT_NUMBER_START_MIN);
  assert.equal(fields.kotShowLogo, false);
  assert.equal(fields.kotPaperWidth, "80mm");
});

test("printSettingsFields(settings): a cafe's stored values flow through, including a falsy override", () => {
  const fields = printSettingsFields({ billShowLogo: false, kotFontSize: "large" });
  assert.equal(fields.billShowLogo, false);
  assert.equal(fields.kotFontSize, "large");
  // Untouched siblings still resolve to the plain default.
  assert.equal(fields.billShowAddress, true);
});

// ── C — printedSlipNumber ────────────────────────────────────────────────────
// The identity that matters most: the FIRST slip of the day prints exactly
// the cafe's configured start, and every slip after it increments by one.

test("printedSlipNumber: the first slip of the day (sequence 1) prints exactly the configured start", () => {
  assert.equal(printedSlipNumber(1, 501), 501);
});

test("printedSlipNumber: the second slip prints one more than the start", () => {
  assert.equal(printedSlipNumber(2, 501), 502);
});

test("printedSlipNumber: a start below PRINT_NUMBER_START_MIN is floored before the sequence is added", () => {
  assert.equal(printedSlipNumber(1, 0), PRINT_NUMBER_START_MIN);
  assert.equal(printedSlipNumber(1, -100), PRINT_NUMBER_START_MIN);
});

test("printedSlipNumber: a fractional sequence rounds rather than truncating", () => {
  // Math.round(1.6) = 2 -> the second slip's number, not the first's.
  assert.equal(printedSlipNumber(1.6, 501), 502);
  // Math.round(0.4) = 0, clamped up to the minimum sequence (1) -> still the
  // first slip's number.
  assert.equal(printedSlipNumber(0.4, 501), 501);
});

// ── D — receiptPageStyle ─────────────────────────────────────────────────────
// NOT duplicated here: lib/print-paths.test.ts's test #4 ("PIN: RECEIPT_PAGE_STYLE
// carries the 80mm/4mm page setup...") already asserts receiptPageStyle("80mm")
// is byte-identical to RECEIPT_PAGE_STYLE and that "58mm" differs only in the
// @page size — fully covered there, so it is intentionally not repeated here.

// ── E — Defect 2: the bill's default font size, pinned against its PRE-CHANGE
// roots ───────────────────────────────────────────────────────────────────
// OrderReceipt.tsx's root has ALWAYS rendered at 12px, and every `em` ratio
// inside that component is derived from that base; KOTReceipt.tsx's root has
// ALWAYS been 14px. Defaulting the bill to "normal" (14px, one step too large)
// would have printed an existing cafe's bill ~17% larger than the day before
// with no setting touched — this is the assertion that makes "an upgrade
// changes nothing until someone opts in" checkable, not just asserted in a
// comment.

test("PIN: printConfigOf(undefined) resolves the bill's default font class to the bill's PRE-CHANGE 12px root, and the kot's to its PRE-CHANGE 14px root", () => {
  const resolved = printConfigOf(undefined);
  assert.equal(
    PRINT_FONT_CLASS[resolved.bill.fontSize],
    "text-[12px]",
    "OrderReceipt.tsx's root has always rendered at text-[12px] — every em ratio inside it is derived from that base; a 'normal' (14px) default would print ~17% larger with no setting changed",
  );
  assert.equal(
    PRINT_FONT_CLASS[resolved.kot.fontSize],
    "text-[14px]",
    "KOTReceipt.tsx's root has always rendered at text-[14px] — the two surfaces differ on purpose, which is why their defaults differ",
  );
});

function defaultOf(schema: mongoose.Schema, field: string): unknown {
  return (schema.path(field) as unknown as { defaultValue?: unknown }).defaultValue;
}

test("PIN: the resolver default and the Mongoose model default agree for billFontSize/kotFontSize — a newly provisioned cafe must print identically to an existing one", () => {
  const resolved = printConfigOf(undefined);
  assert.equal(
    defaultOf(settingsMongooseSchema, "billFontSize"),
    resolved.bill.fontSize,
    "models/Settings.ts's billFontSize default must match printConfigOf's fallback, or a fresh cafe prints its bill at a different size than an existing one",
  );
  assert.equal(
    defaultOf(settingsMongooseSchema, "kotFontSize"),
    resolved.kot.fontSize,
    "models/Settings.ts's kotFontSize default must match printConfigOf's fallback",
  );
});

// ── F — Defect 1: the 0 sentinel must never surface as a printed slip number ─
// The route pads an unnumbered round's kotNumbers entry with 0 (see
// app/api/orders/[id]/items/route.ts's own comment) — a safe sentinel ONLY if
// the reader guards on `> 0`, not merely `!== undefined`. There is no React
// test framework in this repo (deliberate): this is a source-read pin over the
// REAL hook, the same technique as lib/print-paths.test.ts.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

test('PIN: use-pos-print.ts\'s queueKotRound guards the stored kot ticket on `> 0`, not just `!== undefined` — the route\'s 0 sentinel (an unnumbered round) must never print as "#0"', () => {
  const src = readSrc("apps/cafe/hooks/use-pos-print.ts");
  const fnStart = src.indexOf("const queueKotRound");
  assert.ok(fnStart >= 0, "queueKotRound must exist in use-pos-print.ts");
  const nextFnStart = src.indexOf("const queueVoidSlip");
  assert.ok(nextFnStart > fnStart, "queueVoidSlip must exist after queueKotRound");
  const body = src.slice(fnStart, nextFnStart);
  assert.match(
    body,
    /ticket !== undefined && ticket > 0 \? ticket : undefined/,
    "queueKotRound must guard the stored ticket on > 0 — a bare `!== undefined` check would let the route's 0 sentinel (a round fired while numbering was off, or padding for a ship-day-shape tab) print as \"#0\"",
  );
});
