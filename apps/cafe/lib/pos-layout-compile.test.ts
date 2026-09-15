// CB-1c round 2b — real Tailwind compile pin. Every other pos-layout pin
// checks a class STRING; this one drives the actual Tailwind 4.3.1 compiler
// (in node_modules) over the POS class candidates and asserts the emitted
// CSS, so a build-time class-name/arbitrary-value typo that every string
// pin above would miss still fails loud. Precedent for driving the compiler
// from node: scratchpad/tw-probe.mjs (CB-1c.0 F0's own probe method) —
// resolve tailwindcss/package.json via createRequire, import dist/lib.mjs,
// provide a loadStylesheet that maps "tailwindcss" -> its index.css, then
// compile('@import "tailwindcss";', {...}).build(candidates).
//
// DB-free (no fake ports needed — this drives a real, pure compiler over
// literal strings) and self-contained; ~2s to run.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  POS_ROOT_CLASS,
  POS_CHIP_ROW_CLASS,
  POS_ROOT_CHROME_REM_BASE,
  POS_ROOT_CHROME_REM_MD,
  POS_ROOT_CHROME_REM_XL,
  POS_ROOT_FLOOR_REM_BASE,
  POS_ROOT_FLOOR_REM_XL,
  POS_ALERT_HEIGHT_VAR,
  POS_HEADER_CONTROL_CLASS,
  POS_CART_STEPPER_CLASS,
  POS_TILE_OPTIONS_BUTTON_CLASS,
  POS_TILE_OPTIONS_RESERVE_CLASS,
  POS_CHIP_CLASS,
  POS_CART_CTA_CLASS,
  POS_MOBILE_BAR_BUTTON_CLASS,
  POS_PRESS_FEEDBACK_CLASS,
  POS_DIALOG_LIST_CAP_CLASS,
  POS_MOVE_TABLE_LIST_CAP_CLASS,
} from "@/lib/pos-layout";

// Hand-typed to the minimal slice of Tailwind's internal compiler API this
// file actually calls — no @types package ships for tailwindcss/dist/lib.mjs
// and the repo convention (testing.md) is no `any`, so this is an interface,
// not a blanket cast.
interface TailwindCompiled {
  build(candidates: string[]): string;
}
interface StylesheetResult {
  base: string;
  content: string;
}
type LoadStylesheet = (id: string, base: string) => Promise<StylesheetResult>;
type LoadModule = (id: string, base: string) => Promise<unknown>;
interface CompileOptions {
  base: string;
  loadStylesheet: LoadStylesheet;
  loadModule: LoadModule;
}
interface TailwindLib {
  compile(css: string, options: CompileOptions): Promise<TailwindCompiled>;
}

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const req = createRequire(path.join(CAFE_ROOT, "package.json"));
const TAILWIND_DIR = path.dirname(req.resolve("tailwindcss/package.json"));

const loadStylesheet: LoadStylesheet = async (id, base) => {
  const file =
    id === "tailwindcss"
      ? path.join(TAILWIND_DIR, "index.css")
      : id.startsWith("tailwindcss/")
        ? path.join(TAILWIND_DIR, id.slice("tailwindcss/".length))
        : path.resolve(base, id);
  return { base: path.dirname(file), content: readFileSync(file, "utf8") };
};
const loadModule: LoadModule = async () => {
  throw new Error("pos-layout-compile.test.ts: no Tailwind plugin/config modules expected for this candidate set");
};

async function compileCandidates(candidates: string[]): Promise<string> {
  const lib = (await import(pathToFileURL(path.join(TAILWIND_DIR, "dist/lib.mjs")).href)) as TailwindLib;
  const compiled = await lib.compile(`@import "tailwindcss";`, { base: CAFE_ROOT, loadStylesheet, loadModule });
  return compiled.build(candidates);
}

