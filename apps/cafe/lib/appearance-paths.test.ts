import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { PRESET_IDS, DEFAULT_APPEARANCE, appearanceCssVars, appearanceScopedCss } from "@pos/shared/appearance";
import { stripComments } from "@/lib/source-pin-utils";

// CR2.4 S6 — source-read pins for the Appearance/themes surface (step
// phase-CR2-public-ordering.md §22.1 S6, as AMENDED by §22.5 — pin numbers
// below are this file's own, not the original planner's list; the amendments
// deleted/reworded several of those). Same technique as
// lib/public-surface-paths.test.ts / lib/branding-paths.test.ts: no React/
// route test framework exists in this repo, so behaviour that lives in a
// server component or a class-string is pinned by reading the REAL source.
// Split into -2 (mirrors lib/telegram-paths(-2).test.ts) once this file
// crossed the ~300-line soft cap.
//
// NOT duplicated here — already pinned elsewhere:
//   - packages/shared/src/appearance.test.ts: resolveAppearance totality,
//     appearanceCssVars' full token cover, appearanceScopedCss's :root/dark
//     shape and injection-safety — UNIT level. P3/P7 below are the
//     INTEGRATION re-check (this package, as actually consumed by app/m).
//   - lib/branding-paths.test.ts: SLOT_REF_READERS (Object.hasOwn, no
//     ternary), the BRANDING_PRUNE_GRACE_MS grace window, and the per-slot
//     byte cap's route-level 413 (A8/A14/A16) — the original S6 plan's pins
//     10/11 are these; not restated here.
//   - lib/print-form.test.ts: the 4-tab mount discipline + onInvalid routing
//     for the appearance tab.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// Pins forbid/require CODE shapes, so they must look at code, not prose — a
// comment merely DESCRIBING a rule must neither satisfy nor trip the pin that
// enforces it (repo memory: this bit lib/telegram/format.test.ts once).

const M_LAYOUT = "apps/cafe/app/m/layout.tsx";
const PUBLIC_FONTS = "apps/cafe/lib/public-fonts.ts";
const GLOBALS_CSS = "apps/cafe/app/globals.css";
const PUBLIC_MENU_ITEM = "apps/cafe/components/public/PublicMenuItem.tsx";

// A fixture family pair standing in for lib/public-fonts.ts's REAL
// FONT_PAIR_FAMILIES — that module's next/font/google calls cannot be
// imported under `node --import tsx` (confirmed: `Inter is not a function`
// outside Next's own build), so appearanceScopedCss's own family-string
// argument is exercised here with plain strings. public-fonts.ts's shape
// (module-scope, literal options, weight arrays) is pinned separately below
// by source-read, not by importing it.
const FIXTURE_FAMILIES = { body: "Inter, sans-serif", display: "Playfair Display, serif" };

// ── P1 (A1/A3) — layout.tsx's data source, and no dead ISR config ──────────

