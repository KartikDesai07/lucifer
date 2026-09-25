import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// CB-6D-A — Diner Home (/m) premium redesign + "Daily offers" moves Menu ->
// Home. Slice B pins for the plan's own contract
// (.claude/plan/v2/cb6d-home-premium-plan.md). This is a NEW file (not an
// extension of lib/public-shell-layout.test.ts or
// lib/public-diner-panel-pins.test.ts) because both were already at the
// 300-line budget the plan sets for new-pin placement.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");
const absOf = (rel: string): string => path.join(REPO_ROOT, rel);

function mustInclude(haystack: string, needle: string, what: string): void {
  assert.ok(haystack.includes(needle), `expected to find ${what}`);
}

const SKIP_DIRS = new Set(["node_modules", ".next"]);
const CODE_FILE_PATTERN = /\.(ts|tsx|js|jsx|mjs|cjs)$/;
const TEST_FILE_PATTERN = /\.test\.ts$/;

// Same directory-walker convention as lib/public-diner-panel-pins.test.ts /
// lib/category-readers-pins.test.ts, so a file added later is scanned
// automatically rather than by a hardcoded list.
function walkCodeFiles(dirAbs: string, out: string[]): void {
  for (const entry of readdirSync(dirAbs)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = path.join(dirAbs, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) walkCodeFiles(abs, out);
    else if (CODE_FILE_PATTERN.test(entry) && !TEST_FILE_PATTERN.test(entry)) out.push(abs);
  }
}

const SHELL = "apps/cafe/components/public/PublicDinerShell.tsx";
const HOME_TAB = "apps/cafe/components/public/PublicHomeTab.tsx";
const HOME_HERO = "apps/cafe/components/public/PublicHomeHero.tsx";
const LOYALTY_GLANCE = "apps/cafe/components/public/PublicLoyaltyGlance.tsx";
const POPULAR_ROW = "apps/cafe/components/public/PublicPopularRow.tsx";
const PUBLIC_UI = "apps/cafe/components/public/public-ui.ts";

// CB-6D-A — PublicPopularRow is GENERALISED (a `title` prop) and rendered
// TWICE by Home: once for "Daily offers" (the strip that moved off Menu),
// once for "Popular here" (its original CB-6C use). Two occurrences is the
// reachability half of the contract; the offers-chain wiring (shell ->
// offerItems -> PublicHomeTab prop) is pinned separately in
// lib/public-diner-panel-pins.test.ts.
test("PIN: CB-6D-A — PublicHomeTab.tsx renders <PublicPopularRow exactly twice, titled \"Daily offers\" and \"Popular here\"", () => {
  const homeSrc = stripComments(readSrc(HOME_TAB));

  // Positive landmark first: PublicPopularRow.tsx must still exist and export
  // its component, so the occurrence count below cannot pass vacuously
  // against a renamed/gutted component.
  mustInclude(stripComments(readSrc(POPULAR_ROW)), "export function PublicPopularRow", "PublicPopularRow.tsx still exporting its component");

  const occurrences = homeSrc.split("<PublicPopularRow").length - 1;
  assert.equal(
    occurrences,
    2,
    `PublicHomeTab.tsx must render <PublicPopularRow exactly twice (Daily offers + Popular here), found ${occurrences}`,
  );

  const DAILY_OFFERS_TITLE = "title=" + '"Daily offers"';
  const POPULAR_HERE_TITLE = "title=" + '"Popular here"';
  mustInclude(homeSrc, DAILY_OFFERS_TITLE, 'PublicHomeTab.tsx passing title="Daily offers" to one PublicPopularRow');
  mustInclude(homeSrc, POPULAR_HERE_TITLE, 'PublicHomeTab.tsx passing title="Popular here" to the other PublicPopularRow');
});

