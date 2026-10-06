import { test } from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";

import { settingsUpdateOf } from "@/lib/settings";
import { classicBillTemplate, classicKotTemplate } from "@/lib/print-template-legacy";
import type { UpdateSettingsInput } from "@/schemas";
import { tokenFixture } from "@pos/shared/print-template-fixtures";

// Print customization S2: settingsUpdateOf builds PUT /api/settings' update document. A null template cannot be a
// $set (a stored null would be one more shape for every reader, and undefined never survives JSON), so it becomes
// $unset; every other body is returned untouched. The DB-truth of this is verify:print-template:live.

const bodyOf = (o: Record<string, unknown>): UpdateSettingsInput => o as UpdateSettingsInput;
const BILL = classicBillTemplate(null);
const KOT = classicKotTemplate(null);

test("settingsUpdateOf: a body with no null template is returned as the SAME object (every other save is untouched)", () => {
  const plain = bodyOf({ billShowLogo: true, restaurantName: "Cafe" });
  assert.equal(settingsUpdateOf(plain), plain);
  const withObj = bodyOf({ billTemplate: BILL });
  assert.equal(settingsUpdateOf(withObj), withObj, "a template object is a plain $set field");
  const empty = bodyOf({});
  assert.equal(settingsUpdateOf(empty), empty);
});

test("settingsUpdateOf: a null template becomes $unset, and the rest of the body stays in $set", () => {
  assert.deepEqual(settingsUpdateOf(bodyOf({ billTemplate: null })), { $unset: { billTemplate: 1 } });
  assert.deepEqual(settingsUpdateOf(bodyOf({ kotTemplate: null })), { $unset: { kotTemplate: 1 } });
  assert.deepEqual(settingsUpdateOf(bodyOf({ billTemplate: null, billShowLogo: true })), {
    $set: { billShowLogo: true },
    $unset: { billTemplate: 1 },
  });
  assert.deepEqual(settingsUpdateOf(bodyOf({ billTemplate: null, kotTemplate: null })), {
    $unset: { billTemplate: 1, kotTemplate: 1 },
  });
  assert.deepEqual(settingsUpdateOf(bodyOf({ kotTemplate: KOT, billTemplate: null })), {
    $set: { kotTemplate: KOT },
    $unset: { billTemplate: 1 },
  });
});

test("settingsUpdateOf: does not mutate the parsed body", () => {
  const body = bodyOf({ billTemplate: null, billShowLogo: true });
  settingsUpdateOf(body);
  assert.deepEqual(body, { billTemplate: null, billShowLogo: true });
});

// ── S7: tokenTemplate is the third PUT-only slip template ─────────────────────

const TOKEN = tokenFixture() as unknown as Record<string, unknown>;

test("settingsUpdateOf: a token template object stays a plain $set field (the SAME body object back), and null becomes $unset", () => {
  const withObj = bodyOf({ tokenTemplate: TOKEN });
  assert.equal(settingsUpdateOf(withObj), withObj, "landmark: an object is never rewritten");
  assert.deepEqual(settingsUpdateOf(bodyOf({ tokenTemplate: null })), { $unset: { tokenTemplate: 1 } });
  assert.deepEqual(settingsUpdateOf(bodyOf({ tokenTemplate: null, tokenEnabled: true })), {
    $set: { tokenEnabled: true },
    $unset: { tokenTemplate: 1 },
  });
});

test("settingsUpdateOf: all three templates cleared together unset all three; a mixed body splits per key", () => {
  assert.deepEqual(settingsUpdateOf(bodyOf({ billTemplate: null, kotTemplate: null, tokenTemplate: null })), {
    $unset: { billTemplate: 1, kotTemplate: 1, tokenTemplate: 1 },
  });
  assert.deepEqual(settingsUpdateOf(bodyOf({ billTemplate: BILL, tokenTemplate: null })), {
    $set: { billTemplate: BILL },
    $unset: { tokenTemplate: 1 },
  });
});

test("settingsUpdateOf: a null tokenTemplate never reaches $set (a stored null would be one more shape for every reader)", () => {
  const update = settingsUpdateOf(bodyOf({ tokenTemplate: null, billShowLogo: true })) as { $set?: Record<string, unknown> };
  assert.deepEqual(update.$set, { billShowLogo: true }, "landmark: the rest of the body stays in $set");
  assert.equal("tokenTemplate" in (update.$set ?? {}), false);
});

test("SOURCE PIN: SLIP_TEMPLATE_KEYS in lib/settings.ts lists tokenTemplate beside billTemplate and kotTemplate", () => {
  const src = readFileSync(path.join(process.cwd(), "lib/settings.ts"), "utf8");
  assert.ok(src.includes('const SLIP_TEMPLATE_KEYS = ["billTemplate", "kotTemplate", "tokenTemplate"] as const;'));
});
