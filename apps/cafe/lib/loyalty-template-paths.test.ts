import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";

// CB-5A FIX ROUND — pins for the "apply a template desyncs the visible rows
// from the saved value" bug. CONFIRMED against react-hook-form 7.71.2's own
// source: `_setValue` only calls `_subjects.array.next(...)` (which is what
// refreshes a `useFieldArray`'s `fields`) when the touched name is itself a
// registered array name (`_names.array.has(name)`). Setting the GRANDPARENT
// `loyaltyRules` takes the `setFieldValues` branch instead, which notifies
// `_subjects.state` but never `_subjects.array` — so `LoyaltyStampGrid`'s own
// `fields` state never refreshes, while the underlying value tree already
// holds the new preset. The screen and the saved value then disagree in BOTH
// directions (1 row -> 3 rows and 3 rows -> 1 row) until something remounts
// the array.
//
// STRUCTURAL, not behavioural: this repo's node:test setup has no DOM/React
// render harness (no jsdom/testing-library import anywhere in these files),
// so a live `useFieldArray` re-render cannot be driven here. These pins
// instead assert on the RAW SOURCE (after stripping comments, so a fix
// described only in a comment can never satisfy them): the template card
// must drive the milestones array through its own `replace(` (the only RHF
// call that notifies `_subjects.array`), and must NOT be the sole writer of
// the ladder via a grandparent `setValue("loyaltyRules"`. Each negative
// assertion is paired with a positive landmark (repo lesson: a negative pin
// needs a vision guard) proving the presets are still actually applied and
// stay COMPLETE objects — the only fence against Mongoose's
// whole-nested-path $set clobber (loyaltyRulesSchema requires all 4
// container keys once `loyaltyRules` is present at all).
//
// CB-5D (owner, 2026-09-15): `levels` and `membership` are REMOVED from
// loyaltyRulesSchema — no client used either. The `levels`-array wiring pins
// (LoyaltyTemplateCard's second useFieldArray, LoyaltyAdvancedFields' own
// registration) are removed with them; LoyaltyAdvancedFields.tsx no longer
// exists on disk at all (an earlier, unrelated consolidation), which is why
// its pin is dropped rather than re-pointed.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const TEMPLATE_CARD_PATH = "apps/cafe/components/settings/LoyaltyTemplateCard.tsx";
// CB-5C — the milestones array moved from the list editor (LoyaltyMilestonesFields,
// deleted) to the stamp card, which registers the SAME array name. The pin below
// is re-pointed, not loosened: it still names one exact file and one exact name.
const MILESTONES_PATH = "apps/cafe/components/settings/LoyaltyStampGrid.tsx";

test("PIN: LoyaltyTemplateCard no longer sets the whole loyaltyRules grandparent as its sole write", () => {
  const src = readSrc(TEMPLATE_CARD_PATH);
  assert.doesNotMatch(
    src,
    /setValue\(\s*["']loyaltyRules["']\s*,/,
    'must not call setValue("loyaltyRules", ...) — that path never notifies useFieldArray\'s _subjects.array, ' +
      "so the milestone/level rows on screen would desync from the saved value",
  );
});

test("PIN: LoyaltyTemplateCard drives the milestones array through replace()", () => {
  const src = readSrc(TEMPLATE_CARD_PATH);
  // Positive landmark first: the fix must still actually reach the array by
  // NAME (vision guard for the negative assertion below).
  assert.match(src, /["']loyaltyRules\.milestones["']/, "must reference the milestones array by its registered name");

  assert.match(
    src,
    /useFieldArray\(\{[^}]*name:\s*["']loyaltyRules\.milestones["'][^}]*\}\)/,
    "must call useFieldArray for loyaltyRules.milestones to obtain a working replace()",
  );
  assert.match(
    src,
    /replace:\s*\w+\s*\}\s*=\s*useFieldArray/,
    "must destructure replace (renamed or not) from useFieldArray — the only RHF write that notifies " +
      "_subjects.array for a registered array name",
  );
});

test("PIN: LoyaltyTemplateCard still applies every preset field and keeps loyaltyRules complete", () => {
  const src = readSrc(TEMPLATE_CARD_PATH);
  // Positive landmark: the scalar part of a preset that is NOT covered by
  // the milestones array (unitLabel) must still reach the form, or a
  // template application would silently drop it.
  assert.match(src, /unitLabel/, "must still carry the preset's unitLabel into the form");
});

// LoyaltyStampGrid doesn't need to CALL replace() itself — the template card
// gets its own working replace() by calling useFieldArray with the SAME
// registered name (RHF keys field-array registration by control+name, not by
// call site: two useFieldArray calls on the same name independently
// subscribe to _subjects.array and each return a functioning replace()).
// What matters here is that the name this component registers is exactly
// what the template card must also target.
test("PIN: LoyaltyStampGrid still registers the milestones array under its exact name", () => {
  const src = readSrc(MILESTONES_PATH);
  assert.match(
    src,
    /useFieldArray\(\{[^}]*name:\s*["']loyaltyRules\.milestones["']/,
    "must still register the milestones array under its exact name — the template card's own " +
      "useFieldArray targets this same name to get a working replace()",
  );
});