// CB-6D-A — PublicMenuOffers.tsx is DELETED this slice (its filter moved into
// public-home-data.ts's pickOfferItems). Landmark: the file it was replaced
// by on Home, PublicPopularRow.tsx, must still exist — otherwise this pin
// could pass vacuously in a world where the whole components/public
// directory had gone missing.
test("PIN: CB-6D-A — components/public/PublicMenuOffers.tsx no longer exists (deleted; its filter moved to public-home-data.ts)", () => {
  assert.ok(existsSync(absOf(POPULAR_ROW)), "landmark: PublicPopularRow.tsx must still exist");

  const offersPath = absOf("apps/cafe/components/public/PublicMenuOffers.tsx");
  assert.ok(!existsSync(offersPath), "PublicMenuOffers.tsx must be deleted — the offers strip moved to Home in CB-6D-A");
});

// (a) offers chain (A1-style, same pattern as the banner chain in
// lib/public-diner-panel-pins.test.ts): the shell must derive offerItems and
// pass them all the way into the row that renders them, not just declare the
// prop on paper.
test("PIN (offers chain): PublicDinerShell.tsx passes offerItems= into <PublicHomeTab, and PublicHomeTab.tsx declares an offerItems prop", () => {
  const shellSrc = stripComments(readSrc(SHELL));
  mustInclude(shellSrc, "<PublicHomeTab", "the shell rendering PublicHomeTab (positive landmark)");
  mustInclude(shellSrc, "offerItems={offerItems}", "the shell forwarding offerItems={offerItems} into PublicHomeTab");

  const homeSrc = stripComments(readSrc(HOME_TAB));
  mustInclude(homeSrc, "offerItems:", "PublicHomeTab.tsx declaring an offerItems prop");
});

// (b) label: the owner's own words ("wo dekh jaye to daily offer hai, today
// offer nahi hai" — 2026-09-22 phone pass) renamed the strip from "Today's
// offers" to "Daily offers". Needles built by concatenation so this file's
// own literal can never accidentally satisfy its own negative check.
test('PIN (label): PublicHomeTab.tsx says "Daily offers"; no file under components/public says "Today\'s offers" in either apostrophe spelling', () => {
  const homeSrc = stripComments(readSrc(HOME_TAB));
  mustInclude(homeSrc, "Daily offers", 'PublicHomeTab.tsx must contain the literal "Daily offers"');

  const TODAY_OFFERS_STRAIGHT = "Today" + "'s offers";
  const TODAY_OFFERS_HTML_ENTITY = "Today&apos;s offers";

  const files: string[] = [];
  walkCodeFiles(path.join(REPO_ROOT, "apps/cafe/components/public"), files);
  assert.ok(files.length >= 40, `expected to scan at least 40 files, found ${files.length}`);

  let foundLandmark = false;
  for (const fileAbs of files) {
    const src = stripComments(readFileSync(fileAbs, "utf8"));
    if (src.includes("Popular here")) foundLandmark = true;
    const rel = path.relative(REPO_ROOT, fileAbs).split(path.sep).join("/");
    assert.ok(!src.includes(TODAY_OFFERS_STRAIGHT), `${rel} must not contain the old "Today's offers" label`);
    assert.ok(!src.includes(TODAY_OFFERS_HTML_ENTITY), `${rel} must not contain the old "Today&apos;s offers" label`);
  }
  // Vision guard: proves the walk actually reads live component source (a
  // walk over an empty/gutted directory would make the negative checks above
  // pass vacuously).
  assert.ok(foundLandmark, 'landmark: some file under components/public must still contain "Popular here"');
});

// (c) design pins — the plan's per-component contract for the redesign.
test("PIN (design): PublicHomeHero.tsx uses PUB_DISPLAY_TITLE_CLASS and renders no <Button (the CTA button is gone from the header; the tab bar and per-row \"See menu\" links own that path now)", () => {
  const src = stripComments(readSrc(HOME_HERO));
  mustInclude(src, "greetingFor", "PublicHomeHero.tsx calling greetingFor (positive landmark)");
  mustInclude(src, "PUB_DISPLAY_TITLE_CLASS", "PublicHomeHero.tsx using PUB_DISPLAY_TITLE_CLASS");
  assert.ok(!src.includes("<Button"), "PublicHomeHero.tsx must not render <Button — the header's CTA button is removed in the CB-6D-A redesign");
  // Review (CB-6D-A lens) LOW: the fallback monogram is decorative — a bare letter must not be announced.
  assert.ok(src.includes("aria-hidden=\"true\""), "the monogram fallback span must carry aria-hidden=\"true\" (decorative, already named by the heading)");
});

