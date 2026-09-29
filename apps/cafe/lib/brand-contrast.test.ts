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
  ["ink", "slip", TEXT_MIN, "body text on cards and fields, the active sidebar row"],
  ["ink", "paper", TEXT_MIN, "page text on paper"],
  ["ink", "sidebar", TEXT_MIN, "the brand name and account name on the sidebar"],
  ["ink", "wash", TEXT_MIN, "a hovered sidebar row"],
  ["slip", "ink", TEXT_MIN, "the primary button's label"],
  ["slip", "ink-hover", TEXT_MIN, "the primary button's label on hover"],
  ["muted", "slip", TEXT_MIN, "secondary text on cards"],
  ["muted", "paper", TEXT_MIN, "the vendor mark on paper"],
  ["muted", "sidebar", TEXT_MIN, "sidebar section labels, the product name, row icons"],
  ["muted", "wash", TEXT_MIN, "the role line on the hovered account row"],
  ["danger", "slip", TEXT_MIN, "field and sign-in errors"],
  ["field", "slip", NON_TEXT_MIN, "a text field's border"],
  ["accent", "slip", NON_TEXT_MIN, "the active nav icon, focus rings on cards"],
  ["accent", "paper", NON_TEXT_MIN, "focus rings on paper"],
  ["accent", "sidebar", NON_TEXT_MIN, "focus rings on the sidebar"],
  // Dashboard (screen 3).
  ["up", "slip", TEXT_MIN, "a dashboard figure's better-direction change (▲ 6% vs …) on a card"],
  ["danger", "slip", TEXT_MIN, "a dashboard figure's worse-direction change on a card"],
  ["muted", "paper", TEXT_MIN, "the dashboard's date line and period captions on paper"],
  ["accent", "slip", NON_TEXT_MIN, "the sales chart's bars on a card"],
  ["field", "slip", NON_TEXT_MIN, "the sales chart's comparison line on a card"],
  ["ink", "paper", TEXT_MIN, "a Needs-attention chip's label (paper chip)"],
];

/** `fg` drawn at `alpha` over `bg` — what a Tailwind `text-brand-ink/80` actually paints. */
function over(fg: string, bg: string, alpha: number): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16);
  return `#${[1, 3, 5]
    .map((i) => Math.round(channel(fg, i) * alpha + channel(bg, i) * (1 - alpha)).toString(16).padStart(2, "0"))
    .join("")}`;
}

// Translucent text: [foreground, its alpha, background, minimum, where]. The
// alphas are the ones components/brand/brand-classes.ts paints the rows with.
const NAV_ROW_ALPHA = 0.8;
const NAV_SUB_ROW_ALPHA = 0.75;
// components/dashboard/RankedList.tsx paints its bars bg-brand-ink/75.
const RANKED_BAR_ALPHA = 0.75;
const TRANSLUCENT_PAIRS: ReadonlyArray<readonly [string, number, string, number, string]> = [
  ["ink", NAV_ROW_ALPHA, "sidebar", TEXT_MIN, "a resting sidebar row's label (text-brand-ink/80)"],
  ["ink", NAV_SUB_ROW_ALPHA, "sidebar", TEXT_MIN, "a resting Settings section row (text-brand-ink/75)"],
  ["ink", RANKED_BAR_ALPHA, "paper", NON_TEXT_MIN, "a dashboard ranked-list bar (bg-brand-ink/75) on its paper track"],
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

test("the sidebar's translucent row labels meet the text minimum on the sidebar surface", () => {
  const tokens = brandTokens();
  assert.ok(TRANSLUCENT_PAIRS.length > 0, "the translucent pairing list itself must not be empty");
  const classes = readFileSync(fileURLToPath(new URL("../components/brand/brand-classes.ts", import.meta.url)), "utf8");
  for (const [fg, alpha, bg, min, where] of TRANSLUCENT_PAIRS) {
    // The alpha measured here must be the one the rows really use.
    assert.ok(classes.includes(`text-brand-${fg}/${Math.round(alpha * 100)} `), `brand-classes.ts must paint text-brand-${fg}/${alpha * 100}`);
    const ratio = contrast(over(tokens.get(fg)!, tokens.get(bg)!, alpha), tokens.get(bg)!);
    assert.ok(ratio >= min, `${fg}/${alpha} on ${bg} (${where}) is ${ratio.toFixed(2)}:1, needs ${min}:1`);
  }
});

test("the sidebar surface is its own token, a step lighter than paper — the primitive's --sidebar reads it", () => {
  const tokens = brandTokens();
  assert.ok(tokens.has("sidebar") && tokens.has("paper") && tokens.has("slip"), "landmark: --brand-sidebar, paper and slip are declared");
  const [sidebar, paper, slip] = ["sidebar", "paper", "slip"].map((t) => luminance(tokens.get(t)!));
  // The owner asked for a MINOR step toward white: lighter than paper, still
  // darker than the slip (so the raised active row keeps an edge to sit on).
  assert.ok(sidebar > paper, "the sidebar must be lighter than paper");
  assert.ok(sidebar < slip, "the sidebar must stay darker than the slip");
  assert.match(CSS, /--sidebar:\s*var\(--brand-sidebar\);/);
});

test("the sidebar's request badge — white on the brand danger red — is readable", () => {
  const ratio = contrast(WHITE, brandTokens().get("danger")!);
  assert.ok(ratio >= TEXT_MIN, `white on danger is ${ratio.toFixed(2)}:1`);
});
