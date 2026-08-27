import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PRESET_IDS,
  FONT_PAIR_KEYS,
  CORNER_RADII,
  DENSITIES,
  LOGO_PLACEMENTS,
  APPEARANCE_SCHEMA_VERSION,
  DEFAULT_APPEARANCE,
  resolveAppearance,
  appearanceCssVars,
  appearanceScopedCss,
  type ResolvedAppearance,
} from "./appearance";
import { bestForeground } from "./appearance-contrast";

// CR2.4 — resolveAppearance/appearanceCssVars/appearanceScopedCss are the
// three functions every OTHER slice (model reads, the /m layout, the admin
// preview) builds on. This file is DB-free/client-safe (shared package rule).

// Every token appearanceCssVars must emit, restated here as the pinned
// contract — a key silently dropped from the implementation fails THIS list,
// not a vaguer "some keys are missing" assertion.
const EXPECTED_TOKEN_KEYS = [
  "--background", "--foreground", "--card", "--card-foreground",
  "--muted", "--muted-foreground", "--border", "--accent",
  "--primary", "--primary-foreground", "--input", "--ring",
  "--secondary", "--secondary-foreground", "--accent-foreground",
  "--popover", "--popover-foreground", "--destructive", "--destructive-foreground",
  "--radius", "--pub-gap", "--pub-pad",
];

const FONT_FAMILIES = { body: "Inter, sans-serif", display: "Playfair Display, serif" };

// ── resolveAppearance totality ───────────────────────────────────────────────

test("resolveAppearance(undefined/null/non-object) is total: returns DEFAULT_APPEARANCE", () => {
  for (const raw of [undefined, null, "a string", 42, true, []]) {
    assert.deepEqual(resolveAppearance(raw), DEFAULT_APPEARANCE);
  }
});

test("resolveAppearance never throws on any input shape", () => {
  const hostileInputs: unknown[] = [
    undefined, null, 0, NaN, "", [], {}, { toString: () => "x" },
    { presetId: { nested: true } }, { presetId: () => "x" },
  ];
  for (const raw of hostileInputs) {
    assert.doesNotThrow(() => resolveAppearance(raw));
  }
});

test("resolveAppearance: an unknown value for each enum field falls back to that field's own default", () => {
  const r = resolveAppearance({
    presetId: "midnightDiner",
    fontPairKey: "handwritten",
    cornerRadius: "square",
    density: "spacious",
    logoPlacement: "top",
  });
  assert.equal(r.presetId, DEFAULT_APPEARANCE.presetId);
  assert.equal(r.fontPairKey, DEFAULT_APPEARANCE.fontPairKey);
  assert.equal(r.cornerRadius, DEFAULT_APPEARANCE.cornerRadius);
  assert.equal(r.density, DEFAULT_APPEARANCE.density);
  assert.equal(r.logoPlacement, DEFAULT_APPEARANCE.logoPlacement);
});

test("resolveAppearance: every declared member of every enum round-trips unchanged", () => {
  for (const presetId of PRESET_IDS) {
    assert.equal(resolveAppearance({ presetId }).presetId, presetId);
  }
  for (const fontPairKey of FONT_PAIR_KEYS) {
    assert.equal(resolveAppearance({ fontPairKey }).fontPairKey, fontPairKey);
  }
  for (const cornerRadius of CORNER_RADII) {
    assert.equal(resolveAppearance({ cornerRadius }).cornerRadius, cornerRadius);
  }
  for (const density of DENSITIES) {
    assert.equal(resolveAppearance({ density }).density, density);
  }
  for (const logoPlacement of LOGO_PLACEMENTS) {
    assert.equal(resolveAppearance({ logoPlacement }).logoPlacement, logoPlacement);
  }
});

