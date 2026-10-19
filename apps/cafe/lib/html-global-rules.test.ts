import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { stripComments } from "@/lib/source-pin-utils";
import { PAPER_WIDTH_CLASS } from "@/lib/print";

// Ruling R24 (U0 match Task 9 fix round 1): the staff screens take the owner's HTML's global rules (values 1.4) —
// font-variant-numeric: tabular-nums on html/body and on button/input, and the body stack
// 'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif, so a glyph Geist lacks (the "→") falls back as the HTML's
// does instead of to next/font's Arial "Geist Fallback". Scoped by a marker only the staff screens render (the
// dashboard shell and the sign-in screen): the /m diner flow and the print iframes never contain it, and the slips'
// own roots keep their figures.

(globalThis as { React?: typeof React }).React = React;

const CAFE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const raw = (rel: string) => readFileSync(path.join(CAFE, rel), "utf8");
const src = (rel: string) => stripComments(raw(rel));
const CSS = stripComments(raw("app/globals.css"));
const SCOPE = "html:has([data-html-rules])";

/** The brace depth at an index of the stylesheet (0 = a top-level, unlayered rule). */
function depthAt(css: string, at: number): number {
  let depth = 0;
  for (let i = 0; i < at; i += 1) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") depth -= 1;
  }
  return depth;
}

/** The declarations of the first rule whose selector is exactly `selector`. */
function ruleBody(css: string, selector: string): { body: string; at: number } {
  const at = css.indexOf(`${selector} {`);
  if (at < 0) return { body: "", at };
  const open = css.indexOf("{", at);
  return { body: css.slice(open + 1, css.indexOf("}", open)), at };
}

test("the root rule: the HTML's body stack and tabular figures on <html>, unlayered (it must outrank next/font's own variable class)", () => {
  const { body, at } = ruleBody(CSS, SCOPE);
  assert.ok(at >= 0, `landmark: globals.css has a "${SCOPE} { … }" rule`);
  assert.equal(depthAt(CSS, at), 0, "the rule is top-level (unlayered): next/font's --font-geist-sans class is unlayered too");
  assert.ok(
    body.includes("--font-geist-sans: 'Geist', system-ui, -apple-system, 'Segoe UI', sans-serif;"),
    "the sans stack is the HTML's: Geist, then system-ui (not next/font's metric-adjusted Arial)",
  );
  assert.ok(body.includes("font-variant-numeric: tabular-nums;"), "tabular figures on <html>, inherited by body and everything in it");
  assert.match(src("lib/fonts.ts"), /import \{[^}]*\bGeist\b[^}]*\} from "next\/font\/google"/, "the face next/font registers as 'Geist'");
});

test("button and input repeat the figures (the HTML's button,input rule); a utility can still override them", () => {
  const { body, at } = ruleBody(CSS, `${SCOPE} :is(button, input)`);
  assert.ok(at >= 0, "landmark: the button/input rule");
  assert.ok(depthAt(CSS, at) >= 1, "inside a layer (base), so normal-nums on an element still wins");
  assert.ok(body.includes("font-variant-numeric: tabular-nums;"), "tabular figures on buttons and inputs");
});

test("the slips keep their own figures: every paper width's root resets them (the on-screen previews stay the paper)", () => {
  const at = CSS.indexOf("font-variant-numeric: normal;");
  assert.ok(at >= 0, "landmark: a reset rule");
  const selector = CSS.slice(CSS.lastIndexOf("}", at) + 1, CSS.lastIndexOf("{", at)).trim();
  for (const cls of Object.values(PAPER_WIDTH_CLASS)) {
    const escaped = `.${cls.replace(/[[\]]/g, (c) => `\\${c}`)}`;
    assert.ok(selector.includes(escaped), `the reset names the ${cls} slip root (got "${selector}")`);
  }
  assert.ok(selector.includes(".bg-white") && selector.includes(".text-black"), "only a slip root: white paper, black ink, a paper width");
});

test("the marker renders hidden, on the dashboard shell and the sign-in screen only — never in the /m diner flow", async () => {
  const { HtmlRulesScope } = await import("@/components/layout/HtmlRulesScope");
  assert.equal(renderToStaticMarkup(createElement(HtmlRulesScope)), '<span hidden="" data-html-rules=""></span>', "an empty hidden span");
  assert.match(src("app/(dashboard)/layout.tsx"), /<HtmlRulesScope \/>/, "the dashboard shell (every staff page, the lock, their dialogs)");
  assert.match(src("components/auth/AuthShell.tsx"), /<HtmlRulesScope \/>/, "the sign-in screen");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(path.join(CAFE, dir))) {
      const rel = `${dir}/${e}`;
      if (statSync(path.join(CAFE, rel)).isDirectory()) walk(rel);
      else if (/\.tsx?$/.test(e)) files.push(rel);
    }
  };
  walk("app/m");
  walk("components/public");
  for (const f of files) assert.ok(!/HtmlRulesScope|data-html-rules/.test(src(f)), `${f} never carries the staff marker`);
  assert.ok(!/data-html-rules|HtmlRulesScope/.test(src("app/layout.tsx")), "the root layout (shared with /m) does not either");
});
