import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const css = read("app/globals.css");
const start = css.indexOf("@theme inline {");
const themeInline = css.slice(start, css.indexOf("\n}", start));

test("brand-fonts.ts loads no next/font face and exports an empty variable list", () => {
  const src = read("lib/brand-fonts.ts");
  assert.ok(start >= 0, "globals.css has an @theme inline block");
  assert.ok(!/next\/font/.test(src), "brand-fonts.ts must not import next/font");
  assert.match(
    src,
    /export const brandFontVariables\s*=\s*""/,
    "brandFontVariables is exported as an empty string",
  );
});

test("font-brand-sans and font-brand-display resolve to Geist", () => {
  assert.ok(
    themeInline.includes("--font-brand-sans: var(--font-geist-sans);"),
    "--font-brand-sans is Geist",
  );
  assert.ok(
    themeInline.includes("--font-brand-display: var(--font-geist-sans);"),
    "--font-brand-display is Geist",
  );
  assert.ok(
    themeInline.includes("--font-sans: var(--font-geist-sans);"),
    "--font-sans stays Geist",
  );
});

test("lib/fonts.ts still declares the Geist sans variable", () => {
  assert.ok(
    read("lib/fonts.ts").includes('variable: "--font-geist-sans"'),
    "fonts.ts declares --font-geist-sans",
  );
});

test("Shrikhand 400 loads through next/font/google and is registered as font-brand-script", () => {
  const src = read("lib/fonts.ts");
  assert.ok(/Shrikhand/.test(src) && src.includes("next/font/google"), "fonts.ts imports Shrikhand from next/font/google");
  assert.match(src, /Shrikhand\(\{[^}]*weight:\s*"400"/, "Shrikhand loads weight 400 (values 1.3)");
  assert.match(src, /Shrikhand\(\{[^}]*variable:\s*"--font-shrikhand"/, "Shrikhand sets a CSS variable");
  assert.ok(/fontVariables\s*=[^;]*shrikhand\.variable/.test(src), "fontVariables carries the Shrikhand variable (root layout and global-error)");
  assert.ok(
    themeInline.includes("--font-brand-script: var(--font-shrikhand)"),
    "--font-brand-script resolves to Shrikhand in @theme inline",
  );
});
