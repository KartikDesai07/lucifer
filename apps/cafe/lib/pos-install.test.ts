// CB-1d.2 — DB-free unit pins for the installable-POS manifest contract
// (lib/pos-install.ts, FROZEN for this slice). Pure module, no DOM/fetch:
// every case here is plain function-in/object-out.
import { test } from "node:test";
import assert from "node:assert/strict";

import { APP_NAME } from "@pos/shared/constants";
import {
  MANIFEST_PATH,
  MANIFEST_CONTENT_TYPE,
  MANIFEST_START_URL,
  MANIFEST_SCOPE,
  MANIFEST_ID,
  MANIFEST_DISPLAY,
  MANIFEST_BACKGROUND_COLOR,
  MANIFEST_THEME_COLOR,
  MANIFEST_SHORT_NAME_MAX,
  POS_ICON_DIR,
  POS_ICON_192_PATH,
  POS_ICON_512_PATH,
  POS_ICON_MASKABLE_512_PATH,
  APPLE_TOUCH_ICON_PATH,
  manifestShortName,
  buildManifest,
  shouldRequestWakeLock,
} from "@/lib/pos-install";

// ── 1. buildManifest("Foo Cafe") — top-level fields ─────────────────────────

test("PIN: buildManifest top-level fields mirror the frozen MANIFEST_* constants", () => {
  const m = buildManifest("Foo Cafe");
  assert.equal(m.name, "Foo Cafe");
  assert.equal(m.short_name, "Foo Cafe");
  assert.equal(m.id, MANIFEST_ID);
  assert.equal(m.start_url, MANIFEST_START_URL);
  assert.equal(m.scope, MANIFEST_SCOPE);
  assert.equal(m.display, MANIFEST_DISPLAY);
  assert.equal(m.background_color, MANIFEST_BACKGROUND_COLOR);
  assert.equal(m.theme_color, MANIFEST_THEME_COLOR);
});

// ── 2. icons array ───────────────────────────────────────────────────────────

test("PIN: icons array carries exactly 192/512/maskable-512, all PNG, one maskable entry at the maskable path", () => {
  const m = buildManifest("Foo Cafe");
  const icons = m.icons ?? [];
  assert.equal(icons.length, 3, "expected exactly 3 icon entries");

  for (const icon of icons) {
    assert.ok(icon.src.startsWith(POS_ICON_DIR + "/"), `icon src "${icon.src}" must start with "${POS_ICON_DIR}/"`);
    assert.ok(icon.src.endsWith(".png"), `icon src "${icon.src}" must end with ".png"`);
    assert.equal(icon.type, "image/png");
  }

  const sizesList = icons.map((icon) => icon.sizes);
  assert.equal(sizesList.filter((s) => s === "192x192").length, 1, "expected exactly one 192x192 entry");
  assert.equal(sizesList.filter((s) => s === "512x512").length, 2, "expected exactly two 512x512 entries");

  const maskable = icons.filter((icon) => icon.purpose === "maskable");
  assert.equal(maskable.length, 1, "expected exactly one maskable entry");
  assert.equal(maskable[0]!.src, POS_ICON_MASKABLE_512_PATH);

  const nonMaskable = icons.filter((icon) => icon.purpose !== "maskable");
  assert.equal(nonMaskable.length, 2, "expected exactly two non-maskable entries");
  for (const icon of nonMaskable) {
    assert.equal(icon.purpose, "any", `non-maskable icon "${icon.src}" must have purpose "any"`);
  }

  // Landmark for the icon-path negatives above: the two known-good non-maskable
  // srcs are actually present (raw src comparison, not a parsed subset).
  const srcs = icons.map((icon) => icon.src);
  assert.ok(srcs.includes(POS_ICON_192_PATH), "landmark: icons must include POS_ICON_192_PATH");
  assert.ok(srcs.includes(POS_ICON_512_PATH), "landmark: icons must include POS_ICON_512_PATH");
});

// ── 3. negative pins, vision-guarded ────────────────────────────────────────

test("PIN: manifest never advertises share_target / prefer_related_applications / related_applications (vision-guarded by the display landmark)", () => {
  const m = buildManifest("Foo Cafe");
  assert.equal(m.display, "standalone", "landmark: display must be standalone (proves the object was actually read, not vacuously absent)");
  assert.ok(!("share_target" in m), "manifest must not carry share_target");
  assert.ok(!("prefer_related_applications" in m), "manifest must not carry prefer_related_applications");
  assert.ok(!("related_applications" in m), "manifest must not carry related_applications");
});

// ── 4. fallback / trim behavior ──────────────────────────────────────────────

test("PIN: blank/whitespace-only names fall back to APP_NAME; surrounding whitespace on a real name is trimmed", () => {
  for (const blank of ["", "   "]) {
    const m = buildManifest(blank);
    assert.equal(m.name, APP_NAME, `buildManifest(${JSON.stringify(blank)}).name must fall back to APP_NAME`);
    assert.equal(
      m.short_name,
      manifestShortName(APP_NAME),
      `buildManifest(${JSON.stringify(blank)}).short_name must fall back to manifestShortName(APP_NAME)`,
    );
  }

  const trimmed = buildManifest("  Foo  ");
  assert.equal(trimmed.name, "Foo");
});

// ── 5. manifestShortName ─────────────────────────────────────────────────────

