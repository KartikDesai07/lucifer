// POS "New Order" layout SOURCE pins (CB-1 S3, post-review: xl-switch,
// sidebar-aware pane; CB-1c round 2, 2026-08-30: the percent-height chain
// was rejected by a headless-Chrome probe and replaced by a DEFINITE
// vh/dvh root that subtracts the RequestAlertBar's own published height).
// Companion to lib/pos-layout.test.ts (pure arithmetic) and
// lib/pos-header-paths.test.ts (PosHeader/TableSelector/CustomerSearch/
// OpenTabsButton — split out to keep this file under the ~300-line
// convention). No React/route test framework exists here (see
// lib/table-flow-paths.test.ts), so these are raw readFileSync pins.
//
// Every check matches constant NAMES as text in the consumer's source, never
// the constants' values — except a small set of deliberate parity pins,
// which import a real numeric constant to compare against a value PARSED out
// of the other side's text (a parity pin must compare a real value to the
// other side's text, per testing.md). That covers the sidebar-width pin and
// the F14 strip/gap/tile parity pins below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import {
  SIDEBAR_WIDTH_REM,
  SIDEBAR_WIDTH_ICON_REM,
  POS_HEADER_ROW_REM,
  POS_SEARCH_ROW_REM,
  POS_MOBILE_BAR_REM,
  POS_CHIP_STRIP_REM,
  POS_ROOT_GAP_REM,
  POS_TILE_MIN_REM,
  DASHBOARD_HEADER_REM,
  POS_PRESS_FEEDBACK_CLASS,
  POS_HEADER_CONTROL_CLASS,
  POS_CART_STEPPER_CLASS,
  POS_TILE_OPTIONS_BUTTON_CLASS,
  POS_TILE_OPTIONS_RESERVE_CLASS,
  POS_CHIP_CLASS,
  POS_CART_CTA_CLASS,
  POS_MOBILE_BAR_BUTTON_CLASS,
  POS_DIALOG_LIST_CAP_CLASS,
  POS_MOVE_TABLE_LIST_CAP_CLASS,
  POS_TOUCH_ATTR,
  POS_TILE_CARD_PADDING_PX,
} from "@/lib/pos-layout";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const POS_LAYOUT_TS = "apps/cafe/lib/pos-layout.ts";
const POS_PAGE = "apps/cafe/app/(dashboard)/pos/page.tsx";
const CATEGORY_SIDEBAR = "apps/cafe/components/pos/CategorySidebar.tsx";
const MOBILE_CART_BAR = "apps/cafe/components/pos/MobileCartBar.tsx";
const CART_TSX = "apps/cafe/components/pos/Cart.tsx";
const CART_LINE = "apps/cafe/components/pos/CartLine.tsx";
const PRODUCT_GRID = "apps/cafe/components/pos/ProductGrid.tsx";
const PRODUCT_CARD = "apps/cafe/components/pos/ProductCard.tsx";
const DASHBOARD_LAYOUT = "apps/cafe/app/(dashboard)/layout.tsx";
const HEADER_TSX = "apps/cafe/components/layout/Header.tsx";
const ROOT_LAYOUT = "apps/cafe/app/layout.tsx";
const SIDEBAR_TSX = "apps/cafe/components/ui/sidebar.tsx";
const GLOBALS_CSS = "apps/cafe/app/globals.css";
const REQUEST_ALERT_BAR = "apps/cafe/components/orders/RequestAlertBar.tsx";
const INPUT_TSX = "apps/cafe/components/ui/input.tsx";
const LOGIN_PAGE = "apps/cafe/app/(auth)/login/page.tsx";
const M_LAYOUT = "apps/cafe/app/m/layout.tsx";
const PUBLIC_MENU = "apps/cafe/components/public/PublicMenu.tsx";
const GLOBAL_ERROR = "apps/cafe/app/global-error.tsx";
const TABLE_SELECTOR = "apps/cafe/components/pos/TableSelector.tsx";
const OPEN_TABS_BUTTON = "apps/cafe/components/pos/OpenTabsButton.tsx";
const MOVE_TABLE_DIALOG = "apps/cafe/components/orders/MoveTableDialog.tsx";
const TOUCH_FEEL = "apps/cafe/components/shared/TouchFeel.tsx";

test("PIN: pos/page.tsx imports the five layout classes and uses each as a real className, wrapping PosHeader/the split in POS_INSET_CLASS", () => {
  const src = stripComments(readSrc(POS_PAGE));
  const importMatch = src.match(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/pos-layout"/);
  assert.ok(importMatch, "pos/page.tsx must import from @/lib/pos-layout");
  for (const name of ["POS_ROOT_CLASS", "POS_INSET_CLASS", "POS_SPLIT_CLASS", "POS_PANE_CLASS", "POS_DESKTOP_CART_CLASS"]) {
    assert.ok(importMatch![1].includes(name), `the @/lib/pos-layout import must include ${name}`);
  }
  for (const name of ["POS_ROOT_CLASS", "POS_PANE_CLASS", "POS_DESKTOP_CART_CLASS"]) {
    assert.match(src, new RegExp(`className=\\{${name}\\}`), `${name} must be used as a bare className={${name}} somewhere in pos/page.tsx`);
  }
  assert.match(src, /<div className=\{POS_INSET_CLASS\}>\s*<PosHeader\b/, "pos/page.tsx must wrap <PosHeader in <div className={POS_INSET_CLASS}>");
  assert.match(src, /className=\{cn\(POS_SPLIT_CLASS, POS_INSET_CLASS\)\}/, "the split div must use className={cn(POS_SPLIT_CLASS, POS_INSET_CLASS)} — POS_SPLIT_CLASS is no longer a bare className");
  assert.match(src, /import\s*\{\s*cn\s*\}\s*from\s*"@\/lib\/utils"/, "pos/page.tsx must import cn from @/lib/utils");
});

test("PIN: pos/page.tsx renders both category presentations off one category state, and feeds ProductGrid the live cart quantities", () => {
  const src = stripComments(readSrc(POS_PAGE));
  assert.match(src, /<CategoryChips\b/, "pos/page.tsx must render <CategoryChips");
  assert.match(src, /<CategorySidebar\b/, "pos/page.tsx must render <CategorySidebar");
  assert.match(src, /<ProductGrid\b/, "landmark: pos/page.tsx must render <ProductGrid");
  assert.match(src, /qtyByProduct=\{qtyByProduct\}/, "pos/page.tsx must pass qtyByProduct={qtyByProduct} to ProductGrid");
});

test("PIN: the mobile cart sheet auto-closes once the cart drains — otherwise the fixed bar is a dead end over an empty sheet", () => {
  const src = stripComments(readSrc(POS_PAGE));
  assert.match(src, /pos\.cart\.length === 0\)\s*setMobileCartOpen\(false\)/, "must close the mobile cart sheet when pos.cart.length reaches 0");
});

test("PIN: pos/page.tsx never reintroduces the retired md two-pane grid or the old fixed chrome numbers", () => {
  const src = stripComments(readSrc(POS_PAGE));
  assert.ok(!src.includes("md:grid-cols"), "pos/page.tsx must not hardcode a md:grid-cols split (tablet-portrait bug)");
  assert.ok(!src.includes("7rem"), "pos/page.tsx must not hardcode the old flat 7rem chrome budget");
  assert.ok(!src.includes("pb-16"), "pos/page.tsx must not hardcode the old pb-16 bottom padding");
  assert.match(src, /<MobileCartBar\b/, "landmark: pos/page.tsx must still render <MobileCartBar");
});

test("PIN: pos/page.tsx imports CategoryChips from CategorySidebar (reachability, not just definition)", () => {
  const src = stripComments(readSrc(POS_PAGE));
  const importMatch = src.match(/import\s*\{([^}]*)\}\s*from\s*"@\/components\/pos\/CategorySidebar"/);
  assert.ok(importMatch, "pos/page.tsx must import from @/components/pos/CategorySidebar");
  assert.ok(importMatch![1].includes("CategoryChips"), "pos/page.tsx must import CategoryChips, not just CategorySidebar");
});

