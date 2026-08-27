import { test } from "node:test";
import assert from "node:assert/strict";

import { settingsSchema, updateSettingsSchema } from "./settings.schema";
import {
  IMAGE_REF_MAX_LEN,
  PAPER_WIDTHS,
  PRINT_FONT_SIZES,
  PRINT_LOGO_SIZES,
  PRINT_NUMBER_START_MIN,
  PRINT_NUMBER_START_MAX,
} from "../constants";
import { PROMO_CODE_MAX } from "../public";
import { DEFAULT_APPEARANCE, APPEARANCE_SCHEMA_VERSION } from "../appearance";

// CR1.7 print customization — the Zod half of the bill*/kot* contract that
// apps/cafe/lib/print.ts's resolver and models/Settings.ts's Mongoose schema
// both key off. NOT covered here (already pinned in
// apps/cafe/lib/settings-branding.test.ts): logo/fssai length limits, the
// Mongoose model's own string defaults. This file is DB-free and Mongoose-free
// (shared package rule): pure Zod shape checks only.

// A full valid payload with every print field at a plain, in-range value —
// each test below overrides exactly the field(s) it's exercising, so a
// failure elsewhere in the object can't be mistaken for a pass here.
function validPrintPayload() {
  return {
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

    billShowNumber: true,
    billNumberStart: PRINT_NUMBER_START_MIN,
    billShowLogo: true,
    billLogoSize: "medium" as const,
    billShowAddress: true,
    billShowMobile: true,
    billShowGstNumber: true,
    billShowFssai: true,
    billPaperWidth: "80mm" as const,
    billFontSize: "normal" as const,

    kotShowPrices: true,
    kotShowTotal: true,
    kotShowNumber: true,
    kotNumberStart: PRINT_NUMBER_START_MIN,
    kotNumberVoidSlips: true,
    kotShowLogo: false,
    kotShowRestaurantName: false,
    kotShowTable: true,
    kotShowStaff: true,
    kotShowTime: true,
    kotShowNotes: true,
    kotPaperWidth: "80mm" as const,
    kotFontSize: "normal" as const,

    selfOrderMode: "approve" as const,
    allowTableChange: true,
    showPastOrdersToDiner: true,
  };
}

test("settingsSchema accepts a fully-populated valid print payload", () => {
  const r = settingsSchema.safeParse(validPrintPayload());
  assert.equal(r.success, true);
});

// ── billNumberStart / kotNumberStart bounds ─────────────────────────────────

for (const field of ["billNumberStart", "kotNumberStart"] as const) {
  test(`settingsSchema: ${field} rejects 0`, () => {
    const r = settingsSchema.safeParse({ ...validPrintPayload(), [field]: 0 });
    assert.equal(r.success, false);
  });

  test(`settingsSchema: ${field} rejects a negative number`, () => {
    const r = settingsSchema.safeParse({ ...validPrintPayload(), [field]: -1 });
    assert.equal(r.success, false);
  });

  test(`settingsSchema: ${field} rejects a fractional number`, () => {
    const r = settingsSchema.safeParse({ ...validPrintPayload(), [field]: 1.5 });
    assert.equal(r.success, false);
  });

  test(`settingsSchema: ${field} rejects a value above PRINT_NUMBER_START_MAX`, () => {
    const r = settingsSchema.safeParse({
      ...validPrintPayload(),
      [field]: PRINT_NUMBER_START_MAX + 1,
    });
    assert.equal(r.success, false);
  });

  test(`settingsSchema: ${field} accepts PRINT_NUMBER_START_MIN exactly`, () => {
    const r = settingsSchema.safeParse({ ...validPrintPayload(), [field]: PRINT_NUMBER_START_MIN });
    assert.equal(r.success, true);
  });

  test(`settingsSchema: ${field} accepts PRINT_NUMBER_START_MAX exactly`, () => {
    const r = settingsSchema.safeParse({ ...validPrintPayload(), [field]: PRINT_NUMBER_START_MAX });
    assert.equal(r.success, true);
  });
}

