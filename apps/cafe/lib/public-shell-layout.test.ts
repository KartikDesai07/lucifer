import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import {
  ABOVE_CART_BAR_CLASS,
  ABOVE_TAB_BAR_CLASS,
  BOTTOM_CHROME_VAR,
  CONTENT_PAD_TABS_ONLY,
  SHELL_BOTTOM_CHROME_STYLE,
  TAB_BAR_CLASS,
  TAB_BAR_HEIGHT_CLASS,
  TAB_BAR_HEIGHT_REM,
} from "@/components/public/public-shell-layout";
import { DINER_TABS, TAB_META } from "@/components/public/PublicTabBar";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const FLOW_CHROME = "apps/cafe/components/public/PublicFlowChrome.tsx";
const STATUS_ITEMS = "apps/cafe/components/public/PublicStatusItems.tsx";
const TAB_BAR = "apps/cafe/components/public/PublicTabBar.tsx";
const SHELL = "apps/cafe/components/public/PublicDinerShell.tsx";
// S2 split — the item list + note field pulled out of PublicStatusItems.tsx
// (render only; the action bar with its ABOVE_TAB_BAR_CLASS offset stayed put).
const STATUS_ITEM_LIST = "apps/cafe/components/public/PublicStatusItemList.tsx";
const STATUS_NOTE_FIELD = "apps/cafe/components/public/PublicStatusNoteField.tsx";

// CB-4 — the bottom-chrome stack on the diner surface.
//
// THE BLOCKER THESE EXIST FOR (found in review, not hypothetical): the cart bar
// has always been `fixed inset-x-0 bottom-0 z-40`. The new 3-tab shell added a
// SECOND bar at the identical position and z-index, so they stacked by DOM
// order and the tab bar covered the "View cart" button — a diner with items in
// their cart could not reach checkout on a phone. These pin the fix: exactly
// ONE element owns `bottom-0`, and everything else is offset from it through a
// single shared constant.

// Existence-asserting index lookup — a bare indexOf returning -1 would make
// every ordering/absence assertion below pass vacuously.
function mustInclude(haystack: string, needle: string, what: string): void {
  assert.ok(haystack.includes(needle), `expected to find ${what}`);
}

test("PIN: exactly ONE bottom-anchored element on the diner surface uses a bare `bottom-0` — the tab bar", () => {
  // The mutation this catches is the exact bug that shipped into review: a
  // second component pinned to bottom-0 at the same z-index, silently covering
  // the first.
  const cartSrc = stripComments(readSrc(FLOW_CHROME));
  const statusSrc = stripComments(readSrc(STATUS_ITEMS));

  mustInclude(cartSrc, "fixed inset-x-0", "the cart bar's fixed positioning (positive landmark)");
  assert.ok(
    !/fixed inset-x-0 bottom-0/.test(cartSrc),
    "PublicFlowChrome must NOT pin anything to a bare bottom-0 — it has to clear the tab bar (use ABOVE_TAB_BAR_CLASS)",
  );
  assert.ok(
    !/fixed inset-x-0 bottom-0/.test(statusSrc),
    "PublicStatusItems must NOT pin its action bar to a bare bottom-0 — same reason",
  );

  // S2 split — a positive landmark that PublicStatusItems still actually
  // RENDERS the extracted item list, so a gutted parent file (one that lost
  // its render but happens to still avoid the literal bottom-0 string) trips
  // this pin instead of passing vacuously.
  mustInclude(statusSrc, "<PublicStatusItemList", "PublicStatusItems rendering the extracted item list");
});

test("PIN: S2 split — neither PublicStatusItemList nor PublicStatusNoteField owns any `fixed` positioning; only the parent (PublicStatusItems) owns the bottom-anchored action bar", () => {
  const listSrc = stripComments(readSrc(STATUS_ITEM_LIST));
  const noteSrc = stripComments(readSrc(STATUS_NOTE_FIELD));

  // Positive landmarks first — proves each assertion below is checking the
  // REAL file (a gutted/empty file would trip the negative pin vacuously).
  mustInclude(listSrc, "StatusItemRow", "the item list rendering StatusItemRow");
  mustInclude(noteSrc, "PUBLIC_NOTE_MAX_LEN", "the note field's max-length constant");

  // Mutation this catches: bottom chrome (or any fixed positioning) creeping
  // into one of the presentational children instead of staying owned by the
  // parent, which would risk re-opening the exact stacking bug these pins
  // exist for.
  assert.ok(!/\bfixed\b/.test(listSrc), "PublicStatusItemList must not use fixed positioning");
  assert.ok(!/\bfixed\b/.test(noteSrc), "PublicStatusNoteField must not use fixed positioning");
});

