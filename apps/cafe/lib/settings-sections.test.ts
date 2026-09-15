import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { settingsSchema, type SettingsInput } from "@pos/shared/schemas";
import {
  SETTINGS_SECTIONS,
  settingsSectionPath,
  pickSectionValues,
} from "./settings-sections";
import { settingsFormDefaults } from "./settings-form-defaults";

// CB-UI1 S1 — the section constants are the single source of truth every
// settings page/hook routes and splits against. These pins hold the field
// partition complete (no settingsSchema key orphaned or double-owned), the
// curated section list non-empty (memory: a filtered/curated list can
// silently become []), and pickSectionValues immune to prototype-chain leaks.

test("PIN: every settingsSchema field belongs to exactly one SETTINGS_SECTIONS entry", () => {
  const schemaKeys = Object.keys(settingsSchema.shape).sort();
  const sectionKeys = SETTINGS_SECTIONS.flatMap((s) => s.fields);
  const sectionKeysSorted = [...sectionKeys].sort();

  assert.deepEqual(
    sectionKeysSorted,
    schemaKeys,
    "the union of every section's fields must equal settingsSchema's keys exactly",
  );
  assert.equal(
    new Set(sectionKeys).size,
    sectionKeys.length,
    "no field may be claimed by more than one section (would double-submit / double-own validation)",
  );
});

test("PIN: SETTINGS_SECTIONS is non-empty and every slug is unique", () => {
  assert.ok(SETTINGS_SECTIONS.length > 0, "the curated section list must not be empty");
  const slugs = SETTINGS_SECTIONS.map((s) => s.slug);
  assert.equal(new Set(slugs).size, slugs.length, "slugs must be unique");
});

test("PIN: settingsSectionPath builds /settings/<slug>", () => {
  assert.equal(settingsSectionPath("printing"), "/settings/printing");
  assert.equal(settingsSectionPath("business"), "/settings/business");
});

test("PIN: pickSectionValues returns ONLY the section's own keys and ignores an inherited prototype key", () => {
  const businessSection = SETTINGS_SECTIONS.find((s) => s.slug === "business");
  assert.ok(businessSection, "business section must exist");

  // A field list that (hypothetically) named an inherited key must not leak
  // it into the picked object — Object.hasOwn must fence this, not `in`.
  const forgedFields = [...businessSection!.fields, "constructor"] as readonly (keyof SettingsInput)[];
  const forgedSection = { ...businessSection!, fields: forgedFields };

  const values = { restaurantName: "Test", logo: "r2:x" } as unknown as SettingsInput;
  const picked = pickSectionValues(values, forgedSection);

  assert.equal(Object.hasOwn(picked, "constructor"), false, "must not pick up the inherited constructor key");
  assert.deepEqual(Object.keys(picked).sort(), ["logo", "restaurantName"]);
});

test("PIN: pickSectionValues omits a key absent from the source values object", () => {
  const taxesSection = SETTINGS_SECTIONS.find((s) => s.slug === "taxes");
  assert.ok(taxesSection, "taxes section must exist");
  const values = { gstEnabled: true } as unknown as SettingsInput;
  const picked = pickSectionValues(values, taxesSection!);
  assert.deepEqual(Object.keys(picked), ["gstEnabled"]);
});

// CB-5A S4 — loyaltyRules moved the 7 CB-4 flat fields off qr-ordering onto a
// NEW "loyalty" section, on the theory that loyaltyRules and those flat
// fields describe the same stamp-card rule (the flat fields are its legacy
// form) and so must share exactly one owning section — otherwise two pages
// could each save half of one rule set, and since loyaltyRules is a nested
// subdoc a page that only knew the flat half would clobber the ladder every
// save (see settings-sections.ts's own comment on the "loyalty" entry).

const CB4_FLAT_LOYALTY_FIELDS = [
  "dinerAccountsEnabled",
  "loyaltyEnabled",
  "loyaltyStampsPerReward",
  "loyaltyMinBill",
  "loyaltyRewardKind",
  "loyaltyRewardValue",
  "loyaltyRewardItem",
] as const;