// ── the three print enums ───────────────────────────────────────────────────

test("settingsSchema: billPaperWidth/kotPaperWidth reject an unknown value and accept every declared PAPER_WIDTHS member", () => {
  for (const field of ["billPaperWidth", "kotPaperWidth"] as const) {
    const rejected = settingsSchema.safeParse({ ...validPrintPayload(), [field]: "110mm" });
    assert.equal(rejected.success, false, `${field} must reject an unknown width`);
    for (const width of PAPER_WIDTHS) {
      const accepted = settingsSchema.safeParse({ ...validPrintPayload(), [field]: width });
      assert.equal(accepted.success, true, `${field} must accept declared member ${width}`);
    }
  }
});

test("settingsSchema: billFontSize/kotFontSize reject an unknown value and accept every declared PRINT_FONT_SIZES member", () => {
  for (const field of ["billFontSize", "kotFontSize"] as const) {
    const rejected = settingsSchema.safeParse({ ...validPrintPayload(), [field]: "huge" });
    assert.equal(rejected.success, false, `${field} must reject an unknown size`);
    for (const size of PRINT_FONT_SIZES) {
      const accepted = settingsSchema.safeParse({ ...validPrintPayload(), [field]: size });
      assert.equal(accepted.success, true, `${field} must accept declared member ${size}`);
    }
  }
});

test("settingsSchema: billLogoSize rejects an unknown value and accepts every declared PRINT_LOGO_SIZES member", () => {
  const rejected = settingsSchema.safeParse({ ...validPrintPayload(), billLogoSize: "huge" });
  assert.equal(rejected.success, false);
  for (const size of PRINT_LOGO_SIZES) {
    const accepted = settingsSchema.safeParse({ ...validPrintPayload(), billLogoSize: size });
    assert.equal(accepted.success, true, `billLogoSize must accept declared member ${size}`);
  }
});

// ── settingsSchema REQUIRES the print fields; updateSettingsSchema is a partial ─
// This split is what lets the PUT route patch a single toggle without the
// caller resending the other 22 print fields (and the other 12 core fields).

test("settingsSchema rejects a payload missing a print field — every bill*/kot* field is required on the full-save surface", () => {
  const full = validPrintPayload();
  const { billShowLogo: _drop, ...missingBillShowLogo } = full;
  const r = settingsSchema.safeParse(missingBillShowLogo);
  assert.equal(r.success, false, "omitting billShowLogo must fail the full settingsSchema");
});

test("updateSettingsSchema (the PUT partial) accepts a payload carrying only ONE print field", () => {
  const r = updateSettingsSchema.safeParse({ billShowLogo: false });
  assert.equal(r.success, true);
});

test("updateSettingsSchema accepts an entirely empty patch", () => {
  assert.equal(updateSettingsSchema.safeParse({}).success, true);
});

test("updateSettingsSchema still enforces the same numberStart bounds on the field it IS given", () => {
  assert.equal(updateSettingsSchema.safeParse({ billNumberStart: 0 }).success, false);
  assert.equal(
    updateSettingsSchema.safeParse({ kotNumberStart: PRINT_NUMBER_START_MAX + 1 }).success,
    false,
  );
  assert.equal(updateSettingsSchema.safeParse({ billNumberStart: PRINT_NUMBER_START_MIN }).success, true);
});

// ── logo / productLogo: local branding refs ─────────────────────────────────

test("settingsSchema accepts a well-formed local branding ref for both logo and productLogo", () => {
  const r = settingsSchema.safeParse({
    ...validPrintPayload(),
    logo: "local:logo:0123456789ab",
    productLogo: "local:productLogo:0123456789ab",
  });
  assert.equal(r.success, true);
});