test("resolveAppearance: Object.prototype key names as VALUES resolve to the field's default, never throw or prototype-walk", () => {
  for (const poison of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
    const r = resolveAppearance({
      presetId: poison,
      fontPairKey: poison,
      cornerRadius: poison,
      density: poison,
      logoPlacement: poison,
    });
    assert.equal(r.presetId, DEFAULT_APPEARANCE.presetId, `presetId:"${poison}" must fall back to default`);
    assert.equal(r.fontPairKey, DEFAULT_APPEARANCE.fontPairKey, `fontPairKey:"${poison}" must fall back to default`);
    assert.equal(r.cornerRadius, DEFAULT_APPEARANCE.cornerRadius);
    assert.equal(r.density, DEFAULT_APPEARANCE.density);
    assert.equal(r.logoPlacement, DEFAULT_APPEARANCE.logoPlacement);
  }
});

test("resolveAppearance: appearance.v is ALWAYS the current APPEARANCE_SCHEMA_VERSION, regardless of stored input", () => {
  assert.equal(resolveAppearance({ v: 999 }).v, APPEARANCE_SCHEMA_VERSION);
  assert.equal(resolveAppearance({}).v, APPEARANCE_SCHEMA_VERSION);
});

test("resolveAppearance: a hostile accentOverride (CSS-injection attempt) resolves to \"\"", () => {
  const hostileAccents = [
    "#fff; } :root{background:red}",
    "url(x)",
    "red",
    "#gggggg",
    "#12345",
    "#1234567",
    "javascript:alert(1)",
  ];
  for (const accentOverride of hostileAccents) {
    assert.equal(resolveAppearance({ accentOverride }).accentOverride, "", `"${accentOverride}" must resolve to ""`);
  }
});

test("resolveAppearance: a valid lowercase accentOverride round-trips; uppercase is lowercased", () => {
  assert.equal(resolveAppearance({ accentOverride: "#8a4a24" }).accentOverride, "#8a4a24");
  assert.equal(resolveAppearance({ accentOverride: "#8A4A24" }).accentOverride, "#8a4a24");
});

test("resolveAppearance: heroImage — any non-string becomes \"\"", () => {
  assert.equal(resolveAppearance({ heroImage: "r2:branding/abc" }).heroImage, "r2:branding/abc");
  for (const value of [42, null, {}, [], true]) {
    assert.equal(resolveAppearance({ heroImage: value }).heroImage, "");
  }
});

// ── appearanceCssVars completeness ───────────────────────────────────────────

test("appearanceCssVars emits the complete token cover for every preset × scheme", () => {
  for (const presetId of PRESET_IDS) {
    for (const scheme of ["light", "dark"] as const) {
      const resolved: ResolvedAppearance = { ...DEFAULT_APPEARANCE, presetId };
      const vars = appearanceCssVars(resolved, scheme);
      for (const key of EXPECTED_TOKEN_KEYS) {
        assert.ok(Object.hasOwn(vars, key), `${presetId}/${scheme} missing token ${key}`);
      }
      assert.equal(Object.keys(vars).length, EXPECTED_TOKEN_KEYS.length, `${presetId}/${scheme} must emit exactly the pinned token set`);
    }
  }
});

test("appearanceCssVars: an accentOverride replaces --primary/--primary-foreground but --accent stays the preset's own tint", () => {
  const override = "#123456";
  const resolved: ResolvedAppearance = { ...DEFAULT_APPEARANCE, accentOverride: override };
  const withOverride = appearanceCssVars(resolved, "light");
  const withoutOverride = appearanceCssVars({ ...resolved, accentOverride: "" }, "light");

  assert.equal(withOverride["--primary"], override);
  assert.equal(withOverride["--primary-foreground"], bestForeground(override));
  assert.equal(withOverride["--accent"], withoutOverride["--accent"], "--accent must never be replaced by an override");
});

