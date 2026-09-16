import { test } from "node:test";
import assert from "node:assert/strict";

import { settingsSchema, updateSettingsSchema, loyaltyRulesSchema } from "./settings.schema";
import { LOYALTY_RULES_SCHEMA_VERSION, LOYALTY_MILESTONES_MAX } from "../loyalty-rules";

// CB-5A S1 — the loyaltyRules Zod contract. Mirrors settings.schema.test.ts's
// own style: a full valid fixture, each test overriding exactly the field it
// exercises.
//
// CB-5D (owner, 2026-09-15): `levels` and `membership` are REMOVED from
// loyaltyRulesSchema — no client used either, and the owner clears any
// stored data himself.

function validLoyaltyRules() {
  return {
    v: LOYALTY_RULES_SCHEMA_VERSION,
    unitLabel: "stamp",
    milestones: [] as unknown[],
  };
}

// A full valid print payload, same shape as settings.schema.test.ts's own
// validPrintPayload — duplicated minimally here rather than imported, since
// that helper is not exported from settings.schema.test.ts.
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
    billNumberStart: 1,
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
    kotNumberStart: 1,
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

// ── loyaltyRulesSchema in isolation ──────────────────────────────────────────

test("loyaltyRulesSchema accepts a fully-populated valid payload with milestones: []", () => {
  const r = loyaltyRulesSchema.safeParse(validLoyaltyRules());
  assert.equal(r.success, true);
});

test("loyaltyRulesSchema rejects v !== LOYALTY_RULES_SCHEMA_VERSION (a stale admin bundle must 400)", () => {
  const r = loyaltyRulesSchema.safeParse({ ...validLoyaltyRules(), v: LOYALTY_RULES_SCHEMA_VERSION + 1 });
  assert.equal(r.success, false);
});

test("loyaltyRulesSchema rejects a payload missing `milestones` — every key required once present", () => {
  const { milestones: _drop, ...withoutMilestones } = validLoyaltyRules();
  const r = loyaltyRulesSchema.safeParse(withoutMilestones);
  assert.equal(r.success, false);
});

// ── milestones ────────────────────────────────────────────────────────────────

test("loyaltyRulesSchema rejects duplicate milestone `at`, at path [index,'at']", () => {
  const r = loyaltyRulesSchema.safeParse({
    ...validLoyaltyRules(),
    milestones: [
      { at: 5, kind: "flat", value: 50, item: "" },
      { at: 5, kind: "flat", value: 20, item: "" },
    ],
  });
  assert.equal(r.success, false);
  if (!r.success) {
    const issue = r.error.issues.find((i) => i.path.join(".") === "milestones.1.at");
    assert.ok(issue, "duplicate must land on milestones[1].at");
    assert.equal(issue!.message, "Two rewards cannot sit at the same number of stamps");
  }
});

test("loyaltyRulesSchema rejects kind:'item' with item:''", () => {
  const r = loyaltyRulesSchema.safeParse({
    ...validLoyaltyRules(),
    milestones: [{ at: 5, kind: "item", value: 0, item: "" }],
  });
  assert.equal(r.success, false);
});

// CB-5B D8 (owner, 2026-09-13) INVERTED this pin. It used to read "accepts
// kind:'item' with a non-empty item" — a typed NAME was the whole contract.
// The free dish is now a PRODUCT REFERENCE picked from the menu, because D5's
// reversal puts that dish on the bill AND the KOT at its real price, and a
// name cannot be resolved to a Product row once it is renamed, deleted, or
// duplicated. The name survives only as a display snapshot.
test("D8: loyaltyRulesSchema REJECTS kind:'item' with a name but no product ref", () => {
  const r = loyaltyRulesSchema.safeParse({
    ...validLoyaltyRules(),
    milestones: [{ at: 5, kind: "item", value: 0, item: "Free coffee" }],
  });
  assert.equal(r.success, false);
  if (!r.success) {
    const issue = r.error.issues.find((i) => i.path.join(".") === "milestones.0.itemProductId");
    assert.ok(issue, "the error must land on the PICKER field, not on the name");
    assert.equal(issue!.message, "Pick the free item from the menu");
  }
});

test("D8: loyaltyRulesSchema accepts kind:'item' with a product ref", () => {
  const r = loyaltyRulesSchema.safeParse({
    ...validLoyaltyRules(),
    milestones: [
      { at: 5, kind: "item", value: 0, item: "Free coffee", itemProductId: "60a1b2c3d4e5f60718293a4b" },
    ],
  });
  assert.equal(r.success, true);
});

test("D8: a malformed product ref is refused at the settings boundary", () => {
  // Not a 24-hex ObjectId. Refusing here beats failing later at resolve time
  // on a real bill, in front of a customer.
  const r = loyaltyRulesSchema.safeParse({
    ...validLoyaltyRules(),
    milestones: [{ at: 5, kind: "item", value: 0, item: "Free coffee", itemProductId: "not-an-id" }],
  });
  assert.equal(r.success, false);
});

test("D11: qty is optional, bounded, and whole", () => {
  const base = validLoyaltyRules();
  const row = { at: 5, kind: "item", value: 0, item: "Free coffee", itemProductId: "60a1b2c3d4e5f60718293a4b" };
  // Absent = the pre-D11 shape, still valid (every live row is like this).
  assert.equal(loyaltyRulesSchema.safeParse({ ...base, milestones: [row] }).success, true);
  assert.equal(loyaltyRulesSchema.safeParse({ ...base, milestones: [{ ...row, qty: 2 }] }).success, true);
  // Zero dishes is not a reward; a fraction is not a count; the cap holds.
  assert.equal(loyaltyRulesSchema.safeParse({ ...base, milestones: [{ ...row, qty: 0 }] }).success, false);
  assert.equal(loyaltyRulesSchema.safeParse({ ...base, milestones: [{ ...row, qty: 1.5 }] }).success, false);
  assert.equal(loyaltyRulesSchema.safeParse({ ...base, milestones: [{ ...row, qty: 99 }] }).success, false);
});