test("PIN: CategorySidebar exports CategoryChips, and the chip nav is labelled but NOT an ARIA tablist", () => {
  const src = stripComments(readSrc(CATEGORY_SIDEBAR));
  assert.match(src, /export function CategoryChips\(/, "CategorySidebar.tsx must export CategoryChips");
  assert.match(src, /POS_DESKTOP_ONLY_CLASS/, "the vertical rail must use POS_DESKTOP_ONLY_CLASS");
  assert.match(src, /POS_MOBILE_ONLY_CLASS/, "the chip row must use POS_MOBILE_ONLY_CLASS");
  assert.match(src, /POS_CHIP_ROW_CLASS/, "the chip row must use POS_CHIP_ROW_CLASS");
  assert.match(src, /aria-label="Product categories"/, 'the chip nav must carry aria-label="Product categories"');
  assert.ok(!src.includes('role="tablist"'), "the chip nav must NOT be an ARIA tablist — that promises roving tab focus + panels it doesn't have");
});

test("PIN: CategoryChip signals selection via aria-current (same contract as the rail's CategoryButton), never an ARIA tab role", () => {
  const src = stripComments(readSrc(CATEGORY_SIDEBAR));
  assert.match(src, /aria-current=\{selected \? "true" : undefined\}/, 'CategoryChip must use aria-current={selected ? "true" : undefined}');
  assert.ok(!src.includes('role="tab"'), "CategorySidebar.tsx must not declare role=\"tab\" anywhere — aria-current is the real selection signal");
});

test("PIN: both CategorySidebar and CategoryChips render the ALL_CATEGORIES entry before the per-cafe category list", () => {
  const src = stripComments(readSrc(CATEGORY_SIDEBAR));
  const railStart = src.indexOf("export function CategorySidebar(");
  const chipsStart = src.indexOf("export function CategoryChips(");
  assert.ok(railStart >= 0, "CategorySidebar function must exist");
  assert.ok(chipsStart > railStart, "CategoryChips must be declared after CategorySidebar");
  const railBody = src.slice(railStart, chipsStart);
  assert.ok(railBody.indexOf("ALL_CATEGORIES") >= 0 && railBody.indexOf("categories.map(") >= 0);
  assert.ok(railBody.indexOf("ALL_CATEGORIES") < railBody.indexOf("categories.map("), "CategorySidebar must render ALL_CATEGORIES before categories.map(");
  const chipsBody = src.slice(chipsStart);
  assert.ok(chipsBody.indexOf("ALL_CATEGORIES") >= 0 && chipsBody.indexOf("categories.map(") >= 0);
  assert.ok(chipsBody.indexOf("ALL_CATEGORIES") < chipsBody.indexOf("categories.map("), "CategoryChips must render ALL_CATEGORIES before categories.map(");
});

test("PIN: the category rail never reverts to its old fixed width — width comes only from the shared constants file", () => {
  const src = stripComments(readSrc(CATEGORY_SIDEBAR));
  assert.ok(!src.includes("w-28"), "CategorySidebar.tsx must not hardcode the old w-28 rail width");
  assert.ok(!src.includes("md:w-44"), "CategorySidebar.tsx must not gate the rail width at md (tablet-portrait bug)");
  assert.ok(src.includes("w-44"), "landmark: the rail must still be w-44 (11rem, matches POS_RAIL_REM), just not md-gated");
});

test("PIN: MobileCartBar mounts only below xl, in a bottom sheet, and the Cart panel inside uses the shared scrollable-panel class", () => {
  const src = stripComments(readSrc(MOBILE_CART_BAR));
  assert.match(src, /POS_MOBILE_ONLY_CLASS/, "MobileCartBar's wrapper must use POS_MOBILE_ONLY_CLASS");
  assert.match(src, /POS_MOBILE_BAR_CLASS/, "MobileCartBar's fixed bar must use POS_MOBILE_BAR_CLASS");
  assert.match(src, /side="bottom"/, 'the Sheet must open with side="bottom"');
  assert.match(src, /className=\{POS_CART_SHEET_CLASS\}/, "SheetContent must use className={POS_CART_SHEET_CLASS}");
  assert.match(src, /className=\{POS_CART_SHEET_PANEL_CLASS\}/, "the <Cart inside the sheet must use className={POS_CART_SHEET_PANEL_CLASS}");
  assert.match(src, /<Cart\b[\s\S]{0,160}onBack=\{/, "MobileCartBar must wire onBack= directly on the <Cart element");
  assert.ok(!src.includes("rounded-none border-0"), "must not hardcode the old rounded-none border-0 — now in POS_CART_SHEET_PANEL_CLASS");
});

test("PIN: MobileCartBar's outer div gates the breakpoint AND carries the sticky bar styling in one combined className (CB-1b: the bar is in-flow now, not sidebar-offset)", () => {
  const src = stripComments(readSrc(MOBILE_CART_BAR));
  assert.match(
    src,
    /className=\{cn\(POS_MOBILE_ONLY_CLASS, POS_MOBILE_BAR_CLASS\)\}/,
    "MobileCartBar's outer div must be className={cn(POS_MOBILE_ONLY_CLASS, POS_MOBILE_BAR_CLASS)}",
  );
});

test("PIN: MobileCartBar no longer reads the sidebar itself — CB-1b made the bar sticky/in-flow, so it needs no sidebar-width offset", () => {
  const src = stripComments(readSrc(MOBILE_CART_BAR));
  assert.ok(!src.includes("useSidebar"), "MobileCartBar.tsx must not import/call useSidebar any more");
  assert.ok(!src.includes("POS_MOBILE_BAR_SIDEBAR_EXPANDED_CLASS"), "must not reference the retired POS_MOBILE_BAR_SIDEBAR_EXPANDED_CLASS");
  assert.ok(!src.includes("POS_MOBILE_BAR_SIDEBAR_COLLAPSED_CLASS"), "must not reference the retired POS_MOBILE_BAR_SIDEBAR_COLLAPSED_CLASS");
  assert.match(src, /SheetTrigger/, "landmark: MobileCartBar must still render SheetTrigger");
});

test("PIN: MobileCartBar never reverts to the old md-hidden wrapper or a fixed 85dvh sheet height", () => {
  const src = stripComments(readSrc(MOBILE_CART_BAR));
  assert.ok(!src.includes("md:hidden"), "MobileCartBar must not gate itself at md (tablet-portrait bug)");
  assert.ok(!src.includes("h-[85dvh]"), "MobileCartBar must not hardcode a fixed 85dvh sheet height");
  assert.match(src, /SheetContent/, "landmark: MobileCartBar must still render SheetContent");
  assert.match(src, /Cart is empty/, "landmark: MobileCartBar must still render the empty-cart placeholder copy");
});

test("PIN: Cart accepts an optional onBack for the mobile sheet, with an accessible way back to the menu", () => {
  const src = stripComments(readSrc(CART_TSX));
  assert.match(src, /onBack\?:\s*\(\)\s*=>\s*void/, "CartProps must declare onBack?: () => void");
  assert.match(src, /aria-label="Back to menu"/, 'the back button must carry aria-label="Back to menu"');
});

test("PIN: Cart's line-list div uses the shared scrollable-list class, not a hand-rolled literal", () => {
  const src = stripComments(readSrc(CART_TSX));
  assert.match(src, /className=\{POS_CART_LIST_CLASS\}/, "Cart.tsx's line-list div must use className={POS_CART_LIST_CLASS}");
  assert.ok(!src.includes("min-h-0 flex-1 overflow-y-auto"), "must not hardcode the old literal — now in POS_CART_LIST_CLASS");
  assert.match(src, /Cart is empty/, "landmark: Cart.tsx must still render the empty-cart title");
});

test("PIN: Cart's ROOT div scrolls too (both mounts) — a short 1280x640 desktop window reaches the footer by scrolling the card, not overflowing it", () => {
  const src = stripComments(readSrc(CART_TSX));
  const rootMatch = src.match(/cn\(\s*"([^"]*)"/);
  assert.ok(rootMatch, "Cart.tsx's root div must build its className via cn(\"...\", className)");
  assert.ok(rootMatch![1].includes("overflow-y-auto"), `Cart's root className literal must include overflow-y-auto, got "${rootMatch![1]}"`);
  assert.ok(rootMatch![1].includes("rounded-lg border bg-card"), "landmark: the root className literal must still carry rounded-lg border bg-card");
  assert.match(src, /className=\{POS_CART_LIST_CLASS\}/, "the list inside must still use className={POS_CART_LIST_CLASS}");
});

test("PIN: every CTA in CartActions carries the touch-target class POS_CART_CTA_CLASS", () => {
  const src = stripComments(readSrc(CART_TSX));
  const start = src.indexOf("function CartActions");
  assert.ok(start >= 0, "CartActions must exist in Cart.tsx");
  const nextFnIdx = src.indexOf("\nfunction ", start + 1);
  const body = nextFnIdx > 0 ? src.slice(start, nextFnIdx) : src.slice(start);
  const buttonCount = (body.match(/<Button\b/g) ?? []).length;
  assert.ok(buttonCount >= 4, `landmark: CartActions must render >=4 <Button elements, found ${buttonCount}`);
  const ctaClassCount = (body.match(/className=\{POS_CART_CTA_CLASS\}/g) ?? []).length;
  assert.equal(ctaClassCount, buttonCount, `every CTA needs the touch-target class (else a 40px target under a thumb): ${buttonCount} <Button, ${ctaClassCount} with POS_CART_CTA_CLASS`);
});

test("PIN: CartLine steppers use the shared touch-target class, not the old fixed h-7 w-7", () => {
  const src = stripComments(readSrc(CART_LINE));
  assert.match(src, /POS_CART_STEPPER_CLASS/, "CartLine must use POS_CART_STEPPER_CLASS");
  assert.ok(!src.includes("h-7 w-7"), "CartLine must not hardcode the old h-7 w-7 stepper size");
  assert.match(src, /aria-label="Decrease quantity"/, "landmark: the decrease-qty stepper must still exist");
});

test("PIN: ProductGrid picks its grid class via a sidebar-keyed useGridClass() helper — the staff tablet's browser has no container query in play here (viewport tiers, kept for testability, not missing support)", () => {
  const src = stripComments(readSrc(PRODUCT_GRID));
  const importMatch = src.match(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/pos-layout"/);
  assert.ok(importMatch, "ProductGrid.tsx must import from @/lib/pos-layout");
  assert.ok(importMatch![1].includes("POS_GRID_CLASS_SIDEBAR_EXPANDED"), "the import must include POS_GRID_CLASS_SIDEBAR_EXPANDED");
  assert.ok(importMatch![1].includes("POS_GRID_CLASS_SIDEBAR_COLLAPSED"), "the import must include POS_GRID_CLASS_SIDEBAR_COLLAPSED");
  assert.match(src, /import\s*\{\s*useSidebar\s*\}\s*from\s*"@\/components\/ui\/sidebar"/, "ProductGrid.tsx must import useSidebar from @/components/ui/sidebar");
  assert.match(src, /function useGridClass\(/, "ProductGrid.tsx must declare a useGridClass() helper");
  assert.match(src, /state === "collapsed"/, 'useGridClass must branch on state === "collapsed"');
  assert.match(
    src,
    /className="min-h-0 flex-1 overflow-y-auto"/,
    'the grid\'s scroll wrapper must be the literal className="min-h-0 flex-1 overflow-y-auto"',
  );
});

test("PIN: ProductGrid never reverts to the container-query grid — @container/POS_GRID_CONTAINER_CLASS/overscroll-contain are all gone (CB-1b)", () => {
  const src = stripComments(readSrc(PRODUCT_GRID));
  assert.ok(!src.includes("@container"), "ProductGrid.tsx must not use @container");
  assert.ok(!src.includes("POS_GRID_CONTAINER_CLASS"), "ProductGrid.tsx must not reference the retired POS_GRID_CONTAINER_CLASS");
  assert.ok(!src.includes("overscroll-contain"), "must not include overscroll-contain — a drag past the grid's end must chain to the document on a short viewport");
  assert.match(src, /useGridClass/, "landmark: ProductGrid.tsx must still reference useGridClass");
});

test("PIN: GridSkeleton computes its column count the same sidebar-keyed way as the real grid", () => {
  const src = stripComments(readSrc(PRODUCT_GRID));
  const start = src.indexOf("function GridSkeleton");
  assert.ok(start >= 0, "GridSkeleton must exist");
  const nextFnIdx = src.indexOf("\nfunction ", start + 1);
  const body = nextFnIdx > 0 ? src.slice(start, nextFnIdx) : src.slice(start);
  assert.match(body, /useGridClass\(\)/, "GridSkeleton's body must call useGridClass()");
});

test("PIN: ProductGrid carries the cart-quantity prop and a real search input; ProductCard (the tile, split out in CB-1d.3a) carries the notes-button class and the press-feedback wiring", () => {
  const gridSrc = stripComments(readSrc(PRODUCT_GRID));
  assert.match(gridSrc, /qtyByProduct\?:\s*Record<string,\s*number>/, "ProductGridProps must declare qtyByProduct?: Record<string, number>");
  assert.match(gridSrc, /type="search"/, 'the search field must be type="search"');
  assert.match(gridSrc, /<ProductCard\b/, "landmark: ProductGrid must render <ProductCard — the tile lives in ProductCard.tsx since CB-1d.3a");

  const src = stripComments(readSrc(PRODUCT_CARD));
  assert.match(src, /POS_TILE_OPTIONS_BUTTON_CLASS/, "the tile's notes button must use POS_TILE_OPTIONS_BUTTON_CLASS");

  // g10: the tile button's cn() must wire POS_PRESS_FEEDBACK_CLASS directly —
  // the only component-level press-feedback wiring (in ProductCard.tsx since
  // the CB-1d.3a split; the grid itself carries none).
  assert.match(
    src,
    /POS_PRESS_FEEDBACK_CLASS,\s*TILE_MIN_HEIGHT/,
    "the tile button's cn() must apply POS_PRESS_FEEDBACK_CLASS directly (the only component-level press wiring)",
  );

  // g18: regression pin for the arbiter-probed disabled-tile :active flash — a
  // disabled control can still match :active in Chromium, so the tile button
  // must carry disabled:pointer-events-none (needle concatenated per
  // testing.md so this file's own text never spells the literal out whole).
  const disabledPointerEventsNone = "disabled:pointer-" + "events-none";
  assert.ok(src.includes("transition-colors"), "landmark: the tile button's base string must still carry transition-colors");
  assert.ok(
    src.includes(disabledPointerEventsNone),
    `the tile button's base string must carry "${disabledPointerEventsNone}" — a disabled tile can still match :active in Chromium and would otherwise flash brighter under the press-feedback token`,
  );
});

test("PIN: ProductGrid never reintroduces a locally-defined GRID_CLASS constant", () => {
  const src = stripComments(readSrc(PRODUCT_GRID));
  assert.ok(!src.includes("const GRID_CLASS ="), "ProductGrid.tsx must not re-derive its own GRID_CLASS constant");
  assert.match(src, /POS_GRID_CLASS_SIDEBAR_EXPANDED/, "landmark: ProductGrid.tsx must still reference POS_GRID_CLASS_SIDEBAR_EXPANDED");
});

test("PIN: only the dashboard layout opts into resizes-content — the public root layout must not", () => {
  const dashSrc = stripComments(readSrc(DASHBOARD_LAYOUT));
  assert.match(dashSrc, /export const viewport:\s*Viewport\s*=/, "(dashboard)/layout.tsx must export const viewport: Viewport");
  assert.match(dashSrc, /interactiveWidget:\s*"resizes-content"/, '(dashboard)/layout.tsx\'s viewport must set interactiveWidget: "resizes-content"');
  const rootSrc = stripComments(readSrc(ROOT_LAYOUT));
  assert.ok(!rootSrc.includes("export const viewport"), "app/layout.tsx (root) must NOT export a viewport");
  assert.ok(!rootSrc.includes("generateViewport"), "app/layout.tsx (root) must not define generateViewport either");
  assert.ok(!rootSrc.includes("interactiveWidget"), "app/layout.tsx (root) must not mention interactiveWidget anywhere");
  assert.match(rootSrc, /export async function generateMetadata\(/, "landmark: app/layout.tsx must still export generateMetadata");
});

test("PIN: app/layout.tsx's <body> is a vh base with a supports-dvh override (min-h-screen supports-[height:1dvh]:min-h-dvh) — CB-1c round 2 reverted round 1's percent-height-chain h-full body", () => {
  const src = stripComments(readSrc(ROOT_LAYOUT));
  const bodyMatch = src.match(/<body\b[^>]*>/);
  assert.ok(bodyMatch, "app/layout.tsx must render a <body> tag");
  assert.ok(bodyMatch![0].includes("min-h-screen"), `app/layout.tsx's <body> className must include min-h-screen, got "${bodyMatch![0]}"`);
  assert.ok(
    bodyMatch![0].includes("supports-[height:1dvh]:min-h-dvh"),
    `app/layout.tsx's <body> className must include supports-[height:1dvh]:min-h-dvh, got "${bodyMatch![0]}"`,
  );
  assert.ok(
    !bodyMatch![0].includes("h-full"),
    `app/layout.tsx's <body> must not carry round 1's h-full — that needed a percent-height chain the shell no longer has, got "${bodyMatch![0]}"`,
  );
  assert.match(src, /export async function generateMetadata\(/, "landmark: app/layout.tsx must still export generateMetadata");
  assert.match(src, /<body\b/, "landmark: app/layout.tsx must still render <body");
});

test("PIN: no stray lg: token remains in pos/page.tsx — the mode switch moved to xl", () => {
  // lib/pos-layout.ts is deliberately EXCLUDED from this sweep now: CB-1b's
  // viewport-keyed grid tiers legitimately reintroduced a real "lg:" token
  // (lg:grid-cols-4 in POS_GRID_CLASS_SIDEBAR_EXPANDED) — that is pinned by
  // the tier-encoding test in lib/pos-layout.test.ts instead.
  const src = stripComments(readSrc(POS_PAGE));
  assert.ok(!src.includes("lg:"), "pos/page.tsx must not carry a stray lg: token — the mode switch moved to xl");
  assert.match(src, /xl:block/, "landmark: pos/page.tsx must carry its xl: token (xl:block)");
});

test("PIN: lib/pos-layout.ts's only lg: token is the legitimate CB-1b grid tier, not a leftover xl-switch stray", () => {
  const src = stripComments(readSrc(POS_LAYOUT_TS));
  const occurrences = (src.match(/lg:/g) ?? []).length;
  assert.equal(occurrences, 1, `expected exactly 1 "lg:" occurrence in lib/pos-layout.ts (the grid tier), found ${occurrences}`);
  assert.match(src, /lg:grid-cols-4/, "landmark: the one lg: occurrence must be lg:grid-cols-4 (POS_GRID_CLASS_SIDEBAR_EXPANDED's tier)");
  assert.match(src, /xl:hidden/, "landmark: lib/pos-layout.ts must still carry its xl: mode-switch token");
});

test("PIN: the dashboard sidebar's widths match SIDEBAR_WIDTH_REM/SIDEBAR_WIDTH_ICON_REM, and the desktop gap div reserves that space", () => {
  const src = stripComments(readSrc(SIDEBAR_TSX));
  const expectWidth = `${SIDEBAR_WIDTH_REM}rem`;
  const expectIcon = `${SIDEBAR_WIDTH_ICON_REM}rem`;
  assert.match(src, new RegExp(`const SIDEBAR_WIDTH = "${expectWidth}"`), `sidebar.tsx's SIDEBAR_WIDTH must be "${expectWidth}" — the POS bar offset and pane matrix both assume this`);
  assert.match(src, new RegExp(`const SIDEBAR_WIDTH_ICON = "${expectIcon}"`), `sidebar.tsx's SIDEBAR_WIDTH_ICON must be "${expectIcon}"`);
  assert.match(src, /w-\(--sidebar-width\)/, "landmark: the desktop sidebar gap div must reserve w-(--sidebar-width)");
});

// ── CB-1c round 2 additions: definite-root source pins ──────────────────────

// globals.css is scanned RAW, comments included (testing.md: banned-string
// scans read raw bytes; the shared TS scanner is not verified for CSS and the
// naive block-comment regex must never be re-rolled — source-pin-utils.test.ts
// gates that repo-wide). A comment that mentions the rule would therefore trip
// this pin too — the correct failure direction for a negative fence: name the
// rule in prose, never quote it.
test("PIN: globals.css carries no html/body { ... height: 100% ... } rule any more — CB-1c round 2 reverted the percent-height chain a headless-Chrome probe rejected", () => {
  const raw = readSrc(GLOBALS_CSS);
  const normalized = raw.replace(/\s+/g, " ");
  // Any rule whose selector list names html or body (alone, grouped, or beside
  // :root) and whose block sets a bare `height: 100%` (not min-/max-height).
  const percentChainRule = /[^{}]*\b(html|body)\b[^{}]*\{[^}]*(?<![\w-])height:\s*100%/;
  assert.ok(
    !percentChainRule.test(normalized),
    "globals.css must not size html or body to height: 100% — that percent chain made <main> grow to the whole grid and un-stuck the header (CB-1c review F1/F2)",
  );
  assert.match(raw, /@import\s+"tailwindcss"/, "landmark: globals.css must still @import \"tailwindcss\"");
  assert.match(raw, /@layer\s+base/, "landmark: globals.css must still declare its @layer base block");
});

test("PIN: (dashboard)/layout.tsx renders a BARE <SidebarProvider>, and DASHBOARD_SHELL_CLASS is gone from BOTH the dashboard layout AND lib/pos-layout.ts (not just un-referenced on one side) — CB-1c round 2 reverted the shell-class experiment; RequestAlertBar + <main>'s padding stay unchanged", () => {
  // Concatenated so this pin's own source text never contains the identifier
  // as one contiguous literal (testing.md's grep-gate rule) — a repo-wide
  // scan for the retired constant name must not trip on this assertion.
  const shellClassIdentifier = "DASHBOARD_SHELL" + "_CLASS";

  const dashboardSrc = stripComments(readSrc(DASHBOARD_LAYOUT));
  assert.match(dashboardSrc, /<SidebarProvider>/, "(dashboard)/layout.tsx must render a bare <SidebarProvider>, no attributes");
  assert.ok(
    !dashboardSrc.includes(shellClassIdentifier),
    `(dashboard)/layout.tsx must not reference ${shellClassIdentifier} — the constant no longer exists in lib/pos-layout.ts`,
  );
  assert.match(dashboardSrc, /<RequestAlertBar\s*\/>/, "landmark: (dashboard)/layout.tsx must still render <RequestAlertBar />");
  assert.match(dashboardSrc, /<main className="flex-1 p-4 md:p-6">/, "landmark: (dashboard)/layout.tsx's <main> must keep its unchanged flex-1 p-4 md:p-6 padding — the height-chain matrix pin depends on this figure");

  const layoutTsSrc = stripComments(readSrc(POS_LAYOUT_TS));
  assert.ok(
    !layoutTsSrc.includes(shellClassIdentifier),
    `lib/pos-layout.ts must not declare/export ${shellClassIdentifier} — the shell-class experiment was reverted in CB-1c round 2, checked directly on the definition side, not just its former consumer`,
  );
  assert.match(layoutTsSrc, /export const POS_ROOT_CLASS/, "landmark: lib/pos-layout.ts must still export POS_ROOT_CLASS");
});

test("PIN: route-parity fences — the other routes keep the 100vh document floor the body used to give them (plan §B4, review F2)", () => {
  assert.ok(stripComments(readSrc(LOGIN_PAGE)).includes("min-h-screen"), "(auth)/login/page.tsx must still carry its own min-h-screen — unaffected by the body change");
  // /m's wrapper used to say min-h-dvh but the body's min-h-screen was the
  // binding floor on every diner page; with the body now on a dvh floor the
  // wrapper itself must carry min-h-screen so the owner-accepted QR flow's
  // document height is unchanged (review F2 — the old pin was vacuous).
  const mLayout = stripComments(readSrc(M_LAYOUT));
  // Variant-blind `includes` would accept `md:min-h-screen` (no floor at all on
  // a phone) — match the bare token in the wrapper's own class list instead.
  assert.match(mLayout, /pos-public-theme min-h-screen\b/, "app/m/layout.tsx must carry a BARE min-h-screen right after pos-public-theme on its wrapper — the diner flow keeps the 100vh floor the body used to give it");
  assert.ok(!mLayout.includes("min-h-dvh"), "app/m/layout.tsx must not carry min-h-dvh — a dvh floor there would change the owner-accepted diner flow's document height");
  assert.match(mLayout, /pos-public-theme/, "landmark: app/m/layout.tsx must still carry the pos-public-theme wrapper");
  assert.ok(stripComments(readSrc(PUBLIC_MENU)).includes("min-h-screen"), "components/public/PublicMenu.tsx must still carry its own min-h-screen");
  assert.ok(stripComments(readSrc(GLOBAL_ERROR)).includes("min-h-screen"), "app/global-error.tsx must still carry its own min-h-screen — it replaces the root layout entirely");
});

test("PIN: RequestAlertBar publishes its own height on --pos-alert-h via a synchronous layout effect + ResizeObserver, scoped to `visible` (not unmount) — review finding F16", () => {
  const src = stripComments(readSrc(REQUEST_ALERT_BAR));
  const importMatch = src.match(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/pos-layout"/);
  assert.ok(importMatch, "RequestAlertBar.tsx must import from @/lib/pos-layout");
  assert.ok(importMatch![1].includes("POS_ALERT_HEIGHT_VAR"), "the @/lib/pos-layout import must include POS_ALERT_HEIGHT_VAR");
  assert.match(src, /\buseLayoutEffect\b/, "RequestAlertBar.tsx must use useLayoutEffect — a passive effect can run after paint on a poll-triggered render, costing one wrong frame");
  assert.match(src, /new ResizeObserver\(/, "landmark: RequestAlertBar.tsx must instantiate a ResizeObserver — the band's height can change as its content wraps or gains Print buttons");
  assert.match(src, /setProperty\(POS_ALERT_HEIGHT_VAR/, "RequestAlertBar.tsx must call setProperty(POS_ALERT_HEIGHT_VAR, ...)");
  assert.match(src, /removeProperty\(POS_ALERT_HEIGHT_VAR/, "RequestAlertBar.tsx must call removeProperty(POS_ALERT_HEIGHT_VAR) in cleanup / when not visible");
  assert.ok(src.includes("}, [visible])"), "the publisher effect must be keyed on `visible`, not unmount — this component never unmounts, it renders null when idle");

  // Publisher cleanup (CB-1c round 2b): the ResizeObserver started when the
  // band is visible must be torn down — via a real `return () => ...`
  // cleanup closure that disconnects it AND removes the published variable —
  // not just left running against a detached band across a visible->hidden
  // flip. removeProperty(POS_ALERT_HEIGHT_VAR must appear at least twice:
  // the not-visible branch and a cleanup (the real source also carries a
  // third, defensive fallback cleanup for the no-ResizeObserver branch).
  assert.match(src, /observer\.disconnect\(\)/, "RequestAlertBar.tsx must call observer.disconnect() to tear down the ResizeObserver");
  assert.match(src, /return\s*\(\)\s*=>/, "RequestAlertBar.tsx's publisher effect must return a () => cleanup closure");
  const removePropertyCount = (src.match(/removeProperty\(POS_ALERT_HEIGHT_VAR/g) ?? []).length;
  assert.ok(
    removePropertyCount >= 2,
    `RequestAlertBar.tsx must call removeProperty(POS_ALERT_HEIGHT_VAR) at least twice (the not-visible branch and a cleanup), found ${removePropertyCount}`,
  );
  // The ResizeObserver cleanup itself must clear the variable right after
  // disconnecting — the count alone cannot tell that closure from the other
  // two call sites (review round-2 F4).
  assert.match(
    src,
    /observer\.disconnect\(\);\s*root\.style\.removeProperty\(POS_ALERT_HEIGHT_VAR\)/,
    "the ResizeObserver cleanup must disconnect AND removeProperty(POS_ALERT_HEIGHT_VAR) in the same closure",
  );
  // The band's own div carries BOTH the ref the observer watches and the
  // amber styling, in the SAME opening tag (not two different divs) — read
  // the real attribute order rather than guessing.
  assert.match(
    src,
    /<div[^>]*ref=\{bandRef\}[^>]*bg-amber-50/,
    "the band's <div ref={bandRef} ...> must be the SAME element that carries bg-amber-50",
  );
  assert.match(src, /bg-amber-50/, "landmark: RequestAlertBar.tsx must still carry bg-amber-50");
});

test("PIN: CategorySidebar.tsx's CategoryChips keeps the selected chip in view via a scrollIntoView effect keyed on the aria-current chip", () => {
  const src = stripComments(readSrc(CATEGORY_SIDEBAR));
  assert.match(src, /\buseRef\b/, "CategorySidebar.tsx must import/use useRef");
  assert.match(src, /\buseEffect\b/, "CategorySidebar.tsx must import/use useEffect");
  assert.match(src, /scrollIntoView/, "CategorySidebar.tsx must call scrollIntoView");
  assert.match(src, /\[aria-current="true"\]/, 'CategorySidebar.tsx must query \'[aria-current="true"]\'');
  assert.match(src, /inline:\s*"nearest"/, 'the scrollIntoView call must pass inline: "nearest"');
  assert.match(src, /block:\s*"nearest"/, 'the scrollIntoView call must pass block: "nearest" — "start" would scroll ancestors too');
  assert.match(src, /ref=\{navRef\}/, "the <nav> must carry ref={navRef}");
  // Landmark: reuse the file's existing ALL_CATEGORIES-before-categories.map(
  // ordering fact so this pin also fails loud if CategorySidebar.tsx were
  // ever gutted rather than genuinely edited.
  const chipsStart = src.indexOf("export function CategoryChips(");
  assert.ok(chipsStart >= 0, "landmark: CategoryChips must still exist");
  assert.ok(src.indexOf("ALL_CATEGORIES", chipsStart) < src.indexOf("categories.map(", chipsStart), "landmark: CategoryChips must still render ALL_CATEGORIES before categories.map(");
});

test("PIN: pos/page.tsx's root renders exactly the three in-flow children the ROOT-level POS_ROOT_GAP_COUNT boundaries assume (header wrapper, split, MobileCartBar) — the fourth boundary lives inside ProductGrid, not at the root", () => {
  const src = stripComments(readSrc(POS_PAGE));
  assert.match(src, /<div className=\{POS_INSET_CLASS\}>\s*<PosHeader\b/, "landmark: pos/page.tsx must wrap <PosHeader in <div className={POS_INSET_CLASS}> as the root's first in-flow child");
  assert.match(src, /className=\{cn\(POS_SPLIT_CLASS, POS_INSET_CLASS\)\}/, "landmark: the split div (second in-flow child) must use className={cn(POS_SPLIT_CLASS, POS_INSET_CLASS)}");
  assert.match(src, /<MobileCartBar\b/, "landmark: pos/page.tsx must render <MobileCartBar (third in-flow child)");
});

test("PIN: POS_CHIP_STRIP_REM parity — chip height (POS_CHIP_CLASS) + row bottom padding (POS_CHIP_ROW_CLASS), parsed from the real class strings, not re-typed 10+1 (review finding F14)", () => {
  const layoutSrc = stripComments(readSrc(POS_LAYOUT_TS));

  const chipClassMatch = layoutSrc.match(/POS_CHIP_CLASS\s*=\s*\n?\s*"([^"]*)"/);
  assert.ok(chipClassMatch, "pos-layout.ts must declare POS_CHIP_CLASS as a string literal");
  const chipHeightMatch = chipClassMatch![1].match(/\bh-(\d+)\b/);
  assert.ok(chipHeightMatch, `POS_CHIP_CLASS ("${chipClassMatch![1]}") must carry an h-N token`);

  const chipRowClassMatch = layoutSrc.match(/POS_CHIP_ROW_CLASS\s*=\s*"([^"]*)"/);
  assert.ok(chipRowClassMatch, "pos-layout.ts must declare POS_CHIP_ROW_CLASS as a string literal");
  const chipRowPaddingMatch = chipRowClassMatch![1].match(/(?:^|\s)pb-(\d+)(?:\s|$)/);
  assert.ok(chipRowPaddingMatch, `POS_CHIP_ROW_CLASS ("${chipRowClassMatch![1]}") must carry a bare pb-N token`);

  const hVal = Number(chipHeightMatch![1]);
  const pbVal = Number(chipRowPaddingMatch![1]);
  assert.equal(POS_CHIP_STRIP_REM * 4, hVal + pbVal, `POS_CHIP_STRIP_REM*4 must equal POS_CHIP_CLASS's h-${hVal} + POS_CHIP_ROW_CLASS's pb-${pbVal}`);
});

test("PIN: POS_ROOT_GAP_REM parity — the bare gap-N token parsed from POS_ROOT_CLASS, POS_PANE_CLASS, and ProductGrid's search|scroller container all agree (review finding F14)", () => {
  const layoutSrc = stripComments(readSrc(POS_LAYOUT_TS));

  const rootClassMatch = layoutSrc.match(/POS_ROOT_CLASS\s*=\s*\n?\s*"([^"]*)"/);
  assert.ok(rootClassMatch, "pos-layout.ts must declare POS_ROOT_CLASS as a string literal");
  const rootGapMatch = rootClassMatch![1].match(/(?:^|\s)gap-(\d+)(?:\s|$)/);
  assert.ok(rootGapMatch, `POS_ROOT_CLASS ("${rootClassMatch![1]}") must carry a bare gap-N token`);

  const paneClassMatch = layoutSrc.match(/POS_PANE_CLASS\s*=\s*"([^"]*)"/);
  assert.ok(paneClassMatch, "pos-layout.ts must declare POS_PANE_CLASS as a string literal");
  const paneGapMatch = paneClassMatch![1].match(/(?:^|\s)gap-(\d+)(?:\s|$)/);
  assert.ok(paneGapMatch, `POS_PANE_CLASS ("${paneClassMatch![1]}") must carry a bare gap-N token`);

  const gridSrc = stripComments(readSrc(PRODUCT_GRID));
  const gridContainerMatch = gridSrc.match(/className="(flex min-h-0 flex-1 flex-col gap-\d+)"/);
  assert.ok(gridContainerMatch, "ProductGrid.tsx must render its search|scroller container as flex min-h-0 flex-1 flex-col gap-N (the 4th gap boundary)");
  const gridGapMatch = gridContainerMatch![1].match(/gap-(\d+)$/);
  assert.ok(gridGapMatch, `ProductGrid.tsx's container class ("${gridContainerMatch![1]}") must end in gap-N`);

  assert.equal(POS_ROOT_GAP_REM * 4, Number(rootGapMatch![1]), `POS_ROOT_GAP_REM*4 must equal POS_ROOT_CLASS's gap-${rootGapMatch![1]}`);
  assert.equal(POS_ROOT_GAP_REM * 4, Number(paneGapMatch![1]), `POS_ROOT_GAP_REM*4 must equal POS_PANE_CLASS's gap-${paneGapMatch![1]}`);
  assert.equal(POS_ROOT_GAP_REM * 4, Number(gridGapMatch![1]), `POS_ROOT_GAP_REM*4 must equal ProductGrid's container gap-${gridGapMatch![1]}`);

  // Landmark + documented decision: the scroller itself still carries no
  // floor of its own — plan §H0 (d) FAILED that (a min-h floor on the
  // scroller left the one visible row 45px under the sticky bar); (d') put
  // the floor on the ROOT (min-h-[21.5rem]) instead, so ProductGrid's own
  // scroller stays untouched.
  assert.match(
    gridSrc,
    /className="min-h-0 flex-1 overflow-y-auto"/,
    "ProductGrid.tsx's scroller must still carry no min-h floor of its own — the floor lives on the ROOT (documented decision, plan §H0)",
  );
});

test("PIN: POS_TILE_MIN_REM parity — parsed from ProductCard's own TILE_MIN_HEIGHT constant, not re-typed", () => {
  const cardSrc = stripComments(readSrc(PRODUCT_CARD));
  const tileMinMatch = cardSrc.match(/TILE_MIN_HEIGHT\s*=\s*"min-h-\[([\d.]+)rem\]"/);
  assert.ok(tileMinMatch, 'ProductCard.tsx must declare TILE_MIN_HEIGHT = "min-h-[Nrem]"');
  assert.equal(POS_TILE_MIN_REM, Number(tileMinMatch![1]), `POS_TILE_MIN_REM must equal ProductCard.tsx's TILE_MIN_HEIGHT value (${tileMinMatch![1]}rem)`);

  // Keep the two in step: ProductGrid's own GridSkeleton uses a concrete
  // SKELETON_HEIGHT so the loading grid doesn't jump when real tiles land —
  // its value must track ProductCard's TILE_MIN_HEIGHT exactly.
  const gridSrc = stripComments(readSrc(PRODUCT_GRID));
  const skeletonMatch = gridSrc.match(/SKELETON_HEIGHT\s*=\s*"h-\[([\d.]+)rem\]"/);
  assert.ok(skeletonMatch, 'ProductGrid.tsx must declare SKELETON_HEIGHT = "h-[Nrem]"');
  assert.equal(
    Number(skeletonMatch![1]),
    Number(tileMinMatch![1]),
    `ProductGrid.tsx's SKELETON_HEIGHT (${skeletonMatch![1]}rem) must equal ProductCard.tsx's TILE_MIN_HEIGHT (${tileMinMatch![1]}rem)`,
  );
});

test("PIN: POS_SEARCH_ROW_REM/POS_HEADER_ROW_REM/POS_MOBILE_BAR_REM parity — parsed from the real consumer class strings, not re-typed numbers", () => {
  // components/ui/input.tsx's base Input class carries the real h-N the
  // search field renders at; POS_SEARCH_ROW_REM must track it in rem (h-N/4).
  const inputSrc = stripComments(readSrc(INPUT_TSX));
  const inputHeightMatch = inputSrc.match(/\bh-(\d+)\b/);
  assert.ok(inputHeightMatch, "components/ui/input.tsx's base Input class must carry an h-N token");
  assert.equal(POS_SEARCH_ROW_REM * 4, Number(inputHeightMatch![1]), `POS_SEARCH_ROW_REM*4 must equal input.tsx's h-N (${inputHeightMatch![1]})`);

  // pos-layout.ts's own POS_HEADER_CONTROL_CLASS carries the header controls'
  // real touch-target height.
  const layoutSrc = stripComments(readSrc(POS_LAYOUT_TS));
  const headerClassMatch = layoutSrc.match(/POS_HEADER_CONTROL_CLASS\s*=\s*"([^"]*)"/);
  assert.ok(headerClassMatch, "pos-layout.ts must declare POS_HEADER_CONTROL_CLASS as a string literal");
  const headerHeightMatch = headerClassMatch![1].match(/\bh-(\d+)\b/);
  assert.ok(headerHeightMatch, `POS_HEADER_CONTROL_CLASS ("${headerClassMatch![1]}") must carry an h-N token`);
  assert.equal(POS_HEADER_ROW_REM * 4, Number(headerHeightMatch![1]), `POS_HEADER_ROW_REM*4 must equal POS_HEADER_CONTROL_CLASS's h-N (${headerHeightMatch![1]})`);

  // POS_MOBILE_BAR_CLASS/POS_MOBILE_BAR_BUTTON_CLASS: p-3 (top) + h-12
  // (button) + p-3 (bottom) — pos-layout.ts's own doc comment above
  // POS_MOBILE_BAR_REM lists the same three terms, so the bar's outer p-3
  // padding is intentionally counted on BOTH sides here, not doubled by mistake.
  const barClassMatch = layoutSrc.match(/POS_MOBILE_BAR_CLASS\s*=\s*\n?\s*"([^"]*)"/);
  assert.ok(barClassMatch, "pos-layout.ts must declare POS_MOBILE_BAR_CLASS as a string literal");
  const barPaddingMatch = barClassMatch![1].match(/(?:^|\s)p-(\d+)(?:\s|$)/);
  assert.ok(barPaddingMatch, `POS_MOBILE_BAR_CLASS ("${barClassMatch![1]}") must carry a bare p-N token`);
  const buttonClassMatch = layoutSrc.match(/POS_MOBILE_BAR_BUTTON_CLASS\s*=\s*"([^"]*)"/);
  assert.ok(buttonClassMatch, "pos-layout.ts must declare POS_MOBILE_BAR_BUTTON_CLASS as a string literal");
  const buttonHeightMatch = buttonClassMatch![1].match(/\bh-(\d+)\b/);
  assert.ok(buttonHeightMatch, `POS_MOBILE_BAR_BUTTON_CLASS ("${buttonClassMatch![1]}") must carry an h-N token`);
  const pVal = Number(barPaddingMatch![1]);
  const hVal = Number(buttonHeightMatch![1]);
  assert.equal(POS_MOBILE_BAR_REM, (pVal + hVal + pVal) / 4, `POS_MOBILE_BAR_REM must equal (p-${pVal} + h-${hVal} + p-${pVal})/4`);
});

// ── CB-1c round 2b additions (fresh-eyes review pin hardening) ─────────────

test("PIN: DASHBOARD_HEADER_REM parity — parsed from Header.tsx's real <header> h-N token, not re-typed (the height-chain matrix's chrome constants assume this figure)", () => {
  const src = stripComments(readSrc(HEADER_TSX));
  const headerMatch = src.match(/<header className="([^"]*)"/);
  assert.ok(headerMatch, 'Header.tsx must render a <header className="..."> tag');
  assert.ok(headerMatch![1].includes("sticky top-0"), "landmark: Header.tsx's <header> must carry sticky top-0");
  const heightMatch = headerMatch![1].match(/\bh-(\d+)\b/);
  assert.ok(heightMatch, `Header.tsx's <header> className ("${headerMatch![1]}") must carry an h-N token`);
  assert.equal(
    DASHBOARD_HEADER_REM * 4,
    Number(heightMatch![1]),
    `DASHBOARD_HEADER_REM*4 must equal Header.tsx's h-${heightMatch![1]}`,
  );
});

test("PIN: CategoryChips' <nav> composes exactly cn(POS_MOBILE_ONLY_CLASS, POS_CHIP_ROW_CLASS) — no third class argument — and no md: literal survives anywhere in CategorySidebar.tsx (the chip strip is one scrolling line at every width below xl)", () => {
  const src = stripComments(readSrc(CATEGORY_SIDEBAR));
  assert.match(
    src,
    /cn\(\s*POS_MOBILE_ONLY_CLASS\s*,\s*POS_CHIP_ROW_CLASS\s*\)/,
    "CategoryChips' <nav> must call cn(POS_MOBILE_ONLY_CLASS, POS_CHIP_ROW_CLASS) with no third argument",
  );
  assert.match(src, /aria-current/, "landmark: CategorySidebar.tsx must still carry aria-current");
  assert.ok(
    !src.includes("md:"),
    "CategorySidebar.tsx must not carry any md: literal anywhere — the owner-decided single scrolling chip line has no md-gated wrapping cloud left to reintroduce",
  );
});

test("PIN: (dashboard)/layout.tsx renders Header, then RequestAlertBar, then <main> — in that ORDER — so the alert-bar budget's assumption (an in-flow SIBLING above <main>, not a child inside it) holds", () => {
  const src = stripComments(readSrc(DASHBOARD_LAYOUT));
  assert.match(src, /<SidebarInset>/, "landmark: (dashboard)/layout.tsx must render <SidebarInset>");
  const headerIdx = src.indexOf("<Header");
  const alertIdx = src.indexOf("<RequestAlertBar");
  const mainIdx = src.indexOf('<main className="flex-1 p-4 md:p-6">');
  assert.ok(headerIdx >= 0, "(dashboard)/layout.tsx must render <Header");
  assert.ok(alertIdx >= 0, "(dashboard)/layout.tsx must render <RequestAlertBar");
  assert.ok(mainIdx >= 0, '(dashboard)/layout.tsx must render <main className="flex-1 p-4 md:p-6">');
  assert.ok(headerIdx < alertIdx, "<Header must be rendered before <RequestAlertBar");
  assert.ok(alertIdx < mainIdx, "<RequestAlertBar must be rendered before <main — it is main's sibling, not its child");
});

// ── CB-1d.1 additions: touch-feel/device-size token changes ────────────────

test("PIN: POS_PRESS_FEEDBACK_CLASS is duplicated VERBATIM inside every touch-target token (CB-1d.1 L1) — a paths pin, not a re-typed literal, keeps the six copies in sync", () => {
  for (const [label, cls] of [
    ["POS_HEADER_CONTROL_CLASS", POS_HEADER_CONTROL_CLASS],
    ["POS_CART_STEPPER_CLASS", POS_CART_STEPPER_CLASS],
    ["POS_TILE_OPTIONS_BUTTON_CLASS", POS_TILE_OPTIONS_BUTTON_CLASS],
    ["POS_CHIP_CLASS", POS_CHIP_CLASS],
    ["POS_CART_CTA_CLASS", POS_CART_CTA_CLASS],
    ["POS_MOBILE_BAR_BUTTON_CLASS", POS_MOBILE_BAR_BUTTON_CLASS],
  ] as const) {
    assert.ok(cls.includes(POS_PRESS_FEEDBACK_CLASS), `${label} must include POS_PRESS_FEEDBACK_CLASS verbatim`);
  }
});

test("PIN: POS_PRESS_FEEDBACK_CLASS itself carries the instant-tap primitives, gates every active: state on a coarse pointer, and stays compositor-only (scale/opacity — never a paint property)", () => {
  assert.ok(POS_PRESS_FEEDBACK_CLASS.includes("touch-manipulation"), "POS_PRESS_FEEDBACK_CLASS must include touch-manipulation");
  assert.ok(POS_PRESS_FEEDBACK_CLASS.includes("select-none"), "POS_PRESS_FEEDBACK_CLASS must include select-none");

  const tokens = POS_PRESS_FEEDBACK_CLASS.split(/\s+/).filter(Boolean);
  let activeCount = 0;
  for (const t of tokens) {
    if (!t.includes("active:")) continue;
    activeCount++;
    assert.ok(
      t.startsWith("pointer-coarse:active:"),
      `token "${t}" carries active: but is not gated pointer-coarse:active: — an ungated active state would show pressed feedback on desktop too (V1's glass-never-shrinks concern applies to feedback, not just size)`,
    );
    const utility = t.slice("pointer-coarse:active:".length);
    assert.ok(
      /^(scale|opacity)-/.test(utility),
      `token "${t}"'s post-active utility "${utility}" must be scale- or opacity- (compositor-only) — a bg-/text-/border-/shadow- utility here would force a paint on every tap`,
    );
  }
  assert.ok(activeCount >= 2, `landmark: expected >=2 active: tokens in POS_PRESS_FEEDBACK_CLASS, found ${activeCount}`);
});

test("PIN: header/stepper/options-button/CTA/reserve tokens gate their xl compact look on pointer-fine ONLY — glass (coarse) never shrinks at xl (CB-1d.1 V1); every xl: term in these tokens is pointer-fine-gated, enumerated, not just the documented ones (CB-1d.1 g11)", () => {
  for (const [label, cls, xlLandmarks] of [
    ["POS_HEADER_CONTROL_CLASS", POS_HEADER_CONTROL_CLASS, ["xl:pointer-fine:h-8", "xl:pointer-fine:text-xs"]],
    ["POS_CART_STEPPER_CLASS", POS_CART_STEPPER_CLASS, ["xl:pointer-fine:h-7", "xl:pointer-fine:w-7"]],
    ["POS_TILE_OPTIONS_BUTTON_CLASS", POS_TILE_OPTIONS_BUTTON_CLASS, ["xl:pointer-fine:h-8", "xl:pointer-fine:w-8"]],
    ["POS_CART_CTA_CLASS", POS_CART_CTA_CLASS, ["xl:pointer-fine:h-10"]],
    ["POS_TILE_OPTIONS_RESERVE_CLASS", POS_TILE_OPTIONS_RESERVE_CLASS, ["xl:pointer-fine:pr-7"]],
  ] as const) {
    for (const needle of xlLandmarks) {
      assert.ok(cls.includes(needle), `landmark: ${label} must include "${needle}"`);
    }
    assert.ok(
      !/xl:(?!pointer-fine:)(?:h|w|text)-/.test(cls),
      `${label} must not carry an xl: h-/w-/text- token that skips the pointer-fine gate — that would shrink the touch target for a coarse pointer at xl too`,
    );

    // g11: enumerate EVERY xl: term (not just h-/w-/text-, which the negative
    // regex above already covers) — the (?:^|\s) anchor is required, or a
    // bare /xl:\S+/ would false-match INSIDE a future 2xl: token.
    const xlTerms = (cls.match(/(?:^|\s)(xl:\S+)/g) ?? []).map((s) => s.trim());
    assert.ok(xlTerms.length > 0, `landmark: ${label} must carry at least one xl: term`);
    for (const t of xlTerms) {
      assert.ok(
        t.startsWith("xl:pointer-fine:"),
        `${label}'s xl: term "${t}" must be gated on xl:pointer-fine: — an ungated xl: term would apply to a coarse pointer too`,
      );
    }
  }
});

// Utility/variant split for a single Tailwind spacing token: `base` is the
// bare (un-prefixed) N, `fine` is the N behind xl:pointer-fine: — parsed from
// the real class strings, never re-typed (review CB-1d.1, "reserve arithmetic").
function baseAndFineOf(cls: string, prefix: "pr" | "h"): { base: number; fine: number } {
  const baseMatch = cls.match(new RegExp(`(?:^|\\s)${prefix}-(\\d+)(?:\\s|$)`));
  const fineMatch = cls.match(new RegExp(`xl:pointer-fine:${prefix}-(\\d+)`));
  assert.ok(baseMatch, `expected a bare ${prefix}-N token in "${cls}"`);
  assert.ok(fineMatch, `expected an xl:pointer-fine:${prefix}-N token in "${cls}"`);
  return { base: Number(baseMatch![1]), fine: Number(fineMatch![1]) };
}

test("PIN: POS_TILE_OPTIONS_RESERVE_CLASS clears its button's touch target at both the base and xl:pointer-fine sizes (button height + 4px inset − POS_TILE_CARD_PADDING_PX)", () => {
  const reserve = baseAndFineOf(POS_TILE_OPTIONS_RESERVE_CLASS, "pr");
  const button = baseAndFineOf(POS_TILE_OPTIONS_BUTTON_CLASS, "h");
  const INSET_PX = 4;
  assert.ok(
    reserve.base * 4 >= button.base * 4 + INSET_PX - POS_TILE_CARD_PADDING_PX,
    `base pr-${reserve.base} (${reserve.base * 4}px) must clear h-${button.base} (${button.base * 4}px) + ${INSET_PX} − ${POS_TILE_CARD_PADDING_PX} = ${button.base * 4 + INSET_PX - POS_TILE_CARD_PADDING_PX}px`,
  );
  assert.ok(
    reserve.fine * 4 >= button.fine * 4 + INSET_PX - POS_TILE_CARD_PADDING_PX,
    `xl:pointer-fine pr-${reserve.fine} (${reserve.fine * 4}px) must clear h-${button.fine} (${button.fine * 4}px) + ${INSET_PX} − ${POS_TILE_CARD_PADDING_PX} = ${button.fine * 4 + INSET_PX - POS_TILE_CARD_PADDING_PX}px`,
  );
});

test("PIN: ProductCard's tile markup encodes exactly the geometry the name-box floor arithmetic assumes (CB-1d.1 g1; the tile moved to ProductCard.tsx in CB-1d.3a) — card padding p-2.5, thumb row gap-2, thumb h-10 w-10 shrink-0, and the reserve landing on the name column", () => {
  const src = stripComments(readSrc(PRODUCT_CARD));
  assert.match(src, /p-2\.5\b/, "landmark: the tile card's base className must carry p-2.5 (POS_TILE_CARD_PADDING_PX = 10)");
  assert.match(src, /className="flex w-full min-w-0 items-start gap-2"/, "the thumb+name row must carry gap-2 (POS_TILE_ROW_GAP_PX = 8)");
  assert.ok(src.includes("h-10 w-10 shrink-0"), "landmark: the thumb (image or fallback initial) must carry h-10 w-10 shrink-0 (POS_TILE_THUMB_PX = 40)");
  assert.match(
    src,
    /cn\("min-w-0 flex-1",\s*POS_TILE_OPTIONS_RESERVE_CLASS\)/,
    "the reserve must land on the name column via cn(\"min-w-0 flex-1\", POS_TILE_OPTIONS_RESERVE_CLASS)",
  );
});

test("PIN: POS_DIALOG_LIST_CAP_CLASS/POS_MOVE_TABLE_LIST_CAP_CLASS each pair a vh base with an EXACT-matching dvh override (CB-1d.1 V2)", () => {
  const capPattern = /^max-h-\[(\d+)vh\] supports-\[height:1dvh\]:max-h-\[\1dvh\]$/;
  for (const [label, cls] of [
    ["POS_DIALOG_LIST_CAP_CLASS", POS_DIALOG_LIST_CAP_CLASS],
    ["POS_MOVE_TABLE_LIST_CAP_CLASS", POS_MOVE_TABLE_LIST_CAP_CLASS],
  ] as const) {
    assert.match(cls, capPattern, `${label} ("${cls}") must be exactly "max-h-[Nvh] supports-[height:1dvh]:max-h-[Ndvh]" with matching N`);
  }
});

test("PIN: TableSelector and OpenTabsButton use POS_DIALOG_LIST_CAP_CLASS for their scrollable list — no bare max-h-[60vh] literal left behind (CB-1d.1 V2)", () => {
  // Needle built by concatenation (testing.md) so this file's own source text
  // never contains the literal as one contiguous string.
  const sixtyVh = "max-h-[60" + "vh]";
  for (const { label, path: rel, landmark } of [
    {
      label: "TableSelector",
      path: TABLE_SELECTOR,
      landmark: /cn\("grid grid-cols-4 gap-2 overflow-y-auto", POS_DIALOG_LIST_CAP_CLASS\)/,
    },
    {
      label: "OpenTabsButton",
      path: OPEN_TABS_BUTTON,
      landmark: /cn\("space-y-2 overflow-y-auto", POS_DIALOG_LIST_CAP_CLASS\)/,
    },
  ] as const) {
    const src = stripComments(readSrc(rel));
    assert.match(src, landmark, `landmark: ${label} must call cn(...) with POS_DIALOG_LIST_CAP_CLASS on its scrollable list`);
    assert.ok(!src.includes(sixtyVh), `${label} must not carry a bare "${sixtyVh}" literal — POS_DIALOG_LIST_CAP_CLASS replaces it`);
  }
});

test("PIN: MoveTableDialog uses POS_MOVE_TABLE_LIST_CAP_CLASS for its table grid — no bare max-h-[50vh] literal left behind", () => {
  const fiftyVh = "max-h-[50" + "vh]";
  const src = stripComments(readSrc(MOVE_TABLE_DIALOG));
  assert.match(
    src,
    /cn\("grid grid-cols-3 gap-2 overflow-y-auto", POS_MOVE_TABLE_LIST_CAP_CLASS\)/,
    "landmark: MoveTableDialog must call cn(...) with POS_MOVE_TABLE_LIST_CAP_CLASS on its table grid",
  );
  assert.ok(!src.includes(fiftyVh), `MoveTableDialog must not carry a bare "${fiftyVh}" literal — POS_MOVE_TABLE_LIST_CAP_CLASS replaces it`);
});

test("PIN: MoveTableDialog's table tile keeps a long table name readable — min-w-0 on the tile button, truncate px-1 on the name span, and the status sub-line also truncates", () => {
  const src = stripComments(readSrc(MOVE_TABLE_DIALOG));
  assert.match(
    src,
    /"flex min-w-0 flex-col items-center justify-center gap-0\.5 rounded-lg border p-2 text-sm font-semibold transition"/,
    "MoveTableDialog's tile button base class must include min-w-0",
  );
  assert.match(
    src,
    /<span className="max-w-full truncate px-1">\{t\.tableNo\}<\/span>/,
    "MoveTableDialog's tile name span must be exactly max-w-full truncate px-1",
  );
  assert.match(
    src,
    /<span className="max-w-full truncate text-\[10px\] font-normal">/,
    "landmark: the status sub-line span must also carry max-w-full truncate",
  );
});

test("PIN: (dashboard)/layout.tsx mounts <TouchFeel />, which publishes/removes POS_TOUCH_ATTR on <html> (CB-1d.1 L1) — same publish/remove shape as RequestAlertBar's --pos-alert-h", () => {
  const dashboardSrc = stripComments(readSrc(DASHBOARD_LAYOUT));
  assert.match(
    dashboardSrc,
    /import\s*\{\s*TouchFeel\s*\}\s*from\s*"@\/components\/shared\/TouchFeel"/,
    "(dashboard)/layout.tsx must import TouchFeel from @/components/shared/TouchFeel",
  );
  assert.match(dashboardSrc, /<TouchFeel\s*\/>/, "(dashboard)/layout.tsx must render <TouchFeel />");

  const touchFeelSrc = stripComments(readSrc(TOUCH_FEEL));
  assert.match(touchFeelSrc, /setAttribute\(POS_TOUCH_ATTR/, "TouchFeel.tsx must call setAttribute(POS_TOUCH_ATTR, ...)");
  assert.match(touchFeelSrc, /removeAttribute\(POS_TOUCH_ATTR\)/, "TouchFeel.tsx's cleanup must call removeAttribute(POS_TOUCH_ATTR)");
  assert.match(
    touchFeelSrc,
    /return\s*\(\)\s*=>\s*document\.documentElement\.removeAttribute\(POS_TOUCH_ATTR\)/,
    "TouchFeel.tsx's effect must return a () => cleanup closure that removes the attribute (adjacency pattern, like RequestAlertBar's disconnect(); removeProperty()",
  );
});

test("PIN: globals.css's [data-pos-touch] selector and POS_TOUCH_ATTR cannot drift — CSS can't import TS, so this pin is the bridge", () => {
  assert.equal(POS_TOUCH_ATTR, "data-pos-" + "touch", "POS_TOUCH_ATTR's value must stay data-pos-touch");
  const cssSrc = readSrc(GLOBALS_CSS);
  assert.ok(cssSrc.includes("[" + POS_TOUCH_ATTR + "]"), `globals.css must contain "[${POS_TOUCH_ATTR}]"`);
});

// Brace-matches from an "@layer base" opener to that block's OWN closing
// brace — slicing to EOF (the old approach) would let a scan over the
// returned "block" spuriously see every OTHER rule later in the file too.
// Used by both the @layer-nesting pin below and the g20 bare-word scan.
function boundedLayerBlock(cssSrc: string, layerIdx: number, fromIdx: number): string {
  const openIdx = cssSrc.indexOf("{", layerIdx);
  assert.ok(openIdx >= 0 && openIdx <= fromIdx, "the @layer base block must open a brace at or before the scan start point");
  let depth = 0;
  let closeIdx = -1;
  for (let i = openIdx; i < cssSrc.length; i++) {
    if (cssSrc[i] === "{") depth++;
    else if (cssSrc[i] === "}") {
      depth--;
      if (depth === 0) {
        closeIdx = i;
        break;
      }
    }
  }
  assert.ok(closeIdx > openIdx, "must find the @layer base block's own closing brace via brace-matching");
  return cssSrc.slice(fromIdx, closeIdx + 1);
}

test("PIN: globals.css's touch-feel block lives inside its own @layer base and carries the coarse-pointer pressed state", () => {
  const cssSrc = readSrc(GLOBALS_CSS);
  const touchIdx = cssSrc.indexOf("[" + POS_TOUCH_ATTR + "]");
  assert.ok(touchIdx >= 0, "landmark: globals.css must contain a [data-pos-touch] selector to scope this scan from");
  const layerIdx = cssSrc.lastIndexOf("@layer base", touchIdx);
  assert.ok(layerIdx >= 0 && layerIdx < touchIdx, "the [data-pos-touch] block must be nested inside its own @layer base");

  // g5: a real nesting check, not just "comes after somewhere" — count net
  // open braces between the @layer base opener and the touch selector; a
  // depth of 0 (or negative) would mean an intervening block already closed
  // @layer base before the selector even starts.
  const between = cssSrc.slice(layerIdx, touchIdx);
  const depth = (between.match(/\{/g) ?? []).length - (between.match(/\}/g) ?? []).length;
  assert.ok(depth >= 1, "the [data-pos-touch] selector must sit INSIDE that @layer base block, not merely after one");

  const block = boundedLayerBlock(cssSrc, layerIdx, touchIdx);
  assert.match(block, /touch-action:\s*manipulation/, "the touch block must set touch-action: manipulation");
  assert.match(block, /-webkit-tap-highlight-color:\s*transparent/, "the touch block must set -webkit-tap-highlight-color: transparent");
  assert.match(block, /(?:^|\s)user-select:\s*none/, "the touch block must set user-select: none (bare, not -webkit-prefixed)");
  assert.match(block, /-webkit-touch-callout:\s*none/, "the touch block must set -webkit-touch-callout: none — silences the long-press callout on tappable surfaces");
  const coarseMatch = block.match(/@media\s*\(pointer:\s*coarse\)/);
  assert.ok(coarseMatch, "the touch block must carry an @media (pointer: coarse) rule");
  const coarseBlock = block.slice(coarseMatch!.index!);
  assert.match(coarseBlock, /:active/, "landmark: the coarse-pointer block must key on :active");
  assert.match(coarseBlock, /opacity:\s*0\.7/, "the coarse-pointer :active rule must set opacity: 0.7");
});

test("PIN: globals.css's [data-pos-touch] selector lists never include input/textarea/select elements — touch feedback must never suppress a form control", () => {
  const cssSrc = readSrc(GLOBALS_CSS);
  const touchIdx = cssSrc.indexOf("[" + POS_TOUCH_ATTR + "]");
  assert.ok(touchIdx >= 0, "landmark: globals.css must contain a [data-pos-touch] selector to scope this scan from");
  const layerIdx = cssSrc.lastIndexOf("@layer base", touchIdx);
  assert.ok(layerIdx >= 0 && layerIdx < touchIdx, "landmark: the [data-pos-touch] block must be nested inside its own @layer base");
  const block = boundedLayerBlock(cssSrc, layerIdx, touchIdx);

  const whereLists = Array.from(block.matchAll(/:where\(([^)]*)\)/g)).map((m) => m[1]);
  assert.ok(whereLists.length > 0, "landmark: the touch block must contain at least one :where(...) selector list");
  assert.ok(whereLists.some((l) => /\bbutton\b/.test(l)), "landmark: at least one :where(...) list must include the button element");

  for (const list of whereLists) {
    const tokens = list.split(",").map((t) => t.trim());
    for (const el of ["input", "textarea", "select"]) {
      assert.ok(!tokens.includes(el), `:where(${list}) must not include the bare "${el}" element`);
    }
  }

  // g20: a bare-word scan over the WHOLE bounded block, not just the
  // :where() lists above — catches a form-control name introduced any other
  // way (a plain selector, a nested rule) that the :where()-only loop would
  // miss. The [\w-] lookbehind/lookahead excludes user-select/
  // -webkit-user-select (the touch block already carries both — same idiom
  // this file uses at the globals.css percent-height-chain scan, ~:344).
  assert.ok(
    !/(?<![\w-])(input|textarea|select)(?![\w-])/.test(block),
    "no form-control element may appear anywhere in the touch block, qualified or not",
  );
});

test("PIN: app/m/layout.tsx never mounts the touch-feel scope — the diner flow stays untouched by CB-1d.1 (TouchFeel only mounts in (dashboard)/layout.tsx)", () => {
  const src = readSrc(M_LAYOUT);
  const needle = "data-pos-" + "touch";
  assert.ok(!src.includes(needle), `app/m/layout.tsx must not contain "${needle}"`);
  assert.match(src, /pos-public-theme min-h-screen\b/, "landmark: app/m/layout.tsx must still carry its pos-public-theme min-h-screen wrapper");

  // g6: the attribute-string scan above only catches TouchFeel by its
  // published attribute; also fence the component reference itself, on both
  // /m AND the ROOT layout (the root owns the <html> above /m — mounting the
  // publisher there would leak the attribute into the diner flow even though
  // /m's own file never mentions it). Concatenated needle per testing.md.
  const component = "Touch" + "Feel";
  assert.ok(!src.includes(component), `app/m/layout.tsx must not reference ${component} anywhere`);

  const rootSrc = readSrc(ROOT_LAYOUT);
  assert.ok(!rootSrc.includes(component), `app/layout.tsx (root) must not reference ${component} anywhere — it owns the <html> above /m, so mounting the publisher there would leak data-pos-touch into the diner flow`);
  assert.match(rootSrc, /export async function generateMetadata\(/, "landmark: app/layout.tsx must still export generateMetadata");
});

// CB-1d.1b (owner device pass 2026-09-04, phone): the pane is a grid item, and
// a grid item's automatic minimum width is its min-content width — the chip
// strip (ONE non-wrapping line of shrink-0 chips; its own overflow-x-auto does
// not shrink the contribution) hands the SUM of every chip to that. With 12
// categories the single auto column sized to ~1225px and a 412px phone laid
// the whole POS out at 1241px wide: two 608px tiles per row — the owner's
// "bahut bade bade box". min-w-0 on the pane is what lets the track size to
// the viewport and the strip scroll sideways as designed (headless probe:
// innerWidth 1241 → 412, grid 608px×2 → 186px×2, document scrollWidth = 412).
test("PIN: POS_PANE_CLASS carries min-w-0 so the chip strip's min-content width can never widen the split's auto column (CB-1d.1b phone layout)", () => {
  const layoutSrc = stripComments(readSrc(POS_LAYOUT_TS));
  const paneClassMatch = layoutSrc.match(/POS_PANE_CLASS\s*=\s*"([^"]*)"/);
  assert.ok(paneClassMatch, "landmark: pos-layout.ts must declare POS_PANE_CLASS as a string literal");
  const paneTokens = paneClassMatch![1].split(/\s+/);
  assert.ok(paneTokens.includes("min-w-0"), `POS_PANE_CLASS ("${paneClassMatch![1]}") must carry min-w-0`);
  assert.ok(paneTokens.includes("min-h-0"), `POS_PANE_CLASS ("${paneClassMatch![1]}") must still carry min-h-0 (the height chain)`);
  assert.ok(paneTokens.includes("flex") && paneTokens.includes("flex-col"), "POS_PANE_CLASS must still be a flex column below xl");

  // The strip keeps its own sideways scroll — the pane's min-w-0 is what makes
  // that scroll actually happen instead of widening the page.
  const chipRowClassMatch = layoutSrc.match(/POS_CHIP_ROW_CLASS\s*=\s*"([^"]*)"/);
  assert.ok(chipRowClassMatch, "landmark: pos-layout.ts must declare POS_CHIP_ROW_CLASS as a string literal");
  assert.ok(chipRowClassMatch![1].split(/\s+/).includes("overflow-x-auto"), "POS_CHIP_ROW_CLASS must keep overflow-x-auto");

  // The pane div is the split's FIRST child (the grid item whose automatic
  // minimum this pin guards) and takes the constant verbatim.
  const pageSrc = stripComments(readSrc(POS_PAGE));
  assert.match(pageSrc, /className=\{POS_PANE_CLASS\}/, "landmark: pos/page.tsx must render the pane with className={POS_PANE_CLASS}");
  assert.match(
    pageSrc,
    /className=\{cn\(POS_SPLIT_CLASS, POS_INSET_CLASS\)\}\s*>\s*<div className=\{POS_PANE_CLASS\}/,
    "the pane must be the split div's first child — it is the grid item whose min-width the chip strip was widening",
  );
});

// ---------------------------------------------------------------------------
// D9.8 (owner decision 2026-09-26) — the cart footer's "More" menu.
// The occasional money controls moved off the always-visible footer stack.
// These pins guard the SAFETY property that made that move acceptable:
// an adjustment the customer is actually paying is never concealed by it.
// ---------------------------------------------------------------------------

const CART_MORE_MENU = "apps/cafe/components/pos/CartMoreMenu.tsx";
const CART_EXTRA_CHARGES = "apps/cafe/components/pos/CartExtraCharges.tsx";

test("PIN: D9.8 — the occasional money controls render INSIDE CartMoreMenu, not in the always-visible footer stack", () => {
  const src = stripComments(readSrc(CART_TSX));
  const open = src.indexOf("<CartMoreMenu");
  const close = src.indexOf("</CartMoreMenu>");
  assert.ok(open > 0, "Cart.tsx must render <CartMoreMenu>");
  assert.ok(close > open, "Cart.tsx must close </CartMoreMenu>");

  const inside = src.slice(open, close);
  for (const needle of ["<CartReward", "<CartPromo", "<CartExtraCharges", "POS_CART_GST_BUTTON_CLASS"]) {
    assert.ok(
      inside.includes(needle),
      `${needle} must render INSIDE the More menu — putting it back in the always-visible stack is what crowded the 22rem column and the phone sheet`,
    );
  }
  // The discount field is identified by its own aria-label, not by a tag.
  assert.ok(
    inside.includes('aria-label="Discount value"'),
    "the discount input must render inside the More menu",
  );
});

test("PIN: D9.8 — APPLIED money stays OUTSIDE the menu: the discount line, the extra-charge rows and Total are never hidden behind a tap", () => {
  const src = stripComments(readSrc(CART_TSX));
  const close = src.indexOf("</CartMoreMenu>");
  assert.ok(close > 0, "landmark: Cart.tsx must close </CartMoreMenu>");
  const after = src.slice(close);

  // Needle is anchored on the tag BOUNDARY (`\s` or `/>`), not a bare prefix:
  // `includes("<CartExtraChargeRows")` also matches `<CartExtraChargeRowsXX`,
  // so a renamed-away component would have passed this pin (caught by
  // mutation-testing it — a bare substring is not an identity check).
  assert.match(
    after,
    /<CartExtraChargeRows[\s/>]/,
    "the APPLIED extra-charge rows must render AFTER the menu closes — a charge the customer pays is never hidden behind a tap",
  );
  assert.ok(
    after.includes("Discount applied"),
    'the "Discount applied" line must render outside the menu',
  );
  assert.ok(
    /<span>Total<\/span>/.test(after),
    "Total must render outside the menu",
  );
  // The rows component takes no onAdd: the FORM is what moved, not the list.
  assert.ok(
    !/<CartExtraChargeRows[^>]*onAdd/.test(src),
    "CartExtraChargeRows must not take onAdd — it renders applied rows only",
  );
});

test("PIN: D9.8 — CartMoreMenu's trigger summarises what it is hiding, so an applied adjustment can never look idle", () => {
  const cartSrc = stripComments(readSrc(CART_TSX));
  assert.match(
    cartSrc,
    /<CartMoreMenu\s+activeLabels=\{activeAdjustments\}/,
    "Cart.tsx must pass activeAdjustments to CartMoreMenu's activeLabels",
  );
  // Every adjustment the menu can hide must contribute to that summary. The
  // condition is matched on the SAME line as its own push(), not merely
  // present somewhere in the file: `promoCode` (say) appears in the props,
  // the destructure and the CartPromo call, so a whole-file `includes` passed
  // even with the push deleted (caught by mutation-testing this pin).
  const pushLines = cartSrc
    .split("\n")
    .filter((l) => l.includes("activeAdjustments.push"));
  assert.ok(pushLines.length >= 4, `expected at least 4 activeAdjustments.push lines, got ${pushLines.length}`);
  for (const [needle, what] of [
    ["discount > 0", "a manual/GST/reward discount"],
    ["promoCode", "an applied promo code"],
    ["selectedRewardAt !== null", "a selected reward"],
    ["extraCharges.length > 0", "a staff-entered extra charge"],
  ] as const) {
    assert.ok(
      pushLines.some((l) => l.includes(needle)),
      `activeAdjustments must account for ${what} — no activeAdjustments.push line tests \`${needle}\``,
    );
  }

  const menuSrc = stripComments(readSrc(CART_MORE_MENU));
  assert.ok(
    menuSrc.includes("activeLabels.join"),
    "CartMoreMenu must render the active labels on its own trigger, not only in aria",
  );
});

test("PIN: D9.8 — CartMoreMenu uses a Popover, NEVER a DropdownMenu (a DropdownMenuItem closes on click and would make the discount/promo/charge inputs unusable)", () => {
  const src = stripComments(readSrc(CART_MORE_MENU));
  assert.match(
    src,
    /from\s*"@\/components\/ui\/popover"/,
    "CartMoreMenu must import from components/ui/popover",
  );
  assert.ok(src.includes("<PopoverContent"), "landmark: CartMoreMenu must render a PopoverContent");
  assert.ok(
    !src.includes("dropdown-menu"),
    "CartMoreMenu must not import the dropdown-menu primitive — its items close the menu on click, which breaks typing a discount or a promo code",
  );
  assert.ok(
    !src.includes("DropdownMenuItem"),
    "CartMoreMenu must not use DropdownMenuItem — see above",
  );
});

test("PIN: D9.8 — CartExtraCharges still exports BOTH the add-form and the applied-rows components", () => {
  const src = stripComments(readSrc(CART_EXTRA_CHARGES));
  assert.match(src, /export function CartExtraChargeRows/, "must export CartExtraChargeRows (applied rows)");
  assert.match(src, /export function CartExtraCharges\b/, "must export CartExtraCharges (the add form)");
  assert.ok(
    /if\s*\(extras\.length === 0\)\s*return null;/.test(src),
    "CartExtraChargeRows must render nothing when empty — an ordinary sale pays no footer height for it",
  );
});
