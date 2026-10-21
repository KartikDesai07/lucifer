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
  POS_PAGE_CLASS,
  POS_BODY_GRID_CLASS,
  POS_ASIDE_CLASS,
  POS_MAIN_CLASS,
  POS_CART_CLASS,
  POS_MOBILE_BAR_CLASS,
  POS_TOOLBAR_CLASS,
  POS_LIST_CLASS,
  POS_CARD_GRID_CLASS,
  POS_CARD_MIN_PX,
  POS_CARD_GAP_PX,
  POS_BODY_COLUMNS_PX,
  POS_MAIN_PAD_B_PX,
  DASHBOARD_HEADER_REM,
  POS_ALERT_HEIGHT_VAR,
  POS_HEADER_CONTROL_CLASS,
  POS_CART_STEPPER_CLASS,
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

async function compileCandidates(candidates: string[], extraCss = ""): Promise<string> {
  const lib = (await import(pathToFileURL(path.join(TAILWIND_DIR, "dist/lib.mjs")).href)) as TailwindLib;
  const compiled = await lib.compile(`@import "tailwindcss";\n${extraCss}`, { base: CAFE_ROOT, loadStylesheet, loadModule });
  return compiled.build(candidates);
}

// U1 Task 1 (values 1.1, 2.0, 6.2; design 5): the page's frame uses the app's own breakpoints (tab 720px, desk
// 1100px) and the nav's `wide` variant, so this compile reads those three definitions out of app/globals.css (the real
// config, never re-typed) and adds them to the compiler's input.
function appBreakpointsCss(): string {
  const globals = readFileSync(path.join(CAFE_ROOT, "app/globals.css"), "utf8");
  const tab = globals.match(/--breakpoint-tab:\s*[\d.]+rem;/);
  const desk = globals.match(/--breakpoint-desk:\s*[\d.]+rem;/);
  const wide = globals.match(/@custom-variant wide \{[\s\S]*?\n\}/);
  assert.ok(tab && desk && wide, "app/globals.css declares the tab and desk breakpoints and the wide variant");
  return `@theme { ${tab![0]} ${desk![0]} }\n${wide![0]}\n`;
}

