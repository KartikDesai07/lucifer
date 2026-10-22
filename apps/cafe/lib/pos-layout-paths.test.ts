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
  NAV_WIDTH_WIDE_PX,
  NAV_WIDTH_RAIL_PX,
  NAV_RAIL_MIN_PX,
  NAV_WIDE_MIN_PX,
  POS_CART_COLUMN_MIN_PX,
  navWidthPx,
  isWideNav,
  posGridPaneWidthPx,
  posCardColumns,
  posCardWidthPx,
  POS_CARD_MIN_PX,
  POS_CARD_GAP_PX,
  POS_BODY_GRID_CLASS,
  POS_ASIDE_CLASS,
  POS_CART_CLASS,
  POS_CART_SHEET_CLASS,
  POS_MAIN_CLASS,
  POS_MAIN_PAD_B_PX,
  POS_TOOLBAR_CLASS,
  POS_MOBILE_BAR_CLASS,
  DASHBOARD_HEADER_REM,
  POS_PRESS_FEEDBACK_CLASS,
  POS_HEADER_CONTROL_CLASS,
  POS_MOBILE_BAR_BUTTON_CLASS,
  POS_DIALOG_LIST_CAP_CLASS,
  POS_TOUCH_ATTR,
} from "@/lib/pos-layout";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

/** The plain string literal a `const NAME = "...";` (or `export const`) declares in `src`. */
function constOf(src: string, name: string): string {
  const m = src.match(new RegExp(`const ${name} =\\s*"([^"]*)";`));
  assert.ok(m, `${name} must be declared as one plain string literal`);
  return m![1];
}

const count = (src: string, needle: string): number => src.split(needle).length - 1;

/** `src` from one landmark to the next one after it, both asserted to exist (an absent one would blind the slice). */
function between(src: string, from: string, to: string): string {
  const start = src.indexOf(from);
  const end = src.indexOf(to, start + 1);
  assert.ok(start >= 0, `landmark missing: ${from}`);
  assert.ok(end > start, `landmark missing after ${from}: ${to}`);
  return src.slice(start, end);
}

const POS_LAYOUT_TS = "apps/cafe/lib/pos-layout.ts";
const POS_PAGE = "apps/cafe/app/(dashboard)/pos/page.tsx";
const CATEGORY_SIDEBAR = "apps/cafe/components/pos/CategorySidebar.tsx";
const MOBILE_CART_BAR = "apps/cafe/components/pos/MobileCartBar.tsx";
const CART_TSX = "apps/cafe/components/pos/Cart.tsx";
const CART_LINE = "apps/cafe/components/pos/CartLine.tsx";
const CART_LINES = "apps/cafe/components/pos/CartLines.tsx";
const CART_HEAD = "apps/cafe/components/pos/CartHead.tsx";
const PRODUCT_GRID = "apps/cafe/components/pos/ProductGrid.tsx";
const PRODUCT_CARD = "apps/cafe/components/pos/ProductCard.tsx";
const DASHBOARD_LAYOUT = "apps/cafe/app/(dashboard)/layout.tsx";
const HEADER_TSX = "apps/cafe/components/layout/Header.tsx";
const ROOT_LAYOUT = "apps/cafe/app/layout.tsx";
const SIDEBAR_TSX = "apps/cafe/components/ui/sidebar.tsx";
const GLOBALS_CSS = "apps/cafe/app/globals.css";
const REQUEST_ALERT_BAR = "apps/cafe/components/orders/RequestAlertBar.tsx";
// The login page's client screen (ruling R39: app/(auth)/login/page.tsx is now a server page that reads the cafe's name
// and renders this component; every client pin below moved with the code).
const LOGIN_PAGE = "apps/cafe/components/auth/LoginScreen.tsx";
const AUTH_SHELL = "apps/cafe/components/auth/AuthShell.tsx";
const M_LAYOUT = "apps/cafe/app/m/layout.tsx";
const PUBLIC_MENU = "apps/cafe/components/public/PublicMenu.tsx";
const GLOBAL_ERROR = "apps/cafe/app/global-error.tsx";
const TABLE_SELECTOR = "apps/cafe/components/pos/TableSelector.tsx";
const OPEN_TABS_BUTTON = "apps/cafe/components/pos/OpenTabsButton.tsx";
const MOVE_TABLE_DIALOG = "apps/cafe/components/orders/MoveTableDialog.tsx";
const MOVE_TABLE_PICKER = "apps/cafe/components/orders/MoveTablePicker.tsx";
const TOUCH_FEEL = "apps/cafe/components/shared/TouchFeel.tsx";

// U1 Task 1 (design 5, values 2.0): the page is the HTML's body grid, so the frame's classes are the page, the grid and
// its three regions (lib/pos-frame.test.ts pins their order and data-ui names); the old root/inset/split/pane-cart
// wrapper classes are gone. U1 Task 2 (values 3.1): the menu column is the HTML's one scroller, so the pane that stacked
// the control row, the chips and the grid is gone too. U1 Task 6: the control row's last controls moved into the header
// (the switch-order button) and its Open orders panel (the KOT reprint), so its wrapper (POS_CONTROLS_CLASS) is gone.
test("PIN: pos/page.tsx imports the frame's classes and uses each as a real className", () => {
  const src = stripComments(readSrc(POS_PAGE));
  const importMatch = src.match(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/pos-layout"/);
  assert.ok(importMatch, "pos/page.tsx must import from @/lib/pos-layout");
  const frame = ["POS_PAGE_CLASS", "POS_BODY_GRID_CLASS", "POS_ASIDE_CLASS", "POS_MAIN_CLASS", "POS_CART_CLASS"];
  for (const name of frame) {
    assert.ok(importMatch![1].includes(name), `the @/lib/pos-layout import must include ${name}`);
    assert.match(src, new RegExp(`className=\\{${name}\\}`), `${name} must be used as a bare className={${name}} in pos/page.tsx`);
  }
  for (const gone of ["POS_ROOT_CLASS", "POS_INSET_CLASS", "POS_SPLIT_CLASS", "POS_DESKTOP_CART_CLASS", "POS_PANE_CLASS", "POS_CONTROLS_CLASS"]) {
    assert.ok(!src.includes(gone), `pos/page.tsx must not reference the retired ${gone}`);
  }
});

// U1 Task 2 (design 6.3, values 2.1-2.6): the category column (from 1100px) and the toolbar's "Category" button + sheet
// (below it) take ONE picker from the page: the same chosen category and the same "Find category" text (the HTML's
// shared catQuery). Today's chip strip is gone.
test("PIN: pos/page.tsx hands one category picker to the column and to ProductGrid's Category sheet, and feeds ProductGrid the live cart quantities", () => {
  const src = stripComments(readSrc(POS_PAGE));
  assert.ok(!src.includes("CategoryChips"), "the chip strip is gone (design 6.3)");
  assert.match(src, /const \[catQuery, setCatQuery\] = useState\(""\);/, "one Find category text in the page, shared by the column and the sheet");
  assert.match(src, /<CategorySidebar \{\.\.\.categoryPicker\} \/>/, "the column takes the picker");
  assert.match(src, /<ProductGrid\b[^>]*categoryPicker=\{categoryPicker\}/, "the toolbar's Category sheet takes the same picker");
  for (const field of ["selected: category", "onSelect: setCategory", "query: catQuery", "onQueryChange: setCatQuery"]) {
    assert.ok(src.includes(field), `the picker carries ${field}`);
  }
  assert.match(src, /qtyByProduct=\{qtyByProduct\}/, "pos/page.tsx must pass qtyByProduct={qtyByProduct} to ProductGrid");
});

test("PIN: the mobile cart sheet auto-closes once the cart is TRULY empty — otherwise the fixed bar is a dead end over an empty sheet", () => {
  const src = stripComments(readSrc(POS_PAGE));
  // The original rule was `pos.cart.length === 0` alone. D9.8c narrowed it:
  // Clear is clearCart (items only), so a promo/reward/discount/extra charge
  // outlives the items, and MobileCartBar now deliberately stays openable for
  // that case. Closing on item-count alone would slam the sheet shut on the
  // only screen where a phone operator can remove the adjustment — trading
  // one dead end for a worse one (money silently riding to the next sale).
  // The dead-end guard itself is unchanged and still pinned, below. Ruling P50 (U1 audit wave): owner Q18 made the empty
  // sheet a working place, so the close now follows the open sheet's order being emptied (the item count from some to
  // none) and fires once nothing is applied (P55: in that render or a later one) — lib/pos-cart-view.ts
  // emptiedSheetStep, tested over render sequences — through hooks/use-emptied-sheet-close.ts, not whenever the cart is
  // empty; the rulings' own pin is "PIN: rulings P50 / P55" below.
  assert.match(
    src,
    /useEmptiedSheetClose\(pos\.cart\.length, pendingAdjustment, mobileCartOpen, setMobileCartOpen\)/,
    "must close the mobile cart sheet when the cart drains AND no adjustment survives",
  );
  const hook = stripComments(readSrc("apps/cafe/hooks/use-emptied-sheet-close.ts"));
  assert.match(hook, /setOpen\(false\)/, "landmark: the auto-close must still exist");
});

test("PIN: pos/page.tsx never reintroduces the retired md two-pane grid or the old fixed chrome numbers", () => {
  const src = stripComments(readSrc(POS_PAGE));
  assert.ok(!src.includes("md:grid-cols"), "pos/page.tsx must not hardcode a md:grid-cols split (tablet-portrait bug)");
  assert.ok(!src.includes("7rem"), "pos/page.tsx must not hardcode the old flat 7rem chrome budget");
  assert.ok(!src.includes("pb-16"), "pos/page.tsx must not hardcode the old pb-16 bottom padding");
  assert.match(src, /<MobileCartBar\b/, "landmark: pos/page.tsx must still render <MobileCartBar");
});

test("PIN: pos/page.tsx imports the column from CategorySidebar (reachability, not just definition), and no chip strip", () => {
  const src = stripComments(readSrc(POS_PAGE));
  const importMatch = src.match(/import\s*\{([^}]*)\}\s*from\s*"@\/components\/pos\/CategorySidebar"/);
  assert.ok(importMatch, "pos/page.tsx must import from @/components/pos/CategorySidebar");
  assert.ok(importMatch![1].includes("CategorySidebar"), "pos/page.tsx must import CategorySidebar");
  assert.ok(!importMatch![1].includes("CategoryChips"), "the chip strip is gone (design 6.3)");
});