test("PIN: real Tailwind compiles POS_ROOT_CLASS/POS_CHIP_ROW_CLASS/body-dvh candidates to the exact CSS the height-chain contract assumes — no mangled var()/media-query emission", async () => {
  const candidates = [
    ...POS_ROOT_CLASS.split(/\s+/),
    ...POS_CHIP_ROW_CLASS.split(/\s+/),
    "min-h-screen",
    "supports-[height:1dvh]:min-h-dvh",
  ].filter(Boolean);

  const raw = await compileCandidates(candidates);
  const css = raw.replace(/\s+/g, " ").trim();

  // Needles built from the constants (never re-typed literals, testing.md) —
  // a drifted constant trips this pin instead of a hand-typed number silently
  // agreeing with itself.
  const baseHeightDecl =
    "height: calc(100vh - " + POS_ROOT_CHROME_REM_BASE + "rem - var(" + POS_ALERT_HEIGHT_VAR + ",0px));";
  const baseDvhBlock =
    "@supports (height:1dvh) { height: calc(100dvh - " +
    POS_ROOT_CHROME_REM_BASE +
    "rem - var(" +
    POS_ALERT_HEIGHT_VAR +
    ",0px)); }";
  const mdBlock =
    "@media (width >= 48rem) { height: calc(100vh - " +
    POS_ROOT_CHROME_REM_MD +
    "rem - var(" +
    POS_ALERT_HEIGHT_VAR +
    ",0px)); }";
  const xlBlock = "@media (width >= 80rem) { height: calc(100vh - " + POS_ROOT_CHROME_REM_XL + "rem); }";
  // The two compound variants (breakpoint + @supports): the md one is the rule
  // that actually governs the owner's md+, dvh-capable tablet (review F9).
  const mdDvhBlock =
    "@media (width >= 48rem) { @supports (height:1dvh) { height: calc(100dvh - " +
    POS_ROOT_CHROME_REM_MD +
    "rem - var(" +
    POS_ALERT_HEIGHT_VAR +
    ",0px)); } }";
  const xlDvhBlock =
    "@media (width >= 80rem) { @supports (height:1dvh) { height: calc(100dvh - " + POS_ROOT_CHROME_REM_XL + "rem); } }";
  const floorBaseDecl = "min-height: " + POS_ROOT_FLOOR_REM_BASE + "rem;";
  const floorXlBlock = "@media (width >= 80rem) { min-height: " + POS_ROOT_FLOOR_REM_XL + "rem; }";
  const dvhFloorBlock = "@supports (height:1dvh) { min-height: 100dvh; }";
  // The vh side of the body floor — and the whole premise of app/m/layout.tsx
  // keeping the diner flow at its old 100vh document height (review F2): a
  // Tailwind/theme change that redefined `screen` would otherwise pass silently.
  const vhFloorDecl = "min-height: 100vh;";

  assert.ok(css.includes(baseHeightDecl), `compiled CSS must include "${baseHeightDecl}"`);
  assert.ok(
    css.includes(baseDvhBlock),
    `compiled CSS must include the dvh variant nested inside @supports (height:1dvh): "${baseDvhBlock}"`,
  );
  assert.ok(
    css.includes(mdBlock),
    `compiled CSS must include the md height variant nested inside its own @media wrapper: "${mdBlock}"`,
  );
  assert.ok(
    css.includes(xlBlock),
    `compiled CSS must include the xl height variant (no alert-var term) nested inside its own @media wrapper: "${xlBlock}"`,
  );
  assert.ok(
    css.includes(mdDvhBlock),
    `compiled CSS must include the md+dvh compound nested @media > @supports: "${mdDvhBlock}"`,
  );
  assert.ok(
    css.includes(xlDvhBlock),
    `compiled CSS must include the xl+dvh compound nested @media > @supports: "${xlDvhBlock}"`,
  );
  assert.ok(css.includes(floorBaseDecl), `compiled CSS must include "${floorBaseDecl}"`);
  assert.ok(
    css.includes(floorXlBlock),
    `compiled CSS must include the xl min-height floor nested inside @media (width >= 80rem): "${floorXlBlock}"`,
  );
  assert.ok(
    css.includes(dvhFloorBlock),
    `compiled CSS must include the body's dvh min-height floor nested inside @supports (height:1dvh): "${dvhFloorBlock}"`,
  );
  assert.ok(css.includes(vhFloorDecl), `compiled CSS must include min-h-screen's plain "${vhFloorDecl}" — the floor /m and the body fall back to`);

  // Landmark: the plain utilities from POS_CHIP_ROW_CLASS must also have
  // compiled — proves the whole candidate list reached the compiler, not just
  // the arithmetic-bearing tokens asserted above.
  assert.ok(css.includes(".flex {"), "landmark: compiled CSS must include the plain .flex utility");
  assert.ok(css.includes("gap: calc(var(--spacing) * 2);"), "landmark: compiled CSS must include gap-2's declaration");

  // No mangled var() emission: every "var(--pos-alert-h" opener must be
  // immediately followed by exactly ",0px)" — a split/whitespace-mangled
  // emission would make these two counts diverge even where the exact-text
  // check above already caught the common failure mode.
  const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const varOpenNeedle = "var(" + POS_ALERT_HEIGHT_VAR;
  const varOpenCount = (css.match(new RegExp(escapeRegex(varOpenNeedle), "g")) ?? []).length;
  const varFullNeedle = varOpenNeedle + ",0px)";
  const varFullCount = (css.match(new RegExp(escapeRegex(varFullNeedle), "g")) ?? []).length;
  // Exactly the four below-xl height tokens subtract the alert var (base
  // vh/dvh + md vh/dvh); the two xl height tokens and the two min-h floors
  // never reference it.
  assert.equal(
    varFullCount,
    4,
    `"${varFullNeedle}" must appear exactly 4 times (the four below-xl height tokens), got ${varFullCount}`,
  );
  assert.equal(
    varOpenCount,
    varFullCount,
    `every "${varOpenNeedle}" opener must be immediately followed by ",0px)" with no split/whitespace mangling — found ${varOpenCount} openers vs ${varFullCount} well-formed`,
  );
});

