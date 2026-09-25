import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { reconcileCartWithMenu } from "@/components/public/public-cart-math";
import type { CartLine } from "@/components/public/public-cart-store";
import type { PublicMenuProduct } from "@/components/public/PublicMenuItem";
import {
  classifySubmitFailure,
  isPromoErrorMessage as submitIsPromoErrorMessage,
} from "@/components/public/public-submit";
import { PROMO_SESSION_OPEN, PROMO_ALREADY_USED } from "@pos/shared/public";
import { stripComments } from "@/lib/source-pin-utils";
import { groupItemsByCategory } from "@/components/public/public-menu-groups";

// CR2.5 S2 — §23.2: pins for the already-SHIPPED §1 diner behaviours (menu
// search, sold-out shown-never-hidden, status timeline + poll cadence) that
// had ZERO test coverage before this file existed. TESTS ONLY — no source
// edits happened alongside this file; every pin below was checked against
// the landed source before being written, the same discipline
// public-surface-paths.test.ts documents at its own top.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// Same idiom as public-surface-paths.test.ts:31 — these pins forbid/require
// CODE shapes, so they must look at code, not prose (a comment explaining
// the rule would otherwise trip the very pin meant to enforce it).

const PUBLIC_MENU_TSX = "apps/cafe/components/public/PublicMenu.tsx";
const PUBLIC_MENU_ITEM_TSX = "apps/cafe/components/public/PublicMenuItem.tsx";
const PUBLIC_SUGGESTIONS_HOOK = "apps/cafe/components/public/use-public-suggestions.ts";
const PUBLIC_STATUS_TIMELINE_TSX = "apps/cafe/components/public/PublicStatusTimeline.tsx";
const PUBLIC_ORDER_STATUS_TSX = "apps/cafe/components/public/PublicOrderStatus.tsx";

// ── reconcileCartWithMenu (public-cart-math.ts:35-58) — behavioural ────────

function product(overrides: Partial<PublicMenuProduct> = {}): PublicMenuProduct {
  return {
    id: "p1",
    name: "Tea",
    category: "Beverages",
    price: 20,
    discount: 0,
    available: true,
    image: "",
    modifiers: [],
    ...overrides,
  };
}

function line(overrides: Partial<CartLine> = {}): CartLine {
  return {
    lineId: "p1||,|",
    productId: "p1",
    name: "Tea",
    price: 20,
    qty: 2,
    modifiers: [],
    ...overrides,
  };
}

test("reconcileCartWithMenu: drops a cart line whose product is available:false and reports changed", () => {
  const prev = [line()];
  const menuItems = [product({ available: false })];
  const { next, changed } = reconcileCartWithMenu(prev, menuItems);
  assert.deepEqual(
    next,
    [],
    "an available:false product's line must be DROPPED — public-cart-math.ts:43 (`if (!product || !product.available)`)",
  );
  assert.equal(
    changed,
    true,
    "dropping a line must report changed:true so the diner's cart UI can surface the removal — public-cart-math.ts:44",
  );
});

test("reconcileCartWithMenu: keeps an available, unchanged line byte-for-byte and reports changed:false", () => {
  const prev = [line()];
  const menuItems = [product()];
  const { next, changed } = reconcileCartWithMenu(prev, menuItems);
  assert.deepEqual(
    next,
    prev,
    "a line whose product is still available and unchanged must round-trip untouched — public-cart-math.ts:41-56",
  );
  assert.equal(
    changed,
    false,
    "an untouched line must never report changed:true — that would falsely tell the diner their cart was edited",
  );
});

test("reconcileCartWithMenu: re-prices AND renames a line whose product name/price changed, reports changed:true", () => {
  const prev = [line({ name: "Tea", price: 20 })];
  const menuItems = [product({ name: "Masala Tea", price: 25 })];
  const { next, changed } = reconcileCartWithMenu(prev, menuItems);
  assert.equal(next.length, 1, "a re-priced/renamed (but still available) line must be KEPT, not dropped");
  assert.equal(
    next[0].name,
    "Masala Tea",
    "the line's display name must be re-synced to the live product name — public-cart-math.ts:55",
  );
  assert.equal(
    next[0].price,
    25,
    "the line's display price must be re-derived via resolveUnitPrice against the live product — public-cart-math.ts:53,55",
  );
  assert.equal(
    changed,
    true,
    "a name/price drift must report changed:true — public-cart-math.ts:54",
  );
});

// ── PublicMenu.tsx — search never hides sold-out (source pins) ─────────────

