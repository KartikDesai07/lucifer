// The "Paper & Ink" palette (app/globals.css) is the base every redesigned
// screen reuses, so its readable pairings are pinned here, measured from the
// CSS itself — change a token and this says which pairing broke. Text needs
// 4.5:1 (WCAG 1.4.3); a control's edge or a state mark needs 3:1 (1.4.11).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CSS = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

const TEXT_MIN = 4.5;
const NON_TEXT_MIN = 3;

/** Every --brand-* token declared as a hex colour on :root. */
function brandTokens(): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const block of CSS.matchAll(/:root\s*\{([^}]*)\}/g)) {
    for (const m of block[1].matchAll(/--brand-([a-z-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) tokens.set(m[1], m[2]);
  }
  return tokens;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const WHITE = "#ffffff";

// [foreground, background, minimum, where it is used]
const PAIRS: ReadonlyArray<readonly [string, string, number, string]> = [
  ["ink", "slip", TEXT_MIN, "body text on cards and fields"],
  ["ink", "paper", TEXT_MIN, "sidebar rows, page text on paper"],
  ["ink", "wash", TEXT_MIN, "a hovered sidebar row"],
  ["slip", "ink", TEXT_MIN, "the primary button's label"],
  ["slip", "ink-hover", TEXT_MIN, "the primary button's label on hover"],
  ["muted", "slip", TEXT_MIN, "secondary text on cards"],
  ["muted", "paper", TEXT_MIN, "sidebar section labels, the vendor mark"],
  ["muted", "wash", TEXT_MIN, "the role line on the hovered account row"],
  ["danger", "slip", TEXT_MIN, "field and sign-in errors"],
  ["field", "slip", NON_TEXT_MIN, "a text field's border"],
  ["accent", "slip", NON_TEXT_MIN, "the active nav icon, focus rings on cards"],
  ["accent", "paper", NON_TEXT_MIN, "focus rings on the sidebar"],
];

test("the brand palette parses from app/globals.css — every token a pairing below needs is present", () => {
  const tokens = brandTokens();
  assert.ok(tokens.size >= 10, `expected the full palette, parsed ${tokens.size} tokens`);
  for (const [fg, bg] of PAIRS) {
    assert.ok(tokens.has(fg), `--brand-${fg} must be declared on :root`);
    assert.ok(tokens.has(bg), `--brand-${bg} must be declared on :root`);
  }
});

test("every brand pairing in use meets its WCAG contrast minimum", () => {
  const tokens = brandTokens();
  assert.ok(PAIRS.length > 0, "the pairing list itself must not be empty");
  for (const [fg, bg, min, where] of PAIRS) {
    const ratio = contrast(tokens.get(fg)!, tokens.get(bg)!);
    assert.ok(ratio >= min, `${fg} on ${bg} (${where}) is ${ratio.toFixed(2)}:1, needs ${min}:1`);
  }
});

test("the sidebar's request badge — white on the brand danger red — is readable", () => {
  const ratio = contrast(WHITE, brandTokens().get("danger")!);
  assert.ok(ratio >= TEXT_MIN, `white on danger is ${ratio.toFixed(2)}:1`);
});
