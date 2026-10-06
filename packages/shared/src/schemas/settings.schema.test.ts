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
  POS_LAYOUTS,
  TABLE_LONG_STAY_MIN_MINUTES,
  TABLE_LONG_STAY_MAX_MINUTES,
  TABLE_LONG_STAY_DEFAULT_MINUTES,
} from "../constants";
import { PROMO_CODE_MAX } from "../public";
import { PAY_QR_MODES, UPI_ID_MAX_LEN } from "../print-qr";
import {
  TOKEN_READY_CLEAR_MINUTES_MAX,
  TOKEN_READY_CLEAR_MINUTES_MIN,
  isTokenReadyClearMinutes,
} from "../slip-day";
import { DEFAULT_APPEARANCE, APPEARANCE_SCHEMA_VERSION } from "../appearance";
import { accentProblemText } from "../appearance-contrast";

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
    upiId: "",

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

test("settingsSchema rejects a low-contrast accentOverride with the plain-English message (accentProblemText), no raw pair or number", () => {
  const r = settingsSchema.safeParse({
    ...validPrintPayload(),
    appearance: { ...DEFAULT_APPEARANCE, accentOverride: "#fefdfb" },
  });
  assert.equal(r.success, false);
  if (!r.success) {
    const issue = r.error.issues.find((i) => i.path.includes("accentOverride"));
    assert.ok(issue, "the rejection must land on the accentOverride path");
    // Slice 9: the Save toast shows this message, so it is plain English, never the raw pair.
    assert.equal(issue!.message, accentProblemText("light"));
    assert.ok(!/accent vs|\d/.test(issue!.message), "no raw contrast pair or number in the message");
  }
});

test("updateSettingsSchema (PUT) still accepts an entirely empty patch with appearance added to the schema", () => {
  assert.equal(updateSettingsSchema.safeParse({}).success, true);
});

test("updateSettingsSchema rejects a PARTIAL appearance object — every key is required once the object is present at all", () => {
  const r = updateSettingsSchema.safeParse({ appearance: { presetId: "classicBistro" } });
  assert.equal(r.success, false);
});

// ── posLayout (UI batch 1 §H) ────────────────────────────────────────────────

test("settingsSchema accepts a payload with NO posLayout key at all — fixture safety, same omit-empty precedent as promoCodes/appearance", () => {
  const r = settingsSchema.safeParse(validPrintPayload());
  assert.equal(r.success, true);
});

test("settingsSchema accepts every declared POS_LAYOUTS member and rejects an unknown value", () => {
  for (const layout of POS_LAYOUTS) {
    const r = settingsSchema.safeParse({ ...validPrintPayload(), posLayout: layout });
    assert.equal(r.success, true, `posLayout must accept declared member ${layout}`);
  }
  const rejected = settingsSchema.safeParse({ ...validPrintPayload(), posLayout: "byPrice" });
  assert.equal(rejected.success, false, "posLayout must reject an unknown value");
});

test("updateSettingsSchema (the PUT partial) accepts a patch carrying only posLayout", () => {
  const r = updateSettingsSchema.safeParse({ posLayout: "byCategory" });
  assert.equal(r.success, true);
});

// ── tableLongStayMinutes (Tables redesign, 2026-09-30) ──────────────────────

test("settingsSchema accepts a payload with NO tableLongStayMinutes key — documents written before the field", () => {
  const r = settingsSchema.safeParse(validPrintPayload());
  assert.equal(r.success, true);
});

test("tableLongStayMinutes accepts whole minutes inside the range, including both ends and the default", () => {
  for (const minutes of [TABLE_LONG_STAY_MIN_MINUTES, TABLE_LONG_STAY_DEFAULT_MINUTES, TABLE_LONG_STAY_MAX_MINUTES]) {
    const r = settingsSchema.safeParse({ ...validPrintPayload(), tableLongStayMinutes: minutes });
    assert.equal(r.success, true, `must accept ${minutes}`);
  }
});

test("tableLongStayMinutes rejects out-of-range, fractional and string values", () => {
  for (const bad of [TABLE_LONG_STAY_MIN_MINUTES - 1, TABLE_LONG_STAY_MAX_MINUTES + 1, 45.5, "60"]) {
    const r = settingsSchema.safeParse({ ...validPrintPayload(), tableLongStayMinutes: bad });
    assert.equal(r.success, false, `must reject ${String(bad)}`);
  }
});

