import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  DINER_THEME_ATTR,
  DINER_THEMES,
  DINER_THEME_SCRIPT,
  appearanceOverrideCss,
  type DinerTheme,
} from "./appearance-theme-override";
import { DEFAULT_APPEARANCE, appearanceCssVars, appearanceScopedCss, type ResolvedAppearance } from "./appearance";

// S9 — appearanceOverrideCss is a SEPARATE producer, additive to
// appearanceScopedCss: it must never change what that function emits (pin 6
// below), and its own output must stay attribute-scoped, injection-safe, and
// token-complete relative to appearanceCssVars — the same producer both
// files build on, never re-derived.

const FONT_FAMILIES = { body: "Inter, sans-serif", display: "Playfair Display, serif" };

// The no-flash script hardcodes the diner theme's localStorage key, and so
// does the cafe's own store — two packages, two copies, and NOTHING would
// fail if one drifted: the toggle would simply stop applying, with no error
// and no failing test. This repo pins cross-party contracts by reading the
// OTHER side's source (see .claude/rules/shared.md), so that is done here.
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CART_STORE = "apps/cafe/components/public/public-cart-store.ts";

function attrBlockCustomProps(css: string, scheme: "light" | "dark"): Set<string> {
  const re = new RegExp(`:root\\[data-pub-theme="${scheme}"\\]\\{([^}]*)\\}`);
  const body = css.match(re)?.[1] ?? "";
  return new Set([...body.matchAll(/(--[\w-]+):/g)].map((m) => m[1]));
}

// ── shape ────────────────────────────────────────────────────────────────