test("PIN: manifestShortName clamps to MANIFEST_SHORT_NAME_MAX with no trailing whitespace, and passes short names through unchanged", () => {
  const longName = "a".repeat(30);
  const clamped = manifestShortName(longName);
  assert.ok(clamped.length <= MANIFEST_SHORT_NAME_MAX, `clamped length ${clamped.length} must be <= ${MANIFEST_SHORT_NAME_MAX}`);
  assert.equal(clamped, clamped.trimEnd(), "clamped short name must not carry trailing whitespace");

  // 12th char (index 11) is a space in "Hello World Cafe" -> slice(0,12) is
  // "Hello World " -> trimEnd() -> "Hello World".
  assert.equal(manifestShortName("Hello World Cafe"), "Hello World");

  assert.equal(manifestShortName("Foo"), "Foo", "a name already under the max must pass through unchanged");
});

// ── 6. load-bearing constant values ──────────────────────────────────────────

test("PIN: load-bearing MANIFEST_* values — cookie-less /api path, scope/start_url/id agreement, colour format, content type, apple-touch-icon path", () => {
  assert.ok(MANIFEST_PATH.startsWith("/api/"), "MANIFEST_PATH must start with /api/ (middleware matcher excludes /api)");
  assert.equal(MANIFEST_SCOPE, "/");
  assert.ok(MANIFEST_START_URL.startsWith(MANIFEST_SCOPE), "MANIFEST_START_URL must start with MANIFEST_SCOPE");
  assert.equal(MANIFEST_ID, MANIFEST_START_URL);

  const hexColor = /^#[0-9a-f]{6}$/;
  assert.match(MANIFEST_BACKGROUND_COLOR, hexColor);
  assert.match(MANIFEST_THEME_COLOR, hexColor);

  assert.equal(MANIFEST_CONTENT_TYPE, "application/manifest+json");
  assert.ok(APPLE_TOUCH_ICON_PATH.startsWith(POS_ICON_DIR + "/"), "APPLE_TOUCH_ICON_PATH must start with POS_ICON_DIR/");
});

// ── 7. shouldRequestWakeLock truth table ─────────────────────────────────────

test("PIN: shouldRequestWakeLock full 2x2x2 truth table — true ONLY for (enabled, supported, visible)", () => {
  const BOOLS = [true, false];
  const VISIBILITIES: DocumentVisibilityState[] = ["visible", "hidden"];
  let casesRun = 0;

  for (const enabled of BOOLS) {
    for (const supported of BOOLS) {
      for (const visibility of VISIBILITIES) {
        casesRun += 1;
        const expected = enabled === true && supported === true && visibility === "visible";
        assert.equal(
          shouldRequestWakeLock({ enabled, supported, visibility }),
          expected,
          `shouldRequestWakeLock({enabled:${enabled}, supported:${supported}, visibility:"${visibility}"}) must be ${expected}`,
        );
      }
    }
  }

  assert.equal(casesRun, 8, "truth table must cover all 8 combinations");
});

test("PIN: manifestShortName prefers a whole-word cut when it keeps a readable label, else the hard cut", () => {
  // Live curl leg 2026-09-04 showed "Alpha Test Cafe" → "Alpha Test C"; the launcher label should read as words.
  assert.equal(manifestShortName("Alpha Test Cafe"), "Alpha Test");
  // 12th character IS a space → the hard cut already ends on a word.
  assert.equal(manifestShortName("Hello Worlds Cafe"), "Hello Worlds");
  // A word cut that would leave a stub ("Foo") loses to the hard cut.
  assert.equal(manifestShortName("Foo Barbazquxquux"), "Foo Barbazqu");
  // No spaces at all → hard cut.
  assert.equal(manifestShortName("Supercalifragilistic"), "Supercalifra");
  for (const n of ["Alpha Test Cafe", "Hello Worlds Cafe", "Foo Barbazquxquux", "Supercalifragilistic"]) {
    assert.ok(manifestShortName(n).length <= MANIFEST_SHORT_NAME_MAX);
    assert.equal(manifestShortName(n), manifestShortName(n).trimEnd());
  }
});

test("PIN: manifestShortName never splits a surrogate pair or a grapheme cluster (review RC1, 2026-09-04)", () => {
  // 11 ASCII code units, then a 2-code-unit emoji straddling code-unit index 12.
  const emojiName = "Pizza Point" + "\u{1F355}" + " Cafe Deluxe";
  const emojiShort = manifestShortName(emojiName);
  assert.ok(emojiShort.isWellFormed(), "no lone surrogate may reach the launcher label");
  assert.ok(Array.from(emojiShort).length <= MANIFEST_SHORT_NAME_MAX);
  assert.ok(emojiName.startsWith(emojiShort), "the cut is a prefix of the full name");

  // Devanagari: vowel signs and virama are combining marks — a cut must land on
  // a grapheme boundary or the last letter renders broken.
  const hindiName =
    "श्री गणेश कैफे एंड रेस्तोरेंट";
  const seg = new Intl.Segmenter("hi", { granularity: "grapheme" });
  const graphemesOf = (s: string): string[] => Array.from(seg.segment(s), (x) => x.segment);
  assert.ok(graphemesOf(hindiName).length > MANIFEST_SHORT_NAME_MAX, "fixture must actually need a cut");
  const hindiShort = manifestShortName(hindiName);
  assert.ok(hindiShort.length > 0);
  assert.ok(hindiShort.isWellFormed());
  assert.ok(graphemesOf(hindiShort).length <= MANIFEST_SHORT_NAME_MAX);
  assert.equal(
    graphemesOf(hindiName).slice(0, graphemesOf(hindiShort).length).join(""),
    hindiShort,
    "the cut must be a whole-grapheme prefix of the full name",
  );
  assert.equal(hindiShort, hindiShort.trimEnd());
});
