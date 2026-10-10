import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { PRESET_IDS } from "@pos/shared/appearance";
import { APPEARANCE_PRESETS } from "@pos/shared/appearance-presets";
import { checkAccent } from "@pos/shared/appearance-contrast";
import { stripComments } from "@/lib/source-pin-utils";
import { ACCENT_SWATCHES, normalizeAccentHex } from "@/components/settings/accent-swatches";

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

// ── s89g: the picker is our own popover, not the browser's colour popup ─────

test("PIN: a colour reaches the form through onCommit exactly once per pick - one commit site in pick(), no onCommit in a change/keystroke handler", () => {
  const code = stripComments(src);
  assert.match(code, /const pick = \(hex: string\) => \{\s*setLive\(hex\);\s*onCommit\(hex\);\s*setOpen\(false\);\s*\};/, "landmark: pick() is the one commit");
  assert.equal((code.match(/onCommit\(/g) ?? []).length, 1, "onCommit is called from exactly one place");
  assert.match(code, /onClick=\{\(\) => pick\(hex\)\}/, "a swatch tap is one pick");
  assert.match(code, /pick\(hex\);\s*\};/, "a valid hex applied is one pick");
  const onChange = code.match(/onChange=\{\(e\) => \{[\s\S]*?\}\}/);
  assert.ok(onChange, "landmark: the hex field's onChange is present");
  assert.ok(!/onCommit|pick\(/.test(onChange[0]), "typing only edits the local draft - never a commit per keystroke");
});

test("PIN: the browser's own colour input is gone, and a bad hex is refused (error shown, nothing committed)", () => {
  const code = stripComments(src);
  assert.match(code, /<Popover open=\{open\} onOpenChange=\{handleOpenChange\}>/, "landmark: the popover is here");
  assert.ok(!/type=\{?"color"\}?/.test(code), "no native colour input");
  assert.ok(!/addEventListener/.test(code), "no hand-wired change listener any more");
  assert.match(code, /const hex = normalizeAccentHex\(draft\);\s*if \(hex === null\) \{\s*setHexInvalid\(true\);\s*return;\s*\}/, "an invalid hex sets the error and returns before pick()");
  assert.match(code, /Use this colour/, "the apply button says what it does");
  assert.match(code, /role="alert"/, "the hex error is announced");
});

test("normalizeAccentHex accepts #RRGGBB in any case, with or without #, and returns the lowercase stored form", () => {
  assert.equal(normalizeAccentHex("#2563EB"), "#2563eb");
  assert.equal(normalizeAccentHex("2563eb"), "#2563eb");
  assert.equal(normalizeAccentHex("  #AbCdEf  "), "#abcdef");
  for (const bad of ["", "#", "#fff", "#12345", "#1234567", "#gggggg", "blue", "##123456", "#12 456"]) {
    assert.equal(normalizeAccentHex(bad), null, `${JSON.stringify(bad)} must be refused`);
  }
});

test("ACCENT_SWATCHES: 16 unique lowercase colours, each named, and EVERY one passes checkAccent on EVERY preset (a swatch must never open with a red error)", () => {
  assert.equal(ACCENT_SWATCHES.length, 16, "landmark: the curated list is not empty or filtered down");
  assert.equal(new Set(ACCENT_SWATCHES.map((s) => s.hex)).size, 16, "no duplicate colour");
  assert.equal(new Set(ACCENT_SWATCHES.map((s) => s.name)).size, 16, "no duplicate name");
  for (const { name, hex } of ACCENT_SWATCHES) {
    assert.ok(name.length > 0, "named");
    assert.match(hex, /^#[0-9a-f]{6}$/, `${name}: lowercase #rrggbb`);
    for (const presetId of PRESET_IDS) {
      const result = checkAccent(hex, presetId);
      assert.equal(result.ok, true, `${name} ${hex} on ${presetId}: ${result.ok ? "" : result.failing}`);
    }
  }
});