test("PIN: PublicMenu.tsx's search filter matches item.name.toLowerCase().includes(q) and its body never mentions `available` (source: PublicMenu.tsx:140-148)", () => {
  const src = stripComments(readSrc(PUBLIC_MENU_TSX));
  const start = src.indexOf("const filteredItems = useMemo(");
  assert.ok(start >= 0, "PublicMenu.tsx must declare filteredItems via useMemo — look for the search/category filter block");
  const end = src.indexOf("}, [menu, selectedCategory, search]);", start);
  assert.ok(
    end >= 0,
    "filteredItems' useMemo dependency array must close with [menu, selectedCategory, search] — PublicMenu.tsx:148",
  );
  const filterBody = src.slice(start, end);
  assert.match(
    filterBody,
    /item\.name\.toLowerCase\(\)\.includes\(q\)/,
    "the search predicate must be item.name.toLowerCase().includes(q) — PublicMenu.tsx:145",
  );
  // Mutation this catches: the filter body reaching for `item.available` (or
  // `soldOut`) to hide a sold-out item from search results — §1's rule is
  // sold-out items are shown-disabled, NEVER hidden, and search must not
  // become a second, silent way to make one disappear.
  assert.ok(
    !/available/.test(filterBody),
    "PublicMenu.tsx's filteredItems body must never mention `available` — search must never be able to hide a sold-out item (PublicMenu.tsx:140-148)",
  );
});

test("PIN: PublicMenu.tsx's search Input carries an accessible aria-label (source: PublicMenu.tsx ~246-252)", () => {
  const src = stripComments(readSrc(PUBLIC_MENU_TSX));
  const start = src.indexOf("<Input");
  assert.ok(start >= 0, "PublicMenu.tsx must render an <Input> for the search box");
  const end = src.indexOf("/>", start);
  assert.ok(end >= 0, "the <Input> tag found must close with />");
  const inputTag = src.slice(start, end);
  assert.match(
    inputTag,
    /onChange=\{\(e\) => setSearch\(e\.target\.value\)\}/,
    "the <Input> found must be the search box (wired to setSearch), not an unrelated control — check PublicMenu.tsx ~246",
  );
  assert.match(
    inputTag,
    /aria-label="Search the menu"/,
    "the search Input must carry an aria-label — a screen-reader diner has no visible <label> otherwise (PublicMenu.tsx ~251)",
  );
});

test("PIN: PublicMenu.tsx still carries MENU_PAD_NO_CART (vision guard for the min-h-screen pin in pos-layout-paths.test.ts — a gutted file must not pass that pin vacuously)", () => {
  const src = readSrc(PUBLIC_MENU_TSX);
  assert.ok(
    src.includes("MENU_PAD_NO_CART"),
    "PublicMenu.tsx must still reference MENU_PAD_NO_CART — a split that dropped the <main> wrapper (and its min-h-screen) would still need SOME positive landmark to catch a gutted file, since the sibling pin only checks for the substring min-h-screen anywhere in the file",
  );
});

// ── public-menu-groups.ts — groupItemsByCategory (pure, behavioural) ────────

const ALL = "__all__";

test("groupItemsByCategory: respects the configured category order, not insertion/alpha order", () => {
  const items: PublicMenuProduct[] = [
    product({ id: "p1", name: "Tea", category: "Beverages" }),
    product({ id: "p2", name: "Samosa", category: "Snacks" }),
  ];
  const categories = [
    { name: "Snacks", order: 1 },
    { name: "Beverages", order: 2 },
  ];
  const groups = groupItemsByCategory(items, ALL, categories, ALL);
  assert.deepEqual(
    groups.map((g) => g.name),
    ["Snacks", "Beverages"],
    "groups must be ordered by each category's configured `order`, not by first-seen/alphabetical order",
  );
});

test("groupItemsByCategory: a single selected category passes its items straight through as one group", () => {
  const items: PublicMenuProduct[] = [product({ id: "p1", category: "Beverages" })];
  const groups = groupItemsByCategory(items, "Beverages", [{ name: "Beverages", order: 1 }], ALL);
  assert.deepEqual(
    groups,
    [{ name: "Beverages", items }],
    "a non-ALL selectedCategory must yield exactly one group named after it, holding the (already-filtered) items untouched",
  );
});