test("PIN: exactly one section claims loyaltyRules", () => {
  const owners = SETTINGS_SECTIONS.filter((s) => s.fields.includes("loyaltyRules"));
  assert.equal(owners.length, 1, "loyaltyRules must belong to exactly one section");
  assert.equal(owners[0]!.slug, "loyalty");
});

test("PIN: the loyaltyRules-owning section also owns all 7 CB-4 flat loyalty keys", () => {
  const loyaltySection = SETTINGS_SECTIONS.find((s) => s.fields.includes("loyaltyRules"));
  assert.ok(loyaltySection, "a section claiming loyaltyRules must exist");
  for (const field of CB4_FLAT_LOYALTY_FIELDS) {
    assert.ok(
      loyaltySection!.fields.includes(field),
      `the loyaltyRules-owning section must also own "${field}" (one-section-ownership rule)`,
    );
  }
});

test("PIN: qr-ordering no longer claims any loyalty*/dinerAccountsEnabled key", () => {
  const qrSection = SETTINGS_SECTIONS.find((s) => s.slug === "qr-ordering");
  assert.ok(qrSection, "qr-ordering section must exist");
  for (const field of qrSection!.fields) {
    assert.ok(
      !field.startsWith("loyalty") && field !== "dinerAccountsEnabled",
      `qr-ordering must not claim "${field}" — it moved to the loyalty section`,
    );
  }
});

// THE ANTI-CLOBBER PIN: a Settings doc with NO loyaltyRules stored must still
// yield a COMPLETE loyaltyRules object (all 4 container keys) once run
// through settingsFormDefaults + pickSectionValues — this is what proves a
// Save from the loyalty page can never PUT a partial nested object and
// clobber a sibling sub-key.
// Re-baselined for CB-5C's `cardSize` (the stamp card's box count), then
// again for CB-5D (owner, 2026-09-15): `levels` and `membership` are REMOVED
// from loyaltyRulesSchema — no client used either, and the owner clears the
// stored data himself — so the container drops from 6 keys to 4 and the
// `membership` sub-key check is gone entirely. Kept as an EXACT key set,
// never a subset check: a key missing from the form defaults is exactly the
// clobber this pin exists to catch.
test("PIN: pickSectionValues on the loyalty section always returns a COMPLETE loyaltyRules object", () => {
  const loyaltySection = SETTINGS_SECTIONS.find((s) => s.fields.includes("loyaltyRules"));
  assert.ok(loyaltySection, "a section claiming loyaltyRules must exist");

  const settingsWithNoLoyaltyRules = {
    _id: "settings-1",
    restaurantName: "Test Cafe",
    tagline: "",
    mobile: "",
    address: "",
    receiptHeader: "",
    receiptFooter: "",
    gstEnabled: false,
    gstNumber: "",
    gstRate: 0,
    gstMode: "exclusive",
    logo: "",
    fssai: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    // loyaltyRules deliberately absent — the exact case the anti-clobber pin exists for.
  } as unknown as Parameters<typeof settingsFormDefaults>[0];

  const values = settingsFormDefaults(settingsWithNoLoyaltyRules);
  const picked = pickSectionValues(values, loyaltySection!);

  assert.ok(Object.hasOwn(picked, "loyaltyRules"), "picked values must carry loyaltyRules");
  const loyaltyRules = picked.loyaltyRules as NonNullable<typeof picked.loyaltyRules>;
  assert.deepEqual(
    Object.keys(loyaltyRules).sort(),
    ["cardSize", "milestones", "unitLabel", "v"],
    "loyaltyRules must carry all 4 container keys",
  );
});