test("PIN: real Tailwind compiles the /pos frame (page height, body grid, regions, main's foot, the bar) to the exact CSS the frame pins assume — and the column sets cascade lg < desk < wide", async () => {
  const candidates = [
    ...POS_PAGE_CLASS.split(/\s+/),
    ...POS_BODY_GRID_CLASS.split(/\s+/),
    ...POS_ASIDE_CLASS.split(/\s+/),
    ...POS_MAIN_CLASS.split(/\s+/),
    ...POS_CART_CLASS.split(/\s+/),
    ...POS_MOBILE_BAR_CLASS.split(/\s+/),
    ...POS_TOOLBAR_CLASS.split(/\s+/),
    ...POS_LIST_CLASS.split(/\s+/),
    ...POS_CARD_GRID_CLASS.split(/\s+/),
    "min-h-screen",
    "supports-[height:1dvh]:min-h-dvh",
  ].filter(Boolean);

  const raw = await compileCandidates(candidates, appBreakpointsCss());
  const css = raw.replace(/\s+/g, " ").trim();

  // Needles built from the constants (never re-typed literals, testing.md).
  const alert = "var(" + POS_ALERT_HEIGHT_VAR + ",0px)";
  const pageHeight = "height: calc(100vh - " + DASHBOARD_HEADER_REM + "rem - " + alert + ");";
  const pageDvh = "@supports (height:1dvh) { height: calc(100dvh - " + DASHBOARD_HEADER_REM + "rem - " + alert + "); }";
  const { wide, desk, tablet } = POS_BODY_COLUMNS_PX;
  const cols = "grid-template-columns: minmax(0,1fr);";
  const lgCols = "@media (width >= 64rem) { grid-template-columns: minmax(0,1fr) " + tablet.cart + "px; }";
  const deskCols = "@media (width >= 68.75rem) { grid-template-columns: " + desk.aside + "px minmax(0,1fr) " + desk.cart + "px; }";
  const wideCols =
    "@media (width >= 80rem) { &:where(html:not([data-nav-collapsed]) *) { grid-template-columns: " +
    wide.aside +
    "px minmax(0,1fr) " +
    wide.cart +
    "px; } }";
  const cmpFoot = "@media (width < 64rem) { padding-bottom: " + POS_MAIN_PAD_B_PX.cmp + "px; }";
  const phoneFoot = "@media (width < 45rem) { padding-bottom: " + POS_MAIN_PAD_B_PX.phone + "px; }";
  const asideOn = "@media (width >= 68.75rem) { display: flex; }";
  const cartOn = "@media (width >= 64rem) { display: flex; }";
  const barOff = "@media (width >= 64rem) { display: none; }";
  // U1 Task 2 (values 3.1 toolbar, 0.3 toolPad / listPad): the sticky toolbar and the list wrapper, phone forms last.
  const toolbarPhoneTop = "@media (width < 45rem) { padding-top: calc(var(--spacing) * 2.5); }";
  const listPhoneY = "@media (width < 45rem) { padding-block: calc(var(--spacing) * 3.5); }";
  // U1 Task 3 (values 4.1): the card grid's auto-fill tracks and 8px gap.
  const cardTracks = "grid-template-columns: repeat(auto-fill,minmax(min(" + POS_CARD_MIN_PX + "px, 100%),1fr));";
  const cardGap = "gap: calc(var(--spacing) * " + POS_CARD_GAP_PX / 4 + ");";

  for (const [needle, what] of [
    [pageHeight, "the page's vh height"],
    [pageDvh, "the page's dvh height inside @supports (height:1dvh)"],
    [cols, "one menu column below 1024px"],
    [lgCols, "the cart column from 1024px"],
    [deskCols, "the category and cart columns from 1100px"],
    [wideCols, "the wide nav's narrower columns from 1280px, nav open"],
    [cmpFoot, "main's 100px foot below 1024px"],
    [phoneFoot, "main's 150px foot on a phone"],
    [asideOn, "the category column shows from 1100px"],
    [cartOn, "the cart column shows from 1024px"],
    [barOff, "the bar hides from 1024px"],
    ["position: sticky;", "the toolbar sticks inside main"],
    ["z-index: 3;", "the toolbar sits over the cards (z-index 3)"],
    [toolbarPhoneTop, "the toolbar's 10px top padding on a phone"],
    [listPhoneY, "the list's 14px top and bottom padding on a phone"],
    [cardTracks, "the card grid's auto-fill tracks of at least 200px"],
    [cardGap, "the card grid's 8px gap"],
    ["min-height: 100vh;", "min-h-screen's plain floor — the floor /m and the body fall back to"],
    ["@supports (height:1dvh) { min-height: 100dvh; }", "the body's dvh floor"],
  ] as const) {
    assert.ok(css.includes(needle), `compiled CSS must include ${what}: "${needle}"`);
  }

  // The cascade: the later set wins where several match (a 1280px open nav matches all three).
  assert.ok(css.indexOf(lgCols) < css.indexOf(deskCols), "lg's columns come before desk's");
  assert.ok(css.indexOf(deskCols) < css.indexOf(wideCols), "desk's columns come before wide's");
  assert.ok(css.indexOf(cmpFoot) < css.indexOf(phoneFoot), "main's phone foot comes after its 1024px one (the narrower wins)");
  assert.ok(css.indexOf(cartOn) < css.indexOf(asideOn), "landmark: breakpoints emit in width order");

  // No mangled var() emission: every "var(--pos-alert-h" opener is followed by ",0px)", once per page height token.
  const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const varOpenNeedle = "var(" + POS_ALERT_HEIGHT_VAR;
  const varOpenCount = (css.match(new RegExp(escapeRegex(varOpenNeedle), "g")) ?? []).length;
  const varFullCount = (css.match(new RegExp(escapeRegex(alert), "g")) ?? []).length;
  assert.equal(varFullCount, 2, `"${alert}" must appear exactly twice (the page's vh and dvh heights), got ${varFullCount}`);
  assert.equal(varOpenCount, varFullCount, `every "${varOpenNeedle}" opener must be well-formed — ${varOpenCount} openers vs ${varFullCount}`);
});

test("PIN: real Tailwind compiles the CB-1d.1 touch-feel/device-size tokens to the exact CSS the string/paths pins assume — pointer-fine height variants nested UNDER the xl media query, coarse-pointer active scale/opacity, dialog-cap vh/dvh pairs, and base-before-variant emission order", async () => {
  const candidates = [
    ...POS_HEADER_CONTROL_CLASS.split(/\s+/),
    ...POS_CART_STEPPER_CLASS.split(/\s+/),
    ...POS_CART_CTA_CLASS.split(/\s+/),
    ...POS_MOBILE_BAR_BUTTON_CLASS.split(/\s+/),
    ...POS_PRESS_FEEDBACK_CLASS.split(/\s+/),
    ...POS_DIALOG_LIST_CAP_CLASS.split(/\s+/),
    ...POS_MOVE_TABLE_LIST_CAP_CLASS.split(/\s+/),
  ].filter(Boolean);

  const raw = await compileCandidates(candidates);
  const css = raw.replace(/\s+/g, " ").trim();

  // Header controls carry the xl:pointer-fine:h-8 value (U1 Task 3: the
  // tile's corner options button that shared it is gone); the cart stepper has its own h-7/w-7 pair. The pointer-fine media
  // query nests INSIDE the xl one (width first, capability second) — the
  // cascade the string-level V1 pin assumes.
  assert.ok(
    css.includes("@media (width >= 80rem) { @media (pointer: fine) { height: calc(var(--spacing) * 8); } }"),
    "compiled CSS must include the xl:pointer-fine h-8 rule (header controls)",
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

  // ORDER pin: the base .h-10 utility (the header control's un-prefixed
  // size) must compile BEFORE its escaped
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
  assert.ok(css.includes(".justify-between {"), "landmark: compiled CSS must include the plain .justify-between utility (POS_MOBILE_BAR_BUTTON_CLASS)");
});