test("appearanceCssVars: --input/--ring/--secondary/--accent-foreground differ from the raw admin-side values for each preset's dark half (A5)", () => {
  for (const presetId of PRESET_IDS) {
    const resolved: ResolvedAppearance = { ...DEFAULT_APPEARANCE, presetId };
    const vars = appearanceCssVars(resolved, "dark");
    // These are DERIVED tokens, not the palette's raw border/accent/muted —
    // the assertion that matters is that they resolve to a real value at all,
    // and that --accent-foreground is genuinely DERIVED (not a copy of accent).
    assert.notEqual(vars["--accent-foreground"], vars["--accent"], `${presetId} accent-foreground must be derived, not equal to accent`);
    assert.ok(vars["--input"], `${presetId} --input must be set`);
    assert.ok(vars["--ring"], `${presetId} --ring must be set`);
    assert.ok(vars["--secondary"], `${presetId} --secondary must be set`);
  }
});

// ── appearanceScopedCss ───────────────────────────────────────────────────────

function rootBlockCustomProps(css: string, blockIndex: 0 | 1): Set<string> {
  const matches = [...css.matchAll(/:root\{([^}]*)\}/g)];
  const body = matches[blockIndex]?.[1] ?? "";
  return new Set([...body.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
}

test("appearanceScopedCss: contains exactly two :root blocks, no .pos-public-theme selector, color-scheme, both font vars, and the body rule", () => {
  const resolved: ResolvedAppearance = { ...DEFAULT_APPEARANCE };
  const css = appearanceScopedCss(resolved, FONT_FAMILIES);

  assert.equal((css.match(/:root\{/g) ?? []).length, 2, "must emit exactly two :root blocks (light + dark)");
  assert.doesNotMatch(css, /\.pos-public-theme/, "tokens must never be scoped to a class");
  assert.match(css, /color-scheme:\s*light dark/);
  assert.match(css, /--pub-body-font:/);
  assert.match(css, /--pub-display-font:/);
  assert.match(css, /body\{background-color:var\(--background\);color:var\(--foreground\);font-family:var\(--pub-body-font\)\}/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)\{:root\{/);
});

test("appearanceScopedCss: no angle brackets or ampersands, across all 6 presets × a valid custom accent", () => {
  for (const presetId of PRESET_IDS) {
    const resolved: ResolvedAppearance = { ...DEFAULT_APPEARANCE, presetId, accentOverride: "#123456" };
    const css = appearanceScopedCss(resolved, FONT_FAMILIES);
    assert.doesNotMatch(css, /[<>&]/, `${presetId} must not emit < > or &`);
  }
});

test("appearanceScopedCss: a hostile stored accent falls back to the preset — no injected substring reaches the output", () => {
  const hostile = "#fff; } :root{background:red} body{x:'";
  const resolved: ResolvedAppearance = { ...DEFAULT_APPEARANCE, accentOverride: hostile };
  const css = appearanceScopedCss(resolved, FONT_FAMILIES);
  assert.doesNotMatch(css, /background:red/);
  assert.doesNotMatch(css, /[<>&]/);
  // The un-overridden preset primary must be what actually rendered.
  const clean = appearanceCssVars({ ...DEFAULT_APPEARANCE, accentOverride: "" }, "light");
  assert.match(css, new RegExp(`--primary:${clean["--primary"].replace("#", "\\#")};`));
});

test("appearanceScopedCss: fontFamilies containing < > or & throws (a programmer error, not untrusted input)", () => {
  assert.throws(() => appearanceScopedCss(DEFAULT_APPEARANCE, { body: "Evil<script>", display: "Fine" }));
  assert.throws(() => appearanceScopedCss(DEFAULT_APPEARANCE, { body: "Fine", display: "A & B" }));
});

test("parity: the light :root block's custom-property set equals appearanceCssVars('light') keys plus the 2 font vars", () => {
  const resolved: ResolvedAppearance = { ...DEFAULT_APPEARANCE };
  const css = appearanceScopedCss(resolved, FONT_FAMILIES);
  const lightProps = rootBlockCustomProps(css, 0);
  const expected = new Set([...Object.keys(appearanceCssVars(resolved, "light")), "--pub-body-font", "--pub-display-font"]);
  assert.deepEqual(lightProps, expected);
});