test("PIN: real Tailwind compiles the CB-1d.1 touch-feel/device-size tokens to the exact CSS the string/paths pins assume — pointer-fine height variants nested UNDER the xl media query, coarse-pointer active scale/opacity, dialog-cap vh/dvh pairs, and base-before-variant emission order", async () => {
  const candidates = [
    ...POS_HEADER_CONTROL_CLASS.split(/\s+/),
    ...POS_CART_STEPPER_CLASS.split(/\s+/),
    ...POS_TILE_OPTIONS_BUTTON_CLASS.split(/\s+/),
    ...POS_TILE_OPTIONS_RESERVE_CLASS.split(/\s+/),
    ...POS_CHIP_CLASS.split(/\s+/),
    ...POS_CART_CTA_CLASS.split(/\s+/),
    ...POS_MOBILE_BAR_BUTTON_CLASS.split(/\s+/),
    ...POS_PRESS_FEEDBACK_CLASS.split(/\s+/),
    ...POS_DIALOG_LIST_CAP_CLASS.split(/\s+/),
    ...POS_MOVE_TABLE_LIST_CAP_CLASS.split(/\s+/),
  ].filter(Boolean);

  const raw = await compileCandidates(candidates);
  const css = raw.replace(/\s+/g, " ").trim();

  // Header controls / tile options button share the xl:pointer-fine:h-8
  // value; the cart stepper has its own h-7/w-7 pair. The pointer-fine media
  // query nests INSIDE the xl one (width first, capability second) — the
  // cascade the string-level V1 pin assumes.
  assert.ok(
    css.includes("@media (width >= 80rem) { @media (pointer: fine) { height: calc(var(--spacing) * 8); } }"),
    "compiled CSS must include the xl:pointer-fine h-8 rule (header controls + tile options button)",
  );
  assert.ok(
    css.includes("@media (width >= 80rem) { @media (pointer: fine) { height: calc(var(--spacing) * 7); } }"),
    "compiled CSS must include the xl:pointer-fine h-7 rule (cart stepper)",
  );
  assert.ok(
    css.includes("@media (width >= 80rem) { @media (pointer: fine) { width: calc(var(--spacing) * 7); } }"),
    "compiled CSS must include the xl:pointer-fine w-7 rule (cart stepper)",
  );
  assert.ok(
    css.includes("@media (width >= 80rem) { @media (pointer: fine) { height: calc(var(--spacing) * 10); } }"),
    "compiled CSS must include the xl:pointer-fine h-10 rule (POS_CART_CTA_CLASS — g4: the CTA's xl compact size is no longer exempt, it is pointer-fine-gated like every other touch token)",
  );

  // Compositor-only pressed state (POS_PRESS_FEEDBACK_CLASS): scale/opacity
  // only, gated on the coarse-pointer media query, never a paint property.
  assert.ok(
    css.includes("@media (pointer: coarse) { &:active { scale: 0.97; } }"),
    "compiled CSS must include the pointer-coarse active scale rule",
  );
  assert.ok(
    css.includes("@media (pointer: coarse) { &:active { opacity: 80%; } }"),
    "compiled CSS must include the pointer-coarse active opacity rule",
  );
  assert.ok(css.includes("touch-action: manipulation;"), "compiled CSS must include touch-action: manipulation;");
  assert.ok(
    css.includes("-webkit-user-select: none; user-select: none;"),
    "compiled CSS must include the vendor-prefixed user-select: none pair",
  );

  // Dialog-cap vh/dvh pairs (both dialogs' cap classes).
  assert.ok(css.includes("max-height: 60vh;"), "compiled CSS must include max-height: 60vh;");
  assert.ok(
    css.includes("@supports (height:1dvh) { max-height: 60dvh; }"),
    "compiled CSS must include the 60dvh @supports override",
  );
  assert.ok(css.includes("max-height: 50vh;"), "compiled CSS must include max-height: 50vh;");
  assert.ok(
    css.includes("@supports (height:1dvh) { max-height: 50dvh; }"),
    "compiled CSS must include the 50dvh @supports override",
  );

  // g12: both dialog-cap classes ("max-h-[60vh] supports-[height:1dvh]:max-h-[60dvh]"
  // and the 50vh pair) must compile to their ESCAPED selectors, base before
  // the @supports-scoped dvh variant — "equal specificity, source order
  // decides" is exactly the same base-before-variant contract the h-10/h-8
  // ORDER pin below checks for the pointer-fine tokens.
  for (const n of ["60", "50"]) {
    const baseSelectorIdx = css.indexOf(`.max-h-\\[${n}vh\\] {`);
    const dvhSelectorIdx = css.indexOf(`.supports-\\[height\\:1dvh\\]\\:max-h-\\[${n}dvh\\] {`);
    assert.ok(baseSelectorIdx >= 0, `compiled CSS must include the escaped .max-h-\\[${n}vh\\] { rule`);
    assert.ok(dvhSelectorIdx >= 0, `compiled CSS must include the escaped .supports-\\[height\\:1dvh\\]\\:max-h-\\[${n}dvh\\] { rule`);
    assert.ok(
      baseSelectorIdx < dvhSelectorIdx,
      `the base .max-h-[${n}vh] rule (index ${baseSelectorIdx}) must compile BEFORE its supports-dvh variant (index ${dvhSelectorIdx}) — equal specificity, source order decides`,
    );
  }

  // ORDER pin: the base .h-10 utility (header control / chip / options
  // button's un-prefixed size) must compile BEFORE its escaped
  // .xl\:pointer-fine\:h-8 variant selector — this protects the DESKTOP
  // (xl + pointer-fine) compact size specifically: base-before-variant order
  // is what lets the narrower xl:pointer-fine: rule win over the wider base
  // rule at equal specificity. The string-level companion pin lives in
  // pos-layout-paths.test.ts's V1 test (not pos-layout.test.ts, which only
  // holds the pure arithmetic pins) — g22. The glass (coarse-pointer)
  // invariant, by contrast, is order-INDEPENDENT: (pointer: fine) simply
  // never matches on a coarse pointer, so no emission order can make a
  // pointer-fine-gated rule apply there regardless of source order.
  const baseIdx = css.indexOf(".h-10 {");
  const fineVariantIdx = css.indexOf(".xl\\:pointer-fine\\:h-8 {");
  assert.ok(baseIdx >= 0, "compiled CSS must include the base .h-10 { rule");
  assert.ok(fineVariantIdx >= 0, "compiled CSS must include the escaped .xl\\:pointer-fine\\:h-8 { rule");
  assert.ok(
    baseIdx < fineVariantIdx,
    `the base .h-10 rule (index ${baseIdx}) must compile BEFORE its xl:pointer-fine:h-8 variant (index ${fineVariantIdx})`,
  );

  // g4: the same base-before-variant order for the CTA's own pair — .h-12
  // (POS_CART_CTA_CLASS's base height) before its escaped
  // .xl\:pointer-fine\:h-10 variant selector.
  const ctaBaseIdx = css.indexOf(".h-12 {");
  const ctaFineVariantIdx = css.indexOf(".xl\\:pointer-fine\\:h-10 {");
  assert.ok(ctaBaseIdx >= 0, "compiled CSS must include the base .h-12 { rule");
  assert.ok(ctaFineVariantIdx >= 0, "compiled CSS must include the escaped .xl\\:pointer-fine\\:h-10 { rule");
  assert.ok(
    ctaBaseIdx < ctaFineVariantIdx,
    `the base .h-12 rule (index ${ctaBaseIdx}) must compile BEFORE its xl:pointer-fine:h-10 variant (index ${ctaFineVariantIdx})`,
  );

  // Landmark: the whole candidate list reached the compiler, not just the
  // arithmetic-bearing tokens asserted above.
  assert.ok(css.includes(".inline-flex {"), "landmark: compiled CSS must include the plain .inline-flex utility (POS_CHIP_CLASS)");
});