// FIX B — the ladder is now the SINGLE editor of the reward: LoyaltyCard.tsx
// must no longer register the 4 superseded controls as independently
// editable, while the 3 still-authoritative controls and the ladder editor
// remain reachable. Vision guard: pair the 4 absence asserts with positive
// landmarks so a stripped/renamed file can't make this pass vacuously.
test("PIN: the loyalty settings surface no longer registers the 4 superseded controls, and still shows the 3 kept controls plus the ladder editor", () => {
  const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
  const cardSrc = readFileSync(
    path.join(REPO_ROOT, "apps/cafe/components/settings/LoyaltyCard.tsx"),
    "utf8",
  );
  const pageSrc = readFileSync(
    path.join(REPO_ROOT, "apps/cafe/app/(dashboard)/settings/loyalty/page.tsx"),
    "utf8",
  );

  // Negative: LoyaltyCard.tsx must not register() any of the 4 superseded
  // fields as an editable control any more.
  for (const field of ["loyaltyStampsPerReward", "loyaltyRewardKind", "loyaltyRewardValue", "loyaltyRewardItem"]) {
    assert.ok(
      !cardSrc.includes(`"${field}"`),
      `LoyaltyCard.tsx must no longer register/watch "${field}" as an editable control`,
    );
  }

  // Positive landmarks: the 3 kept controls are still live in LoyaltyCard.tsx...
  for (const field of ["dinerAccountsEnabled", "loyaltyEnabled", "loyaltyMinBill"]) {
    assert.ok(cardSrc.includes(`"${field}"`), `LoyaltyCard.tsx must still register/watch "${field}"`);
  }
  // ...and the ladder editor is still reachable from the loyalty page.
  // CB-5C re-pointed this needle: the ladder is now edited ON the stamp card
  // (LoyaltyStampGrid — numbered boxes, tap one to set its reward) instead of
  // as a list of rows. The PIN's intent is unchanged and deliberately NOT
  // loosened to a generic regex — it still names one exact component, so
  // dropping the editor from this page fails here just as before.
  assert.match(pageSrc, /LoyaltyStampGrid/, "the loyalty page must still render the ladder editor (the stamp card)");
  assert.match(pageSrc, /LoyaltyCard/, "the loyalty page must still render the kept-controls card");
});

// Source pin: settings-form-defaults.ts must byte-carry the loyaltyRulesFormDefaults
// landmark (positive landmark — proves the seed line actually exists, not just
// that some comment text survives, memory: negative pins need vision guards).
test("PIN: settings-form-defaults.ts byte-carries the loyaltyRulesFormDefaults landmark", () => {
  const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
  const src = readFileSync(
    path.join(REPO_ROOT, "apps/cafe/lib/settings-form-defaults.ts"),
    "utf8",
  );
  assert.match(src, /loyaltyRulesFormDefaults/, "must carry the loyaltyRulesFormDefaults landmark");
});

// Source pin (readFileSync over the real file) — settings-form-defaults.ts
// must byte-carry the lean-doc comment landmarks moved verbatim off
// SettingsForm.tsx, plus the positive landmark that the move actually
// happened (a stripped/renamed comment would make this pin vacuous had it
// only checked absence — memory: negative pins need vision guards).
test("PIN: settings-form-defaults.ts byte-carries the moved lean-doc comment landmarks", () => {
  const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
  const src = readFileSync(
    path.join(REPO_ROOT, "apps/cafe/lib/settings-form-defaults.ts"),
    "utf8",
  );

  assert.match(src, /printConfigOf\(\)/, "must carry the printConfigOf() lean-doc landmark");
  assert.match(src, /appearanceFormDefaults/, "must carry the appearanceFormDefaults landmark");
  assert.match(src, /pre-CR2 Settings/, "must carry the pre-CR2 Settings lean-doc landmark");
  // Positive landmark: the function actually exists and seeds productLogo
  // the same defensive way as before — proves the move happened, not just
  // that some comment text survived somewhere.
  assert.match(
    src,
    /productLogo: settings\.productLogo \?\? "",/,
    "must carry the verbatim productLogo default line",
  );
  assert.match(
    src,
    /export function settingsFormDefaults\(settings: Settings\): SettingsInput/,
    "must export settingsFormDefaults(settings: Settings): SettingsInput",
  );
});
