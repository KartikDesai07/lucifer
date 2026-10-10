import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { UPI_RULES_MAX } from "@pos/shared/print-qr";
import { settingsSchema as settingsMongooseSchema } from "@/models/Settings";
import { settingsFormDefaults } from "@/lib/settings-form-defaults";
import { SETTINGS_SECTIONS } from "@/lib/settings-sections";
import { BOOTSTRAP_VERSION } from "@/lib/bootstrap-contract";
import type { Settings } from "@/types";

// UPI amount slabs on the settings side: the model declares the path (strict:true would drop an undeclared one), the
// Business section carries it, the form seeds it through the lenient reader, and the payload version moved so an old
// cached blob without slabs is discarded.
const here = path.dirname(fileURLToPath(import.meta.url));
const settingsDoc = (over: object): Settings =>
  ({ restaurantName: "Test Cafe", gstEnabled: false, gstRate: 0, gstMode: "exclusive", ...over }) as unknown as Settings;

test("Settings model: upiRules is a declared array of {upTo, upiId} with no _id and no default (omit-empty)", () => {
  const p = settingsMongooseSchema.path("upiRules") as unknown as {
    defaultValue?: unknown;
    schema?: { path(name: string): unknown; options: { _id?: boolean } };
  };
  assert.ok(p, "upiRules path must exist");
  assert.equal(p.defaultValue, undefined);
  assert.ok(p.schema?.path("upTo") && p.schema?.path("upiId"), "both slab fields are declared");
  assert.equal(p.schema?.options._id, false);
});

test("the Business section carries upiRules next to upiId", () => {
  const business = SETTINGS_SECTIONS.find((s) => s.slug === "business");
  assert.ok(business, "landmark: the Business section exists");
  assert.ok(business.fields.includes("upiId"), "landmark: it owns the UPI ID");
  assert.ok(business.fields.includes("upiRules"));
});

test("the form seeds [] for an older document and sorted, valid slabs for a stored list", () => {
  assert.deepEqual(settingsFormDefaults(settingsDoc({})).upiRules, []);
  const stored = [{ upTo: 2000, upiId: "b.b@ybl" }, { upTo: 500, upiId: "a.a@ybl" }, { upTo: 5, upiId: "bad" }];
  assert.deepEqual(settingsFormDefaults(settingsDoc({ upiRules: stored })).upiRules, [
    { upTo: 500, upiId: "a.a@ybl" },
    { upTo: 2000, upiId: "b.b@ybl" },
  ]);
  assert.equal(UPI_RULES_MAX, 5);
});

test("BOOTSTRAP_VERSION is at least 13 (Settings gained upiRules) and the contract comment says so", () => {
  assert.ok(BOOTSTRAP_VERSION >= 13, `BOOTSTRAP_VERSION is ${BOOTSTRAP_VERSION}`);
  const src = readFileSync(path.join(here, "bootstrap-contract.ts"), "utf8");
  assert.ok(src.includes("`upiRules`"), "the version comment names the new field");
});

test("the slab editor is wired: Business details renders UpiRulesFields, and the print side reads the slab ID", () => {
  const business = readFileSync(path.join(here, "../components/settings/BusinessDetailsFields.tsx"), "utf8");
  assert.ok(business.includes("<UpiRulesFields"), "BusinessDetailsFields renders the slab editor");
  assert.ok(business.indexOf("<UpiRulesFields") > business.indexOf('register("upiId")'), "it sits under the UPI ID field");
  const blocks = readFileSync(path.join(here, "../components/print/slip/generic-blocks.tsx"), "utf8");
  assert.ok(blocks.includes("upiRules: ctx.upiRules") && blocks.includes("upiId: plan.upiId"), "the bill QR passes the slabs and encodes plan.upiId");
});
