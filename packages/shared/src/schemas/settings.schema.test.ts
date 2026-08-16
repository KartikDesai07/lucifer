import { test } from "node:test";
import assert from "node:assert/strict";

import { settingsSchema, updateSettingsSchema } from "./settings.schema";
import {
  PAPER_WIDTHS,
  PRINT_FONT_SIZES,
  PRINT_LOGO_SIZES,
  PRINT_NUMBER_START_MIN,
  PRINT_NUMBER_START_MAX,
} from "../constants";

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