test("a cleared minutes box (NaN) gets the plain-English type message, not zod's default wording", () => {
  const r = settingsSchema.safeParse({ ...validPrintPayload(), tableLongStayMinutes: Number.NaN });
  assert.equal(r.success, false);
  if (r.success) return;
  const issue = r.error.issues.find((i) => i.path[0] === "tableLongStayMinutes");
  assert.equal(issue?.message, "Enter the minutes as a whole number");
});

// Settings slice 3 (s65): the GST & taxes page shows this under "Other rate"
// when the box is cleared — zod's own wording is not plain English.
test("a cleared GST rate box (NaN) gets the plain-English type message, not zod's default wording", () => {
  const r = settingsSchema.safeParse({ ...validPrintPayload(), gstRate: Number.NaN });
  assert.equal(r.success, false);
  if (r.success) return;
  const issue = r.error.issues.find((i) => i.path[0] === "gstRate");
  assert.equal(issue?.message, "Enter the GST rate as a number");
});

test("updateSettingsSchema (the PUT partial) accepts a patch carrying only tableLongStayMinutes", () => {
  const r = updateSettingsSchema.safeParse({ tableLongStayMinutes: 45 });
  assert.equal(r.success, true);
});

// ── upiId (print customization S3: the bill's "Scan to pay" QR) ─────────────

test("settingsSchema: upiId accepts \"\" (not set) and a valid UPI ID", () => {
  for (const upiId of ["", "samplecafe@okaxis", "sample.cafe-1_x@ybl"]) {
    const r = settingsSchema.safeParse({ ...validPrintPayload(), upiId });
    assert.equal(r.success, true, `"${upiId}" should be accepted`);
  }
});

test("settingsSchema: upiId is trimmed before it is checked and saved", () => {
  const r = settingsSchema.safeParse({ ...validPrintPayload(), upiId: "  samplecafe@okaxis  " });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.upiId, "samplecafe@okaxis");
});

test("settingsSchema: upiId rejects a malformed ID with the plain-English message", () => {
  const tooLong = `${"a".repeat(UPI_ID_MAX_LEN)}@okaxis`;
  for (const upiId of ["no-at-sign", "a@1", "with space@okaxis", tooLong]) {
    const r = settingsSchema.safeParse({ ...validPrintPayload(), upiId });
    assert.equal(r.success, false, `"${upiId}" should be rejected`);
    if (r.success) continue;
    assert.ok(r.error.issues.some((i) => i.path[0] === "upiId"), "the issue is on upiId");
  }
  const r = settingsSchema.safeParse({ ...validPrintPayload(), upiId: "no-at-sign" });
  assert.equal(r.success ? "" : r.error.issues.find((i) => i.path[0] === "upiId")?.message, "Enter a UPI ID like yourshop@okaxis");
});

test("updateSettingsSchema (the PUT partial) still builds with the upiId refine: a patch of only upiId passes, a bad one fails", () => {
  assert.equal(updateSettingsSchema.safeParse({ upiId: "samplecafe@okaxis" }).success, true);
  assert.equal(updateSettingsSchema.safeParse({ upiId: "" }).success, true);
  assert.equal(updateSettingsSchema.safeParse({ upiId: "nope" }).success, false);
});

// ── payQrMode / payQrValidMinutes (S3b: when the pay QR prints, and for how long after the first print) ─────
// Both are OPTIONAL: documents written before S3b carry neither, and every reader goes through payQrModeOf /
// payQrMinutesOf (print-qr.ts) for the defaults. The range check sits on the field, so the PUT partial enforces it too.
const PAY_QR_MINUTES_RANGE_MESSAGE = "Use 5 to 1440 minutes, or No limit";

function payQrIssue(r: ReturnType<typeof settingsSchema.safeParse>, field: string): string | undefined {
  return r.success ? undefined : r.error.issues.find((i) => i.path[0] === field)?.message;
}