test("PIN: the cart bar and the status action bar both offset themselves through the SHARED layout constant", () => {
  const cartSrc = stripComments(readSrc(FLOW_CHROME));
  const statusSrc = stripComments(readSrc(STATUS_ITEMS));
  mustInclude(cartSrc, "ABOVE_TAB_BAR_CLASS", "the cart bar's shared bottom offset");
  mustInclude(cartSrc, "ABOVE_CART_BAR_CLASS", "the item-cap notice's shared bottom offset");
  mustInclude(statusSrc, "ABOVE_TAB_BAR_CLASS", "the status action bar's shared bottom offset");
});

test("PIN: the tab bar renders through TAB_BAR_CLASS and the shell publishes the chrome height variable", () => {
  const tabSrc = stripComments(readSrc(TAB_BAR));
  const shellSrc = stripComments(readSrc(SHELL));
  mustInclude(tabSrc, "TAB_BAR_CLASS", "the tab bar's shared class");
  mustInclude(shellSrc, "SHELL_BOTTOM_CHROME_STYLE", "the shell raising --pub-bottom-chrome");
  mustInclude(shellSrc, "CONTENT_PAD_TABS_ONLY", "the shell's content bottom padding");
});

test("the offsets all resolve through ONE custom property, so they cannot drift apart", () => {
  for (const [name, value] of [
    ["ABOVE_TAB_BAR_CLASS", ABOVE_TAB_BAR_CLASS],
    ["ABOVE_CART_BAR_CLASS", ABOVE_CART_BAR_CLASS],
  ] as const) {
    assert.ok(value.includes(BOTTOM_CHROME_VAR), `${name} must be expressed in terms of ${BOTTOM_CHROME_VAR}`);
  }
});

test("every bottom offset carries a safe-area term — an iOS home indicator must never overlap a control", () => {
  for (const [name, value] of [
    ["TAB_BAR_CLASS", TAB_BAR_CLASS],
    ["ABOVE_TAB_BAR_CLASS", ABOVE_TAB_BAR_CLASS],
    ["ABOVE_CART_BAR_CLASS", ABOVE_CART_BAR_CLASS],
    ["CONTENT_PAD_TABS_ONLY", CONTENT_PAD_TABS_ONLY],
  ] as const) {
    assert.match(value, /env\(safe-area-inset-bottom\)/, `${name} must account for the safe-area inset`);
  }
});

test("the custom property DEFAULTS to 0px — a cafe with the diner features off must render exactly as before CB-4", () => {
  // `var(--pub-bottom-chrome,0px)`: without the shell nothing sets the
  // property, so the cart bar resolves to its original bottom position and no
  // conditional prop is needed anywhere.
  for (const value of [ABOVE_TAB_BAR_CLASS, ABOVE_CART_BAR_CLASS]) {
    assert.match(
      value,
      new RegExp(`var\\(${BOTTOM_CHROME_VAR},0px\\)`),
      "the offset must fall back to 0px when no shell is present",
    );
  }
});

// S6 — extending the tab bar from 3 to 5 destinations. These pins guard the
// height-contract agreement that CHANGE 2 documents but cannot enforce at the
// type level (Tailwind can't JIT a class built from a template literal, so
// TAB_BAR_HEIGHT_CLASS / SHELL_BOTTOM_CHROME_STYLE / CONTENT_PAD_TABS_ONLY
// stay hand-written literals) — this test is the only mechanism that keeps
// them from drifting apart the way the two bottom-0 bars once did.

