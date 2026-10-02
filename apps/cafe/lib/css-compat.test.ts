import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import postcss, { type Node, type Root, type Rule } from "postcss";
import tailwind from "@tailwindcss/postcss";
import oklab from "@csstools/postcss-oklab-function";
import colorMix from "@csstools/postcss-color-mix-function";
import tintFallback from "../postcss-tint-fallback.cjs";

// The production pipeline from postcss.config.mjs, in the same order.
async function compileCss(): Promise<Root> {
  const from = path.resolve(__dirname, "../app/globals.css");
  const { root } = await postcss([
    tailwind({ base: path.resolve(__dirname, ".."), optimize: true }),
    colorMix({ preserve: true }),
    oklab({ preserve: true }),
    tintFallback(),
  ]).process(readFileSync(from, "utf8"), { from });
  return root;
}

const MIX = /^color-mix\(in oklab,\s*var\((--[\w-]+)\)\s+([\d.]+)%,\s*transparent\)$/;

test("production CSS supplies RGB tokens for WebView 109 and gates modern overrides", async () => {
  const root = await compileCss();
  let rgbTokens = 0;
  root.walkDecls((decl) => {
    if (!decl.prop.startsWith("--")) return;
    if (/^(rgb\(|#[\da-f])/i.test(decl.value)) rgbTokens++;
    if (!/oklch\(|oklab\(|color\(display-p3/.test(decl.value)) return;
    let node: Node | undefined = decl.parent;
    while (node && !(node.type === "atrule" && "name" in node && node.name === "supports")) node = node.parent;
    assert.ok(node, `${decl.prop} must not override the RGB fallback in an old WebView`);
  });
  assert.ok(rgbTokens > 30, "both semantic tokens and Tailwind palette are compiled to RGB");
});

test("old-WebView tints: no opacity utility on a theme colour keeps a solid fallback", async () => {
  const root = await compileCss();
  const twins = new Set<string>();
  root.walkDecls(/-rgb$/, (decl) => {
    twins.add(decl.prop.slice(0, -"-rgb".length));
  });
  const solid: string[] = [];
  let rewritten = 0;
  root.walkAtRules("supports", (supports) => {
    if (!/color-mix\(in lab/.test(supports.params)) return;
    supports.walkDecls((modern) => {
      const m = MIX.exec(modern.value);
      if (!m || !twins.has(m[1])) return;
      const fallback = tintFallback.findFallback(supports, modern);
      if (fallback?.value === `rgb(var(${m[1]}-rgb) / ${m[2]}%)`) rewritten++;
      else solid.push(`${(modern.parent as Rule).selector ?? "(nested)"} ${modern.prop}: ${fallback?.value ?? "no fallback"}`);
    });
  });
  assert.deepEqual(solid, [], "every tint on a theme colour must fall back to rgb(var(--x-rgb) / N%)");
  assert.ok(rewritten > 20, `the POS uses dozens of tints; only ${rewritten} were rewritten`);
  const css = root.toString();
  for (const [cls, token, pct] of [
    ["bg-primary\\/10", "--primary", "10"],
    ["bg-destructive\\/10", "--destructive", "10"],
    ["bg-muted\\/40", "--muted", "40"],
  ] as const) {
    assert.ok(css.includes(`.${cls}{background-color:rgb(var(${token}-rgb) / ${pct}%)}`), `${cls} must fall back to an rgb() alpha`);
  }
});

test("old-WebView tints: light and dark themes each define their own channel twins", async () => {
  const root = await compileCss();
  const selectors: string[] = [];
  root.walkDecls("--primary-rgb", (decl) => {
    if (decl.parent?.type === "rule") selectors.push((decl.parent as Rule).selector);
  });
  assert.ok(selectors.some((s) => s.includes(":root")), "light theme twin");
  assert.ok(selectors.some((s) => s.includes(".dark")), "dark theme twin");
});

test("old-WebView tints: a token with its own alpha in one theme gets no twin anywhere; a merged plain utility stays solid", async () => {
  // --line is translucent in dark: a light-only twin would paint dark tints with the light channels.
  const css =
    ":root{--line:#e2e8f0;--tone:#2563eb}.dark{--line:rgba(255, 255, 255, 0.1);--tone:rgb(226, 232, 240)}" +
    ".a\\/50{border-color:var(--line)}@supports (color:color-mix(in lab, red, red)){.a\\/50{border-color:color-mix(in oklab, var(--line) 50%, transparent)}}" +
    ".b,.b\\/10{color:var(--tone)}@supports (color:color-mix(in lab, red, red)){.b\\/10{color:color-mix(in oklab, var(--tone) 10%, transparent)}}";
  const out = (await postcss([tintFallback()]).process(css, { from: undefined })).css;
  assert.ok(!out.includes("--line-rgb"), "no twin for a token that is not plain sRGB in every theme");
  assert.ok(out.includes(".a\\/50{border-color:var(--line)}"), "its tint keeps Tailwind's fallback");
  assert.ok(out.includes(".b{color:var(--tone)}"), "the plain utility keeps its solid colour");
  assert.ok(out.includes(".b\\/10{color:rgb(var(--tone-rgb) / 10%)}"), "the tint split out of the merged rule");
  assert.ok(out.includes(".dark{--line:rgba(255, 255, 255, 0.1);--tone:rgb(226, 232, 240);--tone-rgb:226 232 240}"), "dark twin");
});

test("old-WebView tints: the colour parser takes rgb() and hex, and refuses alpha", () => {
  assert.equal(tintFallback.channelsOf("rgb(37 99 235)"), "37 99 235");
  assert.equal(tintFallback.channelsOf("rgb(37, 99, 235)"), "37 99 235");
  assert.equal(tintFallback.channelsOf("#2563eb"), "37 99 235");
  assert.equal(tintFallback.channelsOf("#fff"), "255 255 255");
  assert.equal(tintFallback.channelsOf("rgb(0 0 0 / 0.1)"), null, "a token with its own alpha keeps Tailwind's fallback");
  assert.equal(tintFallback.channelsOf("#0000001a"), null);
  assert.equal(tintFallback.channelsOf("oklch(0.6 0.2 260)"), null);
});
