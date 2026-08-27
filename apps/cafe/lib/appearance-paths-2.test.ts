import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { DEFAULT_APPEARANCE, appearanceCssVars } from "@pos/shared/appearance";
import { stripComments } from "@/lib/source-pin-utils";

// CR2.4 S6 — part 2 of the Appearance/themes source-read pins (see
// lib/appearance-paths.test.ts's header for the full convention/scope note).
// This half covers the DATA-FLOW pins (A1 reachability, A12 hero delivery,
// A7/A17 preview reuse, A19 mention-ban) and the A5 token-coverage pin, which
// needed its own directory walker.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const SKIP_DIRS = new Set(["node_modules", ".next"]);
const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

// Walks a directory recursively and pushes every code file's absolute path
// onto `out` — same helper as lib/public-surface-paths.test.ts, so a file
// added to either tree later is scanned automatically, not by a hardcoded list.
function walk(dirAbs: string, out: string[]): void {
  for (const entry of readdirSync(dirAbs)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = path.join(dirAbs, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) walk(abs, out);
    else if (CODE_FILE_PATTERN.test(entry)) out.push(abs);
  }
}

const M_LAYOUT = "apps/cafe/app/m/layout.tsx";
const M_PAGE = "apps/cafe/app/m/page.tsx";
const M_TOKEN_PAGE = "apps/cafe/app/m/[token]/page.tsx";
const PUBLIC_APPEARANCE = "apps/cafe/lib/public-appearance.ts";
const PUBLIC_ORDER_FLOW = "apps/cafe/components/public/PublicOrderFlow.tsx";
const PUBLIC_MENU = "apps/cafe/components/public/PublicMenu.tsx";
const PUBLIC_MENU_HEADER = "apps/cafe/components/public/PublicMenuHeader.tsx";
const APPEARANCE_PREVIEW = "apps/cafe/components/settings/AppearancePreview.tsx";
const APPEARANCE_PRESETS = "packages/shared/src/appearance-presets.ts";
const APPEARANCE_FIELDS_UTILS = "apps/cafe/components/settings/appearance-fields-utils.ts";
const GLOBALS_CSS = "apps/cafe/app/globals.css";

// ── P8 (A5) — every --color-* token the public surface actually uses is covered ──