test("PIN (design): PublicLoyaltyGlance.tsx uses PUB_HERO_LG_CLASS and text-5xl, and keeps the MAX_DRAWN_STAMPS constant (stamp math must never be re-derived differently)", () => {
  const src = stripComments(readSrc(LOYALTY_GLANCE));
  mustInclude(src, "MAX_DRAWN_STAMPS", "PublicLoyaltyGlance.tsx keeping the MAX_DRAWN_STAMPS constant (positive landmark)");
  mustInclude(src, "PUB_HERO_LG_CLASS", "PublicLoyaltyGlance.tsx using the PUB_HERO_LG_CLASS hero surface");
  mustInclude(src, "text-5xl", "PublicLoyaltyGlance.tsx sizing the stamp count at text-5xl");
});

test("PIN (design): PublicPopularRow.tsx uses PUB_TEXT_LINK_CLASS and declares a title prop (generalised for both Daily offers and Popular here)", () => {
  const src = stripComments(readSrc(POPULAR_ROW));
  mustInclude(src, "title", "PublicPopularRow.tsx declaring/using a title prop");
  mustInclude(src, "PUB_TEXT_LINK_CLASS", "PublicPopularRow.tsx using PUB_TEXT_LINK_CLASS for its \"See menu\" link");
});

test("PIN (design): public-ui.ts exports the six new CB-6D-A constants, each as a whole hand-written string literal (never a template literal — Tailwind's JIT scans source text for whole class names)", () => {
  const src = stripComments(readSrc(PUBLIC_UI));
  const NEW_CONSTANTS = [
    "PUB_HOME_STACK_CLASS",
    "PUB_DISPLAY_TITLE_CLASS",
    "PUB_SECTION_HEADING_CLASS",
    "PUB_HERO_LG_CLASS",
    "PUB_TONAL_CARD_CLASS",
    "PUB_TEXT_LINK_CLASS",
  ];
  for (const name of NEW_CONSTANTS) {
    const needle = "export const " + name + ' = "';
    assert.ok(
      src.includes(needle),
      `public-ui.ts must export ${name} as a whole string literal (regex-equivalent: export const ${name} = "..."), never a template literal`,
    );
  }
});

// (d) touch floor: every control on the redesigned Home surface stays >= 44px.
test("PIN (touch floor): PublicPopularRow.tsx's Add/Options buttons carry h-11, and PUB_TEXT_LINK_CLASS's own literal contains min-h-11", () => {
  const rowSrc = stripComments(readSrc(POPULAR_ROW));
  mustInclude(rowSrc, "Add", 'PublicPopularRow.tsx still rendering the "Add" button (positive landmark)');
  mustInclude(rowSrc, "Options", 'PublicPopularRow.tsx still rendering the "Options" button (positive landmark)');
  const H11_NEEDLE = "h-1" + "1";
  assert.ok(rowSrc.includes(H11_NEEDLE), "PublicPopularRow.tsx's tile buttons must carry the h-11 touch-floor class");

  const uiSrc = stripComments(readSrc(PUBLIC_UI));
  const constMatch = uiSrc.match(/export const PUB_TEXT_LINK_CLASS = "([^"]*)"/);
  assert.ok(constMatch, "expected to find PUB_TEXT_LINK_CLASS declared as a plain string literal in public-ui.ts");
  assert.match(
    constMatch![1],
    /min-h-11/,
    "PUB_TEXT_LINK_CLASS's own literal must contain min-h-11 — the \"See menu\" link stays touch-floored even though its visible text is small",
  );
});