// U1 Task 2: the column (values 2.1) and the sheet (values 2.6) are the two presentations; each list is a labelled nav
// of plain buttons with aria-current, never an ARIA tablist (that promises roving tab focus + panels it doesn't have).
test("PIN: CategorySidebar exports the column and the Category sheet; both lists are labelled navs, NOT an ARIA tablist", () => {
  const src = stripComments(readSrc(CATEGORY_SIDEBAR));
  assert.match(src, /export function CategorySidebar\(/, "CategorySidebar.tsx must export the column");
  assert.match(src, /export function CategorySheet\(/, "CategorySidebar.tsx must export the Category button + sheet");
  assert.ok(!src.includes("CategoryChips"), "the chip strip is gone (design 6.3)");
  for (const gone of ["POS_DESKTOP_ONLY_CLASS", "POS_MOBILE_ONLY_CLASS", "POS_CHIP_ROW_CLASS", "POS_CHIP_CLASS"]) {
    assert.ok(!src.includes(gone), `CategorySidebar.tsx must not use the retired ${gone}`);
  }
  assert.equal(src.split('<nav aria-label="Product categories"').length - 1, 2, 'one <nav aria-label="Product categories"> per presentation');
  assert.ok(!src.includes('role="tablist"'), "the lists must NOT be an ARIA tablist");
});

test("PIN: a category row signals selection via aria-current, never an ARIA tab role", () => {
  const src = stripComments(readSrc(CATEGORY_SIDEBAR));
  assert.match(src, /aria-current=\{selected \? "true" : undefined\}/, 'a row must use aria-current={selected ? "true" : undefined}');
  assert.ok(!src.includes('role="tab"'), "CategorySidebar.tsx must not declare role=\"tab\" anywhere — aria-current is the real selection signal");
  assert.match(src, /title=\{name\}/, "a row's operator-typed name stays readable when cut (title)");
});

// The rows themselves ("All items" first, the counts, the hues, the find filter) are lib/pos-categories.ts's, pinned by
// lib/pos-categories.test.ts; both presentations draw exactly those rows.
test("PIN: both presentations draw lib/pos-categories.ts's rows and share the Find category text", () => {
  const src = stripComments(readSrc(CATEGORY_SIDEBAR));
  assert.match(src, /import \{[^}]*\bcategoryRows\b[^}]*\} from "@\/lib\/pos-categories"/, "the rows come from the pure helper");
  const columnStart = src.indexOf("export function CategorySidebar(");
  const sheetStart = src.indexOf("export function CategorySheet(");
  assert.ok(columnStart >= 0 && sheetStart > columnStart, "the column is declared before the sheet");
  const column = src.slice(columnStart, sheetStart);
  const sheet = src.slice(sheetStart);
  for (const [what, body] of [["the column", column], ["the sheet", sheet]] as const) {
    assert.match(body, /useCategoryRows\(categories, products, query\)/, `${what} draws the rows for the shared query`);
    assert.match(body, /<CategoryFind value=\{query\} onChange=\{onQueryChange\} \/>/, `${what} shows the shared Find category box`);
    assert.match(body, /\{rows\.map\(\(c\) => \(/, `${what} draws every row`);
  }
});

// U1 Task 2 (design 6.3, values 2.0): the column is the body grid's own track (200px beside the wide nav, 220px beside
// the rail), so the component sets no width of its own; the old rail's w-44 (and the older w-28) are gone.
test("PIN: the category column takes the body grid's 200px / 220px track — CategorySidebar.tsx sets no width of its own", () => {
  const src = stripComments(readSrc(CATEGORY_SIDEBAR));
  assert.ok(!src.includes("w-28"), "CategorySidebar.tsx must not hardcode the old w-28 rail width");
  assert.ok(!src.includes("w-44"), "CategorySidebar.tsx must not hardcode the old w-44 rail width: the aside is the grid's track");
  assert.ok(POS_BODY_GRID_CLASS.includes("desk:grid-cols-[220px_"), "the column is 220px beside the rail (values 2.0)");
  assert.ok(POS_BODY_GRID_CLASS.includes("wide:grid-cols-[200px_"), "the column is 200px beside the wide nav (values 2.0)");
  assert.ok(POS_ASIDE_CLASS.split(/\s+/).includes("desk:flex"), "the column shows from 1100px");
});

// Owner Q19: at 1100-1279px the order bar runs from the rail's edge under the category column too (left 76, as at 820),
// so the column's list keeps the same room at its foot as the menu column (main's 100px below 1280px): its last rows
// scroll clear of the bar instead of staying under it. From 1280px (no bar) its 16px as before.
test("PIN: the category column's list keeps the order bar clear below 1280px, with the menu column's own 100px (owner Q19)", () => {
  const src = stripComments(readSrc(CATEGORY_SIDEBAR));
  const list = src.match(/<nav aria-label="Product categories" data-ui="pos-cat-list" className="([^"]*)"/);
  assert.ok(list, "landmark: the column's list");
  const cls = list![1].split(/\s+/);
  assert.ok(cls.includes("pb-4"), "16px at its foot beside the cart column (1280px and wider)");
  // Ruling P49: the bar grows by the bottom safe-area inset from 720px, so the 100px does too (100px at inset 0).
  const cmpFoot = `max-xl:pb-[calc(${POS_MAIN_PAD_B_PX.cmp}px+env(safe-area-inset-bottom))]`;
  assert.ok(cls.includes(cmpFoot), "below 1280px the bar's room, main's own 100px plus the inset");
  assert.ok(POS_MAIN_CLASS.split(/\s+/).includes(cmpFoot), "the same token as the menu column's");
});

// U1 Task 7 (values 6.1, 6.3; design 6.9): the HTML's glass order bar over the page's foot and the cart sheet it opens.
// The sheet stays a Radix dialog (focus trap, Escape, the sr-only title) drawn as the HTML's cart section. Its panel
// names itself (data-ui="pos-cart-sheet"): the F8 / F9 keys treat it as the cart, not as a dialog (PosKeys, U1 Task 5).
// Owner Q19 (2026-10-22): below 1280px (was 1024px), and the sheet is the phone's at every width: the whole screen,
// sliding up from the foot, with no scrim (its overlay stays mounted, never drawn: the phone's form since Task 7).
test("PIN: MobileCartBar is the HTML's bar (shown below 1280px by its own class, owner Q19) and a Radix dialog drawn as the phone's cart sheet, the Cart inside", () => {
  const src = stripComments(readSrc(MOBILE_CART_BAR));
  assert.match(src, /import \* as DialogPrimitive from "@radix-ui\/react-dialog";/, "the Radix dialog primitive (the kit sheet's overlay, X and slide are not the HTML's)");
  assert.match(
    src,
    /<div data-ui="pos-order-bar" data-open=\{open \? "" : undefined\} className=\{POS_MOBILE_BAR_CLASS\}>/,
    "one element, one class: the bar's look and its 1280px switch; it steps aside while its sheet is open (values 6.1 showBar)",
  );
  assert.ok(!src.includes("POS_MOBILE_ONLY_CLASS") && !/\b(?:xl|desk|lg):/.test(src), "no width gate in the file: the bar shows below 1280px (max-xl:flex in POS_MOBILE_BAR_CLASS)");
  assert.match(src, /<DialogPrimitive\.Root open=\{open\} onOpenChange=\{onOpenChange\}>/, "the page owns the open state (its auto-close)");
  assert.match(src, /<DialogPrimitive\.Overlay data-ui="pos-cart-scrim" className=\{POS_CART_SHEET_SCRIM_CLASS\} \/>/, "the overlay: mounted, never drawn (owner Q19: no scrim at any width)");
  // U1 final fix wave (ruling P38): the panel also holds a ref and an outside guard (lib/nested-dialog.ts, pinned in its
  // own test), so the tag spans lines; the name and the frame are unchanged.
  assert.match(
    src,
    /<DialogPrimitive\.Content\s+data-ui="pos-cart-sheet"\s+ref=\{sheetRef\}\s+aria-describedby=\{undefined\}\s+className=\{POS_CART_SHEET_CLASS\}/,
    "the sheet panel names itself for the keys and takes the HTML's frame",
  );
  assert.match(src, /<DialogPrimitive\.Title className="sr-only">Your cart<\/DialogPrimitive\.Title>/, 'the sheet keeps its sr-only title "Your cart"');
  assert.match(src, /className=\{POS_CART_SHEET_PANEL_CLASS\}/, "the <Cart inside the sheet must use className={POS_CART_SHEET_PANEL_CLASS}");
  assert.match(src, /<Cart\b[\s\S]{0,160}onBack=\{/, "MobileCartBar must wire onBack= directly on the <Cart element");
  assert.ok(!src.includes("rounded-none border-0"), "must not hardcode the old rounded-none border-0 — now in POS_CART_SHEET_PANEL_CLASS");
  assert.ok(!src.includes("@/components/ui/sheet"), "the kit's bottom sheet is gone");
});

// Owner Q18 (design 6.9): the bar ALWAYS shows below 1024px — an empty new order too ("No items · New order"), so the
// table, customer, note and bill options are reachable before the first item. Today's disabled "Cart is empty"
// placeholder went with it; "Review order" opens the sheet in every state (a frozen send's too).
test("PIN: owner Q18 — the bar renders \"Review order\" in every state, an empty order included; no disabled placeholder", () => {
  const src = stripComments(readSrc(MOBILE_CART_BAR));
  assert.ok(!src.includes("Cart is empty"), "the empty-cart placeholder is gone (owner Q18)");
  assert.ok(!/\bisEmpty\b/.test(src) && !/\bdisabled\b/.test(src), "no empty branch and nothing disabled: the bar is the same in every state");
  assert.equal(count(src, "<DialogPrimitive.Trigger asChild>"), 1, "one trigger, always rendered");
  assert.match(
    src,
    /<DialogPrimitive\.Trigger asChild>\s*<button type="button" data-ui="pos-review-order" className=\{cn\(POS_MOBILE_BAR_BUTTON_CLASS, BRAND_PRESS_CLASS\)\}>\s*Review order\s*<\/button>/,
    "the HTML's Review order (owner Q1), with the HTML's press",
  );
  assert.match(src, /orderBarSummary\(\{/, "the first line comes from lib/pos-cart-view.ts (No items · New order, Adjustment still applied, Couldn't confirm)");
  assert.match(src, /title: cartTitle\(\{ resumedOrder: cartProps\.resumedOrder \}\)/, "the cart's own title (U1 Task 4's cartTitle)");
  assert.match(src, /\{inr\(cartProps\.total\)\}/, "the second line: the bill's total, usePosTotals' figure");
  for (const gone of ["View cart", "Tap to send again", "SheetTrigger", "SheetContent", 'side="bottom"', "zoom-in-95"]) {
    assert.ok(!src.includes(gone), `today's bar piece ${gone} is gone (the HTML's bar and sheet replace it)`);
  }
});

test("PIN: MobileCartBar no longer reads the sidebar itself — the bar sits inside the page (beside the nav), so it needs no sidebar-width offset", () => {
  const src = stripComments(readSrc(MOBILE_CART_BAR));
  assert.ok(!src.includes("useSidebar"), "MobileCartBar.tsx must not import/call useSidebar any more");
  assert.ok(!src.includes("POS_MOBILE_BAR_SIDEBAR_EXPANDED_CLASS"), "must not reference the retired POS_MOBILE_BAR_SIDEBAR_EXPANDED_CLASS");
  assert.ok(!src.includes("POS_MOBILE_BAR_SIDEBAR_COLLAPSED_CLASS"), "must not reference the retired POS_MOBILE_BAR_SIDEBAR_COLLAPSED_CLASS");
  assert.match(src, /DialogPrimitive\.Trigger/, "landmark: MobileCartBar must still render the sheet's trigger");
});

// Where the cart is the page's column (values 0.3 cartDisplay; owner Q19: from 1280px) a sheet left open while the
// window grows (a window widened past 1280px) closes, as the HTML's sheet gives way to its column.
test("PIN: MobileCartBar never reverts to the old md-hidden wrapper or a fixed sheet height, and closes its sheet where the cart column takes over (1280px, owner Q19)", () => {
  const src = stripComments(readSrc(MOBILE_CART_BAR));
  assert.ok(!src.includes("md:hidden"), "MobileCartBar must not gate itself at md (tablet-portrait bug)");
  assert.ok(!src.includes("h-[85dvh]") && !src.includes("h-[90vh]"), "MobileCartBar must not hardcode a sheet height: the HTML's sheet runs top to bottom");
  assert.match(src, /DialogPrimitive\.Content/, "landmark: MobileCartBar must still render the sheet's content");
  assert.match(src, /window\.matchMedia\(CART_COLUMN_QUERY\)/, "the cart column's media query");
  assert.match(src, /const CART_COLUMN_QUERY = `\(min-width: \$\{POS_CART_COLUMN_MIN_PX\}px\)`;/, "1280px, the cart column's own breakpoint (owner Q19)");
  assert.ok(!src.includes("BREAKPOINT_LG_PX"), "no 1024px close any more (owner Q19)");
  assert.equal(POS_CART_COLUMN_MIN_PX, 1280, "the query reads (min-width: 1280px)");
  assert.match(src, /if \(query\.matches\) onOpenChange\(false\);/, "the sheet closes there");
  assert.match(src, /return \(\) => query\.removeEventListener\("change", closeOnColumn\);/, "the listener goes with the open sheet");
});

// U1 Task 4 (values 5.2, 5.4; design 6.5, 6.6): the cart is the HTML's head (CartHead.tsx) over its lines
// (CartLines.tsx); U1 Task 5 (values 5.5): then the HTML's footer.
test("PIN: Cart composes the HTML's head and lines, and still takes the sheet's onBack", () => {
  const src = stripComments(readSrc(CART_TSX));
  assert.match(src, /onBack\?:\s*\(\)\s*=>\s*void/, "CartProps must declare onBack?: () => void");
  assert.match(src, /import \{ CartHead, type CartCellsProps \} from "@\/components\/pos\/CartHead";/, "the head comes from CartHead.tsx");
  assert.match(src, /import \{ CartLines \} from "@\/components\/pos\/CartLines";/, "the lines come from CartLines.tsx");
  const head = src.indexOf("<CartHead");
  const lines = src.indexOf("<CartLines");
  const footer = src.indexOf('data-ui="pos-cart-footer"');
  assert.ok(head > 0 && head < lines && lines < footer, "the head, then the lines, then the HTML's footer (U1 Task 5)");
  assert.match(between(src, "<CartHead", "/>"), /onBack=\{onBack\}/, "the sheet's way back reaches the head");
  for (const gone of ["<EmptyState", "CartSentSection", "ShoppingCart", "Cart is empty", "Tab {resumedOrderId}"]) {
    assert.ok(!src.includes(gone), `Cart.tsx must no longer carry today's head/list piece ${gone} (the HTML's head and lines replace it)`);
  }
  const head2 = stripComments(readSrc(CART_HEAD));
  assert.match(head2, /aria-label="Back to menu"/, 'the back button must carry aria-label="Back to menu"');
  assert.match(head2, /onClick=\{onBack\}/, "the back button closes the sheet");
});

// U1 Task 7 (values 5.2 "‹ Menu"; design 6.9): the sheet's way back is the HTML's "‹ Menu" on top of the head — 30px,
// no padding, 15px --link at the button's own weight, the 18px chevron (stroke 2.2) 2px from the word — in place of
// today's ghost icon button; its name stays "Back to menu" (the pinned word).
test("PIN: CartHead's way back is the HTML's \"‹ Menu\": the chevron and the word, still named Back to menu", () => {
  const src = stripComments(readSrc(CART_HEAD));
  assert.equal(
    constOf(src, "BACK_CLASS"),
    "flex h-[30px] cursor-pointer items-center gap-0.5 self-start bg-transparent p-0 text-[15px] text-link",
    "values 5.2: align-self flex-start, 30px, no padding, 15px --link, the chevron 2px from the word",
  );
  assert.match(
    src,
    /\{onBack && \(\s*<button type="button" data-ui="pos-cart-back" className=\{cn\(BACK_CLASS, BRAND_PRESS_CLASS\)\} onClick=\{onBack\} aria-label="Back to menu">/,
    "the sheet only (onBack), first in the head, with the HTML's press",
  );
  assert.match(
    src,
    /<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2\.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">\s*<path d="m15 18-6-6 6-6" \/>\s*<\/svg>\s*Menu\s*<\/button>/,
    "the HTML's chevron-left (18px, stroke 2.2, round) then the word Menu",
  );
  assert.ok(!src.includes("ChevronLeft") && !src.includes('size="icon"'), "today's ghost icon button is gone");
});

test("PIN: CartLines' wrapper is the HTML's lines wrapper (POS_CART_LIST_CLASS) with the HTML's empty words", () => {
  const src = stripComments(readSrc(CART_LINES));
  assert.match(src, /className=\{POS_CART_LIST_CLASS\}/, "the lines wrapper must use className={POS_CART_LIST_CLASS}");
  assert.ok(src.includes(">No items</p>"), 'values 5.4: "No items" (owner Q1: the HTML\'s words)');
  assert.ok(src.includes(">Tap a price on the menu to add an item.</p>"), "values 5.4: the empty line under it");
  assert.match(
    src,
    /className="flex h-full min-h-40 flex-col items-center justify-center gap-1 text-center"/,
    "values 5.4: height 100%, min-height 160, a centred column 4px apart",
  );
  assert.ok(src.includes('className="text-[15px] font-semibold"'), '"No items" 15px 600');
  assert.ok(src.includes('className="text-[13px] text-muted-foreground"'), "the line under it 13px --text-2");
  assert.ok(src.includes("Add items to fire another round."), "a tab with nothing new keeps today's hint under its lines");
});

test("PIN: Cart's ROOT is the HTML's cart column body — it scrolls as one (both mounts), on --surface, with no card frame of its own", () => {
  const src = stripComments(readSrc(CART_TSX));
  // Anchored on the ROOT's own cn(..., className) shape, not merely the first
  // cn("…") in the file: D9.8b hoisted the More menu above the return, so a
  // bare first-match now finds the discount unit toggle's cn() instead and
  // asserts the wrong element's classes.
  const rootMatch = src.match(/cn\(\s*"([^"]*)",\s*className,?\s*\)/);
  assert.ok(rootMatch, "Cart.tsx's root div must build its className via cn(\"...\", className)");
  const root = rootMatch![1].split(/\s+/);
  for (const t of ["flex", "h-full", "min-h-0", "flex-col", "overflow-y-auto", "overflow-x-hidden", "overscroll-contain", "bg-card"]) {
    assert.ok(root.includes(t), `values 5.1: Cart's root className literal must include ${t}, got "${rootMatch![1]}"`);
  }
  // U1 Task 4 (values 5.1): the HTML's cart is the column itself (POS_CART_CLASS draws its left rule), not a card in it.
  for (const t of ["rounded-lg", "border"]) {
    assert.ok(!root.includes(t), `Cart's root must not draw today's card frame (${t}): the HTML's cart has none`);
  }
  assert.ok(!stripComments(readSrc(POS_PAGE)).includes("rounded-none border-0"), "the page no longer has a card frame to undo");
});

// U1 Task 5 (values 5.5; design 6.8; ruling R1): the HTML's two 50px buttons replace the kit CTAs. The pin's meaning is
// kept — every CTA is touch-sized (50px is above the 44px floor) — through the two HTML looks every button wears.
test("PIN: CartActions draws the HTML's two buttons — every button wears the Send or the Pay look, both 50px, and the keys find them", () => {
  const src = stripComments(readSrc(CART_TSX));
  const start = src.indexOf("function CartActions");
  assert.ok(start >= 0, "CartActions must exist in Cart.tsx");
  const nextFnIdx = src.indexOf("\nfunction ", start + 1);
  const body = nextFnIdx > 0 ? src.slice(start, nextFnIdx) : src.slice(start);
  assert.ok(!/<Button\b/.test(body), "no kit Button: the HTML's buttons are drawn as the HTML draws them");
  const buttons = body.match(/<button\b[^>]*>/g) ?? [];
  assert.ok(buttons.length >= 4, `landmark: Send again, Send KOT and the two Pay buttons (new order, tab), found ${buttons.length}`);
  for (const tag of buttons) {
    assert.match(tag, /className=\{(?:SEND|PAY)_BUTTON_CLASS\}/, `every CTA wears one of the two HTML looks (no cn() wrap): ${tag}`);
  }
  assert.ok(body.includes('<SendDiscard kind="kitchen" disabled={sending} onDiscard={onDiscard} className={SEND_BUTTON_CLASS} />'), "Discard takes its slot's look");
  for (const name of ["SEND_LOOK", "PAY_LOOK"]) {
    const look = constOf(src, name).split(/\s+/);
    for (const t of ["flex", "h-[50px]", "items-center", "justify-center", "gap-2", "whitespace-nowrap", "rounded-[10px]", "px-1.5", "py-px", "font-semibold", "cursor-pointer"]) {
      assert.ok(look.includes(t), `values 5.5: ${name} must include ${t}`);
    }
  }
  const send = constOf(src, "SEND_LOOK").split(/\s+/);
  for (const t of ["border", "border-ink", "bg-card", "text-foreground", "text-[14.5px]", "not-disabled:hover:bg-hover", "disabled:opacity-50"]) {
    assert.ok(send.includes(t), `values 5.5 Send KOT: ${t}`);
  }
  const pay = constOf(src, "PAY_LOOK").split(/\s+/);
  for (const t of ["[border:0]", "bg-primary", "text-primary-foreground", "text-[15px]", "not-disabled:hover:bg-primary-hover", "disabled:opacity-40"]) {
    assert.ok(pay.includes(t), `values 5.5 Pay: ${t}`);
  }
  assert.match(src, /const SEND_BUTTON_CLASS = cn\(SEND_LOOK, BRAND_PRESS_CLASS\);/, "the HTML's press on Send");
  assert.match(src, /const PAY_BUTTON_CLASS = cn\(PAY_LOOK, BRAND_PRESS_CLASS\);/, "the HTML's press on Pay");
  assert.equal(count(body, '<div className="grid grid-cols-[1fr_1.4fr] gap-2" data-ui="pos-cart-actions">'), 2, "values 5.5: the 1fr 1.4fr grid, 8px apart (a new order's and a tab's)");
  assert.equal(count(body, 'data-ui="pos-send"'), 1, "F8 finds the one Send KOT button");
  assert.equal(count(body, 'data-ui="pos-pay"'), 2, "F9 finds Pay (a new order's and a tab's)");
  assert.match(body, /\{newCount > 0 \? `Send KOT · \$\{newCount\}` : "All sent"\}/, "owner Q1: the HTML's words, the unsent quantity");
  assert.equal(count(body, "Pay {inr(total)}"), 2, "owner Q1: Pay ₹{total} on both");
  assert.equal(count(body, '<span aria-hidden="true" className={SEND_CHIP_CLASS}>F8</span>'), 1, "the F8 chip");
  assert.equal(count(body, '<span aria-hidden="true" className={PAY_CHIP_CLASS}>F9</span>'), 2, "the F9 chip");
  for (const chip of ["SEND_CHIP_CLASS", "PAY_CHIP_CLASS"]) {
    const t = constOf(src, chip).split(/\s+/);
    for (const k of ["hidden", "tab:inline", "rounded-[4px]", "border", "px-1", "font-mono", "text-[11px]", "leading-4"]) {
      assert.ok(t.includes(k), `values 5.5: the ${chip} key chip (Geist Mono 11, from 720px) needs ${k}`);
    }
  }
  assert.ok(constOf(src, "PAY_CHIP_CLASS").includes("border-[rgba(255,255,255,.5)]"), "the Pay chip's white rule, precomputed (no runtime color-mix)");
});

// U1 Task 4 (values 5.4, 0.3 stepBox/stepW/stepH; ruling R1: the HTML's sizes on touch screens too): the HTML's line —
// the number, the name and its meta, the stepper (or a sent line's "×qty") and the total, then the status line.
// Ruling P48 (U1 Task 14 review; owner Q20: below 1280px = the mobile style): the cart below 1280px is the full-screen
// sheet, so its steppers take the HTML's touch sizes (the 36px box, 38x34 buttons, its below-1100 values) at 1100-1279px
// too; the desk 30 / 30x28 go with the cart column from 1280px (xl:, POS_CART_CLASS's own switch).
test("PIN: CartLine is the HTML's line: its grid, the 30/28 stepper in the column from 1280px (36/34 in the sheet below, ruling P48), the status words, no trash button", () => {
  const src = stripComments(readSrc(CART_LINE));
  assert.equal(
    constOf(src, "LINE_CLASS"),
    "-mx-2 grid cursor-pointer grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-[3px] rounded-[10px] px-2 py-2.5 motion-safe:animate-html-line-in",
    "values 5.4 line: 24px · 1fr · auto, gap 3px 10px, padding 10px 8px pulled back by margin 0 -8px, radius 10, lineIn",
  );
  assert.equal(
    constOf(src, "SELECTED_CLASS"),
    "bg-accent [box-shadow:inset_0_0_0_1px_var(--accent-b)]",
    "values 5.4 selected: --accent-t under an inset 1px --accent-b ring",
  );
  assert.equal(
    constOf(src, "STEPPER_CLASS"),
    "flex h-9 items-center rounded-[8px] border border-border bg-card xl:h-[30px]",
    "values 5.4 stepper box: 1px --border, radius 8, --surface, stepBox 36 / 30 in the column from 1280px (ruling P48)",
  );
  assert.equal(
    constOf(src, "STEP_BUTTON_CLASS"),
    "h-[34px] w-[38px] cursor-pointer bg-transparent px-1.5 py-px text-[16px] text-foreground not-disabled:hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 xl:h-7 xl:w-[30px]",
    "values 5.4 / 0.3 stepW/stepH / 0.5: 38x34 (30x28 in the column from 1280px, ruling P48), the UA's 1px 6px padding, a 16px glyph, hover --surface-2",
  );
  assert.ok(!/\bdesk:/.test(src), "ruling P48: no 1100px size in the cart line (below 1280px it is the sheet's, the mobile style)");
  assert.ok(POS_CART_CLASS.split(/\s+/).includes("xl:flex"), "the desk sizes switch where the cart column shows (xl:)");
  assert.ok(src.includes('title="Remove one"') && src.includes('title="Add one"'), "the HTML's stepper titles");
  assert.ok(src.includes('aria-label="Decrease quantity"') && src.includes('aria-label="Increase quantity"'), "today's aria-labels kept");
  assert.ok(src.includes(">−</button>"), "the HTML's minus glyph (U+2212)");
  assert.equal(count(src, "disabled={disabled}"), 2, "both stepper buttons lock while busy");
  for (const gone of ["Trash2", "POS_CART_STEPPER_CLASS", "Remove ${", "orderItemLabel"]) {
    assert.ok(!src.includes(gone), `CartLine must not carry ${gone}: no trash button (owner Q10: select a line, then Remove)`);
  }
  assert.ok(src.includes('"Sent to kitchen"') && src.includes('"New · not sent"'), "values 5.4 status words");
  assert.ok(src.includes('dot: STATUS_CLASSES.ok.dot, color: "text-muted-foreground"'), "sent: --ok dot, --text-2");
  assert.ok(src.includes("dot: STATUS_CLASSES.warn.dot, color: STATUS_CLASSES.warn.ink"), "new: --warn dot, --warn-i");
  assert.ok(src.includes('"col-[2/4] flex items-center gap-1.5 text-[11.5px]"'), "the status spans columns 2-3, 6px gap, 11.5px");
  assert.ok(src.includes('"size-1.5 rounded-[50%]"'), "a 6x6 dot, radius 50% (values 5.4)");
  assert.match(src, />\s*×\{item\.qty\}\s*<\/span>/, "a sent line shows its quantity where the stepper sits (it stays locked)");
  assert.ok(
    src.includes('className="flex h-9 items-center text-[13px] font-semibold text-muted-foreground xl:h-[30px]"'),
    '"×qty" 13px 600 --text-2, as tall as the stepper box (a sent line stands as tall as a new one; ruling P48)',
  );
  assert.ok(src.includes("{inr(item.price * item.qty)}"), "the line total at the real price (a reward line too, as today)");
  assert.ok(src.includes("{lineMeta(item)}"), "the meta comes from lib/pos-cart-view.ts");
});

test("PIN: a cart line arrives with the HTML's lineIn, verbatim (values 5.4)", () => {
  const css = readSrc(GLOBALS_CSS);
  assert.match(css, /--animate-html-line-in: html-line-in 0\.4s cubic-bezier\(0\.2, 0\.8, 0\.2, 1\) both;/, "lineIn .4s on the HTML's easing");
  assert.match(
    css,
    /@keyframes html-line-in \{\s*from \{\s*opacity: 0;\s*transform: translateX\(14px\);\s*\}\s*to \{\s*opacity: 1;\s*transform: none;\s*\}\s*\}/,
    "@keyframes lineIn{from{opacity:0;transform:translateX(14px)}to{opacity:1;transform:none}}",
  );
});

// Owner Q10 (design 6.6): tapping a line (not its stepper) selects it and shows one action row under it: "Remove" for a
// new line, "Void" for a sent line of a resumed tab (the void dialog opens on that line). One line at a time; none while
// the cart is busy or frozen.
test("PIN: CartLines selects one line and offers Remove (a new line) or Void (a sent line of a tab, opening the dialog on it)", () => {
  const lines = stripComments(readSrc(CART_LINES));
  const line = stripComments(readSrc(CART_LINE));
  assert.ok(lines.includes("const fired = items.filter((it) => it.kotRound > 0);"), "sent lines first");
  assert.ok(lines.includes("const lines = [...fired, ...fresh];"), "then the new ones");
  assert.ok(lines.includes("selectionHolds(selection, { scope, busy: isBusy, lineIds: lines.map((l) => l.lineId) })"), "the pure rule");
  assert.ok(lines.includes("if (selection !== null && !holds) setSelection(null);"), "a selection that no longer holds is dropped");
  assert.ok(lines.includes("if (isBusy) return;"), "no selection while busy or frozen");
  const remove = between(lines, "item.kotRound === 0", ">Remove</button>");
  assert.ok(remove.includes("onRemove(item.lineId)"), "Remove removes that new line (today's remove)");
  const voidRow = between(lines, "if (!resumedOrder || !onVoidItem) return null;", ">Void</button>");
  assert.ok(voidRow.includes("onVoidItem(voidLineOf(item, resumedOrder))"), "Void opens the dialog on that sent line");
  assert.match(between(lines, "<CartLine", "/>"), /disabled=\{isBusy\}/, "every line's controls lock while busy");
  assert.ok(line.includes("onClick={disabled ? undefined : () => onToggle(item.lineId)}"), "a tap on the line selects it, not while busy");
  assert.ok(line.includes("onClick={keep}"), "a tap on the stepper does not select the line");
  // U1 final fix wave (the final review's minor 2): the action row is not a popup, so the name says "pressed" (selected).
  assert.ok(line.includes("aria-pressed={selected}"), "the name is the keyboard's way to select (its click reaches the line), heard as pressed");
  assert.ok(!line.includes("aria-expanded"), "not aria-expanded: nothing pops up");
  assert.equal(constOf(lines, "ACTION_CLASS"), "min-h-11 cursor-pointer bg-transparent p-0 text-[12.5px] font-medium text-link", "12.5px 500 --link (our own control: 44px tall)");
});

// U1 final fix wave (the Task 4 review's FIX BEFORE MERGE): the action button unmounts with its row, and the keyboard
// focus fell to <body>. After Remove it moves to the next line's name (else the previous, else the cart's first
// control: lib/pos-cart-view.ts focusIndexAfterRemove, unit-tested); before Void opens the dialog it moves to the line's
// own name, so the dialog's opener focus (hooks/use-opener-focus.ts) gives it back there when the dialog closes.
test("PIN: the focus never falls to <body> after a line's Remove or Void", () => {
  const lines = stripComments(readSrc(CART_LINES));
  const line = stripComments(readSrc(CART_LINE));
  assert.match(line, /data-ui="pos-line-name"/, "the name button is addressable");
  assert.match(lines, /<div ref=\{listRef\} data-ui="pos-cart-lines"/, "the list is held, to find its names");
  const remove = between(lines, "item.kotRound === 0", ">Remove</button>");
  assert.ok(remove.indexOf("removedRef.current = { lineId: item.lineId, index: i };") >= 0, "Remove notes the line and its place");
  assert.ok(
    remove.indexOf("removedRef.current = { lineId: item.lineId, index: i };") < remove.indexOf("onRemove(item.lineId)"),
    "noted before today's remove runs",
  );
  assert.ok(lines.includes("focusIndexAfterRemove(gone.index, names.length)"), "the next line, else the previous (the pure rule)");
  assert.ok(lines.includes("if (!gone || lines.some((l) => l.lineId === gone.lineId)) return;"), "only once the line is really gone");
  const voidRow = between(lines, "if (!resumedOrder || !onVoidItem) return null;", ">Void</button>");
  assert.ok(voidRow.includes("nameOf(e.currentTarget)?.focus();"), "Void hands the focus to the line's name first");
  assert.ok(
    voidRow.indexOf("nameOf(e.currentTarget)?.focus();") < voidRow.indexOf("onVoidItem(voidLineOf(item, resumedOrder))"),
    "before the dialog opens (its opener focus remembers the name)",
  );
});

// Owner Q9 (design 6.5): the head's two cells, Table and Customer, in the HTML's cell look; the Table cell opens today's
// table picker for a new order and today's move / assign dialog for a tab; both lock while busy.
test("PIN: CartHead draws the HTML's head: the title, the tab's meta, Clear / Close in the red link style, and two cells", () => {
  const src = stripComments(readSrc(CART_HEAD));
  assert.equal(
    constOf(src, "HEAD_CLASS"),
    "relative flex flex-none flex-col gap-3 border-b border-border px-4 py-3.5 leading-[normal]",
    "values 5.2 head: padding 14px 16px, a 12px column gap, a bottom rule",
  );
  assert.equal(
    constOf(src, "TITLE_ROW_CLASS"),
    "flex min-h-[29px] items-baseline justify-between gap-2.5",
    "values 5.2 title row: baseline, 10px apart; 29px as the HTML's row with its Clear (no jump when the first item lands)",
  );
  assert.equal(constOf(src, "TITLE_CLASS"), "min-w-0 truncate text-[20px] font-semibold tracking-[-0.015em]", "values 5.2 title: 20px 600 -.015em");
  assert.equal(constOf(src, "META_CLASS"), "font-mono text-[12px] text-muted-foreground", "values 5.2 meta: Geist Mono 12px --text-2");
  assert.equal(
    constOf(src, "HEAD_ACTION_CLASS"),
    "h-[26px] cursor-pointer rounded-[6px] bg-transparent px-1 text-[12.5px] text-status-bad-ink not-disabled:hover:bg-status-bad-tint disabled:cursor-not-allowed disabled:opacity-50",
    "values 5.2 Clear: 26px, --bad-i 12.5px, 0 4px, radius 6, hover --bad-t",
  );
  assert.equal(constOf(src, "CELLS_CLASS"), "grid grid-cols-2 overflow-hidden rounded-[10px] border border-border", "owner Q9: two cells");
  assert.equal(
    constOf(src, "CELL_CLASS"),
    "flex min-w-0 cursor-pointer flex-col items-start border-r border-border bg-transparent px-2.5 py-2 text-left leading-[1.25] text-foreground not-disabled:hover:bg-hover focus-visible:ring-inset disabled:cursor-not-allowed disabled:opacity-50",
    "values 5.2 cell: a column, 8px 10px, line-height 1.25, the HTML's right rule on every cell (its 2px right edge), hover --hover",
  );
  assert.ok(src.includes('"whitespace-nowrap text-[11px] text-muted-foreground"'), "the cell key 11px --text-2");
  assert.ok(src.includes('"w-full truncate text-[13.5px] font-semibold"'), "the cell value 13.5px 600, one line");
  assert.ok(src.includes("onClick={onClear} disabled={isBusy}"), "Clear locks while busy");
  assert.ok(src.includes("onClick={onCloseTab} disabled={isBusy}"), "Close locks while busy");
  assert.ok(src.includes(">Clear</button>") && src.includes(">Close</button>"), "the HTML's word, and today's for a tab");
  assert.ok(src.includes("useNow(MINUTE_MS)"), "the tab's age ticks once a minute on the device (no request)");
  assert.ok(src.includes("cartTitle({ resumedOrder })"), "the title from lib/pos-cart-view.ts");
});

test("PIN: CartHead's Table cell opens the picker for a new order and the move / assign dialog for a tab; the Customer cell opens the customer dialog", () => {
  const src = stripComments(readSrc(CART_HEAD));
  const cells = between(src, "className={CELLS_CLASS}", "</div>");
  assert.equal(count(cells, "disabled={isBusy}"), 3, "the table trigger, the move cell and the customer trigger lock while busy");
  assert.ok(cells.includes("<TableSelector"), "a new order: today's table picker");
  assert.ok(cells.includes("onClick={cells.onMoveTable}"), "a tab: today's move / assign dialog");
  assert.ok(cells.includes("<CustomerSearch"), "the customer: today's customer dialog");
  assert.equal(count(cells, "trigger={"), 2, "both dialogs open from their cell");
  assert.ok(cells.includes('aria-label={cells.table ? `Table ${cells.table}` : "Select table (Walk-In)"}'), "today's table chip aria");
  assert.ok(cells.includes('title={cells.table ? `Table ${cells.table}` : "Walk-In — no table"}'), "today's table chip title");
  assert.ok(
    cells.includes("? `Move ${resumedOrder.orderId} to another table`") && cells.includes(": `Assign a table to ${resumedOrder.orderId}`"),
    "today's move / assign titles",
  );
  assert.ok(cells.includes('aria-label={customer ? `Customer: ${customer.name}` : "Select customer"}'), "today's customer chip aria");
  assert.ok(cells.includes('title={customer ? customer.name : "Select customer"}'), "today's customer chip title");
  assert.ok(cells.includes('<CellText k="Customer" v={customer ? customer.name : "Add"} />'), 'values 5.2: "Customer" / name or "Add"');
  assert.equal(count(cells, '<CellText k="Table" v={tableValue} />'), 2, "both Table cells say the same thing");
  assert.ok(src.includes("tableCellValue(tableNo, tableAreaName(tableNo, cells.tables, areas.data))"), "\"T-4 · AC Hall\" / \"Walk-In\"");
});

// U1 Task 3 (values 4.1, 4.3; design 5): the cards sit in the HTML's auto-fill grid, so the columns follow the menu
// column's own width (two beside the cart, three at 820px, one on a phone) — CB-1b's viewport tiers keyed by the nav's
// state (useGridClass + useSidebar) went with the old tile.
test("PIN: ProductGrid lays the cards in the HTML's auto-fill grid (POS_CARD_GRID_CLASS) inside the HTML's list wrapper — no viewport tiers, no nav-state read, no scroller of its own", () => {
  const src = stripComments(readSrc(PRODUCT_GRID));
  const importMatch = src.match(/import\s*\{([^}]*)\}\s*from\s*"@\/lib\/pos-layout"/);
  assert.ok(importMatch, "ProductGrid.tsx must import from @/lib/pos-layout");
  assert.ok(importMatch![1].includes("POS_CARD_GRID_CLASS"), "the import must include POS_CARD_GRID_CLASS");
  for (const gone of ["useSidebar", "useGridClass", "POS_GRID_CLASS_SIDEBAR_EXPANDED", "POS_GRID_CLASS_SIDEBAR_COLLAPSED"]) {
    assert.ok(!src.includes(gone), `ProductGrid.tsx must not use the retired ${gone}: the auto-fill grid needs no tier`);
  }
  // U1 Task 2 (values 3.1): the menu column (main) is the HTML's one scroller and the toolbar sticks inside it, so the
  // grid sits in the HTML's list wrapper (its listPad) and keeps no scroller of its own.
  assert.match(src, /<div data-ui="pos-list" className=\{POS_LIST_CLASS\}>/, "the grid sits in the HTML's list wrapper");
  assert.ok(!src.includes("overflow-y-auto"), "no scroller of its own: main scrolls the toolbar's list");
  // Both layouts (owner Q8) use the one grid and stay inert while busy (pos-send-paths S8).
  assert.equal(
    src.split('<div className={cn(POS_CARD_GRID_CLASS, disabled && "opacity-50")} inert={disabled}>').length - 1,
    2,
    "the Normal grid and each By category group's grid",
  );
});

test("PIN: ProductGrid never reverts to the container-query grid — @container/POS_GRID_CONTAINER_CLASS/overscroll-contain are all gone (CB-1b)", () => {
  const src = stripComments(readSrc(PRODUCT_GRID));
  assert.ok(!src.includes("@container"), "ProductGrid.tsx must not use @container");
  assert.ok(!src.includes("POS_GRID_CONTAINER_CLASS"), "ProductGrid.tsx must not reference the retired POS_GRID_CONTAINER_CLASS");
  assert.ok(!src.includes("overscroll-contain"), "must not include overscroll-contain — a drag past the grid's end must chain to the document on a short viewport");
  assert.match(src, /POS_CARD_GRID_CLASS/, "landmark: ProductGrid.tsx must still reference POS_CARD_GRID_CLASS");
});

// U1 Task 3 (design 6.3): while the products load, the toolbar shows (its search box and Category button take no input)
// over HTML-shaped cards in the same grid, so nothing jumps when the menu arrives.
test("PIN: GridSkeleton draws the toolbar (no input while loading) over HTML-shaped cards in the same auto-fill grid", () => {
  const src = stripComments(readSrc(PRODUCT_GRID));
  const start = src.indexOf("export function GridSkeleton(");
  assert.ok(start >= 0, "GridSkeleton must exist");
  const nextFnIdx = src.indexOf("\nfunction ", start + 1);
  const body = nextFnIdx > 0 ? src.slice(start, nextFnIdx) : src.slice(start);
  assert.match(body, /<MenuToolbar\b[^>]*\bloading\b/, "the toolbar shows while loading");
  assert.ok(body.includes("<div className={POS_CARD_GRID_CLASS}>"), "the same grid as the cards");
  assert.ok(body.includes("<CardSkeleton key={i} />"), "HTML-shaped cards");
  const toolbar = src.slice(src.indexOf("function MenuToolbar("), src.indexOf("export function ProductGrid("));
  assert.ok(toolbar.includes("disabled={loading}"), "the search box takes no input while loading");
  assert.ok(toolbar.includes("<CategorySheet {...categoryPicker} disabled={loading} />"), "nor does the Category button");
});

test("PIN: ProductGrid carries the cart-quantity prop and a real search input; ProductCard's buttons press like the HTML's and show no press while disabled", () => {
  const gridSrc = stripComments(readSrc(PRODUCT_GRID));
  assert.match(gridSrc, /qtyByProduct\?:\s*Record<string,\s*number>/, "ProductGridProps must declare qtyByProduct?: Record<string, number>");
  assert.match(gridSrc, /type="search"/, 'the search field must be type="search"');
  // U1 Task 2: the HTML's words (owner Q1) and the hook the "/" key (U1 Task 5) focuses.
  assert.match(gridSrc, /data-ui="pos-search"/, 'the search input carries data-ui="pos-search" for the "/" key');
  assert.match(gridSrc, /placeholder="Search items"/, 'the HTML\'s placeholder "Search items"');
  assert.match(gridSrc, /<ProductCard\b/, "landmark: ProductGrid must render <ProductCard — the tile lives in ProductCard.tsx since CB-1d.3a");

  const src = stripComments(readSrc(PRODUCT_CARD));
  // U1 Task 3 (values 1.4, ruling R1): the HTML's button feel (its transition, scale(.97) when not disabled) on the
  // name and price buttons, as on the rebuilt shell — the coarse-pointer press token went with the old tile.
  assert.ok(src.includes("className={cn(NAME_BUTTON_CLASS, BRAND_PRESS_CLASS)}"), "the name button presses like the HTML's");
  assert.ok(src.includes("className={cn(PRICE_BUTTON_CLASS, PRICE_HEIGHT_CLASS, BRAND_PRESS_CLASS)}"), "the price buttons press like the HTML's");
  assert.ok(!src.includes("POS_PRESS_FEEDBACK_CLASS"), "the old tile's press token is gone from the card");

  // g18: a disabled control can still match :active in Chromium, and the touch layer ([data-pos-touch]) dims any
  // pressed button on a coarse pointer — so an out-of-stock card's buttons take no touch at all (the pointer still
  // shows not-allowed, values 4.2). Needle concatenated per testing.md.
  const noTouch = "pointer-coarse:disabled:pointer-" + "events-none";
  for (const name of ["NAME_BUTTON_CLASS", "PRICE_BUTTON_CLASS"]) {
    const cls = src.match(new RegExp(`const ${name} =\\s*"([^"]*)";`))?.[1] ?? "";
    assert.ok(cls.includes(noTouch), `${name} must carry "${noTouch}" (no press flash on a disabled button under a finger)`);
    assert.ok(cls.includes("disabled:cursor-not-allowed"), `${name}: the HTML's not-allowed pointer when disabled`);
  }
});

test("PIN: ProductGrid never reintroduces a locally-defined GRID_CLASS constant", () => {
  const src = stripComments(readSrc(PRODUCT_GRID));
  assert.ok(!src.includes("const GRID_CLASS ="), "ProductGrid.tsx must not re-derive its own GRID_CLASS constant");
  assert.match(src, /POS_CARD_GRID_CLASS/, "landmark: ProductGrid.tsx must still reference POS_CARD_GRID_CLASS");
});

// U1 Task 3 (owner Q8, design 6.4, values 4.1): "By category" draws the HTML's groups — "● {category} {count}", 13.5px
// 600, the dot in the category's own hue from the column (Task 2's rows), 24px apart, "Other" last in --text-3;
// "Normal" is one grid with no heading.
test("PIN: the By category groups are the HTML's: the heading (dot, name, count), the category's own hue, 24px apart; Normal has no heading", () => {
  const src = stripComments(readSrc(PRODUCT_GRID));
  assert.match(src, /import \{[^}]*\bcategoryHueMap\b[^}]*\} from "@\/lib\/pos-categories"/, "the hues come from the column's own rule");
  assert.ok(src.includes('<section key={group.categoryId ?? "other"} data-ui="pos-group" className="mb-6">'), "a section per group, 24px apart");
  const heading = constOf(src, "GROUP_HEADING_CLASS");
  for (const t of ["mt-1", "mb-2.5", "flex", "items-center", "gap-2", "text-[13.5px]", "font-semibold", "text-foreground"]) {
    assert.ok(heading.split(/\s+/).includes(t), `the group heading (values 4.1): "${t}"`);
  }
  assert.ok(src.includes('role="heading"') && src.includes("aria-level={3}"), "still a level-3 heading for screen readers");
  assert.ok(src.includes("hue={group.categoryId === null ? null : (hues.get(group.categoryId) ?? null)}"), "the dot takes the category's hue; Other has none");
  assert.ok(src.includes('hue === null && "bg-subtle-foreground"'), "a dot without a hue (Other) is --text-3");
  assert.ok(src.includes('<span data-ui="pos-group-count" className="font-normal text-subtle-foreground">'), "the count: 400, --text-3");
  assert.ok(!src.includes("border-b pb-1"), "today's ruled heading is gone");
});

// U1 Task 3 (values 3.1, design 6.3): a search with no hit reads the HTML's "No results for “{q}”"; an empty category
// our "No products found"; the page's load error the same line — centred, 14px, --text-2, 64px above and below.
test("PIN: the menu's messages are the HTML's no-results line: a search with no hit, an empty category, the load error", () => {
  const src = stripComments(readSrc(PRODUCT_GRID));
  assert.equal(constOf(src, "MENU_MESSAGE_CLASS"), "py-16 text-center text-[14px] text-muted-foreground", "values 3.1 No results");
  assert.ok(src.includes('{search.trim() === "" ? "No products found" : `No results for “${search}”`}'), "the HTML's words for a search, ours for an empty category");
  assert.ok(src.includes("Failed to load products. Refresh to retry."), "the load error, in the same look (MenuLoadError)");
  assert.ok(!src.includes("<EmptyState"), "the dashed empty card is gone");
  const page = stripComments(readSrc(POS_PAGE));
  assert.match(page, /\) : products\.isError && products\.data === undefined \? \(\s*<MenuLoadError \/>\s*\) : \(/, "the page's error branch draws it");
  assert.ok(!page.includes("text-destructive"), "no red error text on the page");
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

// U1 Task 1 (design 5): the page switches at the HTML's widths (the cart column from 1024px, the category column from
// 1100px), and those switches live in lib/pos-layout.ts. U1 Task 2: the chip strip and its skeleton are gone, so the
// page carries no breakpoint of its own (the Category button's 1100px switch is CategorySidebar.tsx's).
test("PIN: no stray lg:/xl:/desk: token in pos/page.tsx — the frame's switches live in lib/pos-layout.ts", () => {
  const src = stripComments(readSrc(POS_PAGE));
  assert.ok(!src.includes("lg:"), "pos/page.tsx must not carry a stray lg: token — the cart column's switch is POS_CART_CLASS's");
  assert.ok(!src.includes("xl:"), "pos/page.tsx must not carry a stray xl: token — the retired two-pane switch");
  assert.ok(!src.includes("desk:"), "pos/page.tsx must not carry a desk: token — the category switch is the aside's and the button's");
  assert.match(src, /className=\{POS_ASIDE_CLASS\}/, "landmark: the column's switch is POS_ASIDE_CLASS's");
});

// U1 Task 1: the HTML's cmp breakpoint (1024px) is Tailwind's lg, so lg: came back in lib/pos-layout.ts as the frame's
// cart switch; the retired lg:grid-cols-4 tier (owner, 2026-09-29: at most 3 columns) never returns. Owner Q19
// (2026-10-22): the cart switch moved to 1280px (Tailwind's xl), so lib/pos-layout.ts carries no lg: token at all, and
// its frame's xl: tokens are exactly the cart column, its grid track, the bar's show below 1280px and main's 100px foot
// (the header controls' xl:pointer-fine: shrink is CB-1d.1 V1's, pinned below).
test("PIN: lib/pos-layout.ts carries no lg: token (owner Q19), and xl: only as the 1280px cart switch — never a grid-cols-N tier", () => {
  const src = stripComments(readSrc(POS_LAYOUT_TS));
  const lgTokens = src.match(/[\w:-]*lg:[^\s"`]+/g) ?? [];
  assert.deepEqual(lgTokens, [], `no lg: token: owner Q19 retired the 1024px cart switch, found ${lgTokens.join(", ")}`);
  const xlTokens = (src.match(/[\w:-]*xl:[^\s"`]+/g) ?? []).filter((t) => !t.startsWith("xl:pointer-fine:"));
  assert.deepEqual(
    [...xlTokens].sort(),
    ["max-xl:flex", "max-xl:pb-[calc(100px+env(safe-area-inset-bottom))]", "xl:flex", "xl:grid-cols-[220px_minmax(0,1fr)_380px]"],
    `the frame's only xl: tokens are the bar's show below 1280px, main's 100px foot, the cart column and its grid track, found ${xlTokens.join(", ")}`,
  );
  assert.ok(!/(?:lg|xl):grid-cols-\d/.test(src), "no lg:/xl:grid-cols-N tier (the 4-column tier is retired)");
  assert.match(src, /desk:flex/, "landmark: lib/pos-layout.ts carries the category column's switch too (desk:flex)");
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
  // U0 Task 4: below 720px the page's foot keeps 92px clear of the tab bar (values 2.1 screenPadB); the POS root bleeds
  // over it there (POS_ROOT_CLASS max-tab:-mb-[92px]), so the height chain's top padding (p-4 / md:p-6) is unchanged.
  assert.match(dashboardSrc, /<main className="flex-1 p-4 pb-\[92px\] tab:pb-4 md:p-6">/, "landmark: (dashboard)/layout.tsx's <main> keeps its flex-1 p-4 md:p-6 padding, 92px at the foot on a phone — the height-chain matrix pin depends on this figure");

  const layoutTsSrc = stripComments(readSrc(POS_LAYOUT_TS));
  assert.ok(
    !layoutTsSrc.includes(shellClassIdentifier),
    `lib/pos-layout.ts must not declare/export ${shellClassIdentifier} — the shell-class experiment was reverted in CB-1c round 2, checked directly on the definition side, not just its former consumer`,
  );
  assert.match(layoutTsSrc, /export const POS_PAGE_CLASS/, "landmark: lib/pos-layout.ts must still export the page's class (POS_PAGE_CLASS)");
});

test("PIN: route-parity fences — the other routes keep the 100vh document floor the body used to give them (plan §B4, review F2)", () => {
  // The login screen's frame is components/auth/AuthShell. Since U0 match Task 10 (ruling R27) its root is the owner's
  // HTML lock root: fixed to the viewport (inset 0), so the screen IS the visible viewport and needs no document floor
  // (a 100vh floor on a fixed root would push its footer under a phone browser's toolbar). Checked on the root <main>
  // itself, not anywhere in the file, so a frame that stops covering the viewport fails.
  const loginSrc = stripComments(readSrc(LOGIN_PAGE));
  assert.match(loginSrc, /<AuthShell[\s>]/, "the login screen (components/auth/LoginScreen.tsx) must render inside <AuthShell>");
  const shellRoot = stripComments(readSrc(AUTH_SHELL)).match(/<main\b[^>]*className="([^"]*)"/);
  assert.ok(shellRoot, "landmark: AuthShell must render a <main className=\"...\"> root");
  const rootClasses = shellRoot![1].split(/\s+/);
  assert.ok(
    rootClasses.includes("fixed") && rootClasses.includes("inset-0"),
    "AuthShell's root <main> must be fixed inset-0 — the signed-out screen fills the visible viewport exactly",
  );
  assert.ok(!rootClasses.includes("min-h-screen"), "no 100vh floor on the fixed root (it would overflow a phone browser's visible viewport)");
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
  // warn-tint styling (the status token since the 2026-10 look), in the SAME opening tag (not two different divs).
  assert.match(
    src,
    /<div[^>]*ref=\{bandRef\}[^>]*bg-status-warn-tint/,
    "the band's <div ref={bandRef} ...> must be the SAME element that carries bg-status-warn-tint",
  );
  assert.match(src, /bg-status-warn-tint/, "landmark: RequestAlertBar.tsx must still carry bg-status-warn-tint");
});

// U1 Task 2 (values 2.2, 2.6): picking a row in the sheet chooses the category AND closes the sheet (the HTML's
// setState({cat, catSheet:false})); the chosen name then reads on the Category button, so a pick is never lost from
// view (the retired chip strip's scrollIntoView did that job). Done and a tap on the scrim close it too (Radix Close and
// the overlay), and Escape (Radix).
test("PIN: picking a row in the Category sheet chooses it and closes the sheet; the button names the chosen category", () => {
  const src = stripComments(readSrc(CATEGORY_SIDEBAR));
  const sheet = src.slice(src.indexOf("export function CategorySheet("));
  assert.match(sheet, /const \[open, setOpen\] = useState\(false\);/, "the sheet opens from the button and starts closed");
  assert.match(sheet, /onSelect\(value\);\s*setOpen\(false\);/, "a pick chooses the category, then closes the sheet");
  assert.match(sheet, /selectedCategoryName\(categories, selected\)/, 'the button reads "Category {name}" (values 3.1 curCatName)');
  assert.match(sheet, /<DialogPrimitive\.Close\b[^>]*>\s*Done\s*<\/DialogPrimitive\.Close>/, '"Done" closes the sheet');
  assert.match(sheet, /<DialogPrimitive\.Trigger asChild>\s*<button type="button" data-ui="pos-category-button"/, "the Category button opens the sheet");
});

// U1 Task 1 (design 5, values 2.0 and 6.2): the page holds ONE in-flow child, the HTML's body grid, which fills it;
// the phone/tablet cart bar lies over the page's foot (absolute; main's bottom padding keeps it clear), so it never
// shortens the grid. The CB-1 root's three in-flow rows (header wrapper, split, bar) and their gap budget are gone.
test("PIN: pos/page.tsx's page renders the body grid as its one in-flow child, filling it, with the cart bar over its foot", () => {
  const src = stripComments(readSrc(POS_PAGE));
  // U1 Task 6: PosHeader comes first and draws nothing in the page's flow — its switch button is a phone action of the
  // page header (a portal into the shell's header at every width, never the body row) and the Floor hand-off renders
  // nothing.
  assert.match(
    src,
    /<div className=\{POS_PAGE_CLASS\}>\s*(?:\{\}\s*)?<PosHeader\b[^>]*\/>\s*(?:\{\}\s*)?<div data-ui="pos-body"/,
    "the page opens with PosHeader, then the body grid (comments aside)",
  );
  const header = stripComments(readSrc("apps/cafe/components/pos/PosHeader.tsx"));
  assert.ok(header.includes("phoneActions={") && !/\sactions=\{/.test(header), "PosHeader hands the header phone actions only: no body row");
  const body = src.indexOf('<div data-ui="pos-body"');
  const bar = src.indexOf("<MobileCartBar");
  assert.ok(body >= 0 && bar > body, "the bar comes after the body grid, as the page's second child");
  assert.ok(POS_BODY_GRID_CLASS.split(/\s+/).includes("h-full"), "the body grid fills the page's height");
  assert.ok(POS_MOBILE_BAR_CLASS.split(/\s+/).includes("absolute"), "the bar is out of the flow: it lies over the page's foot");
});

// U1 Task 3: the loading card is drawn from the card's own shell, strip and price height (ProductCard.tsx), with bars as
// tall as the name (19px) and the tag (16px) 2px apart, so it is the card's 117px (123px below 1100px; pinned in
// lib/pos-tile-paths.test.ts) and the loading grid does not jump.
test("PIN: the loading card is the real card's shape (its shell, strip and price height), so the loading grid does not jump", () => {
  const gridSrc = stripComments(readSrc(PRODUCT_GRID));
  assert.match(gridSrc, /import \{[^}]*\bCARD_SHELL_CLASS\b[^}]*\bPRICE_HEIGHT_CLASS\b[^}]*\bPRICE_STRIP_CLASS\b[^}]*\} from "@\/components\/pos\/ProductCard"/, "the card's own classes");
  const skeleton = gridSrc.slice(gridSrc.indexOf("function CardSkeleton("));
  assert.ok(skeleton.includes('className={cn(CARD_SHELL_CLASS, "border-border")}'), "the card's shell");
  assert.match(skeleton, /<Skeleton className="h-\[19px\] [^"]*" \/>\s*<Skeleton className="h-4 [^"]*" \/>/, "the name (19px) and tag (16px) bars");
  assert.ok(skeleton.includes('<div className="flex flex-col gap-0.5">'), "2px apart, as the card's name column");
  assert.match(skeleton, /<div className=\{PRICE_STRIP_CLASS\}>\s*<div className=\{PRICE_HEIGHT_CLASS\} \/>\s*<\/div>/, "the strip with one price button's height");
  assert.match(gridSrc, /<div data-ui="pos-toolbar" className=\{POS_TOOLBAR_CLASS\}>/, "landmark: ProductGrid heads the list with the HTML's toolbar");
});

// ── CB-1c round 2b additions (fresh-eyes review pin hardening) ─────────────

// U1 Task 1: the header keeps every page's 56px literal (min-h-14); on /pos (data-pos) it is exactly 56px tall (h-14),
// the HTML's Order header (values 1.2), and the page's height subtracts that same figure (lib/pos-frame.test.ts).
test("PIN: DASHBOARD_HEADER_REM parity — parsed from Header.tsx's real <header> tokens (min-h-14 everywhere, h-14 on /pos), not re-typed", () => {
  const src = stripComments(readSrc(HEADER_TSX));
  const headerMatch = src.match(/<header className="([^"]*)"/);
  assert.ok(headerMatch, 'Header.tsx must render a <header className="..."> tag');
  assert.ok(headerMatch![1].includes("sticky top-0"), "landmark: Header.tsx's <header> must carry sticky top-0");
  const minMatch = headerMatch![1].match(/(?:^|\s)min-h-(\d+)(?=\s|$)/);
  assert.ok(minMatch, `Header.tsx's <header> className ("${headerMatch![1]}") must carry a min-h-N token`);
  assert.equal(DASHBOARD_HEADER_REM * 4, Number(minMatch![1]), `DASHBOARD_HEADER_REM*4 must equal Header.tsx's min-h-${minMatch![1]}`);
  const posMatch = headerMatch![1].match(/(?:^|\s)data-pos:h-(\d+)(?=\s|$)/);
  assert.ok(posMatch, `Header.tsx's <header> className ("${headerMatch![1]}") must carry a data-pos:h-N token`);
  assert.equal(DASHBOARD_HEADER_REM * 4, Number(posMatch![1]), `DASHBOARD_HEADER_REM*4 must equal Header.tsx's data-pos:h-${posMatch![1]}`);
});

// U1 Task 2 (values 0.3 asideDisplay / catBtnDisplay / catRowH): exactly one category list shows at any width: the
// column from 1100px, the Category button (and its sheet) below it; the rows are 34px, 44px on a phone. No md: switch.
test("PIN: the Category button switches with the column at the HTML's 1100px, and the rows take the HTML's 34px / 44px", () => {
  const src = stripComments(readSrc(CATEGORY_SIDEBAR));
  assert.match(src, /data-ui="pos-category-button"/, "landmark: the Category button");
  assert.match(src, /"[^"]*\bdesk:hidden\b[^"]*"/, "the button hides from 1100px");
  assert.ok(POS_ASIDE_CLASS.split(/\s+/).includes("desk:flex"), "the column shows from 1100px");
  assert.match(src, /h-\[34px\][^"]*max-tab:h-11/, "a row is 34px, 44px on a phone (values 0.3 catRowH)");
  assert.match(src, /aria-current/, "landmark: CategorySidebar.tsx must still carry aria-current");
  assert.ok(!src.includes("md:"), "CategorySidebar.tsx must not carry any md: literal — the HTML switches at 720px and 1100px only");
});

test("PIN: (dashboard)/layout.tsx renders Header, then RequestAlertBar, then <main> — in that ORDER — so the alert-bar budget's assumption (an in-flow SIBLING above <main>, not a child inside it) holds", () => {
  const src = stripComments(readSrc(DASHBOARD_LAYOUT));
  assert.match(src, /<SidebarInset>/, "landmark: (dashboard)/layout.tsx must render <SidebarInset>");
  const headerIdx = src.indexOf("<Header");
  const alertIdx = src.indexOf("<RequestAlertBar");
  const mainIdx = src.indexOf('<main className="flex-1 p-4 pb-[92px] tab:pb-4 md:p-6">');
  assert.ok(headerIdx >= 0, "(dashboard)/layout.tsx must render <Header");
  assert.ok(alertIdx >= 0, "(dashboard)/layout.tsx must render <RequestAlertBar");
  assert.ok(mainIdx >= 0, '(dashboard)/layout.tsx must render <main className="flex-1 p-4 pb-[92px] tab:pb-4 md:p-6">');
  assert.ok(headerIdx < alertIdx, "<Header must be rendered before <RequestAlertBar");
  assert.ok(alertIdx < mainIdx, "<RequestAlertBar must be rendered before <main — it is main's sibling, not its child");
});

// ── CB-1d.1 additions: touch-feel/device-size token changes ────────────────

// U1 Task 2: the chip token (POS_CHIP_CLASS) went with the chip strip (design 6.3); U1 Task 3: the tile's corner options
// button (POS_TILE_OPTIONS_BUTTON_CLASS) went with the old tile (owner Q5: the name opens the modal); U1 Task 4: the cart
// stepper token (POS_CART_STEPPER_CLASS) went with the old cart line (values 5.4: the HTML's stepper, its own sizes on
// touch screens too, ruling R1); U1 Task 7: the bar's button (POS_MOBILE_BAR_BUTTON_CLASS) is the HTML's "Review order"
// with the HTML's press (BRAND_PRESS_CLASS, as the cart's Send KOT / Pay), so two copies remain.
// U1 final fix wave (the final review's minor 1): POS_CART_CTA_CLASS had no caller left since Task 12 (SendDiscard's kit
// fallback went) and POS_HEADER_CHIP_ICON_CLASS none since Task 9 (the customer chip's icon); both exports and their
// pins went, so one copy remains here.
test("PIN: POS_PRESS_FEEDBACK_CLASS is duplicated VERBATIM inside every touch-target token (CB-1d.1 L1) — a paths pin, not a re-typed literal, keeps the two copies in sync", () => {
  for (const [label, cls] of [
    ["POS_HEADER_CONTROL_CLASS", POS_HEADER_CONTROL_CLASS],
  ] as const) {
    assert.ok(cls.includes(POS_PRESS_FEEDBACK_CLASS), `${label} must include POS_PRESS_FEEDBACK_CLASS verbatim`);
  }
  assert.ok(!POS_MOBILE_BAR_BUTTON_CLASS.includes("pointer-coarse:"), "Review order is the HTML's button on touch screens too (ruling R1)");
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

test("PIN: header/CTA tokens gate their xl compact look on pointer-fine ONLY — glass (coarse) never shrinks at xl (CB-1d.1 V1); every xl: term in these tokens is pointer-fine-gated, enumerated, not just the documented ones (CB-1d.1 g11)", () => {
  for (const [label, cls, xlLandmarks] of [
    ["POS_HEADER_CONTROL_CLASS", POS_HEADER_CONTROL_CLASS, ["xl:pointer-fine:h-8", "xl:pointer-fine:text-xs"]],
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

// U1 Task 3: the tile's corner options button, its title reserve and the thumbnail-row arithmetic went with the old
// tile (owner Q5/Q6); the card's own geometry (the HTML's 117px / 123px) is pinned in lib/pos-tile-paths.test.ts.

test("PIN: POS_DIALOG_LIST_CAP_CLASS pairs a vh base with an EXACT-matching dvh override (CB-1d.1 V2)", () => {
  const capPattern = /^max-h-\[(\d+)vh\] supports-\[height:1dvh\]:max-h-\[\1dvh\]$/;
  assert.match(
    POS_DIALOG_LIST_CAP_CLASS,
    capPattern,
    `POS_DIALOG_LIST_CAP_CLASS ("${POS_DIALOG_LIST_CAP_CLASS}") must be exactly "max-h-[Nvh] supports-[height:1dvh]:max-h-[Ndvh]" with matching N`,
  );
});

// U1 Task 6 (values 7.1): OpenTabsButton is the HTML's Open orders panel now, its list a flex child of a panel capped at
// min(640px, 100dvh - 80px) (86dvh on a phone; lib/pos-header-paths.test.ts). U1 Task 11 (values 9.1): the table picker
// and the move dialog are the HTML's "Choose a table" sheet, whose PANEL is capped at 100dvh - 32px (88dvh on a phone)
// with the areas scrolling inside it, so the 60vh / 50vh list caps went (POS_MOVE_TABLE_LIST_CAP_CLASS with them).
test("PIN: the table sheet and the Open orders panel cap on the visible viewport — no bare max-h-[60vh] / max-h-[50vh] literal left behind (CB-1d.1 V2)", () => {
  // Needles built by concatenation (testing.md) so this file's own source text
  // never contains the literal as one contiguous string.
  const sixtyVh = "max-h-[60" + "vh]";
  const fiftyVh = "max-h-[50" + "vh]";
  const selector = stripComments(readSrc(TABLE_SELECTOR));
  const picker = stripComments(readSrc(MOVE_TABLE_PICKER));
  const dialog = stripComments(readSrc(MOVE_TABLE_DIALOG));
  const panel = stripComments(readSrc(OPEN_TABS_BUTTON));
  for (const src of [selector, picker, dialog, panel]) {
    assert.ok(!src.includes(sixtyVh) && !src.includes(fiftyVh), `no bare "${sixtyVh}" / "${fiftyVh}" literal`);
  }
  assert.ok(selector.includes("className={TABLE_PANEL_CLASS}") && dialog.includes("className={TABLE_PANEL_CLASS}"), "landmark: both open the shared capped panel");
  assert.ok(selector.includes("className={TABLE_BODY_CLASS}") && picker.includes("className={TABLE_BODY_CLASS}"), "landmark: the areas scroll in the shared body");
  // Ruling P54 (U1 audit wave): the table panel's caps are the shared sheet frame's (lib/sheet-frame.ts).
  const sheet = stripComments(readSrc("apps/cafe/lib/table-sheet.ts"));
  assert.match(sheet, /export const TABLE_PANEL_CLASS = cn\(\s*SHEET_PANEL_BASE,\s*SHEET_PANEL_CAP_CLASS,/, "the table panel takes the shared caps");
  const frame = stripComments(readSrc("apps/cafe/lib/sheet-frame.ts"));
  assert.ok(frame.includes("tab:supports-[height:1dvh]:max-h-[calc(100dvh-32px)]"), "the table sheet: the dvh cap where it exists");
  assert.ok(frame.includes("max-tab:supports-[height:1dvh]:max-h-[88dvh]"), "the phone's table sheet: 88dvh where it exists");
  assert.ok(panel.includes("tab:supports-[height:1dvh]:max-h-[min(640px,calc(100dvh-80px))]"), "the panel: the dvh cap where it exists");
  assert.ok(panel.includes("max-tab:supports-[height:1dvh]:max-h-[86dvh]"), "the phone's sheet: 86dvh where it exists");
});

// U1 Task 11: the tile is TableTile (components/pos/TableSheet.tsx) in both pickers, a grid item of the HTML's auto-fill
// grid; a long table name must neither widen its column nor push the seats out.
test("PIN: the table tile keeps a long table name readable — min-w-0 on the tile (a grid item), the name truncates beside the seats, the title names it in full", () => {
  const sheet = stripComments(readSrc("apps/cafe/lib/table-sheet.ts"));
  const tokens = (name: string) => sheet.match(new RegExp(`const ${name} =\\s*"([^"]*)"`))?.[1]?.split(/\s+/) ?? [];
  assert.ok(tokens("TABLE_TILE_CLASS").includes("min-w-0"), "the tile button: min-w-0, so its column stays minmax(92px, 1fr)");
  for (const t of ["min-w-0", "truncate"]) assert.ok(tokens("TABLE_TILE_NAME_CLASS").includes(t), `the name: ${t}`);
  assert.ok(tokens("TABLE_TILE_SEATS_CLASS").includes("whitespace-nowrap"), "the seats never wrap under a long name");
  const tile = stripComments(readSrc("apps/cafe/components/pos/TableSheet.tsx"));
  assert.match(tile, /<span className=\{TABLE_TILE_NAME_CLASS\}>\{table\.tableNo\}<\/span>/, "the name span shows the table's name");
  assert.match(tile, /title=\{title \?\? table\.tableNo\}/, "the full name (or the open tab's customer) as the tile's title");
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
// U1 Task 1: the grid item is now the HTML's menu column (main, `min-width:0`, values 3.1) in the body grid's
// minmax(0,1fr) track. U1 Task 2: the chip strip is gone; main is the HTML's one scroller with the sticky toolbar
// (values 3.1: `position:sticky; top:0; z-index:3` on --bg). U1 Task 6: the interim control row above the toolbar is
// gone (its controls are the header's switch-order button and the Open orders panel), so the toolbar leads main.
test("PIN: the menu column carries min-w-0 so no content's min-content width can widen the body grid's column (CB-1d.1b phone layout), and it is the toolbar's scroller", () => {
  const mainTokens = POS_MAIN_CLASS.split(/\s+/);
  assert.ok(mainTokens.includes("min-w-0"), `POS_MAIN_CLASS ("${POS_MAIN_CLASS}") must carry min-w-0 (the grid item)`);
  assert.ok(mainTokens.includes("min-h-0"), `POS_MAIN_CLASS ("${POS_MAIN_CLASS}") must carry min-h-0 (it scrolls inside the page)`);
  assert.ok(mainTokens.includes("overflow-auto"), "main is the HTML's one scroller");
  assert.ok(POS_BODY_GRID_CLASS.includes("grid-cols-[minmax(0,1fr)]"), "landmark: the menu track itself has a 0 minimum");
  const toolbar = POS_TOOLBAR_CLASS.split(/\s+/);
  for (const t of ["sticky", "top-0", "z-[3]", "bg-background"]) assert.ok(toolbar.includes(t), `the toolbar sticks inside main: "${t}"`);

  // The toolbar and the list (ProductGrid) or the loading / error branch are main's only content.
  const pageSrc = stripComments(readSrc(POS_PAGE));
  assert.match(
    pageSrc,
    /<div data-ui="pos-main" className=\{POS_MAIN_CLASS\}>\s*(?:\{\}\s*)*\{products\.isLoading \? \(/,
    "the loading / error / grid branch is the menu column's first child (no control row above the toolbar)",
  );
  assert.ok(!pageSrc.includes("pos-controls"), "no control row's wrapper");
});

// ---------------------------------------------------------------------------
// U1 Task 5 (owner Q11, 2026-10-21; design 6.7, 6.8; values 5.5): the cart footer is the HTML's — the links row, the
// bill behind "Total · Details", the notices, the two buttons. Today's three-dot More menu (D9.8, 2026-09-26) became the
// one Bill options panel the links open at their own section; its contents and their order did not change. The SAFETY
// property D9.8 pinned still holds: an adjustment the customer is paying is never concealed — the links name it
// (lib/pos-footer.ts, unit-tested in lib/pos-footer.test.ts) and the bill (CartBill.tsx) keeps each applied row and its
// remove control outside the panel.
// ---------------------------------------------------------------------------

const BILL_OPTIONS_PANEL = "apps/cafe/components/pos/BillOptionsPanel.tsx";
const CART_BILL = "apps/cafe/components/pos/CartBill.tsx";
const CART_FOOTER_LINKS = "apps/cafe/components/pos/CartFooterLinks.tsx";
const CART_NOTES = "apps/cafe/components/pos/CartNotes.tsx";
const CART_EXTRA_CHARGES = "apps/cafe/components/pos/CartExtraCharges.tsx";
const POS_FOOTER_TS = "apps/cafe/lib/pos-footer.ts";
const POS_KEYS = "apps/cafe/components/pos/PosKeys.tsx";

test("PIN: owner Q11 — the More menu's contents render INSIDE the Bill options panel, in today's order, each in its captioned section", () => {
  const src = stripComments(readSrc(CART_TSX));
  const open = src.indexOf("<BillOptionsPanel");
  const close = src.indexOf("</BillOptionsPanel>");
  assert.ok(open > 0 && close > open, "Cart.tsx must render <BillOptionsPanel>…</BillOptionsPanel>");
  const inside = src.slice(open, close);
  // Today's binding order inside the More menu (owner decision: the reward sits right above the discount), kept.
  let last = -1;
  for (const needle of ["<CartReward", "<CartPromo", 'aria-label="Discount value"', "POS_CART_GST_BUTTON_CLASS", "<CartExtraCharges"]) {
    const at = inside.indexOf(needle);
    assert.ok(at > last, `${needle} must render inside the panel, after the control before it (reward, promo, discount, the GST preset, extra charges)`);
    last = at;
  }
  const sections = [...inside.matchAll(/<BillOptionsSection id="(\w+)" caption="([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`);
  assert.deepEqual(
    sections,
    ["reward:Reward", "promo:Promo code", "discount:Discount", "charges:Extra charges"],
    "design 6.7: one captioned section per link, in today's order",
  );
  assert.ok(!src.includes("CartMoreMenu") && !src.includes("moreMenu"), "the three-dot trigger and its two mount points are gone (owner Q11)");
  assert.ok(!src.includes("activeAdjustments"), "the trigger's summary is gone: the links name what is applied");
});

test("PIN: owner Q11 — APPLIED money stays OUTSIDE the panel: the bill rows, Total and each row's remove control live in CartBill", () => {
  const cart = stripComments(readSrc(CART_TSX));
  const open = cart.indexOf("<BillOptionsPanel");
  const close = cart.indexOf("</BillOptionsPanel>");
  const bill = cart.search(/<CartBill[\s/>]/);
  assert.ok(bill > 0, "Cart.tsx must render <CartBill");
  // Ruling P16: the bill's rows sit behind "Details" on a window under 820px tall, so what holds is narrower than "never
  // behind a tap": the applied rows and their remove controls are the bill's own (never in the panel), and a waived or
  // changed table charge opens the details by itself until the user uses the toggle.
  assert.ok(
    bill < open || bill > close,
    "the bill renders outside the panel — applied money is the bill's own rows, and a waived or changed table charge shows the details by itself (P16)",
  );

  const src = stripComments(readSrc(CART_BILL));
  // Needles anchored on the tag BOUNDARY: a bare prefix would pass a renamed-away component (mutation-tested in D9.8).
  assert.match(src, /<CartExtraChargeRows[\s/>]/, "the APPLIED extra-charge rows");
  assert.ok(src.includes('gstActive ? "GST Discount applied" : "Discount applied"'), 'the "Discount applied" line');
  assert.match(src, /<span>Total<\/span>/, "Total");
  assert.ok(!/<CartExtraChargeRows[^>]*onAdd/.test(src), "CartExtraChargeRows takes no onAdd — it renders applied rows only");
  const call = src.match(/<CartAppliedRows[\s\S]*?\/>/);
  assert.ok(call, "the promo / reward rows (CartAppliedRows) render in the bill");
  assert.match(call![0], /promoCode=\{promoCode\}/, "fed the live promoCode");
  assert.match(call![0], /selectedReward=\{/, "fed the selected reward offer");
  assert.match(call![0], /rewardLocked=\{rewardLocked\}/, "fed rewardLocked");
  assert.match(src, /<CartAppliedCard[\s/>]/, "the picked scratch card's row");

  const rowsSrc = stripComments(readSrc("apps/cafe/components/pos/CartAppliedRows.tsx"));
  assert.match(rowsSrc, /Promo \{promoCode\} applied/, "the promo row names the code in literal text, never colour alone");
  assert.match(rowsSrc, /rungWorthLabel\(selectedReward\.rung\)/, "the reward row names what the reward is worth");
  assert.ok(/if \(!promoCode && !selectedReward\) return null;/.test(rowsSrc), "nothing applied: no row");
  assert.match(rowsSrc, /\{!rewardLocked && \(/, "a LOCKED reward renders without a remove control");
});

test("PIN: owner Q11 — the links name what is applied, read off the same props the controls render from (keyed on the entered figure)", () => {
  const src = stripComments(readSrc(CART_TSX));
  const view = between(src, "footerLinks({", "})");
  for (const needle of ["resuming", "discountRaw", "discountUnit", "promoCode", "rewardWorth", "extraCount: extraCharges.length", "notes"]) {
    assert.ok(view.includes(needle), `the links' view must carry ${needle}`);
  }
  const lib = stripComments(readSrc(POS_FOOTER_TS));
  assert.match(lib, /view\.discountRaw > 0/, "a discount the operator ENTERED counts even when the derived amount is 0 (an empty cart after Clear)");
  assert.match(lib, /view\.discountUnit === "GST"/, "the GST preset counts on its own");
  const links = stripComments(readSrc(CART_FOOTER_LINKS));
  assert.match(links, /\{link\.applied \?\? link\.label\}/, "an applied link shows its value in place of its word");
  assert.ok(links.includes("font-semibold text-accent-foreground"), "values 5.5 / design 6.7: an applied link in --accent-i 600");
});

test("PIN: owner Q11 / D9.8c — the links row is NEVER gated on an empty cart: Clear keeps the adjustments, so removing them stays reachable; only busy locks it", () => {
  const src = stripComments(readSrc(CART_TSX));
  const tag = src.match(/<CartFooterLinks[^>]*\/>/);
  assert.ok(tag, "landmark: Cart.tsx must render <CartFooterLinks … />");
  assert.match(tag![0], /disabled=\{isBusy\}/, "the links lock ONLY while busy (plan Review Focus 1)");
  assert.ok(!/items\.length/.test(tag![0]), "the links must NOT be gated on the cart's items — a surviving adjustment would be stranded");
  const links = stripComments(readSrc(CART_FOOTER_LINKS));
  assert.equal(count(links, "<button"), 1, "one button per link");
  assert.match(links, /disabled=\{disabled\}/, "each link honours the lock");
  assert.match(src, /if \(isBusy && panel !== null\) setPanel\(null\);/, "a panel open when the cart turns busy closes: nothing in it acts while a send flies");
});

test("PIN: owner Q11 — the Bill options and Note panels are one Popover anchored on the footer (never a DropdownMenu), opening upward at the tapped section", () => {
  const panel = stripComments(readSrc(BILL_OPTIONS_PANEL));
  assert.match(panel, /from "@\/components\/ui\/popover"/, "the kit Popover: inputs inside keep their focus");
  assert.ok(panel.includes("<PopoverContent"), "landmark: a PopoverContent");
  assert.ok(!panel.includes("dropdown-menu") && !panel.includes("DropdownMenuItem"), "never a DropdownMenu: its items close on click and steal the field's focus");
  assert.match(panel, /side="top"/, "it opens upward, over the lines, never over the bill and the buttons");
  assert.ok(panel.includes("data-bill-section"), "each section is addressable so the tapped one scrolls into view and takes the focus");
  assert.match(panel, /onOpenAutoFocus=\{\(e\) => e\.preventDefault\(\)\}/, "the panel focuses the tapped section's field, not its first button");
  const cart = stripComments(readSrc(CART_TSX));
  assert.match(cart, /<PopoverAnchor asChild>\s*<div data-ui="pos-cart-footer"/, "the footer anchors the panels");
  assert.ok(!stripComments(readSrc(POS_LAYOUT_TS)).includes("POS_CART_MORE_"), "the three-dot trigger's classes went with it");
});

test("PIN: the Note link opens the order note for a NEW order only (an add-round carries no notes); the note keeps its 200-character field", () => {
  const lib = stripComments(readSrc(POS_FOOTER_TS));
  assert.match(lib, /if \(!view\.resuming\)/, "no Note link on a resumed tab");
  const cart = stripComments(readSrc(CART_TSX));
  assert.match(cart, /if \(resuming && panel === "note"\) setPanel\(null\);/, "a resumed tab closes the note panel (it has no note)");
  assert.match(cart, /\{panel === "note" \? \(\s*<CartNotes /, "the Note link opens the note panel");
  const notes = stripComments(readSrc(CART_NOTES));
  assert.match(notes, /maxLength=\{ORDER_NOTES_MAX_LEN\}/, "the 200-character cap");
  assert.ok(notes.includes('placeholder="Order note (prints on KOT)"'), "today's placeholder");
  assert.ok(notes.includes(">Order note<"), "the panel's title labels the field");
  assert.match(notes, /htmlFor=\{notesId\}/, "the title is the field's label (useId: the cart mounts twice)");
  assert.ok(!notes.includes("trailing"), "the three-dot trigger no longer rides the note");
});

test("PIN: CartExtraCharges still exports BOTH the add-form and the applied-rows components", () => {
  const src = stripComments(readSrc(CART_EXTRA_CHARGES));
  assert.match(src, /export function CartExtraChargeRows/, "must export CartExtraChargeRows (applied rows)");
  assert.match(src, /export function CartExtraCharges\b/, "must export CartExtraCharges (the add form)");
  assert.ok(
    /if\s*\(extras\.length === 0\)\s*return null;/.test(src),
    "CartExtraChargeRows must render nothing when empty — an ordinary sale pays no footer height for it",
  );
});

test("PIN: the footer is the HTML's (values 5.5): sticky at the cart's foot over its lines, 12px 16px 14px, a rule and a soft lift; links, bill, notices, buttons in that order", () => {
  const src = stripComments(readSrc(CART_TSX));
  const footer = constOf(src, "FOOTER_CLASS").split(/\s+/);
  for (const t of [
    "sticky", "bottom-0", "z-[2]", "flex", "flex-none", "flex-col", "gap-2.5", "border-t", "border-border", "bg-card", "px-4", "pt-3",
    "pb-[calc(14px+env(safe-area-inset-bottom))]", "max-tab:pb-[calc(12px+env(safe-area-inset-bottom))]", "[box-shadow:0_-10px_24px_rgba(0,0,0,.04)]", "leading-[normal]",
  ]) {
    assert.ok(footer.includes(t), `values 5.5 footer: ${t}`);
  }
  const at = (needle: string) => {
    const i = src.indexOf(needle);
    assert.ok(i > 0, `landmark: ${needle}`);
    return i;
  };
  const order = ["<CartFooterLinks", "<CartBill", "<CartUnavailableNotice", "<WriteNoticePanel", "<CartActions"].map(at);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "the links, the bill, the menu notice, the send notice, the buttons");
  const links = stripComments(readSrc(CART_FOOTER_LINKS));
  assert.match(links, /className="flex flex-wrap gap-x-4 gap-y-1"/, "values 5.5: the links wrap, 4px 16px apart");
  assert.ok(links.includes("text-[12.5px] font-medium text-link"), "values 5.5: a link 12.5px 500 --link");
});

test("PIN: the bill is the HTML's (values 5.5, 0.4; owner Q12): the details behind Total · Details / Hide details, open by default from an 820px-tall window", () => {
  const src = stripComments(readSrc(CART_BILL));
  // Ruling P16 (U1 final fix wave): the rule moved to lib/pos-cart-view.ts (billDetailsOpen, unit-tested: the user's toggle
  // wins; until then the HTML's 820px, and open while the table charge is waived or changed).
  assert.match(
    src,
    /const billOpen = billDetailsOpen\(\{ toggled, windowHeight, chargeAdjusted \}\);/,
    "values 0.4: billOpen = s.billOpen ?? (s.h >= 820), and P16's waived / changed table charge",
  );
  assert.match(src, /const chargeAdjusted = chargeShown && charge !== entitledCharge;/, "P16: the same condition as the waived / changed row");
  // Ruling P51 (U1 audit wave, report M-2): the choice holds for the order on screen only (billToggleStep, tested over
  // render sequences in lib/pos-cart-view.test.ts): it is stored with its order, stepped during render — dropped when
  // another order is on screen or the count has just gone from some to none (the column from 1280px never remounts) —
  // and `toggled` is what is left.
  assert.match(
    src,
    /const \[bill, setBill\] = useState<BillToggleState>\(\(\) => \(\{ toggle: null, hadItems: count > 0 \}\)\);/,
    "P51: the choice is stored with its order, and whether the cart had items",
  );
  assert.match(
    src,
    /const nextBill = billToggleStep\(bill, \{ scope: orderScope, count \}\);\s*if \(nextBill !== bill\) setBill\(nextBill\);/,
    "P51: each render steps the rule; another order on screen, or the cart just emptied, drops the choice",
  );
  assert.match(src, /const toggled = nextBill\.toggle\?\.open \?\? null;/, "P51: what is left of the choice feeds billDetailsOpen");
  assert.match(
    src,
    /onClick=\{\(\) => setBill\(\{ toggle: \{ open: !billOpen, scope: orderScope \}, hadItems: count > 0 \}\)\}/,
    "P51: a tap stores the choice with the order on screen",
  );
  assert.ok(!src.includes("setToggled("), "the per-mount toggle that never reset is gone");
  const cart = stripComments(readSrc(CART_TSX));
  assert.match(cart, /<CartBill\s+orderScope=\{resumedOrder\?\._id \?\? "new"\}/, "P51: the order on screen, CartLines' own scope (the tab's id, or \"new\")");
  assert.match(src, /\{chargeShown && \(/, "the charge rows render on the same condition");
  assert.match(src, /useWindowHeight\(\)/, "the window's own height (the HTML's s.h)");
  assert.ok(src.includes('{billOpen ? "Hide details" : "Details"}'), "owner Q1: the HTML's words");
  assert.match(src, /aria-expanded=\{billOpen\}/, "the toggle says whether the rows show");
  assert.ok(src.includes("text-[26px] font-semibold tracking-[-0.02em]"), "values 5.5: the total 26px 600 -.02em");
  assert.ok(src.includes("text-[15px] font-semibold"), 'values 5.5: "Total" 15px 600');
  assert.ok(src.includes("text-[12px] font-medium text-link"), 'values 5.5: "Details" 12px 500 --link');
  assert.ok(src.includes("text-status-ok-ink"), "values 5.5: the discount in --ok-i");
  assert.match(src, /mt-1 flex items-baseline justify-between border-t border-border-2 pt-2\.5/, "values 5.5: the total row (4px over a --border-2 rule, 10px under it)");
  assert.ok(!/const\s+total\s*=/.test(src) && !/subtotal\s*-\s*discount/.test(src), "the bill only prints usePosTotals' figures");
});

test("PIN: owner Q13 — PosKeys is rendered ONCE, by the page, and presses only the visible cart's enabled buttons", () => {
  const page = stripComments(readSrc(POS_PAGE));
  assert.equal(count(page, "<PosKeys"), 1, "one key listener for the page");
  assert.match(page, /<PosKeys busy=\{pos\.isBusy\} \/>/, "the cart's busy flag reaches the keys");
  assert.equal(count(stripComments(readSrc(CART_TSX)), "<PosKeys"), 0, "never per cart mount (the cart mounts twice)");
  const keys = stripComments(readSrc(POS_KEYS));
  assert.match(keys, /posKeyAction\(/, "the pure guard decides (lib/pos-keys.ts, unit-tested)");
  assert.ok(keys.includes("[data-ui='pos-search']") && keys.includes("[data-ui='pos-send']") && keys.includes("[data-ui='pos-pay']"), "the search, Send KOT and Pay");
  assert.match(keys, /getClientRects\(\)\.length > 0/, "only a visible element (the hidden cart mount is skipped)");
  assert.match(keys, /\.disabled/, "a disabled button is never pressed");
  assert.match(keys, /data-ui='pos-cart-sheet'/, "the cart sheet below 1280px is no dialog to the keys when it is the only one");
  assert.match(stripComments(readSrc(MOBILE_CART_BAR)), /data-ui="pos-cart-sheet"/, "the sheet names itself");
});

// U1 audit wave (report M1; ruling P54): the listener ran 3 querySelectorAll + getClientRects scans on EVERY keydown
// (typing in any field) before posKeyAction dropped the key. The key is now checked first (isPosKey, unit-tested).
test("PIN: PosKeys checks the key before any DOM read — any other key returns at the listener's first line", () => {
  const keys = stripComments(readSrc(POS_KEYS));
  assert.match(keys, /import \{ isPosKey, posKeyAction \} from "@\/lib\/pos-keys";/, "the shared key check");
  assert.match(
    keys,
    /const onKey = \(e: KeyboardEvent\) => \{\s*if \(!isPosKey\(e\.key\)\) return;\s*const send = visible</,
    "the first line of onKey returns on any other key, before the first scan",
  );
  const onKey = between(keys, "const onKey = (e: KeyboardEvent) => {", 'window.addEventListener("keydown", onKey);');
  const early = onKey.indexOf("if (!isPosKey(e.key)) return;");
  for (const read of ["visible<", "otherDialogOpen()", "querySelector", "getClientRects"]) {
    const at = onKey.indexOf(read);
    assert.ok(at === -1 || at > early, `${read} comes after the key check`);
  }
  const lib = stripComments(readSrc("apps/cafe/lib/pos-keys.ts"));
  assert.match(lib, /export function posKeyAction\([^)]*\): PosKeyAction \| null \{\s*if \(!isPosKey\(e\.key\)\) return null;/, "posKeyAction's first check is the same isPosKey");
});

// U1 Task 14 review (minor): the cart sheet stays mounted for its .2s slide down (Radix keeps it until the close has
// played, owner Q19), still on screen, so F8 / F9 must not press the closing sheet's Send KOT / Pay in that time: a
// button inside a sheet whose data-state is "closed" is not the visible cart's.
test("PIN: F8 / F9 never press the buttons of a cart sheet that is sliding down (data-state closed)", () => {
  const keys = stripComments(readSrc(POS_KEYS));
  assert.ok(keys.includes(`const CLOSING_CART_SHEET = "[data-ui='pos-cart-sheet'][data-state='closed']";`), "the closing sheet, by Radix's own state");
  const visibleFn = between(keys, "function visible<", "\n}\n");
  assert.match(
    visibleFn,
    /if \(el\.getClientRects\(\)\.length > 0 && !el\.closest\(CLOSING_CART_SHEET\)\) return el;/,
    "visible() skips an element inside the closing sheet (Send KOT, Pay, the search alike)",
  );
  assert.match(keys, /const send = visible<HTMLButtonElement>\("\[data-ui='pos-send'\]"\);/, "Send KOT is found through visible()");
  assert.match(keys, /const pay = visible<HTMLButtonElement>\("\[data-ui='pos-pay'\]"\);/, "Pay is found through visible()");
  const sheet = stripComments(readSrc(MOBILE_CART_BAR));
  assert.ok(POS_CART_SHEET_CLASS.includes("data-[state=closed]:animate-cart-sheet-down"), "the close is the one that keeps the sheet mounted");
  assert.match(sheet, /<DialogPrimitive\.Content\s+data-ui="pos-cart-sheet"/, "landmark: the sheet is the Radix content (it carries data-state)");
});

// U1 Task 7 (owner Q18): the bar is openable in EVERY state now (an empty order too), so D9.8c's "openable while an
// adjustment survives" holds by construction; the bar still says why an item-less cart is worth a look, through the
// SAME shared predicate the page's auto-close uses.
test("PIN: D9.8c — on mobile, a surviving adjustment keeps the cart bar OPENABLE (and the sheet from auto-closing), or it is unreachable there", () => {
  const barSrc = stripComments(readSrc(MOBILE_CART_BAR));
  assert.match(
    barSrc,
    /adjustment: hasPendingAdjustment\(cartProps\),/,
    "the bar's line reads the shared predicate: an item-less cart with a surviving adjustment says so",
  );
  const viewSrc = stripComments(readSrc("apps/cafe/lib/pos-cart-view.ts"));
  assert.match(viewSrc, /view\.adjustment \? "Adjustment still applied"/, "the bar must say WHY it is live on an item-less cart");

  // ONE predicate, shared: the bar and the page's auto-close must agree, or
  // one of them strands the adjustment the other is trying to keep reachable.
  const propsSrc = stripComments(readSrc("apps/cafe/lib/pos-cart-props.ts"));
  assert.match(propsSrc, /export function hasPendingAdjustment/, "pos-cart-props.ts must own the shared predicate");
  // Scoped to the RETURNED EXPRESSION, not the whole file: the function's own
  // Pick<> type signature names every field too, so a whole-file includes()
  // stayed green with the promo arm gutted to `false ||` (caught by mutating
  // it). The needles below must be live conditions, not type annotations.
  const bodyAt = propsSrc.indexOf("export function hasPendingAdjustment");
  const returnAt = propsSrc.indexOf("return (", bodyAt);
  assert.ok(returnAt > bodyAt, "landmark: hasPendingAdjustment must return an expression");
  const body = propsSrc.slice(returnAt);
  for (const needle of [
    "input.promoCode",
    "input.selectedRewardAt",
    "input.selectedCardId",
    "input.discountRaw",
    'input.discountUnit === "GST"',
    "input.extraCharges.length",
  ]) {
    assert.ok(body.includes(needle), `hasPendingAdjustment's condition must test ${needle}`);
  }

  const pageSrc = stripComments(readSrc(POS_PAGE));
  assert.match(
    pageSrc,
    /hasPendingAdjustment\(pos\)/,
    "the POS page must use the SAME shared predicate, not its own copy",
  );
  // Rulings P50 / P55: the page's close goes through hooks/use-emptied-sheet-close.ts, which steps the unit-tested
  // emptiedSheetStep (lib/pos-cart-view.test.ts) with the SAME predicate: never while an adjustment survives.
  assert.match(
    pageSrc,
    /const pendingAdjustment = hasPendingAdjustment\(pos\);\s*useEmptiedSheetClose\(pos\.cart\.length, pendingAdjustment, mobileCartOpen, setMobileCartOpen\);/,
    "the POS page must not force-close the mobile sheet while an adjustment survives",
  );
});

// Ruling P50 (U1 audit wave, report M-1): owner Q18 made the empty sheet a working place, so the page's close follows the
// open sheet's order being emptied (its items from some to none: main's last-item / Clear / settled close), never an
// empty sheet opened on an item-less order. Ruling P55 (the fix round, review I-1): the close may come a render later,
// once a lagging adjustment (an auto-armed stamp reward) lets go — a small state machine (emptiedSheetStep), tested over
// render sequences in lib/pos-cart-view.test.ts; these pins hold the wiring.
test("PIN: rulings P50 / P55 — the cart sheet closes itself once its emptied order has nothing applied (the page's hook, the stepped rule)", () => {
  const pageSrc = stripComments(readSrc(POS_PAGE));
  assert.match(pageSrc, /import \{ useEmptiedSheetClose \} from "@\/hooks\/use-emptied-sheet-close";/, "the page imports the hook");
  assert.ok(!pageSrc.includes("setMobileCartOpen(false)"), "the page keeps no close of its own (the old empty-cart effect is gone)");
  assert.ok(!/pos\.cart\.length === 0/.test(pageSrc), "no 'empty right now' rule in the page");
  const hook = stripComments(readSrc("apps/cafe/hooks/use-emptied-sheet-close.ts"));
  assert.match(
    hook,
    /import \{ emptiedSheetStart, emptiedSheetStep, type EmptiedSheetState \} from "@\/lib\/pos-cart-view";/,
    "the hook runs the pure rule",
  );
  assert.match(
    hook,
    /const state = useRef<EmptiedSheetState>\(emptiedSheetStart\(\{ count, open \}\)\);/,
    "it starts from the first render's figures (that render never closes), in a ref (no render of its own)",
  );
  assert.match(
    hook,
    /const step = emptiedSheetStep\(state\.current, \{ count, pendingAdjustment, open \}\);\s*state\.current = step\.state;\s*if \(step\.close\) setOpen\(false\);/,
    "each change steps the rule once, keeps its state, and closes on its word",
  );
  assert.match(hook, /\}, \[count, pendingAdjustment, open, setOpen\]\);/, "it steps when the count, the adjustment or the sheet's open state changes");
  assert.ok(!hook.includes("shouldCloseEmptiedSheet"), "the one-render comparison is gone (review I-1)");
});

// ── U0 Task 2 (2026-10-19): the HTML's nav widths drive the POS grid ─────────
// The owner's HTML (values 2.1 rootCols): no nav on a phone (< 720 px), the 76 px rail from 720 px and on a collapsed
// desktop, the 232 px sidebar at 1280 px and up. The POS grid pane is the HTML's menu column (U1 Task 1, values 2.0:
// the viewport minus that nav, the category column from 1100 px and the cart column from 1024 px) minus its inset.

test("navWidthPx: 0 on a phone, the 76 px rail on a tablet or a collapsed desktop, the 232 px sidebar from 1280 px", () => {
  assert.equal(NAV_WIDTH_WIDE_PX, 232, "the wide sidebar is the HTML's 232 px");
  assert.equal(NAV_WIDTH_RAIL_PX, 76, "the rail is the HTML's 76 px");
  assert.equal(NAV_RAIL_MIN_PX, 720, "the rail starts at the HTML's 720 px (values 0.1 ph)");
  assert.equal(NAV_WIDE_MIN_PX, 1280, "the wide sidebar starts at the HTML's 1280 px (values 0.1 wide)");
  assert.equal(SIDEBAR_WIDTH_REM * 16, NAV_WIDTH_WIDE_PX, "the primitive's --sidebar-width is the same 232 px");
  assert.equal(SIDEBAR_WIDTH_ICON_REM * 16, NAV_WIDTH_RAIL_PX, "the primitive's --sidebar-width-icon is the same 76 px");
  const cases: Array<[number, boolean, number]> = [
    [390, false, 0],
    [390, true, 0],
    [719, false, 0],
    [720, false, 76],
    [820, false, 76],
    [1024, false, 76],
    [1279, false, 76],
    [1280, false, 232],
    [1280, true, 76],
    [1920, false, 232],
  ];
  for (const [viewportWidth, collapsed, expected] of cases) {
    assert.equal(navWidthPx({ viewportWidth, collapsed }), expected, `navWidthPx at ${viewportWidth} px (collapsed ${collapsed}) must be ${expected}`);
  }
  assert.equal(isWideNav({ viewportWidth: 1280, collapsed: false }), true, "1280 px, not collapsed: the wide form");
  assert.equal(isWideNav({ viewportWidth: 1280, collapsed: true }), false, "1280 px, collapsed: the rail");
  assert.equal(isWideNav({ viewportWidth: 1279, collapsed: false }), false, "below 1280 px: the rail");
});

// U1 Task 3 (values 4.3): the HTML's measured columns and card widths at the plan's five viewports.
test("the POS card grid gives the HTML's columns and card widths beside the nav, the category column and the cart at the plan's five viewports", () => {
  const viewports: Array<[string, number, boolean, number, number, number]> = [
    // label, viewport, collapsed, list inner width, columns, card width (values 4.3)
    ["1280", 1280, false, 448, 2, 220],
    ["1280 collapsed", 1280, true, 564, 2, 278],
    // Owner Q19: no cart column at 1024px, so the menu holds four (the HTML's 568 / 2 / 280).
    ["1024 (owner Q19)", 1024, false, 908, 4, 221],
    ["820", 820, false, 704, 3, 229.33],
    ["390", 390, false, 366, 1, 366],
  ];
  for (const [label, viewportWidth, collapsed, inner, columns, card] of viewports) {
    const pane = posGridPaneWidthPx({ viewportWidth, collapsed });
    const room = viewportWidth - navWidthPx({ viewportWidth, collapsed });
    assert.ok(pane > 0 && pane <= room, `${label}: the grid pane (${pane} px) must fit the ${room} px beside the nav`);
    assert.equal(pane, inner, `${label}: the list's inner width`);
    assert.equal(posCardColumns(pane), columns, `${label}: ${columns} column(s)`);
    assert.ok(Math.abs(posCardWidthPx(pane) - card) < 0.01, `${label}: cards ${card} px wide, got ${posCardWidthPx(pane)}`);
  }
  assert.equal(POS_CARD_MIN_PX, 200, "values 4.1: minmax(min(200px,100%),1fr)");
  assert.equal(POS_CARD_GAP_PX, 8, "values 4.1: gap 8px");
});

// U1 final fix wave (the Task 5 review's FIX BEFORE MERGE minors): a section switch while the Bill options panel is open
// opens that section's form too (CartPromo / CartExtraCharges seeded it on mount only); the first-field focus skips a
// section's "Remove" buttons; the Reward section shows whenever its link does (lib/pos-footer.ts rewardSectionShown);
// closing a panel gives the focus back to the link that opened it (it has no Radix trigger).
test("PIN: the Bill options panel opens the switched-to section's form, focuses past Remove, keeps the Reward section with its link, and returns the focus to the link", () => {
  for (const file of ["apps/cafe/components/pos/CartPromo.tsx", CART_EXTRA_CHARGES]) {
    const src = stripComments(readSrc(file));
    assert.match(src, /const \[expandAsked, setExpandAsked\] = useState\(defaultExpanded\);/, `${file}: remembers what the panel last asked`);
    assert.match(
      src,
      /if \(expandAsked !== defaultExpanded\) \{\s*setExpandAsked\(defaultExpanded\);\s*if \(defaultExpanded\) setExpanded\(true\);\s*\}/,
      `${file}: a later ask (another link moved the open panel here) opens the form, while rendering (no frame without it)`,
    );
  }
  const panel = stripComments(readSrc(BILL_OPTIONS_PANEL));
  assert.ok(
    panel.includes(`const FIRST_FIELD = "input:not([disabled]):not([readonly]), textarea:not([disabled]), button:not([disabled]):not([aria-label^='Remove'])";`),
    "the first field is never a Remove button (every Remove in the panel is labelled \"Remove …\")",
  );
  assert.match(panel, /onCloseAutoFocus=\{returnFocus\}/, "the panel hands the focus back as it closes");
  assert.ok(panel.includes("boundary?.querySelector<HTMLElement>(footerLinkSelector(focusKey))?.focus();"), "to this cart's link of the open section");
  assert.ok(panel.includes("if (active && active !== document.body) return;"), "unless a tap outside put the focus somewhere on purpose");
  const cart = stripComments(readSrc(CART_TSX));
  assert.ok(
    cart.includes("{rewardSectionShown({ offered: rewardShown, picked: rewardPicked, locked: rewardLocked }) && ("),
    "the Reward section shows whenever its link can (offered, picked, or a tab's locked reward)",
  );
  const reward = stripComments(readSrc("apps/cafe/components/pos/CartReward.tsx"));
  assert.match(reward, /if \(!rewardSectionShown\(\{ offered, picked: selectedAt !== null \|\| \(cards\?\.selectedId \?\? null\) !== null, locked \}\)\) return null;/, "CartReward draws on the same gate (the locked line included)");
});

// U1 final fix wave (the final review's minor 1): the dead exports are gone, so the next page session cannot pick up a
// token that describes a control that no longer exists.
test("PIN: lib/pos-layout.ts no longer exports the dead POS_CART_CTA_CLASS / POS_HEADER_CHIP_ICON_CLASS", () => {
  const src = readSrc(POS_LAYOUT_TS);
  for (const gone of ["POS_CART_CTA_CLASS", "POS_HEADER_CHIP_ICON_CLASS"]) {
    assert.ok(!src.includes(gone), `${gone} is gone from lib/pos-layout.ts (no caller outside tests)`);
  }
});