test('PIN (A3): app/m/layout.tsx reads the theme via readPublicAppearance, never getSettings, exports NO `revalidate` (ISR premise is FALSE — the root layout\'s await auth() makes every /m render dynamic; the real freshness bound is readSettings\' TTL.SETTINGS cache), and stays a server component', () => {
  const src = stripComments(readSrc(M_LAYOUT));
  assert.match(
    src,
    /import \{ readPublicAppearance \} from "@\/lib\/public-appearance";/,
    "layout.tsx must read the theme through readPublicAppearance",
  );
  assert.ok(!/\bgetSettings\b/.test(src), "layout.tsx must never call the upserting getSettings — it renders on every /m visit");
  // Mutation this catches: re-adding `export const revalidate = 60` (the
  // ORIGINAL S3 plan, deleted by A3) — dead config that would wrongly imply
  // ISR governs freshness here, when the root layout's Dynamic API already
  // forces every /m render to be dynamic regardless of this export.
  assert.ok(
    !/export const revalidate/.test(src),
    "app/m/layout.tsx must not export `revalidate` — A3 proved the ISR premise false; re-adding it would be dead config that misleads the next reader",
  );
  assert.ok(
    !/["']use client["']/.test(src),
    "app/m/layout.tsx must stay a server component — it awaits readPublicAppearance() directly, which a client component cannot do",
  );
});

// ── P2 (A11) — the style element is a plain string child, never raw HTML ───

test("PIN (A11): app/m/layout.tsx renders <style>{appearanceScopedCss(...)}</style> as a plain string child, and dangerouslySetInnerHTML appears nowhere in the file", () => {
  // Raw source (not comment-stripped) — the file's own comment above this
  // line describes the escaping guarantee in prose without ever spelling out
  // the banned API name, so a raw scan is safe and catches a FUTURE comment
  // that might accidentally quote it too.
  const rawSrc = readSrc(M_LAYOUT);
  assert.match(
    rawSrc,
    /<style>\{appearanceScopedCss\(appearance, fontFamilies\)\}<\/style>/,
    "the theme text must reach the page via a <style> element's plain string child, sourced from appearanceScopedCss",
  );
  assert.ok(
    !/dangerouslySetInnerHTML/.test(rawSrc),
    "app/m/layout.tsx must never use dangerouslySetInnerHTML — the <style> child above is already React-escaped like any other text node",
  );
});

// ── P3 — integration re-check: appearanceScopedCss as CONSUMED by this app ──

test("INTEGRATION: appearanceScopedCss (@pos/shared/appearance) emits no < > or & across all 6 presets with a valid custom accent, and a hostile stored accentOverride injects nothing (falls back to the preset's own primary)", () => {
  const validAccent = "#123456";
  for (const presetId of PRESET_IDS) {
    const resolved = { ...DEFAULT_APPEARANCE, presetId, accentOverride: validAccent };
    const css = appearanceScopedCss(resolved, FIXTURE_FAMILIES);
    assert.doesNotMatch(css, /[<>&]/, `${presetId}: the /m style text must carry no <, >, or &`);
  }

  const hostile = "#fff; } :root{background:red} body{x:'";
  const resolvedHostile = { ...DEFAULT_APPEARANCE, accentOverride: hostile };
  const hostileCss = appearanceScopedCss(resolvedHostile, FIXTURE_FAMILIES);
  // Mutation this catches: trusting a stored accentOverride at emit time
  // instead of re-validating it — a hand-edited (or pre-Zod-era) document
  // carrying this string would otherwise inject a second CSS rule into every
  // diner's page.
  assert.doesNotMatch(hostileCss, /background:red/, "a hostile stored accent must not reach the emitted CSS text");
  assert.doesNotMatch(hostileCss, /[<>&]/);
  const cleanPrimary = appearanceCssVars({ ...DEFAULT_APPEARANCE, accentOverride: "" }, "light")["--primary"];
  assert.match(
    hostileCss,
    new RegExp(`--primary:${cleanPrimary.replace("#", "\\#")};`),
    "a rejected accent must fall back to the preset's own --primary, not a blank/truncated declaration",
  );

  // Mutation this catches: the body{} rule dropping font-family — portalled
  // content (Sheet/Drawer/Toaster, A2/A9) mounts on document.body OUTSIDE the
  // .pos-public-theme wrapper, so body{} is the only rule those surfaces
  // inherit their font from.
  const css = appearanceScopedCss(DEFAULT_APPEARANCE, FIXTURE_FAMILIES);
  assert.match(
    css,
    /body\{background-color:var\(--background\);color:var\(--foreground\);font-family:var\(--pub-body-font\)\}/,
    "the emitted body{} rule must set font-family:var(--pub-body-font) so body-level portals inherit the selected pair",
  );
});

// ── P4 (A9/A10) — public-fonts.ts: literal, module-scope, complete ─────────

test("PIN (A9/A10): public-fonts.ts declares all 8 next/font/google constants at module scope with literal options — preload:false on EVERY family (next/font preloads per build entry, not per rendered font, and this module is imported unconditionally by every /m route), Lato alone carries an explicit weight array, and no other family's block declares `weight:`", () => {
  const src = stripComments(readSrc(PUBLIC_FONTS));

  // Exact, verbatim call shapes — module-scope literal-only, next/font's own
  // requirement (a computed/looped call cannot be statically rewritten).
  assert.match(src, /const inter = Inter\(\{\s*variable: "--font-inter",\s*subsets: \["latin"\],\s*preload: false,\s*\}\);/);
  assert.match(src, /const playfairDisplay = Playfair_Display\(\{\s*variable: "--font-playfair-display",\s*subsets: \["latin"\],\s*preload: false,\s*\}\);/);
  assert.match(
    src,
    /const lato = Lato\(\{\s*variable: "--font-lato",\s*subsets: \["latin"\],\s*weight: \["400", "700"\],\s*preload: false,\s*\}\);/,
  );
  assert.match(src, /const quicksand = Quicksand\(\{\s*variable: "--font-quicksand",\s*subsets: \["latin"\],\s*preload: false,\s*\}\);/);
  assert.match(src, /const nunitoSans = Nunito_Sans\(\{\s*variable: "--font-nunito-sans",\s*subsets: \["latin"\],\s*preload: false,\s*\}\);/);
  assert.match(src, /const oswald = Oswald\(\{\s*variable: "--font-oswald",\s*subsets: \["latin"\],\s*preload: false,\s*\}\);/);
  assert.match(
    src,
    /const cormorantGaramond = Cormorant_Garamond\(\{\s*variable: "--font-cormorant-garamond",\s*subsets: \["latin"\],\s*preload: false,\s*\}\);/,
  );
  assert.match(src, /const baloo2 = Baloo_2\(\{\s*variable: "--font-baloo-2",\s*subsets: \["latin"\],\s*preload: false,\s*\}\);/);

  // Mutation this catches: a SECOND family gaining its own `weight:` array —
  // A10's rule is that Lato is the ONE non-variable family; every other
  // family stays weightless on purpose (that omission selects its variable
  // axis), so a second `weight:` occurrence would mean either a silent
  // duplicate or a family wrongly pinned to fixed weights.
  const weightMatches = src.match(/weight:\s*\[/g) ?? [];
  assert.equal(weightMatches.length, 1, "exactly ONE font block (Lato) may declare a `weight:` array");
  assert.ok(!/weight:\s*\["variable"/.test(src), 'a weight array must never contain the literal "variable"');
});

test("PIN (A9): FONT_PAIR_CLASSNAMES and FONT_PAIR_FAMILIES are COMPLETE static object literals — all 6 FontPairKey members present, built with no .map/.reduce/Object.fromEntries or computed [key] construction", () => {
  const src = stripComments(readSrc(PUBLIC_FONTS));
  const classnamesStart = src.indexOf("export const FONT_PAIR_CLASSNAMES");
  const familiesStart = src.indexOf("export const FONT_PAIR_FAMILIES", classnamesStart);
  assert.ok(classnamesStart >= 0 && familiesStart > classnamesStart, "both exports must exist, in this order");
  const classnamesBlock = src.slice(classnamesStart, familiesStart);
  const familiesBlock = src.slice(familiesStart);

  const KEYS = ["clean", "classic", "warm", "bold", "elegant", "friendly"];
  for (const key of KEYS) {
    assert.match(classnamesBlock, new RegExp(`\\b${key}:\\s`), `FONT_PAIR_CLASSNAMES must declare the "${key}" pair literally`);
    assert.match(familiesBlock, new RegExp(`\\b${key}:\\s`), `FONT_PAIR_FAMILIES must declare the "${key}" pair literally`);
  }
  // Mutation this catches: replacing the complete literal with a computed
  // construction (a loop over FONT_PAIR_KEYS indexing into some other table)
  // — a key this repo hasn't enumerated here would then silently resolve to
  // `undefined` instead of failing to compile.
  for (const block of [classnamesBlock, familiesBlock]) {
    assert.ok(!/\.map\(/.test(block), "must not be built via .map(");
    assert.ok(!/\.reduce\(/.test(block), "must not be built via .reduce(");
    assert.ok(!/Object\.fromEntries\(/.test(block), "must not be built via Object.fromEntries(");
    assert.ok(!/\[\w+\]:/.test(block), "must not use a computed [key]: property");
  }

  // A9's actual mandate — "for every FontPairKey, the family strings passed
  // to the css builder match the .variable-declared fonts of that pair" — a
  // PARITY read across both maps, not just a shape check of each in isolation.
  // FONT_PAIR_CLASSNAMES entries are `${display.variable} ${body.variable}`
  // (display first); FONT_PAIR_FAMILIES entries are `{ body: X.style.fontFamily,
  // display: Y.style.fontFamily }`. Mutation this catches: FONT_PAIR_FAMILIES
  // and FONT_PAIR_CLASSNAMES drifting apart for the same key (a copy-paste
  // swap) — appearanceScopedCss would then emit a --pub-*-font family for
  // which this build injects no matching @font-face, and every diner on that
  // pair would silently render a system fallback (or the wrong loaded face).
  for (const key of KEYS) {
    const classnamesMatch = classnamesBlock.match(
      new RegExp(`\\b${key}: \`\\$\\{(\\w+)\\.variable\\} \\$\\{(\\w+)\\.variable\\}\``),
    );
    const familiesMatch = familiesBlock.match(
      new RegExp(`\\b${key}: \\{ body: (\\w+)\\.style\\.fontFamily, display: (\\w+)\\.style\\.fontFamily \\}`),
    );
    assert.ok(classnamesMatch, `FONT_PAIR_CLASSNAMES.${key} must match the \${display.variable} \${body.variable} shape`);
    assert.ok(familiesMatch, `FONT_PAIR_FAMILIES.${key} must match the { body, display } shape`);
    const [, classnameDisplayIdent, classnameBodyIdent] = classnamesMatch!;
    const [, familiesBodyIdent, familiesDisplayIdent] = familiesMatch!;
    assert.equal(
      classnameDisplayIdent,
      familiesDisplayIdent,
      `${key}: FONT_PAIR_CLASSNAMES' display font (${classnameDisplayIdent}) must match FONT_PAIR_FAMILIES.display (${familiesDisplayIdent})`,
    );
    assert.equal(
      classnameBodyIdent,
      familiesBodyIdent,
      `${key}: FONT_PAIR_CLASSNAMES' body font (${classnameBodyIdent}) must match FONT_PAIR_FAMILIES.body (${familiesBodyIdent})`,
    );
  }
});

// ── P5 (S3) — globals.css: the 4 pub tokens, and --font-sans untouched ─────

test("PIN (S3): globals.css's @theme inline block declares --font-pub-body/--font-pub-display/--spacing-pub-gap/--spacing-pub-pad (each referencing its var(--pub-*) source), and --font-sans is UNCHANGED — still var(--font-geist-sans), never re-pointed at the pub tokens", () => {
  const src = readSrc(GLOBALS_CSS);
  const themeStart = src.indexOf("@theme inline {");
  assert.ok(themeStart >= 0, "@theme inline block must exist");
  const themeEnd = src.indexOf("\n}", themeStart);
  const themeBlock = src.slice(themeStart, themeEnd);

  assert.match(themeBlock, /--font-pub-body:\s*var\(--pub-body-font\);/);
  assert.match(themeBlock, /--font-pub-display:\s*var\(--pub-display-font\);/);
  assert.match(themeBlock, /--spacing-pub-gap:\s*var\(--pub-gap\);/);
  assert.match(themeBlock, /--spacing-pub-pad:\s*var\(--pub-pad\);/);
  // Mutation this catches: "wrapping" --font-sans to also carry a pub
  // fallback — globals.css's own top comment calls this out as a no-op trap
  // (the value is ALREADY var(--font-geist-sans); redefining it here changes
  // nothing for admin screens but risks a future edit silently rebinding it).
  assert.match(
    themeBlock,
    /--font-sans:\s*var\(--font-geist-sans\);/,
    "--font-sans must still read var(--font-geist-sans) — the admin app's own font must never be repointed at the /m tokens",
  );
});

// ── P6 (S3) — density never shrinks the touch target ───────────────────────

test("PIN (S3): PublicMenuItem.tsx's CONTROL_FOOTPRINT still carries h-11 (44px) — density tokens (gap/pad) never rebind this control's own fixed height", () => {
  // Raw source by choice (L14: a plain literal-value presence check needs no
  // comment stripping), not because it's still required — the old stripper's
  // naive block-regex used to misread this file's own "components/public/**"
  // header mention as a block-comment opener and eat everything up to the
  // next unrelated "*/"; that bug is FIXED and pinned in
  // lib/source-pin-utils.test.ts.
  const src = readSrc(PUBLIC_MENU_ITEM);
  const match = src.match(/const CONTROL_FOOTPRINT = "([^"]+)";/);
  assert.ok(match, "CONTROL_FOOTPRINT must be declared as a literal string");
  const tokens = match![1].split(/\s+/);
  assert.ok(tokens.includes("h-11"), 'CONTROL_FOOTPRINT must include the literal "h-11" utility class — A20 disproved shrinking it at any density');
});

// ── P7 (A2) — tokens land on :root in BOTH scheme blocks, never the class ──

test("INTEGRATION (A2): appearanceScopedCss declares its custom properties on :root in BOTH the light block and the dark @media block, never scoped to .pos-public-theme — the guarantee portalled content (Sheet/Drawer/Toaster) depends on", () => {
  const css = appearanceScopedCss(DEFAULT_APPEARANCE, FIXTURE_FAMILIES);
  assert.match(css, /^:root\{/, "the light block must open on a bare :root selector");
  assert.match(
    css,
    /@media \(prefers-color-scheme: dark\)\{:root\{/,
    "the dark half must be a @media (prefers-color-scheme: dark) block that ALSO targets :root",
  );
  // Mutation this catches: scoping either block to `.pos-public-theme` instead
  // of `:root` — a body-level portal (Sheet/Drawer/Toaster) mounts OUTSIDE the
  // themed wrapper div and would then read the ADMIN's own tokens instead.
  assert.doesNotMatch(css, /\.pos-public-theme/, "tokens must never be scoped to the .pos-public-theme class");
});