test("groupItemsByCategory: an item whose category is not in the configured list sorts LAST", () => {
  const items: PublicMenuProduct[] = [
    product({ id: "p1", name: "Mystery", category: "Discontinued" }),
    product({ id: "p2", name: "Tea", category: "Beverages" }),
  ];
  const categories = [{ name: "Beverages", order: 1 }];
  const groups = groupItemsByCategory(items, ALL, categories, ALL);
  assert.deepEqual(
    groups.map((g) => g.name),
    ["Beverages", "Discontinued"],
    "a category absent from the configured list must sort LAST (Number.POSITIVE_INFINITY), never first or silently dropped",
  );
});

test("groupItemsByCategory: an empty item list returns []", () => {
  const groups = groupItemsByCategory([], ALL, [{ name: "Beverages", order: 1 }], ALL);
  assert.deepEqual(groups, [], "no items must yield no groups, not a single empty-named group");
});

// ── PublicMenuItem.tsx — sold-out gates BOTH controls, never hides the tile ─

test("PIN: PublicMenuItem.tsx derives soldOut from product.available (source: PublicMenuItem.tsx:74)", () => {
  // RAW source by choice (L14: a presence/absence pin prefers raw text over
  // a stripped view), not because stripComments is unsafe here — the old
  // stripper's /** -inside-a-line-comment blinding bug (this file's own
  // "components/public/**" mention, see PublicMenuItem.tsx:12) is FIXED and
  // pinned in lib/source-pin-utils.test.ts. A plain require-style
  // code-presence check needs no comment stripping either way — there is no
  // comment in this file that could coincidentally contain this literal code
  // string.
  const src = readSrc(PUBLIC_MENU_ITEM_TSX);
  assert.match(
    src,
    /const soldOut = !product\.available;/,
    "soldOut must be derived as `!product.available` — a separate/duplicated soldOut field would drift from the server's own flag (PublicMenuItem.tsx:74)",
  );
});

