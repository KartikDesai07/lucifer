import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { PRESET_IDS } from "@pos/shared/appearance";
import { APPEARANCE_PRESETS } from "@pos/shared/appearance-presets";
import { checkAccent } from "@pos/shared/appearance-contrast";

// CR2.4 post-review fix (accent-contrast-error-shown-when-override-unset) —
// AppearanceAccentInput's checkAccent feedback must be suppressed ONLY in the
// untouched-default state (accentOverride==="" and the picker still shows the
// preset's own accent), never on a genuinely committed failing value. No
// React render harness exists in this repo (see lib/appearance-paths.test.ts's
// header note), so — same convention as that file — this is a source-read
// pin of the exact guard shape, backed by a live computation proving WHY the
// guard is necessary: every preset's own accent fails checkAccent against
// itself, so an unguarded render would show a permanent false error on a
// fresh install.

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const SRC_PATH = "apps/cafe/components/settings/AppearanceAccentInput.tsx";
const src = readFileSync(path.join(REPO_ROOT, SRC_PATH), "utf8");

test("PIN: AppearanceAccentInput suppresses checkAccent feedback ONLY when value===\"\" AND live still equals presetAccent — never on value===\"\" alone (that would also kill A17's mid-drag live feedback)", () => {
  assert.match(
    src,
    /const untouchedDefault = value === "" && live === presetAccent;/,
    "the untouched-default guard must check BOTH value==='' and live===presetAccent — a plain value==='' guard would also suppress feedback mid-drag",
  );
  assert.match(
    src,
    /const feedback = untouchedDefault \? \{ ok: true as const \} : checkAccent\(live, presetId\);/,
    "feedback must be forced ok ONLY in the untouched-default state; every other state re-runs the real checkAccent(live, presetId)",
  );
});

test("Why the guard is necessary: every preset's own light.primary FAILS checkAccent against that same preset — an unguarded render would show a permanent, false destructive error on every fresh install", () => {
  for (const presetId of PRESET_IDS) {
    const presetAccent = APPEARANCE_PRESETS[presetId].light.primary;
    const result = checkAccent(presetAccent, presetId);
    assert.equal(result.ok, false, `${presetId}: expected its own light.primary to fail checkAccent (that's exactly why untouchedDefault must suppress the message)`);
  }
});

test("A genuinely failing COMMITTED value (value !== \"\") is never mistaken for the untouched-default state, by construction — the guard's first conjunct (value===\"\") already excludes it", () => {
  // Structural check on the guard source, not a render: `untouchedDefault`
  // requires value==="" as its FIRST conjunct, so any committed non-empty
  // value can never satisfy it regardless of what `live` holds.
  const guardMatch = src.match(/const untouchedDefault = (value === "" && live === presetAccent);/);
  assert.ok(guardMatch, "untouchedDefault guard must be present");
  assert.match(guardMatch![1], /^value === ""/, "value===\"\" must be the guard's leading conjunct");
});
