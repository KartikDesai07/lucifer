import { settingsOf } from "./print-template-golden.fixtures"; // FIRST (selects React's production renderer; harmless here)
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import {
  PRINT_FONT_CATALOG,
  PRINT_FONT_FACES,
  PRINT_FONT_FAMILIES_MAX,
  PRINT_FONT_WEIGHTS_MAX,
  type PrintFontFace,
} from "@pos/shared/print-fonts";
import { BILL_DESIGNS, KOT_DESIGNS, PRINT_FONT_KEYS } from "@pos/shared/print-template";
import { stripComments } from "./source-pin-utils";
import {
  BILL_DESIGN_FACES,
  KOT_DESIGN_FACES,
  defaultBillTemplate,
  defaultKotTemplate,
  templateFaces,
} from "@/lib/print-template-designs";
import { printFontPreloadDescriptors } from "@/hooks/use-print-fonts-preload";

// Print customization S3 slice A: source-read pins for the self-hosted slip faces (01-PLAN §2.5). The CSS, the
// font files, their licences, the call sites and the slip sources' "no variable fonts, no grey" rules.

const CAFE_ROOT = path.resolve(__dirname, "..");
const FONT_DIR = path.join(CAFE_ROOT, "assets", "print-fonts");
const SLIP_DIR = path.join(CAFE_ROOT, "components", "print", "slip");
const read = (...p: string[]) => readFileSync(path.join(CAFE_ROOT, ...p), "utf8");
const CSS = read("app", "print-fonts.css");
// CSS comments are not rules: strip them before looking at declarations or forbidden tokens.
// The shared scanner (testing rules: never re-roll the naive block-comment regex). CSS has no line comments, and
// this file has no "//" outside its comments, so the JS/TS scanner reads it correctly.
const CSS_RULES = stripComments(CSS);
const FACE_BLOCKS = [...CSS_RULES.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);

const LICENSE_OF: Record<PrintFontFace, string> = {
  sans: "inter-OFL.txt",
  condensed: "barlow-condensed-OFL.txt",
  slab: "roboto-slab-LICENSE.txt",
  mono: "ibm-plex-mono-OFL.txt",
  display: "archivo-black-OFL.txt",
  devanagari: "noto-sans-devanagari-OFL.txt",
};

function declared(): { family: string; weight: number; url: string }[] {
  return FACE_BLOCKS.map((b) => ({
    family: /font-family:\s*"([^"]+)"/.exec(b)?.[1] ?? "",
    weight: Number(/font-weight:\s*(\d+)/.exec(b)?.[1]),
    url: /url\("([^"]+)"\)/.exec(b)?.[1] ?? "",
  }));
}

test("(a) print-fonts.css declares exactly the catalog families and weights", () => {
  const faces = declared();
  assert.ok(faces.length > 0);
  for (const face of PRINT_FONT_FACES) {
    const { family, weights } = PRINT_FONT_CATALOG[face];
    const got = faces.filter((f) => f.family === family).map((f) => f.weight).sort();
    assert.deepEqual(got, [...weights].sort(), `${family} weights`);
    assert.ok(got.length <= PRINT_FONT_WEIGHTS_MAX, `${family} ships at most ${PRINT_FONT_WEIGHTS_MAX} weights`);
  }
  const catalogFamilies = new Set(PRINT_FONT_FACES.map((f) => PRINT_FONT_CATALOG[f].family));
  for (const f of faces) assert.ok(catalogFamilies.has(f.family), `unknown family ${f.family}`);
  for (const b of FACE_BLOCKS) {
    assert.match(b, /font-style:\s*normal/);
    assert.match(b, /font-display:\s*swap/);
    assert.match(b, /format\("woff2"\)/);
  }
});

test("(b) every url() resolves to a real woff2 file under assets/print-fonts", () => {
  for (const { url } of declared()) {
    const file = path.resolve(CAFE_ROOT, "app", url);
    assert.equal(path.dirname(file), FONT_DIR, `${url} must point into assets/print-fonts`);
    assert.ok(existsSync(file), `${url} exists`);
    assert.equal(readFileSync(file).subarray(0, 4).toString("latin1"), "wOF2", `${url} is woff2`);
  }
});

test("(c) every .woff2 in the folder is referenced (no orphan)", () => {
  const used = new Set(declared().map((d) => path.basename(d.url)));
  const onDisk = readdirSync(FONT_DIR).filter((f) => f.endsWith(".woff2"));
  assert.ok(onDisk.length > 0);
  for (const f of onDisk) assert.ok(used.has(f), `${f} is not referenced by print-fonts.css`);
});