test("PIN (A5): every Tailwind color-utility token referenced under components/public/** or app/m/** is covered by appearanceCssVars' output — mapped through globals.css's OWN @theme inline registrations, so a future primitive addition trips this", () => {
  const cssSrc = readSrc(GLOBALS_CSS);
  const themeStart = cssSrc.indexOf("@theme inline {");
  const themeEnd = cssSrc.indexOf("\n}", themeStart);
  const themeBlock = cssSrc.slice(themeStart, themeEnd);

  // Derive the token universe from the ACTUAL registrations (never hand-typed
  // twice) — e.g. "--color-background: var(--background);" yields the pair
  // ("background", "background"). Every entry in this file maps a utility
  // name straight onto the identically-named css var it registers.
  const registrations = new Map<string, string>();
  for (const m of themeBlock.matchAll(/--color-([\w-]+):\s*var\(--([\w-]+)\)/g)) {
    registrations.set(m[1], m[2]);
  }
  assert.ok(registrations.size > 0, "globals.css must register at least one --color-* token to check against");

  // Longest-name-first so the regex alternation below prefers e.g.
  // "muted-foreground" over its "muted" prefix at the same match position.
  const tokenNames = [...registrations.keys()].sort((a, b) => b.length - a.length);
  const escaped = tokenNames.map((n) => n.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&"));
  const prefixes = ["bg", "text", "border", "ring", "placeholder", "divide", "outline", "decoration", "caret", "accent", "from", "via", "to", "fill", "stroke"];
  const usageRe = new RegExp(`\\b(?:${prefixes.join("|")})-(${escaped.join("|")})\\b`, "g");

  const dirs = ["apps/cafe/app/m", "apps/cafe/components/public"];
  const usedTokens = new Set<string>();
  for (const dir of dirs) {
    const files: string[] = [];
    walk(path.join(REPO_ROOT, dir), files);
    for (const fileAbs of files) {
      const content = readFileSync(fileAbs, "utf8");
      for (const m of content.matchAll(usageRe)) usedTokens.add(m[1]);
    }
  }
  assert.ok(usedTokens.size > 0, "the scan must find at least one color-utility usage to prove anything");

  const emitted = new Set(Object.keys(appearanceCssVars(DEFAULT_APPEARANCE, "light")));
  for (const token of usedTokens) {
    const cssVarName = registrations.get(token)!;
    // Mutation this catches: a public/app-m component adopting a NEW semantic
    // color primitive (e.g. `bg-sidebar`) that appearanceCssVars never learned
    // to emit — the /m page would then paint that surface with whatever the
    // browser's default (unset custom property) resolves to.
    assert.ok(
      emitted.has(`--${cssVarName}`),
      `"${token}" is used under components/public/** or app/m/** but appearanceCssVars never emits --${cssVarName}`,
    );
  }
});

// ── P9 (A1) — positive reachability: chrome actually flows server → header ──

test("PIN (A1): the chrome={heroImage, logoPlacement} prop actually flows app/m/page.tsx + app/m/[token]/page.tsx -> PublicOrderFlow -> PublicMenu -> PublicMenuHeader, which reads BOTH fields — a real prop chain, not a dead branch", () => {
  const pageSrc = stripComments(readSrc(M_PAGE));
  assert.match(pageSrc, /import \{ readPublicAppearance \} from "@\/lib\/public-appearance";/);
  assert.match(
    pageSrc,
    /const chrome = \{ heroImage: appearance\.heroImage, logoPlacement: appearance\.logoPlacement \};/,
  );
  assert.match(pageSrc, /<PublicOrderFlow chrome=\{chrome\} \/>/, "app/m/page.tsx must pass chrome into PublicOrderFlow");

  const tokenPageSrc = stripComments(readSrc(M_TOKEN_PAGE));
  assert.match(tokenPageSrc, /import \{ readPublicAppearance \} from "@\/lib\/public-appearance";/);
  assert.match(
    tokenPageSrc,
    /const chrome = \{ heroImage: appearance\.heroImage, logoPlacement: appearance\.logoPlacement \};/,
  );
  assert.match(
    tokenPageSrc,
    /<PublicOrderFlow token=\{token\} chrome=\{chrome\} \/>/,
    "app/m/[token]/page.tsx must pass BOTH token and chrome into PublicOrderFlow",
  );

  const flowSrc = stripComments(readSrc(PUBLIC_ORDER_FLOW));
  assert.match(
    flowSrc,
    /chrome: \{ heroImage: string; logoPlacement: LogoPlacement \};/,
    "PublicOrderFlowProps must declare a typed chrome prop, not `any`",
  );
  assert.match(
    flowSrc,
    /<PublicMenu[\s\S]{0,600}?chrome=\{chrome\}/,
    "PublicOrderFlow must forward its own chrome prop into PublicMenu, not a re-derived value",
  );

  const menuSrc = stripComments(readSrc(PUBLIC_MENU));
  assert.match(
    menuSrc,
    /<PublicMenuHeader[\s\S]{0,250}?chrome=\{chrome\}/,
    "PublicMenu must forward chrome into PublicMenuHeader",
  );

  const headerSrc = stripComments(readSrc(PUBLIC_MENU_HEADER));
  assert.match(headerSrc, /chrome\.heroImage/, "PublicMenuHeader must actually read chrome.heroImage");
  assert.match(headerSrc, /chrome\.logoPlacement/, "PublicMenuHeader must actually read chrome.logoPlacement");
});

// ── P10 (A12) — hero delivery: productImageUrl, never brandingUrl; priority + dims ──

test("PIN (A12): PublicMenuHeader.tsx builds the hero src with productImageUrl(, never brandingUrl( in that same scope, and the hero <Image> carries priority plus explicit width/height", () => {
  const src = stripComments(readSrc(PUBLIC_MENU_HEADER));
  const heroUrlIdx = src.indexOf("const heroUrl");
  const headerTagIdx = src.indexOf("<header", heroUrlIdx);
  assert.ok(heroUrlIdx >= 0 && headerTagIdx > heroUrlIdx, "the hero derivation must precede the <header> block");
  const heroScope = src.slice(heroUrlIdx, headerTagIdx);

  assert.match(
    heroScope,
    /const heroUrl = chrome\.heroImage !== "" \? productImageUrl\(chrome\.heroImage\) : null;/,
    "the hero src must be derived via productImageUrl(chrome.heroImage)",
  );
  // Mutation this catches: reaching for brandingUrl (the unversioned,
  // always-current branding route) for the hero — brandingUrl is legitimately
  // used elsewhere in this SAME file for the restaurant logo, so the check is
  // scoped to the hero derivation only, not the whole file.
  assert.ok(
    !/brandingUrl\(/.test(heroScope),
    "the hero derivation must never call brandingUrl( — the hero is a versioned productImageUrl ref, not the always-current branding route",
  );

  assert.match(
    heroScope,
    /<Image\s+src=\{heroUrl\}[\s\S]{0,200}?width=\{HERO_RENDER_WIDTH\}[\s\S]{0,100}?height=\{HERO_RENDER_HEIGHT\}[\s\S]{0,100}?priority/,
    "the hero <Image> must carry explicit width/height (HERO_RENDER_WIDTH/HEIGHT) and priority",
  );
  // Post-review fix (prune-vs-save-race-hero-no-fallback): a stale hero ref
  // (the A14 grace-window's accepted residual) must degrade like the sibling
  // logo two blocks below, not render a permanently broken image box.
  assert.match(
    heroScope,
    /<Image\s+src=\{heroUrl\}[\s\S]{0,300}?priority[\s\S]{0,60}?onError=\{\(\) => setHeroFailed\(true\)\}/,
    "the hero <Image> must carry onError={() => setHeroFailed(true)} AFTER priority",
  );
});

// ── P11 (A7/A17) — preview reuses the real header, subscribes narrowly ─────

test("PIN (A7/A17): AppearancePreview.tsx imports the REAL PublicMenuHeader (no duplicated markup) and subscribes via useWatch(, never a render-prop watch( call", () => {
  const src = stripComments(readSrc(APPEARANCE_PREVIEW));
  assert.match(
    src,
    /import \{ PublicMenuHeader \} from "@\/components\/public\/PublicMenuHeader";/,
    "AppearancePreview must import the real PublicMenuHeader component",
  );
  assert.match(src, /<PublicMenuHeader/, "AppearancePreview must actually RENDER PublicMenuHeader, not just import its type");
  assert.match(src, /\buseWatch\(/, "AppearancePreview must subscribe via useWatch");
  // Case-sensitive and deliberately so: "useWatch(" never matches this
  // lowercase-w pattern, so a genuine render-prop `watch("appearance")` call
  // (which would re-render on EVERY form field, not just this slice) is what
  // this actually catches.
  assert.ok(!/\bwatch\(/.test(src), "AppearancePreview must never subscribe via a render-prop watch( call — only useWatch(");
});

// ── P12 (A19) — mention-ban + public-appearance.ts's sole import/no-spread ──

test("PIN (A19): app/m/layout.tsx, both /m pages, and lib/public-appearance.ts never mention promoCodes, selfOrderMode, showPastOrdersToDiner, or telegram in CODE — this surface has no business reaching for any of them", () => {
  // Comment-stripped (matches public-surface-paths.test.ts pin 10's own
  // convention): public-appearance.ts's own comment legitimately EXPLAINS
  // this exact invariant by naming the banned fields in prose, which would
  // otherwise trip this same pin — a comment describing a rule must not
  // itself violate the rule it documents.
  const banned = [/promoCodes/i, /selfOrderMode/i, /showPastOrdersToDiner/i, /telegram/i];
  const files = [M_LAYOUT, M_PAGE, M_TOKEN_PAGE, PUBLIC_APPEARANCE];
  for (const rel of files) {
    const src = stripComments(readSrc(rel));
    for (const pattern of banned) {
      assert.ok(!pattern.test(src), `${rel} must never mention ${pattern} in code`);
    }
  }
});

test("PIN (A19): lib/public-appearance.ts's only @/lib import is { readSettings } from \"@/lib/settings\", and it never spreads the settings document — it returns resolveAppearance(...) key-by-key", () => {
  const src = stripComments(readSrc(PUBLIC_APPEARANCE));
  const libImports = [...src.matchAll(/from "(@\/(?:lib|models)\/[^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(
    libImports,
    ["@/lib/settings"],
    "public-appearance.ts must import from exactly one @/lib or @/models path: @/lib/settings",
  );
  assert.match(
    src,
    /import \{ readSettings \} from "@\/lib\/settings";/,
    "the one @/lib import must be the named readSettings binding, not a default or namespace import",
  );
  // Mutation this catches: `return { ...settings, ... }` (or `{ ...s }`) —
  // spreading the raw settings doc would leak every OTHER field it carries
  // (promoCodes, selfOrderMode, telegram*) onto whatever this function
  // returns, defeating the mention-ban pin above at the type level.
  assert.ok(!/\.\.\.settings\b/.test(src) && !/\.\.\.s\b/.test(src), "readPublicAppearance must never spread the settings document");
  assert.match(
    src,
    /return resolveAppearance\(settings\?\.appearance\);/,
    "readPublicAppearance must return resolveAppearance(settings?.appearance) — the one function that builds a FRESH, key-by-key object",
  );
});

// ── P14 (post-review fix) — bg-accent never appears without its foreground ─

const PUBLIC_COMPONENTS_DIR = "apps/cafe/components/public";
// Matches any single/double/backtick-quoted string literal (covers plain
// className="..." AND a cn(...) call's string/template arguments) — same
// generic literal scan style as the rest of this file's source-read pins.
const STRING_LITERAL = /(["'`])((?:\\.|(?!\1)[\s\S])*)\1/g;

test("PIN: every class-string containing bg-accent under components/public/** also carries text-accent-foreground in the SAME literal — --accent is a strong fill (post-review A6 amendment), never painted with inherited foreground/muted-foreground text", () => {
  const files: string[] = [];
  walk(path.join(REPO_ROOT, PUBLIC_COMPONENTS_DIR), files);
  assert.ok(files.length > 0, "the scan must find at least one file under components/public/**");

  let checkedAtLeastOne = false;
  for (const fileAbs of files) {
    const src = readFileSync(fileAbs, "utf8");
    for (const m of src.matchAll(STRING_LITERAL)) {
      const literal = m[2];
      if (!/\bbg-accent\b/.test(literal)) continue;
      checkedAtLeastOne = true;
      assert.ok(
        /\btext-accent-foreground\b/.test(literal),
        `${path.relative(REPO_ROOT, fileAbs)}: a class string using bg-accent ("${literal}") must also carry text-accent-foreground`,
      );
    }
  }
  // Mutation this catches: every bg-accent use being silently REMOVED (the
  // whole file becomes vacuously green) — the fix's own PublicItemSheet.tsx
  // "active" tile is expected to still use bg-accent, so this must find it.
  assert.ok(checkedAtLeastOne, "expected to find at least one bg-accent usage under components/public/** to check");
});

// ── P13 — no preset/font-pair/preview label names a cafe ───────────────────

test('PIN: no Appearance preset label, font-pair label, or APPEARANCE_PREVIEW_ITEMS sample name mentions a cafe — reuses settings-branding.test.ts\'s banned placeholder strings, plus "Lucifer" (CLAUDE.md: never hardcode a cafe\'s identity in v2 code)', () => {
  // Built from split fragments, never as one contiguous literal: settings-
  // branding.test.ts's own banned-string SCANNER walks every code file
  // (including this one) except itself, so quoting these names whole here
  // would trip THAT pin (its own header names this exact hazard — "CR1.6 did
  // exactly that from a neighbouring test's header").
  const bannedExact = [
    ["My", "Restaurant"].join(" "),
    ["Brewed", "with", "passion"].join(" "),
    ["Thank you!", "Visit again"].join(" "),
    ["DEFAULT_RESTAURANT", "_NAME"].join(""),
  ];
  const files = [APPEARANCE_PRESETS, APPEARANCE_FIELDS_UTILS, APPEARANCE_PREVIEW];
  for (const rel of files) {
    const src = readSrc(rel);
    for (const needle of bannedExact) {
      assert.ok(!src.includes(needle), `${rel} must not contain the banned placeholder "${needle}"`);
    }
    assert.ok(!/lucifer/i.test(src), `${rel} must never mention "Lucifer" — product names are generic, per-cafe branding comes from Settings only`);
  }
});