test("PIN: PublicMenuItem.tsx gates BOTH the Add button and the [-n+] stepper on !soldOut (source: PublicMenuItem.tsx:145,157)", () => {
  const src = stripComments(readSrc(PUBLIC_MENU_ITEM_TSX));
  assert.match(
    src,
    /\{!soldOut && qty === 0 && onIncrement && \(/,
    "the Add pill must render only when !soldOut && qty === 0 — PublicMenuItem.tsx:145; a sold-out item must never be tappable to add",
  );
  assert.match(
    src,
    /\{!soldOut && qty > 0 && onIncrement && onDecrement && \(/,
    "the [− n +] stepper must render only when !soldOut && qty > 0 — PublicMenuItem.tsx:157; a sold-out item already in an old cart must not be incrementable",
  );
});

test("PIN: PublicMenuItem.tsx renders the destructive Sold out badge exactly when soldOut, and never early-returns to hide the tile (source: PublicMenuItem.tsx:140-144,86-92)", () => {
  const src = stripComments(readSrc(PUBLIC_MENU_ITEM_TSX));
  assert.match(
    src,
    /\{soldOut && \(\s*<Badge variant="destructive"/,
    "a sold-out product must render the destructive Badge — PublicMenuItem.tsx:140-141",
  );
  assert.match(src, />\s*Sold out\s*</, "the badge's copy must read \"Sold out\" — PublicMenuItem.tsx:142");
  // Mutation this catches: an early return / conditional that drops the
  // whole tile when soldOut — §1's rule is sold-out items stay VISIBLE
  // (dimmed via opacity-60), never removed mid-scroll from the list.
  //
  // RAW source by choice (L14), not because it's still required: the old
  // stripper's naive block-regex used to misread this file's own
  // "components/public/**" line-11 comment as an opener and delete lines
  // 11-117 — that bug is FIXED and pinned in lib/source-pin-utils.test.ts.
  // The vision guard below proves the inspected raw text still contains the
  // span this pin depends on.
  const raw = readSrc(PUBLIC_MENU_ITEM_TSX);
  assert.match(
    raw,
    /const soldOut = !product\.available;/,
    "vision guard: the raw source this pin inspects must contain the soldOut declaration — if this fails the pin is blind, fix the pin before trusting it",
  );
  assert.ok(
    !/if \(soldOut\)\s*\{?\s*return null/.test(raw),
    "PublicMenuItem must never early-return null for a sold-out product — it must render the (disabled, dimmed) tile, not hide it",
  );
});

// ── use-public-suggestions.ts — never suggests a sold-out item ─────────────

test("PIN: use-public-suggestions.ts skips products with available === false (source: use-public-suggestions.ts:55)", () => {
  const src = stripComments(readSrc(PUBLIC_SUGGESTIONS_HOOK));
  assert.match(
    src,
    /if \(item\.available === false\) continue;/,
    "the suggestion picker must skip a sold-out product — offering an unbuyable item as a suggestion would dead-end the diner on tap (use-public-suggestions.ts:55)",
  );
});

// ── PublicStatusTimeline.tsx — the 3 step labels ────────────────────────────

test("PIN: PublicStatusTimeline.tsx carries the exact 3 step labels (source: PublicStatusTimeline.tsx:28-30)", () => {
  const src = stripComments(readSrc(PUBLIC_STATUS_TIMELINE_TSX));
  const labels = [
    "Order sent",
    "Cafe is confirming…",
    "Being prepared",
  ];
  for (const label of labels) {
    assert.ok(
      src.includes(label),
      `PublicStatusTimeline.tsx must contain the step-label literal ${JSON.stringify(label)} — a copy change here silently breaks the owner's "very very easy" 3-step promise (PublicStatusTimeline.tsx:28-30)`,
    );
  }
  // CB-6C: the "✓" text glyph must be GONE from every label — the Check icon
  // on a "done" step already conveys it, and the dir-wide no-emoji pin bans
  // U+2713. A regression here would silently reintroduce a banned glyph.
  assert.ok(!src.includes("✓"), 'PublicStatusTimeline.tsx must not contain the "✓" glyph in any step label — the Check icon already conveys done');
});

// ── PublicOrderStatus.tsx — manual refresh + cooldown + terminal statuses ──
// S5: the diner's status page no longer polls at all — a single mount fetch
// plus an explicit, server-cooldown-gated Refresh button. These pins replace
// the old poll-cadence assertions with the new manual-refresh contract.

test("PIN: PublicOrderStatus.tsx's refresh cooldown is IMPORTED from @pos/shared/public, and no timer-driven refetch loop remains (source: PublicOrderStatus.tsx)", () => {
  const raw = readSrc(PUBLIC_ORDER_STATUS_TSX);
  const src = stripComments(raw);

  // Positive landmarks first — a gutted file must not pass the negatives
  // below vacuously.
  assert.match(
    src,
    /async function handleRefresh\(\)/,
    "PublicOrderStatus.tsx must declare the manual handleRefresh() handler — the ONE re-fetch path a diner can trigger after mount",
  );
  assert.match(
    src,
    /readRefreshAt\(code\)/,
    "PublicOrderStatus.tsx must read the persisted refresh timestamp via readRefreshAt(code) so a reload's countdown is correct",
  );

  // The cooldown constant must be imported, never a re-declared literal.
  assert.match(
    src,
    /import\s*\{[^}]*PUBLIC_STATUS_REFRESH_COOLDOWN_MS[^}]*\}\s*from\s*"@pos\/shared\/public"/,
    "PublicOrderStatus.tsx must import PUBLIC_STATUS_REFRESH_COOLDOWN_MS from @pos/shared/public, not re-declare its own cooldown constant",
  );
  assert.ok(
    !/\b30_000\b/.test(raw),
    "PublicOrderStatus.tsx must not contain a bare 30_000 literal anywhere — the cooldown value must come from the shared import, never a local duplicate",
  );

  // No poll loop left: neither a setInterval driving re-fetches (whether it
  // names the fetcher directly OR wraps it in an arrow, e.g.
  // `setInterval(() => fetchStatus(...), ...)`), nor a setTimeout that
  // re-invokes the fetch (the old schedule()/poll() pair). Every
  // setInterval(...) call's own argument list is scanned for a re-fetch
  // reference, not just its very first token.
  for (const call of src.matchAll(/setInterval\(([\s\S]*?)\)(?=[,;)\n]|$)/g)) {
    assert.ok(
      !/\b(poll|runFetch|fetchStatus)\b/.test(call[1]),
      `PublicOrderStatus.tsx must not drive its status re-fetch off a setInterval — found one whose body references a fetcher: ${call[0]}`,
    );
  }
  assert.ok(
    !/function schedule\(\)/.test(src) && !/setTimeout\(\s*poll\b/.test(src),
    "PublicOrderStatus.tsx must not carry a schedule()/poll() timer pair that re-invokes the fetch — that was the old auto-poll loop",
  );
});

test("PIN: PublicOrderStatus.tsx's TERMINAL_STATUSES is exactly {accepted, rejected} — now gates whether the manual refresh control is offered at all (source: PublicOrderStatus.tsx)", () => {
  const src = stripComments(readSrc(PUBLIC_ORDER_STATUS_TSX));
  const match = src.match(/TERMINAL_STATUSES = new Set<[^>]*>\(\[([^\]]*)\]\)/);
  assert.ok(match, "PublicOrderStatus.tsx must declare TERMINAL_STATUSES as a Set literal");
  const values = [...match![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(
    values,
    ["accepted", "rejected"],
    'TERMINAL_STATUSES must contain exactly "accepted" and "rejected" — a settled order can never change again, so these (and only these) must hide the manual refresh control; including "pending"/"accepting" would hide it before the diner ever learns the outcome, and omitting one would keep offering a dead refresh past a final state',
  );
});

// ── public-submit.ts — the two newer promo reasons are FIELD promo errors ──
// CR2.5 review F2: the CREATE path can 422 with PROMO_SESSION_OPEN
// (order-request-create.ts:69) and PROMO_ALREADY_USED (:84). Both are promo
// rejections — the submit classifier must route them onto the promo FIELD
// verbatim (promoRejected: true), never mislabel them as MENU_CHANGED_ERROR
// ("The menu just changed"), which tells the diner to review a cart that is
// fine. The edit-flow classifier's own membership is pinned in
// public-status-edit.test.ts; this pins the submit-flow twin.

test("classifySubmitFailure: PROMO_SESSION_OPEN and PROMO_ALREADY_USED ride the promo FIELD verbatim, not the menu-changed banner", () => {
  for (const message of [PROMO_SESSION_OPEN, PROMO_ALREADY_USED]) {
    assert.equal(submitIsPromoErrorMessage(message), true, `isPromoErrorMessage must classify ${JSON.stringify(message)} as a promo rejection`);
    assert.deepEqual(
      classifySubmitFailure(422, "SAVE10", message),
      { promoRejected: true, message },
      `a 422 carrying ${JSON.stringify(message)} with a promo sent must surface ON THE FIELD verbatim — public-submit.ts's documented promo-rejection contract`,
    );
  }
});

// ── The cooldown ticker must STOP (review 2026-09-13, CONFIRMED) ───────────
// The 1s countdown ticker's effect keys on [cooldownUntil]. Nothing ever
// resets that value when the cooldown LAPSES, so the effect never re-ran, the
// cleanup never fired, and the interval kept ticking for the life of the
// page — re-rendering the whole status subtree (timeline, every item row,
// the actions block) once a second while a diner sat at the table waiting for
// food. That is the "laggy taps on a cheap Android" class this project has
// already had a build rejected for. The ticker must be bounded by a
// self-stopping guard, not only by a dependency change that never comes.
test("PIN: PublicOrderStatus.tsx's countdown ticker STOPS on its own when the cooldown lapses — it must never free-run", () => {
  const src = stripComments(readSrc(PUBLIC_ORDER_STATUS_TSX));
  const tickIdx = src.indexOf("setInterval(");
  assert.ok(tickIdx >= 0, "expected the countdown ticker's setInterval");
  assert.ok(
    /clearInterval\(/.test(src.slice(tickIdx, tickIdx + 400)),
    "the ticker effect must clear its interval on cleanup",
  );
  // The CALLBACK ITSELF is what matters. A guard clause ABOVE setInterval only
  // runs at effect SETUP; once the deadline passes mid-interval nothing re-runs
  // the effect, so ONLY logic inside the callback can end it.
  //
  // Slice just the first argument. Note the callback may be a CONCISE arrow
  // with no braces — an earlier draft of this pin sliced to the next "}" and
  // swallowed the cleanup's own clearInterval, which made it pass against the
  // very bug it exists to catch. Cut at the delay argument instead.
  const cbStart = tickIdx + "setInterval(".length;
  const delayIdx = src.indexOf("COOLDOWN_TICK_MS", cbStart);
  assert.ok(delayIdx > cbStart, "the ticker's delay must be the named COOLDOWN_TICK_MS constant");
  const callback = src.slice(cbStart, delayIdx);
  assert.ok(
    /Date\.now\(\) >=|>=\s*deadline|cooldownUntil|stopTicker|setCooldownUntil\(0\)|clearInterval\(/.test(callback),
    `the ticker CALLBACK must itself notice the cooldown has lapsed and stop (or reset the state its effect keys on). A callback that only does setNowTick(Date.now()) free-runs forever once the deadline passes, re-rendering the whole status subtree every second. Callback was: ${callback}`,
  );
});