test("PIN: the tab bar height, the published chrome variable and the content padding all state the SAME 3.5rem — changing one without the others re-opens the CB-4 collision where the tab bar covered View cart", () => {
  assert.equal(TAB_BAR_HEIGHT_CLASS, "min-h-14");
  assert.equal(
    SHELL_BOTTOM_CHROME_STYLE[BOTTOM_CHROME_VAR as keyof typeof SHELL_BOTTOM_CHROME_STYLE],
    `${TAB_BAR_HEIGHT_REM}rem`,
  );
  assert.ok(
    CONTENT_PAD_TABS_ONLY.includes(`${TAB_BAR_HEIGHT_REM}rem`),
    `CONTENT_PAD_TABS_ONLY must contain ${TAB_BAR_HEIGHT_REM}rem`,
  );
});

test("PIN: DINER_TABS stays within the 3-5 thumb-reach norm (Material/HIG guidance; Airbnb measured ~40% faster task completion vs a hamburger)", () => {
  assert.ok(
    DINER_TABS.length <= 5,
    `DINER_TABS has ${DINER_TABS.length} entries — a bottom tab bar must stay within the 3-5 thumb-reachable range`,
  );
});

test("PIN: every DINER_TABS entry has a TAB_META entry with a non-empty label and a defined Icon", () => {
  for (const tab of DINER_TABS) {
    const meta = TAB_META[tab];
    assert.ok(meta, `TAB_META is missing an entry for "${tab}"`);
    assert.ok(meta.label.length > 0, `TAB_META["${tab}"].label must be non-empty`);
    assert.ok(meta.Icon, `TAB_META["${tab}"].Icon must be defined`);
  }
});

test("PIN: TAB_META is declared as an exhaustive Record<DinerTab, ...>, not a Partial/optional map", () => {
  const tabSrc = stripComments(readSrc(TAB_BAR));
  // Positive landmark first — proves this is checking the real file, not one
  // gutted down to nothing (which would make the negative-shaped check below
  // pass vacuously).
  mustInclude(tabSrc, "TAB_BAR_CLASS", "the tab bar's shared class (positive landmark)");
  mustInclude(tabSrc, "Record<DinerTab,", "TAB_META declared as an exhaustive Record<DinerTab, ...>");
});

// S12 — the WIRING slice's reachability pins. This repo has shipped "every
// slice spec satisfied, feature still dead" before (nothing owned WIRING);
// these prove the CB-6A tabs/helpers this session built are actually mounted,
// not just present on disk.

const ORDER_BILL_VIEW = "apps/cafe/components/public/PublicOrderBillView.tsx";

test("PIN: PublicDinerShell.tsx actually RENDERS PublicHomeTab, PublicAccountTab, PublicMyOrdersTab and PublicTabBar — a type-only import must not satisfy this", () => {
  const shellSrc = stripComments(readSrc(SHELL));
  mustInclude(shellSrc, "<PublicHomeTab", "the shell rendering PublicHomeTab");
  mustInclude(shellSrc, "<PublicAccountTab", "the shell rendering PublicAccountTab");
  mustInclude(shellSrc, "<PublicMyOrdersTab", "the shell rendering PublicMyOrdersTab");
  mustInclude(shellSrc, "<PublicTabBar", "the shell rendering PublicTabBar");
});

test("PIN: PublicBillRows has a real RENDER call site inside PublicOrderBillView.tsx — a type-only import must not satisfy this", () => {
  const billViewSrc = stripComments(readSrc(ORDER_BILL_VIEW));
  mustInclude(billViewSrc, "<PublicBillRows", "PublicOrderBillView.tsx actually rendering PublicBillRows");
});

// CB-5D part 2 (review finding, confirmed): signOut() cleared diner/stampCard/
// resolvedOrders but NOT the assigned reward codes, which the promo field
// renders as TAP-TO-APPLY rows. On a shared phone or the cafe's own tablet the
// next person could spend the previous diner's reward. Scoped to signOut()'s
// own body so a setRewards call somewhere else in the file cannot satisfy it.
test("PIN: signOut() clears the assigned rewards too — a tap-to-apply code must not survive a logout on a shared device", () => {
  const shellSrc = stripComments(readSrc(SHELL));
  const signOutIdx = shellSrc.indexOf("async function signOut()");
  assert.ok(signOutIdx >= 0, "landmark: signOut() must exist in PublicDinerShell.tsx");
  const nextFnIdx = shellSrc.indexOf("\n  function ", signOutIdx + 1);
  const signOutBody = shellSrc.slice(signOutIdx, nextFnIdx > 0 ? nextFnIdx : undefined);
  // Positive landmark: the sibling clears are still there, so this pin cannot
  // pass against a gutted signOut().
  mustInclude(signOutBody, "setStampCard(null)", "signOut() still clearing the stamp card");
  mustInclude(
    signOutBody,
    "setRewards(undefined)",
    "signOut() clearing the assigned reward codes — without it the next diner on the same device is offered the previous diner's codes",
  );
});