test("appearanceOverrideCss: emits exactly two :root[data-pub-theme=] blocks, no .pos-public-theme class scoping", () => {
  const css = appearanceOverrideCss(DEFAULT_APPEARANCE, FONT_FAMILIES);
  const matches = css.match(/:root\[data-pub-theme="(?:light|dark)"\]\{/g) ?? [];
  assert.equal(matches.length, 2, "must emit exactly two attribute-scoped :root blocks");
  assert.match(css, /:root\[data-pub-theme="light"\]\{/);
  assert.match(css, /:root\[data-pub-theme="dark"\]\{/);
  assert.doesNotMatch(css, /\.pos-public-theme/, "tokens must never be scoped to a class");
});

// ── injection guard ──────────────────────────────────────────────────────

test("appearanceOverrideCss: no < > or & across all 6 presets with a valid custom accent, and a hostile accent injects nothing", () => {
  const PRESET_IDS = ["classicBistro", "warmTerracotta", "masalaCharcoal", "freshMint", "royalMaroon", "sunsetChai"] as const;
  for (const presetId of PRESET_IDS) {
    const resolved: ResolvedAppearance = { ...DEFAULT_APPEARANCE, presetId, accentOverride: "#123456" };
    const css = appearanceOverrideCss(resolved, FONT_FAMILIES);
    assert.doesNotMatch(css, /[<>&]/, `${presetId} must not emit < > or &`);
  }

  const hostile = "#fff; } :root{background:red} body{x:'";
  const resolved: ResolvedAppearance = { ...DEFAULT_APPEARANCE, accentOverride: hostile };
  const css = appearanceOverrideCss(resolved, FONT_FAMILIES);
  assert.doesNotMatch(css, /background:red/);
  assert.doesNotMatch(css, /[<>&]/);
  const cleanPrimary = appearanceCssVars({ ...DEFAULT_APPEARANCE, accentOverride: "" }, "light")["--primary"];
  assert.match(css, new RegExp(`--primary:${cleanPrimary.replace("#", "\\#")};`));
});

test("appearanceOverrideCss: fontFamilies containing < > or & throws", () => {
  assert.throws(() => appearanceOverrideCss(DEFAULT_APPEARANCE, { body: "Evil<script>", display: "Fine" }));
  assert.throws(() => appearanceOverrideCss(DEFAULT_APPEARANCE, { body: "Fine", display: "A & B" }));
});

// ── parity vs appearanceCssVars ─────────────────────────────────────────

test("PARITY: the dark block's token key set equals appearanceCssVars('dark')'s key set (plus the 2 font vars) — a token added to one producer and not the other must fail here", () => {
  const css = appearanceOverrideCss(DEFAULT_APPEARANCE, FONT_FAMILIES);
  const darkProps = attrBlockCustomProps(css, "dark");
  const expected = new Set([...Object.keys(appearanceCssVars(DEFAULT_APPEARANCE, "dark")), "--pub-body-font", "--pub-display-font"]);
  assert.deepEqual(darkProps, expected);
});

test("PARITY: the light block's token key set equals appearanceCssVars('light')'s key set (plus the 2 font vars)", () => {
  const css = appearanceOverrideCss(DEFAULT_APPEARANCE, FONT_FAMILIES);
  const lightProps = attrBlockCustomProps(css, "light");
  const expected = new Set([...Object.keys(appearanceCssVars(DEFAULT_APPEARANCE, "light")), "--pub-body-font", "--pub-display-font"]);
  assert.deepEqual(lightProps, expected);
});

// ── stable exports ──────────────────────────────────────────────────────

test("DINER_THEME_ATTR and DINER_THEMES are exported and stable", () => {
  assert.equal(DINER_THEME_ATTR, "data-pub-theme");
  assert.deepEqual(DINER_THEMES, ["system", "light", "dark"]);
  const check: DinerTheme = "system"; // compiles only if the type still has this member
  assert.equal(check, "system");
});

// ── no-flash script ──────────────────────────────────────────────────────

test("DINER_THEME_SCRIPT references the store's localStorage key and is wrapped in try/catch", () => {
  assert.match(DINER_THEME_SCRIPT, /pos\.public\.theme\.v1/, "must read the same key public-cart-store.ts's THEME_KEY uses");
  assert.match(DINER_THEME_SCRIPT, /^try\{/, "must be wrapped starting with try{");
  assert.match(DINER_THEME_SCRIPT, /\}catch\(e\)\{\}$/, "must end in a catch block — private-mode localStorage access can throw");
  assert.doesNotMatch(DINER_THEME_SCRIPT, /[<>]/, "a script constant embedded in a <script> child must carry no < or >");
});

// ── MOST IMPORTANT: the original appearanceScopedCss guarantee still holds ──

test("MOST IMPORTANT: appearanceScopedCss (the ORIGINAL producer, untouched by this file) still emits exactly two bare :root{} blocks and no attribute selector — proving this override is purely additive", () => {
  const css = appearanceScopedCss(DEFAULT_APPEARANCE, FONT_FAMILIES);
  assert.equal((css.match(/:root\{/g) ?? []).length, 2, "appearanceScopedCss must still emit exactly two :root blocks");
  assert.doesNotMatch(css, /\.pos-public-theme/, "appearanceScopedCss must still never scope to .pos-public-theme");
  assert.doesNotMatch(css, /:root\[data-pub-theme/, "appearanceScopedCss must never gain an attribute selector — that belongs solely to appearanceOverrideCss");
});

// ── cross-package parity: the theme storage key ──────────────────────────

test("PARITY: DINER_THEME_SCRIPT reads the SAME localStorage key the cafe's public-cart-store writes", () => {
  const storeSrc = readFileSync(path.join(REPO_ROOT, CART_STORE), "utf8");
  // The store's own declaration is the source of truth. Read the key OUT of
  // it rather than restating a literal here, so this pin cannot agree with a
  // stale copy of itself.
  const declared = storeSrc.match(/const THEME_KEY = "([^"]+)";/);
  assert.ok(
    declared,
    `expected a THEME_KEY declaration in ${CART_STORE} — if it was renamed, re-point this pin rather than deleting it`,
  );
  const key = declared![1];
  assert.match(key, /\.v\d+$/, "the theme key must stay version-suffixed");
  assert.ok(
    DINER_THEME_SCRIPT.includes(`localStorage.getItem("${key}")`),
    `the no-flash script must read ${key} — the cafe store writes that key, and a drift between the two silently stops the theme from applying (no error, no failing render)`,
  );
});

test("PARITY: DINER_THEME_SCRIPT parses the key the same way the store WRITES it (JSON, not a bare string)", () => {
  const storeSrc = readFileSync(path.join(REPO_ROOT, CART_STORE), "utf8");
  // safeWrite JSON.stringifies every value, so a stored "light" is the bytes
  // `"light"` WITH quotes. A script comparing getItem() === "light" would
  // never match — the bug this pin exists to catch.
  assert.match(
    storeSrc,
    /JSON\.stringify\(value\)/,
    "the store is expected to JSON.stringify what it writes; if that changed, the script's JSON.parse must change with it",
  );
  assert.ok(
    DINER_THEME_SCRIPT.includes("JSON.parse("),
    "the no-flash script must JSON.parse the stored value to mirror the store's JSON.stringify",
  );
  // Vision guard: prove the script really does apply a theme, so the two
  // assertions above cannot pass against an empty/gutted constant.
  assert.ok(
    DINER_THEME_SCRIPT.includes(`setAttribute("${DINER_THEME_ATTR}"`),
    "the script must set the theme attribute it exists to set",
  );
});