test("settingsSchema: payQrMode accepts every PAY_QR_MODES member and a payload with no payQrMode at all", () => {
  for (const payQrMode of PAY_QR_MODES) {
    const r = settingsSchema.safeParse({ ...validPrintPayload(), payQrMode });
    assert.equal(r.success, true, `must accept ${payQrMode}`);
    if (r.success) assert.equal(r.data.payQrMode, payQrMode);
  }
  // Absent stays absent: the schema supplies no default, the readers do.
  const absent = settingsSchema.safeParse(validPrintPayload());
  assert.equal(absent.success, true);
  if (absent.success) assert.equal(absent.data.payQrMode, undefined);
});

test("settingsSchema: payQrMode rejects an unknown value", () => {
  for (const bad of ["sometimes", "ALWAYS", ""]) {
    const r = settingsSchema.safeParse({ ...validPrintPayload(), payQrMode: bad });
    assert.equal(r.success, false, `must reject ${JSON.stringify(bad)}`);
    assert.ok(!r.success && r.error.issues.some((i) => i.path[0] === "payQrMode"), "the issue is on payQrMode");
  }
});

test("settingsSchema: payQrValidMinutes accepts 0 (No limit), the 5 and 1440 ends, the default, and an absent key", () => {
  for (const payQrValidMinutes of [0, 5, 60, 1440]) {
    const r = settingsSchema.safeParse({ ...validPrintPayload(), payQrValidMinutes });
    assert.equal(r.success, true, `must accept ${payQrValidMinutes}`);
    // 0 survives parsing: it is a real value, not "unset".
    if (r.success) assert.equal(r.data.payQrValidMinutes, payQrValidMinutes);
  }
  const absent = settingsSchema.safeParse(validPrintPayload());
  assert.equal(absent.success, true);
  if (absent.success) assert.equal(absent.data.payQrValidMinutes, undefined);
});

test("settingsSchema: payQrValidMinutes rejects out-of-range and fractional numbers with the plain-English range message", () => {
  for (const bad of [1, 4, 1441, 5.5, -1]) {
    const r = settingsSchema.safeParse({ ...validPrintPayload(), payQrValidMinutes: bad });
    assert.equal(r.success, false, `must reject ${bad}`);
    assert.equal(payQrIssue(r, "payQrValidMinutes"), PAY_QR_MINUTES_RANGE_MESSAGE, String(bad));
  }
});

test("settingsSchema: payQrValidMinutes rejects NaN (a cleared box) and a numeric string with the type message", () => {
  for (const bad of [Number.NaN, "60"]) {
    const r = settingsSchema.safeParse({ ...validPrintPayload(), payQrValidMinutes: bad });
    assert.equal(r.success, false, `must reject ${String(bad)}`);
    assert.equal(payQrIssue(r, "payQrValidMinutes"), "Enter the minutes as a whole number", String(bad));
  }
});

test("updateSettingsSchema (the PUT partial) accepts a patch of only payQrMode, and of only payQrValidMinutes", () => {
  for (const payQrMode of PAY_QR_MODES) {
    assert.equal(updateSettingsSchema.safeParse({ payQrMode }).success, true, payQrMode);
  }
  for (const payQrValidMinutes of [0, 5, 60, 1440]) {
    assert.equal(updateSettingsSchema.safeParse({ payQrValidMinutes }).success, true, String(payQrValidMinutes));
  }
});

test("updateSettingsSchema still enforces the pay QR rules on the field it IS given", () => {
  assert.equal(updateSettingsSchema.safeParse({ payQrMode: "sometimes" }).success, false);
  assert.equal(updateSettingsSchema.safeParse({ payQrValidMinutes: 4 }).success, false);
  assert.equal(updateSettingsSchema.safeParse({ payQrValidMinutes: 1441 }).success, false);
  assert.equal(updateSettingsSchema.safeParse({ payQrValidMinutes: Number.NaN }).success, false);
});

// ── tokens + the daily restart time (print customization S6) ─────────────────
// All three are OPTIONAL (older documents have none; printConfigOf supplies the defaults) with their ranges on the
// FIELD, so the full settingsSchema and the PUT partial both keep working.

const TOKEN_FIELDS = ["tokenEnabled", "tokenNumberStart", "numberResetMinutes"] as const;