test("settingsSchema rejects a productLogo ref over IMAGE_REF_MAX_LEN", () => {
  const r = settingsSchema.safeParse({
    ...validPrintPayload(),
    productLogo: "x".repeat(IMAGE_REF_MAX_LEN + 1),
  });
  assert.equal(r.success, false);
});

// ── promo codes (CR2.2c) ─────────────────────────────────────────────────────

test("settingsSchema accepts a payload with NO promoCodes key at all — fixture safety: a required field here broke every existing fixture once before", () => {
  const r = settingsSchema.safeParse(validPrintPayload());
  assert.equal(r.success, true);
});

test("settingsSchema accepts a well-formed promoCodes array, normalizing a lower-case code to uppercase", () => {
  const r = settingsSchema.safeParse({
    ...validPrintPayload(),
    promoCodes: [{ code: "save10", kind: "percent", value: 10, active: true }],
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.promoCodes?.[0]?.code, "SAVE10");
});

test("settingsSchema rejects duplicate codes (case-insensitively)", () => {
  const r = settingsSchema.safeParse({
    ...validPrintPayload(),
    promoCodes: [
      { code: "SAVE10", kind: "percent", value: 10, active: true },
      { code: "save10", kind: "flat", value: 50, active: true },
    ],
  });
  assert.equal(r.success, false);
});

test("settingsSchema: kind:\"percent\" rejects a value over 100 and accepts 1..100", () => {
  const over = settingsSchema.safeParse({
    ...validPrintPayload(),
    promoCodes: [{ code: "SAVE99", kind: "percent", value: 101, active: true }],
  });
  assert.equal(over.success, false);

  const inRange = settingsSchema.safeParse({
    ...validPrintPayload(),
    promoCodes: [{ code: "SAVE99", kind: "percent", value: 100, active: true }],
  });
  assert.equal(inRange.success, true);
});

test("settingsSchema: value must be greater than 0 (covers flat's own \"a money amount > 0\")", () => {
  const r = settingsSchema.safeParse({
    ...validPrintPayload(),
    promoCodes: [{ code: "ZERO", kind: "flat", value: 0, active: true }],
  });
  assert.equal(r.success, false);
});

test("settingsSchema rejects a promoCodes array over PROMO_CODE_MAX", () => {
  const promoCodes = Array.from({ length: PROMO_CODE_MAX + 1 }, (_, i) => ({
    code: `CODE${i}`,
    kind: "flat" as const,
    value: 10,
    active: true,
  }));
  const r = settingsSchema.safeParse({ ...validPrintPayload(), promoCodes });
  assert.equal(r.success, false);
});

test("settingsSchema accepts exactly PROMO_CODE_MAX codes", () => {
  const promoCodes = Array.from({ length: PROMO_CODE_MAX }, (_, i) => ({
    code: `CODE${i}`,
    kind: "flat" as const,
    value: 10,
    active: true,
  }));
  const r = settingsSchema.safeParse({ ...validPrintPayload(), promoCodes });
  assert.equal(r.success, true);
});

// ── SPEC P4 — per-customer usage cap ────────────────────────────────────────

test("settingsSchema accepts a promo code with oncePerCustomer:true", () => {
  const r = settingsSchema.safeParse({
    ...validPrintPayload(),
    promoCodes: [{ code: "ONCE10", kind: "percent", value: 10, active: true, oncePerCustomer: true }],
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.promoCodes?.[0]?.oncePerCustomer, true);
});

test("settingsSchema accepts a promo code with NO oncePerCustomer key at all — fixture safety, same discipline as the array's own optionality", () => {
  const r = settingsSchema.safeParse({
    ...validPrintPayload(),
    promoCodes: [{ code: "SAVE10", kind: "percent", value: 10, active: true }],
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.promoCodes?.[0]?.oncePerCustomer, undefined);
});

test("settingsSchema rejects a non-boolean oncePerCustomer value", () => {
  const r = settingsSchema.safeParse({
    ...validPrintPayload(),
    promoCodes: [{ code: "ONCE10", kind: "percent", value: 10, active: true, oncePerCustomer: "yes" }],
  });
  assert.equal(r.success, false);
});

test("updateSettingsSchema (the PUT partial) accepts a patch carrying only promoCodes", () => {
  const r = updateSettingsSchema.safeParse({
    promoCodes: [{ code: "SAVE10", kind: "percent", value: 10, active: true }],
  });
  assert.equal(r.success, true);
});

// ── Appearance (CR2.4) ───────────────────────────────────────────────────────
// DEFAULT_APPEARANCE's own presetId is "classicBistro". A preset's baked-in
// accent is tuned to ONE scheme (see appearance-contrast.test.ts's own note),
// so the "known-good custom accent" fixture below is a separate hex, verified
// against classicBistro's light+dark background/card by the same tuning
// script that built appearance-presets.ts.

test("settingsSchema accepts a payload with NO appearance key at all — same omit-empty precedent as promoCodes", () => {
  const r = settingsSchema.safeParse(validPrintPayload());
  assert.equal(r.success, true);
});

test("settingsSchema accepts a full, valid appearance block", () => {
  const r = settingsSchema.safeParse({
    ...validPrintPayload(),
    appearance: { ...DEFAULT_APPEARANCE },
  });
  assert.equal(r.success, true);
});

test("settingsSchema rejects an unknown presetId", () => {
  const r = settingsSchema.safeParse({
    ...validPrintPayload(),
    appearance: { ...DEFAULT_APPEARANCE, presetId: "midnightDiner" },
  });
  assert.equal(r.success, false);
});

test("settingsSchema rejects appearance.v !== APPEARANCE_SCHEMA_VERSION (A21 — a stale cached bundle must 400, never silently stamp)", () => {
  const r = settingsSchema.safeParse({
    ...validPrintPayload(),
    appearance: { ...DEFAULT_APPEARANCE, v: APPEARANCE_SCHEMA_VERSION + 1 },
  });
  assert.equal(r.success, false);
});

test("settingsSchema accepts accentOverride:\"\" (the preset-accent sentinel) with no contrast gate applied", () => {
  const r = settingsSchema.safeParse({
    ...validPrintPayload(),
    appearance: { ...DEFAULT_APPEARANCE, accentOverride: "" },
  });
  assert.equal(r.success, true);
});

test("settingsSchema accepts heroImage:\"\" (no hero configured)", () => {
  const r = settingsSchema.safeParse({
    ...validPrintPayload(),
    appearance: { ...DEFAULT_APPEARANCE, heroImage: "" },
  });
  assert.equal(r.success, true);
});

test("settingsSchema accepts a passing custom accentOverride, uppercase normalized to lowercase", () => {
  const r = settingsSchema.safeParse({
    ...validPrintPayload(),
    appearance: { ...DEFAULT_APPEARANCE, accentOverride: "#9A6A3A" },
  });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.appearance?.accentOverride, "#9a6a3a");
});

test("settingsSchema rejects a low-contrast accentOverride, naming the failing pair", () => {
  const r = settingsSchema.safeParse({
    ...validPrintPayload(),
    appearance: { ...DEFAULT_APPEARANCE, accentOverride: "#fefdfb" },
  });
  assert.equal(r.success, false);
  if (!r.success) {
    const issue = r.error.issues.find((i) => i.path.includes("accentOverride"));
    assert.ok(issue, "the rejection must land on the accentOverride path");
    assert.match(issue!.message, /accent vs (light|dark) (background|card): [\d.]+ < 3/);
  }
});

test("updateSettingsSchema (PUT) still accepts an entirely empty patch with appearance added to the schema", () => {
  assert.equal(updateSettingsSchema.safeParse({}).success, true);
});

test("updateSettingsSchema rejects a PARTIAL appearance object — every key is required once the object is present at all", () => {
  const r = updateSettingsSchema.safeParse({ appearance: { presetId: "classicBistro" } });
  assert.equal(r.success, false);
});