test("loyaltyRulesSchema rejects kind:'percent' value 101", () => {
  const r = loyaltyRulesSchema.safeParse({
    ...validLoyaltyRules(),
    milestones: [{ at: 5, kind: "percent", value: 101, item: "" }],
  });
  assert.equal(r.success, false);
});

test("loyaltyRulesSchema accepts kind:'percent' value 100", () => {
  const r = loyaltyRulesSchema.safeParse({
    ...validLoyaltyRules(),
    milestones: [{ at: 5, kind: "percent", value: 100, item: "" }],
  });
  assert.equal(r.success, true);
});

test("loyaltyRulesSchema rejects a non-item kind with value 0", () => {
  const r = loyaltyRulesSchema.safeParse({
    ...validLoyaltyRules(),
    milestones: [{ at: 5, kind: "flat", value: 0, item: "" }],
  });
  assert.equal(r.success, false);
});

test("loyaltyRulesSchema accepts a milestone with optional minBill present", () => {
  const r = loyaltyRulesSchema.safeParse({
    ...validLoyaltyRules(),
    milestones: [{ at: 5, kind: "flat", value: 50, item: "", minBill: 100 }],
  });
  assert.equal(r.success, true);
});

test("loyaltyRulesSchema accepts a milestone with no minBill key at all", () => {
  const r = loyaltyRulesSchema.safeParse({
    ...validLoyaltyRules(),
    milestones: [{ at: 5, kind: "flat", value: 50, item: "" }],
  });
  assert.equal(r.success, true);
});

test("loyaltyRulesSchema rejects a milestones array over LOYALTY_MILESTONES_MAX", () => {
  const milestones = Array.from({ length: LOYALTY_MILESTONES_MAX + 1 }, (_, i) => ({
    at: i + 1,
    kind: "flat" as const,
    value: 10,
    item: "",
  }));
  const r = loyaltyRulesSchema.safeParse({ ...validLoyaltyRules(), milestones });
  assert.equal(r.success, false);
});

test("loyaltyRulesSchema accepts exactly LOYALTY_MILESTONES_MAX milestones", () => {
  const milestones = Array.from({ length: LOYALTY_MILESTONES_MAX }, (_, i) => ({
    at: i + 1,
    kind: "flat" as const,
    value: 10,
    item: "",
  }));
  const r = loyaltyRulesSchema.safeParse({ ...validLoyaltyRules(), milestones });
  assert.equal(r.success, true);
});

// ── wired into settingsSchema / updateSettingsSchema ────────────────────────

test("settingsSchema accepts a payload with NO loyaltyRules key at all — fixture safety", () => {
  const r = settingsSchema.safeParse(validPrintPayload());
  assert.equal(r.success, true);
});

test("settingsSchema accepts a payload WITH a valid loyaltyRules block", () => {
  const r = settingsSchema.safeParse({ ...validPrintPayload(), loyaltyRules: validLoyaltyRules() });
  assert.equal(r.success, true);
});

test("settingsSchema rejects a loyaltyRules block missing `milestones`", () => {
  const { milestones: _drop, ...withoutMilestones } = validLoyaltyRules();
  const r = settingsSchema.safeParse({ ...validPrintPayload(), loyaltyRules: withoutMilestones });
  assert.equal(r.success, false);
});

test("updateSettingsSchema accepts an entirely empty patch with loyaltyRules added to the schema", () => {
  assert.equal(updateSettingsSchema.safeParse({}).success, true);
});

test("updateSettingsSchema rejects a PARTIAL loyaltyRules object — every key required once present", () => {
  const r = updateSettingsSchema.safeParse({ loyaltyRules: { v: LOYALTY_RULES_SCHEMA_VERSION, unitLabel: "stamp" } });
  assert.equal(r.success, false);
});

test("updateSettingsSchema (PUT) accepts a patch carrying only a valid loyaltyRules block", () => {
  const r = updateSettingsSchema.safeParse({ loyaltyRules: validLoyaltyRules() });
  assert.equal(r.success, true);
});

test("D8: a NON-item rung may not carry a product reference", () => {
  // Found in review (2026-09-13): RHF keeps hidden field values
  // (shouldUnregister defaults false), so switching a rung from "item" to
  // "flat" left a dead itemProductId behind. Switching back then re-validated
  // against that stale ref with no pick event, so the reference and the shown
  // name could silently diverge. The schema is the single enforcement point.
  const r = loyaltyRulesSchema.safeParse({
    ...validLoyaltyRules(),
    milestones: [
      { at: 5, kind: "flat", value: 50, item: "", itemProductId: "60a1b2c3d4e5f60718293a4b" },
    ],
  });
  assert.equal(r.success, false);
  if (!r.success) {
    const issue = r.error.issues.find((i) => i.path.join(".") === "milestones.0.itemProductId");
    assert.ok(issue, "the error must name the stale field");
  }
});

test("D8: a non-item rung with NO product reference is still valid", () => {
  // The positive twin — the fence must not break the ordinary flat/percent row.
  const r = loyaltyRulesSchema.safeParse({
    ...validLoyaltyRules(),
    milestones: [{ at: 5, kind: "flat", value: 50, item: "" }],
  });
  assert.equal(r.success, true);
});