test("settingsSchema: tokenEnabled / tokenNumberStart / numberResetMinutes are optional (absent is valid) and valid values parse", () => {
  const full = validPrintPayload();
  for (const key of TOKEN_FIELDS) assert.equal(key in full, false, `landmark: the base payload carries no ${key}`);
  assert.equal(settingsSchema.safeParse(full).success, true, "a payload without the three fields still parses");
  const r = settingsSchema.safeParse({ ...full, tokenEnabled: true, tokenNumberStart: 101, numberResetMinutes: 240 });
  assert.equal(r.success, true);
  if (r.success) assert.deepEqual([r.data.tokenEnabled, r.data.tokenNumberStart, r.data.numberResetMinutes], [true, 101, 240]);
});

test("settingsSchema: numberResetMinutes is a whole number 0..1439", () => {
  const parse = (numberResetMinutes: unknown) => settingsSchema.safeParse({ ...validPrintPayload(), numberResetMinutes });
  for (const ok of [0, 1, 240, 1439]) assert.equal(parse(ok).success, true, String(ok));
  for (const bad of [-1, 1440, 1.5, "240", null, Number.NaN]) assert.equal(parse(bad).success, false, String(bad));
  const issue = parse(1440);
  assert.ok(!issue.success && issue.error.issues.some((i) => i.path[0] === "numberResetMinutes"), "the issue is on numberResetMinutes");
});

test("settingsSchema: tokenNumberStart has exactly the kotNumberStart bounds", () => {
  const parse = (key: "tokenNumberStart" | "kotNumberStart", v: unknown) => settingsSchema.safeParse({ ...validPrintPayload(), [key]: v }).success;
  for (const v of [PRINT_NUMBER_START_MIN, 101, PRINT_NUMBER_START_MAX, 0, PRINT_NUMBER_START_MIN - 1, PRINT_NUMBER_START_MAX + 1, 1.5, "7", Number.NaN, null]) {
    assert.equal(parse("tokenNumberStart", v), parse("kotNumberStart", v), `token follows kot for ${String(v)}`);
  }
  assert.equal(parse("tokenNumberStart", PRINT_NUMBER_START_MAX), true, "landmark: the top of the range is accepted");
  assert.equal(parse("tokenNumberStart", PRINT_NUMBER_START_MAX + 1), false, "landmark: one past it is refused");
  assert.equal(parse("tokenNumberStart", 0), false);
});

test("settingsSchema: tokenEnabled must be a boolean", () => {
  const parse = (tokenEnabled: unknown) => settingsSchema.safeParse({ ...validPrintPayload(), tokenEnabled }).success;
  assert.equal(parse(true), true);
  assert.equal(parse(false), true);
  for (const bad of ["true", 1, null]) assert.equal(parse(bad), false, String(bad));
});

test("updateSettingsSchema (the PUT partial) accepts each of the three token fields ALONE, and still enforces their ranges", () => {
  assert.equal(updateSettingsSchema.safeParse({ tokenEnabled: true }).success, true);
  assert.equal(updateSettingsSchema.safeParse({ tokenNumberStart: 101 }).success, true);
  assert.equal(updateSettingsSchema.safeParse({ numberResetMinutes: 240 }).success, true);
  assert.equal(updateSettingsSchema.safeParse({ numberResetMinutes: 0 }).success, true, "a 0 (midnight) is a real value, not 'absent'");
  assert.equal(updateSettingsSchema.safeParse({ numberResetMinutes: 1440 }).success, false);
  assert.equal(updateSettingsSchema.safeParse({ tokenNumberStart: 0 }).success, false);
  assert.equal(updateSettingsSchema.safeParse({ tokenEnabled: "yes" }).success, false);
  const kept = updateSettingsSchema.safeParse({ numberResetMinutes: 0 });
  assert.ok(kept.success && kept.data.numberResetMinutes === 0, "the 0 survives parsing");
});

// ── tokenReadyClearMinutes (print customization S8) ──────────────────────────
// How long a Ready token stays on the token list. A scalar SECTION field like numberResetMinutes: optional (absent
// reads as 10 via tokenReadyClearMinutesOf), its range on the FIELD so the PUT partial keeps working.

