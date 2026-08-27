import { test } from "node:test";
import assert from "node:assert/strict";

import { PRESET_IDS } from "@pos/shared/appearance";
import { checkAccent } from "@pos/shared/appearance-contrast";
import { accentSuggestionsFor } from "./appearance-fields-utils";

// CR2.4 post-review fix — the accent swatch row (§22.1 S5/§5) must never
// silently go empty: every preset's own light.primary FAILS checkAccent's
// both-halves rule, so a naive "derive suggestions from the presets" filter
// (the pre-fix implementation) returned [] for all six presets, on every
// install. accentSuggestionsFor now draws from packages/shared's curated
// SUGGESTED_ACCENTS instead — this pin fences that guarantee going forward.

const MIN_SUGGESTIONS = 3;

test("accentSuggestionsFor: every preset returns at least 3 suggestions, and every one clears checkAccent for that preset", () => {
  for (const presetId of PRESET_IDS) {
    const suggestions = accentSuggestionsFor(presetId);
    assert.ok(
      suggestions.length >= MIN_SUGGESTIONS,
      `${presetId}: expected at least ${MIN_SUGGESTIONS} suggestions, got ${suggestions.length}`,
    );
    for (const hex of suggestions) {
      const result = checkAccent(hex, presetId);
      assert.ok(result.ok, `${presetId}: suggested accent ${hex} must pass checkAccent`);
    }
  }
});