test("(d) every face has a licence file naming its licence", () => {
  for (const face of PRINT_FONT_FACES) {
    const file = path.join(FONT_DIR, LICENSE_OF[face]);
    assert.ok(existsSync(file), `${LICENSE_OF[face]} exists`);
    assert.match(readFileSync(file, "utf8"), /SIL Open Font License|Apache License/);
  }
});

test("(e) print-fonts.css has no CSS variable and no @import", () => {
  assert.ok(CSS_RULES.includes("@font-face"), "landmark: the stripped css still has its rules");
  assert.ok(!CSS_RULES.includes("var(--"));
  assert.ok(!CSS_RULES.includes("@import"));
});

test("(f) the dashboard layout imports the css and PrintSources calls the preload hook", () => {
  assert.match(read("app", "(dashboard)", "layout.tsx"), /import\s+"\.\.\/print-fonts\.css";/);
  assert.match(read("components", "pos", "PrintSources.tsx"), /usePrintFontsPreload\(settings\);/);
});

// Globbed at test time: the slip folder grows slice by slice.
function slipSources(): { name: string; src: string }[] {
  return readdirSync(SLIP_DIR)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .map((name) => ({ name, src: readFileSync(path.join(SLIP_DIR, name), "utf8") }));
}

test("(g) slip sources set fonts inline: no CSS variable, no arbitrary font class", () => {
  const files = slipSources();
  assert.ok(files.length > 0);
  for (const { name, src } of files) {
    assert.ok(!src.includes("var(--"), `${name} uses var(--`);
    assert.ok(!src.includes("font-["), `${name} uses an arbitrary font-[ class`);
  }
});

// 1-bit thermal threshold (01-PLAN §2.5): a grey, an opacity or a shadow prints as mush or as nothing.
const GREY_TOKENS = ["opacity-", "text-gray", "text-neutral", "text-slate", "text-zinc", "text-stone", "bg-gray", "shadow"];
const GREY_EXEMPT = new Set(["bill-classic-blocks.tsx", "kot-classic-blocks.tsx"]);

test("(h) new slip sources stay 1-bit: no grey, opacity or shadow classes (Classic blocks exempt)", () => {
  assert.ok(slipSources().length > 0);
  for (const { name, src } of slipSources()) {
    if (GREY_EXEMPT.has(name)) continue;
    for (const token of GREY_TOKENS) assert.ok(!src.includes(token), `${name} contains ${token}`);
  }
});

const descriptors = (family: string, weights: number[]) => weights.map((w) => `${w} 16px "${family}"`);

test("(i) printFontPreloadDescriptors", () => {
  assert.deepEqual(printFontPreloadDescriptors(null), []);
  assert.deepEqual(printFontPreloadDescriptors(undefined), []);
  assert.deepEqual(printFontPreloadDescriptors(settingsOf()), []);

  const modern = printFontPreloadDescriptors({ ...settingsOf(), billTemplate: defaultBillTemplate("modern", null) });
  assert.deepEqual(modern, descriptors("POS Print Sans", [500, 700]));

  const cafe = printFontPreloadDescriptors({ ...settingsOf(), billTemplate: defaultBillTemplate("cafe", null) });
  assert.deepEqual(
    [...cafe].sort(),
    [...descriptors("POS Print Sans", [500, 700]), ...descriptors("POS Print Slab", [500, 700])].sort(),
  );

  const kitchenSettings = { ...settingsOf(), kotTemplate: defaultKotTemplate("kitchenBold", null) };
  const kitchen = printFontPreloadDescriptors(kitchenSettings);
  assert.deepEqual(
    [...kitchen].sort(),
    [...descriptors("POS Print Condensed", [500, 700]), ...descriptors("POS Print Sans", [500, 700])].sort(),
  );

  const both = printFontPreloadDescriptors({ ...kitchenSettings, billTemplate: defaultBillTemplate("cafe", null) });
  for (const list of [modern, cafe, kitchen, both]) {
    assert.equal(new Set(list).size, list.length, "no duplicates");
    assert.ok(!list.some((d) => d.includes("Devanagari")), "Devanagari is never preloaded");
  }
  assert.ok(both.length > 0);
});

test("(j) every design x every font stays within the family budget, Devanagari included", () => {
  for (const font of PRINT_FONT_KEYS) {
    for (const design of BILL_DESIGNS) {
      const faces = templateFaces({ font }, BILL_DESIGN_FACES[design], true);
      assert.ok(faces.length <= PRINT_FONT_FAMILIES_MAX, `bill ${design}/${font}: ${faces.join(",")}`);
    }
    for (const design of KOT_DESIGNS) {
      const faces = templateFaces({ font }, KOT_DESIGN_FACES[design], true);
      assert.ok(faces.length <= PRINT_FONT_FAMILIES_MAX, `kot ${design}/${font}: ${faces.join(",")}`);
    }
  }
});