test("settingsSchema: tokenReadyClearMinutes is optional (absent is valid) and a valid value parses and survives", () => {
  const full = validPrintPayload();
  assert.equal("tokenReadyClearMinutes" in full, false, "landmark: the base payload carries no tokenReadyClearMinutes");
  assert.equal(settingsSchema.safeParse(full).success, true, "a payload without it still parses");
  const r = settingsSchema.safeParse({ ...full, tokenReadyClearMinutes: 25 });
  assert.ok(r.success && r.data.tokenReadyClearMinutes === 25, "the value survives parsing");
  const absent = settingsSchema.safeParse(full);
  assert.ok(absent.success && !("tokenReadyClearMinutes" in absent.data), "absent stays absent (no default injected)");
});

test("settingsSchema: tokenReadyClearMinutes is a whole number 1..120 (0 and 121 refused, 1 and 120 accepted)", () => {
  const parse = (tokenReadyClearMinutes: unknown) => settingsSchema.safeParse({ ...validPrintPayload(), tokenReadyClearMinutes });
  for (const ok of [1, 2, 10, 60, 119, 120]) assert.equal(parse(ok).success, true, String(ok));
  for (const bad of [0, -1, 121, 1.5, "10", "", null, Number.NaN, Infinity, true]) assert.equal(parse(bad).success, false, String(bad));
  const issue = parse(121);
  assert.ok(!issue.success && issue.error.issues.some((i) => i.path[0] === "tokenReadyClearMinutes"), "the issue is on tokenReadyClearMinutes");
  const typed = parse("10");
  assert.ok(!typed.success && typed.error.issues.some((i) => i.path[0] === "tokenReadyClearMinutes" && i.message === "Choose a time"), "a non-number reads 'Choose a time'");
});

test("tokenReadyClearMinutes: the schema's range IS the shared validator's range (no second source of truth)", () => {
  const parse = (v: number) => settingsSchema.safeParse({ ...validPrintPayload(), tokenReadyClearMinutes: v }).success;
  for (const v of [TOKEN_READY_CLEAR_MINUTES_MIN - 1, TOKEN_READY_CLEAR_MINUTES_MIN, 7, TOKEN_READY_CLEAR_MINUTES_MAX, TOKEN_READY_CLEAR_MINUTES_MAX + 1, 1.5, 0]) {
    assert.equal(parse(v), isTokenReadyClearMinutes(v), String(v));
  }
  assert.equal(parse(TOKEN_READY_CLEAR_MINUTES_MAX), true, "landmark: the top is accepted");
  assert.equal(parse(TOKEN_READY_CLEAR_MINUTES_MAX + 1), false, "landmark: one past it is refused");
});

test("updateSettingsSchema (the PUT partial) accepts tokenReadyClearMinutes ALONE and still enforces its range on it", () => {
  assert.equal(updateSettingsSchema.safeParse({ tokenReadyClearMinutes: 20 }).success, true);
  assert.equal(updateSettingsSchema.safeParse({ tokenReadyClearMinutes: 1 }).success, true);
  assert.equal(updateSettingsSchema.safeParse({ tokenReadyClearMinutes: 120 }).success, true);
  assert.equal(updateSettingsSchema.safeParse({ tokenReadyClearMinutes: 0 }).success, false, "0 would hide every Ready token at once");
  assert.equal(updateSettingsSchema.safeParse({ tokenReadyClearMinutes: 121 }).success, false);
  assert.equal(updateSettingsSchema.safeParse({ tokenReadyClearMinutes: 1.5 }).success, false);
  assert.equal(updateSettingsSchema.safeParse({ tokenReadyClearMinutes: "20" }).success, false);
  assert.equal(updateSettingsSchema.safeParse({ tokenReadyClearMinutes: Number.NaN }).success, false);
  const kept = updateSettingsSchema.safeParse({ tokenReadyClearMinutes: 20 });
  assert.ok(kept.success && kept.data.tokenReadyClearMinutes === 20, "the value survives parsing");
  assert.equal(Object.keys(kept.success ? kept.data : {}).length, 1, "a one-field patch parses to exactly one field");
  // alongside the other token fields (the whole tokens section PUT)
  const section = updateSettingsSchema.safeParse({ tokenEnabled: true, tokenNumberStart: 101, numberResetMinutes: 240, tokenReadyClearMinutes: 30 });
  assert.ok(section.success && section.data.tokenReadyClearMinutes === 30, "the tokens section's four fields parse together");
});