test("PIN: signOut() calls clearDinerData( — a logout must clear diner-owned localStorage, not just in-memory state", () => {
  const shellSrc = stripComments(readSrc(SHELL));
  const signOutIdx = shellSrc.indexOf("async function signOut()");
  assert.ok(signOutIdx >= 0, "expected to find signOut() in PublicDinerShell.tsx");
  const nextFnIdx = shellSrc.indexOf("\n  function ", signOutIdx + 1);
  const signOutBody = shellSrc.slice(signOutIdx, nextFnIdx > 0 ? nextFnIdx : undefined);
  mustInclude(signOutBody, "clearDinerData(", "signOut() calling clearDinerData(");
});

test("PIN: the both-features-off early return stays byte-identical — `return <PublicOrderFlow token={token} chrome={chrome} />;` — the backward-compat guarantee for every cafe running neither feature", () => {
  const shellSrc = stripComments(readSrc(SHELL));
  mustInclude(
    shellSrc,
    "return <PublicOrderFlow token={token} chrome={chrome} />;",
    "the exact backward-compat early return",
  );
});

test("PIN: the shell's initial tab state is \"menu\", not \"home\" — an explicit owner decision that a QR scan must behave exactly as it does today", () => {
  const shellSrc = stripComments(readSrc(SHELL));
  // Positive landmark first — proves the file still declares the tab state at
  // all (a gutted file would otherwise make the negative check below pass
  // vacuously).
  mustInclude(shellSrc, 'useState<DinerTab>("menu")', 'the shell initializing tab state to "menu"');
  assert.ok(
    !/useState<DinerTab>\("home"\)/.test(shellSrc),
    'the shell must NOT default its initial tab to "home" — Menu stays the landing tab in every configuration',
  );
});

// ── Review round 2026-09-13: the four owner-approved UI fixes ──────────────

test("PIN: the tab bar's ACTIVE state is never conveyed by colour alone", () => {
  const src = stripComments(readSrc(TAB_BAR));
  // A cafe's accent is owner-configurable and can sit close to the muted tone;
  // on a sunlit cheap phone a colour-only active state is unreadable.
  //
  // Scoped to the ACTIVE TERNARY itself, not the whole file: an earlier draft
  // searched the file for "font-semibold" and passed even after that class was
  // stripped from this branch (the word occurs elsewhere) — a vacuous pin.
  const ternary = src.match(/isActive \? "([^"]*)" : "([^"]*)"/);
  assert.ok(ternary, "expected an isActive ? ... : ... class ternary in the tab bar");
  const [, activeClasses] = ternary!;
  assert.match(
    activeClasses,
    /font-(semibold|bold|medium)/,
    `the ACTIVE tab's own classes must include a weight difference, not colour alone (found: "${activeClasses}")`,
  );
  assert.match(
    src,
    /isActive &&[\s\S]{0,200}bg-primary/,
    "the active tab must also render a non-colour indicator element",
  );
  // Vision guard: prove the colour class is still there too (this pin must not
  // pass because the whole active branch was deleted).
  assert.match(src, /text-primary/, "the active tab should still carry its colour");
});

test("PIN: the MENU tab badges the cart, so a half-built cart stays visible from the other tabs", () => {
  const bar = stripComments(readSrc(TAB_BAR));
  assert.match(bar, /cartCount/, "the tab bar must accept a cart count");
  assert.match(
    bar,
    /tab === "menu" && cartCount > 0/,
    "the badge belongs on the MENU tab (where the cart lives) and only when non-empty",
  );
  const shell = stripComments(readSrc(SHELL));
  assert.match(shell, /cartCount=\{cartCount\}/, "the shell must feed the badge");
  assert.match(
    shell,
    /function countCartItems\(\)/,
    "the count must come from the STORE, not from reaching into PublicOrderFlow's state",
  );
});
