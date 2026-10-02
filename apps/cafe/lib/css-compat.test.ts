import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import postcss, { type Node } from "postcss";
import tailwind from "@tailwindcss/postcss";
import oklab from "@csstools/postcss-oklab-function";
import colorMix from "@csstools/postcss-color-mix-function";

test("production CSS supplies RGB tokens for WebView 109 and gates modern overrides", async () => {
  const from = path.resolve(__dirname, "../app/globals.css");
  const { root } = await postcss([
    tailwind({ base: path.resolve(__dirname, ".."), optimize: true }),
    colorMix({ preserve: true }),
    oklab({ preserve: true }),
  ]).process(readFileSync(from, "utf8"), { from });
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
