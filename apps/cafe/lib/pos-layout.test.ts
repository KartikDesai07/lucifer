// POS terminal layout ARITHMETIC pins. U1 Task 1 (2026-10-21) replaced the frame: the page is the owner's HTML Order
// screen (values 1.1, 2.0, 6.2 in docs/superpowers/specs/2026-10-20-pos-html-values.md; design 5): it fills the screen
// under the 56px header, its body grid holds the category column (from 1100px), the menu column and the cart column
// (from 1024px), and each region scrolls on its own. CB-1's two-pane switch at 1280px, its stacked phone column, the
// root's floor and the device height matrices that modelled that stack went with it (lib/pos-frame.test.ts pins the
// new page, grid and header; this file keeps the arithmetic: the grid's tiles beside the new columns, the column
// tiers, and the class strings that still encode numbers).
//
// lib/pos-layout.ts is the single source of the class strings/numbers the page consumes. Source-read pins live in
// lib/pos-layout-paths.test.ts + lib/pos-header-paths.test.ts.
//
// Column-count tiering (viewport breakpoints keyed by sidebar state, not a container query) is kept until U1 Task 3
// gives the menu the HTML's auto-fill cards: plain data these pins can verify directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { ABOVE_TAB_BAR_STICKY_CLASS, PHONE_PAGE_FOOT_PX, TAB_BAR_HEIGHT_PX } from "./shell-layout";

import {
  BREAKPOINT_SM_PX,
  BREAKPOINT_MD_PX,
  BREAKPOINT_LG_PX,
  BREAKPOINT_XL_PX,
  BREAKPOINT_2XL_PX,
  BREAKPOINT_DESK_PX,
  NAV_RAIL_MIN_PX,
  navWidthPx,
  posBodyColumnsPx,
  posGridPaneWidthPx,
  POS_BODY_COLUMNS_PX,
  POS_PANE_INSET_PX,
  POS_PAGE_CLASS,
  POS_MAIN_CLASS,
  POS_MAIN_PAD_B_PX,
  POS_ASIDE_CLASS,
  POS_CART_CLASS,
  POS_MOBILE_ONLY_CLASS,
  POS_TOOLBAR_CLASS,
  POS_LIST_CLASS,
  POS_CONTROLS_CLASS,
  POS_MOBILE_BAR_CLASS,
  POS_CART_SHEET_CLASS,
  POS_CART_SHEET_PANEL_CLASS,
  POS_CART_LIST_CLASS,
  POS_GRID_CLASS_SIDEBAR_EXPANDED,
  POS_GRID_CLASS_SIDEBAR_COLLAPSED,
  POS_GRID_GAP_REM,
  POS_GRID_COLUMN_TIERS_SIDEBAR_EXPANDED,
  POS_GRID_COLUMN_TIERS_SIDEBAR_COLLAPSED,
  POS_MIN_TILE_PX,
  POS_TILE_CARD_PADDING_PX,
  POS_TILE_THUMB_PX,
  POS_TILE_ROW_GAP_PX,
  POS_MIN_NAME_BOX_PX,
  POS_TILE_OPTIONS_RESERVE_CLASS,
} from "@/lib/pos-layout";

const REM_PX = 16;
const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);

type SidebarState = "expanded" | "collapsed";
const SIDEBAR_STATES: ReadonlyArray<SidebarState> = ["expanded", "collapsed"];
const GRID_TIERS: Record<SidebarState, ReadonlyArray<{ minPx: number; cols: number }>> = {
  expanded: POS_GRID_COLUMN_TIERS_SIDEBAR_EXPANDED,
  collapsed: POS_GRID_COLUMN_TIERS_SIDEBAR_COLLAPSED,
};

// ── pure helpers mirroring the HTML's own rules (never lib/pos-layout.ts's functions) ─────────────────────────────

// The menu column is the viewport minus the nav, the category column (from 1100px: 200px beside the wide nav, else
// 220px) and the cart column (from 1024px: 340px below 1100px, 360px beside the wide nav, else 380px) — values 2.0
// bodyCols — and the grid sits inside the pane's side inset (20px, 12px on a phone).
function paneWidthPx(viewportPx: number, sidebarState: SidebarState = "expanded"): number {
  const collapsed = sidebarState === "collapsed";
  const wide = viewportPx >= BREAKPOINT_XL_PX && !collapsed;
  const desk = viewportPx >= BREAKPOINT_DESK_PX;
  const nav = navWidthPx({ viewportWidth: viewportPx, collapsed });
  const aside = desk ? (wide ? POS_BODY_COLUMNS_PX.wide.aside : POS_BODY_COLUMNS_PX.desk.aside) : 0;
  const cart =
    viewportPx < BREAKPOINT_LG_PX ? 0 : !desk ? POS_BODY_COLUMNS_PX.tablet.cart : wide ? POS_BODY_COLUMNS_PX.wide.cart : POS_BODY_COLUMNS_PX.desk.cart;
  const inset = viewportPx < NAV_RAIL_MIN_PX ? POS_PANE_INSET_PX.phone : POS_PANE_INSET_PX.base;
  return viewportPx - nav - aside - cart - 2 * inset;
}

// Column count is a VIEWPORT breakpoint keyed by sidebar state (CB-1b) — no container query, no pane width input.
function colsFor(viewportPx: number, sidebarState: SidebarState): number {
  const tiers = GRID_TIERS[sidebarState];
  let cols = tiers[0].cols;
  for (const tier of tiers) {
    if (tier.minPx <= viewportPx) cols = tier.cols;
  }
  return cols;
}

function tilePx(panePx: number, cols: number): number {
  return (panePx - (cols - 1) * POS_GRID_GAP_REM * REM_PX) / cols;
}

// ── A. breakpoint matrix ─────────────────────────────────────────────────────

// U1 Task 1 adds the HTML's own breakpoints: 1100 (the category column arrives; the owner's tablet) and 1180.
const VIEWPORTS = [360, 412, 740, 768, 820, 1024, 1100, 1180, 1280, 1366, 1536, 1920];

// g1: the bare (base, un-prefixed) pr-N reserve, parsed from the real class
// string — never re-typed — anchored to the BASE utility (not the
// xl:pointer-fine:pr-7 variant) via the (?:^|\s)...(?:\s|$) fence.
const reserveMatch = POS_TILE_OPTIONS_RESERVE_CLASS.match(/(?:^|\s)pr-(\d+)(?:\s|$)/);
assert.ok(reserveMatch, `expected a bare pr-N token in POS_TILE_OPTIONS_RESERVE_CLASS ("${POS_TILE_OPTIONS_RESERVE_CLASS}")`);
const RESERVE_PX = Number(reserveMatch![1]) * 4;

test("PIN: every POS breakpoint keeps the grid tile at or above POS_MIN_TILE_PX beside the HTML's columns, sidebar expanded OR collapsed — and the product-name box left over after card padding/thumb/row-gap/reserve never drops below POS_MIN_NAME_BOX_PX (CB-1d.1 g1)", () => {
  for (const vw of VIEWPORTS) {
    for (const sidebarState of SIDEBAR_STATES) {
      const pane = paneWidthPx(vw, sidebarState);
      const cols = colsFor(vw, sidebarState);
      const tile = tilePx(pane, cols);
      assert.ok(
        tile >= POS_MIN_TILE_PX,
        `viewport ${vw}px (sidebar ${sidebarState}): pane ${pane}px -> ${cols} cols -> tile ${tile.toFixed(1)}px ` +
          `is below POS_MIN_TILE_PX (${POS_MIN_TILE_PX}px)`,
      );

      const nameBox = tile - 2 * POS_TILE_CARD_PADDING_PX - POS_TILE_THUMB_PX - POS_TILE_ROW_GAP_PX - RESERVE_PX;
      assert.ok(
        nameBox >= POS_MIN_NAME_BOX_PX,
        `viewport ${vw}px (sidebar ${sidebarState}): tile ${tile.toFixed(1)}px -> name box ${nameBox.toFixed(1)}px ` +
          `is below POS_MIN_NAME_BOX_PX (${POS_MIN_NAME_BOX_PX}px)`,
      );
    }
  }
});

test("PIN: lib/pos-layout.ts's posGridPaneWidthPx is the same menu-column arithmetic (the HTML's columns minus the pane's inset)", () => {
  for (const vw of [...VIEWPORTS, 719, 720, 1023, 1099, 1100, 1279]) {
    for (const sidebarState of SIDEBAR_STATES) {
      const viewport = { viewportWidth: vw, collapsed: sidebarState === "collapsed" };
      assert.equal(posGridPaneWidthPx(viewport), paneWidthPx(vw, sidebarState), `${vw}px (sidebar ${sidebarState}): the grid pane`);
      const columns = posBodyColumnsPx(viewport);
      assert.equal(columns.reduce((a, b) => a + b, 0), vw - navWidthPx(viewport), `${vw}px (sidebar ${sidebarState}): the columns fill the page`);
    }
  }
});

// U1 Task 2 (values 3.1 listPad): the grid sits in the HTML's list wrapper, 16px 20px (14px 12px on a phone); its side
// padding is the inset the tile arithmetic above subtracts.
test("PIN: the grid's inset is the list wrapper's padding POS_LIST_CLASS draws (px-5 py-4, max-tab:px-3 max-tab:py-3.5)", () => {
  const cls = tokens(POS_LIST_CLASS);
  assert.ok(cls.includes(`px-${POS_PANE_INSET_PX.base / 4}`), `POS_LIST_CLASS must carry px-${POS_PANE_INSET_PX.base / 4} (${POS_PANE_INSET_PX.base}px)`);
  assert.ok(cls.includes(`max-tab:px-${POS_PANE_INSET_PX.phone / 4}`), `POS_LIST_CLASS must carry max-tab:px-${POS_PANE_INSET_PX.phone / 4} (${POS_PANE_INSET_PX.phone}px)`);
  assert.ok(cls.includes("py-4") && cls.includes("max-tab:py-3.5"), "16px above and below, 14px on a phone (values 0.3 listPad)");
});

// U1 Task 2 (values 3.1, 0.3 toolPad): the toolbar sticks at the top of main on the page's --bg, 14px 20px 4px (10px
// 12px 4px on a phone). Main is the HTML's one scroller, so the list scrolls under the toolbar at every height: the
// pane's floor (CB-1c's rule in Task 1's interim frame) is gone with the pane.
test("PIN: the toolbar is the HTML's sticky strip with its toolPad, and main is the one scroller (no floor)", () => {
  const cls = tokens(POS_TOOLBAR_CLASS);
  for (const t of ["sticky", "top-0", "z-[3]", "bg-background", "px-5", "pt-3.5", "pb-1", "max-tab:px-3", "max-tab:pt-2.5"]) {
    assert.ok(cls.includes(t), `POS_TOOLBAR_CLASS (values 3.1 toolbar): "${t}"`);
  }
  assert.ok(tokens(POS_MAIN_CLASS).includes("overflow-auto"), "the menu column scrolls the list under the toolbar");
  assert.ok(!tokens(POS_MAIN_CLASS).includes("flex"), "main is a block, as the HTML's (the toolbar and the list stack in flow)");
  for (const gone of ["POS_PANE_CLASS", "POS_PANE_FLOOR_PX", "POS_CHIP_CLASS", "POS_CHIP_ROW_CLASS", "POS_DESKTOP_ONLY_CLASS"]) {
    assert.ok(!readFileSync(path.join(CAFE_ROOT, "lib/pos-layout.ts"), "utf8").includes(`export const ${gone}`), `lib/pos-layout.ts no longer exports ${gone}`);
  }
  // Today's control row (until U1 Tasks 4 and 6) sits above the toolbar with the toolbar's own side inset.
  const controls = tokens(POS_CONTROLS_CLASS);
  for (const t of ["px-5", "pt-3.5", "max-tab:px-3", "max-tab:pt-2.5"]) assert.ok(controls.includes(t), `POS_CONTROLS_CLASS lines up with the toolbar: "${t}"`);
});

test("PIN: desktop column counts cap at 3 everywhere (owner decision 2026-09-29, UI batch 1 §H — supersedes the old v1-four-columns-at-1536+ target)", () => {
  assert.equal(colsFor(1280, "expanded"), 3, "1280px grid (sidebar expanded) must give 3 columns");
  assert.equal(colsFor(1536, "expanded"), 3, "1536px grid (sidebar expanded) must give AT MOST 3 columns, not the old v1 four");
  assert.equal(colsFor(1920, "expanded"), 3, "1920px grid (sidebar expanded) must give AT MOST 3 columns, not the old v1 four");
  assert.equal(colsFor(1280, "collapsed"), 3, "1280px grid (sidebar collapsed) must give AT MOST 3 columns, not the old 4");
  // U1 Task 1: beside the category column and the 380px cart (1100-1279px) the menu is too narrow for three tiles.
  assert.equal(colsFor(1100, "expanded"), 2, "1100px (the category column arrives) gives 2 columns");
  assert.equal(colsFor(1279, "collapsed"), 2, "1279px beside the rail still gives 2 columns");
  for (const state of SIDEBAR_STATES) {
    for (const tier of GRID_TIERS[state]) assert.ok(tier.cols <= 3, `no tier above 3 columns (sidebar ${state}, from ${tier.minPx}px)`);
  }
});

// ── B. the two grid class strings encode exactly their tier tables ─────────

const NAMED_BREAKPOINT_PX: Record<string, number> = {
  sm: BREAKPOINT_SM_PX,
  md: BREAKPOINT_MD_PX,
  lg: BREAKPOINT_LG_PX,
  desk: BREAKPOINT_DESK_PX,
  xl: BREAKPOINT_XL_PX,
  "2xl": BREAKPOINT_2XL_PX,
};

function parseGridTiers(cls: string): Array<{ minPx: number; cols: number }> {
  const tiers: Array<{ minPx: number; cols: number }> = [];
  const bareMatch = cls.match(/(?:^|\s)grid-cols-(\d+)(?:\s|$)/);
  if (bareMatch) tiers.push({ minPx: 0, cols: Number(bareMatch[1]) });
  for (const m of cls.matchAll(/(sm|md|lg|desk|xl|2xl):grid-cols-(\d+)/g)) {
    tiers.push({ minPx: NAMED_BREAKPOINT_PX[m[1]], cols: Number(m[2]) });
  }
  tiers.sort((a, b) => a.minPx - b.minPx);
  return tiers;
}

test("PIN: POS_GRID_CLASS_SIDEBAR_EXPANDED/COLLAPSED each encode exactly their POS_GRID_COLUMN_TIERS_SIDEBAR_* table", () => {
  assert.deepStrictEqual(
    parseGridTiers(POS_GRID_CLASS_SIDEBAR_EXPANDED),
    POS_GRID_COLUMN_TIERS_SIDEBAR_EXPANDED as unknown as ReturnType<typeof parseGridTiers>,
    "the tiers parsed out of POS_GRID_CLASS_SIDEBAR_EXPANDED must exactly match POS_GRID_COLUMN_TIERS_SIDEBAR_EXPANDED",
  );
  assert.deepStrictEqual(
    parseGridTiers(POS_GRID_CLASS_SIDEBAR_COLLAPSED),
    POS_GRID_COLUMN_TIERS_SIDEBAR_COLLAPSED as unknown as ReturnType<typeof parseGridTiers>,
    "the tiers parsed out of POS_GRID_CLASS_SIDEBAR_COLLAPSED must exactly match POS_GRID_COLUMN_TIERS_SIDEBAR_COLLAPSED",
  );
});

test("PIN: neither grid class string uses a container query — the viewport tiers are kept as plain testable data, not a missing-support fallback", () => {
  for (const [label, cls] of [
    ["POS_GRID_CLASS_SIDEBAR_EXPANDED", POS_GRID_CLASS_SIDEBAR_EXPANDED],
    ["POS_GRID_CLASS_SIDEBAR_COLLAPSED", POS_GRID_CLASS_SIDEBAR_COLLAPSED],
  ] as const) {
    assert.ok(!cls.includes("@container"), `${label} must not include @container`);
    assert.ok(!cls.includes("@min-"), `${label} must not include @min-`);
    assert.match(cls, /grid-cols-2/, `landmark: ${label} must still carry the bare grid-cols-2 base tier`);
  }
});

// ── C. the frame's breakpoints and the classes that encode numbers ─────────

test("PIN: the HTML's desk breakpoint is the app's desk: variant (1100px = 68.75rem in app/globals.css)", () => {
  const css = readFileSync(path.join(CAFE_ROOT, "app/globals.css"), "utf8");
  const desk = css.match(/--breakpoint-desk:\s*([\d.]+)rem;/);
  assert.ok(desk, "app/globals.css declares --breakpoint-desk in rem");
  assert.equal(Number(desk![1]) * REM_PX, BREAKPOINT_DESK_PX, "BREAKPOINT_DESK_PX is the CSS breakpoint");
  const tab = css.match(/--breakpoint-tab:\s*([\d.]+)rem;/);
  assert.equal(Number(tab?.[1]) * REM_PX, NAV_RAIL_MIN_PX, "the HTML's phone ends at the CSS tab breakpoint (720px)");
});

// values 6.2: on a phone main runs under the order bar and the 59px tab bar to the window's foot ([0,56,390,788]),
// keeping 150px clear at its end (the bar 65 + the tab bar 59 + 26); 100px at 820 (the bar + 35).
test("PIN: on a phone the page runs under the tab bar to the window's foot, and main keeps the bar and the tab bar clear", () => {
  assert.equal(TAB_BAR_HEIGHT_PX, 1 + 2 + 56, "the bar: a 1px rule, 2px top padding, 56px tabs");
  assert.equal(PHONE_PAGE_FOOT_PX, 92, "values 2.1 screenPadB on a phone");
  const page = tokens(POS_PAGE_CLASS);
  assert.ok(page.includes(`-mb-[${PHONE_PAGE_FOOT_PX}px]`), "the page bleeds over <main>'s 92px phone foot, to the window's foot");
  assert.ok(!page.some((t) => t.startsWith("max-tab:h-")), "no phone height of its own: the page is the window minus the header at every width");
  assert.ok(POS_MAIN_PAD_B_PX.phone > TAB_BAR_HEIGHT_PX + 65, "150px clears the order bar (65px) on the tab bar");
  assert.ok(tokens(POS_MAIN_CLASS).includes(`max-tab:pb-[${POS_MAIN_PAD_B_PX.phone}px]`), "main's phone padding");
});

test("PIN: on a phone the POS cart bar always sits on the tab bar (the shell's 59px offset)", () => {
  assert.equal(ABOVE_TAB_BAR_STICKY_CLASS, "max-tab:bottom-[" + TAB_BAR_HEIGHT_PX + "px]", "the offset is the tab bar's height");
  assert.ok(tokens(POS_MOBILE_BAR_CLASS).includes(ABOVE_TAB_BAR_STICKY_CLASS), "POS_MOBILE_BAR_CLASS carries it");
  assert.ok(tokens(POS_MOBILE_BAR_CLASS).includes("bottom-0"), "landmark: from 720px it sits on the screen's foot");
});

test("PIN: POS_CART_SHEET_CLASS carries a vh base with a supports-dvh override, plus the Radix-X hider", () => {
  assert.ok(POS_CART_SHEET_CLASS.includes("h-[90vh]"), "POS_CART_SHEET_CLASS must include h-[90vh]");
  assert.ok(POS_CART_SHEET_CLASS.includes("supports-[height:1dvh]:h-[90dvh]"), "POS_CART_SHEET_CLASS must include supports-[height:1dvh]:h-[90dvh]");
  assert.ok(POS_CART_SHEET_CLASS.includes("[&>button]:hidden"), "POS_CART_SHEET_CLASS must still hide Radix's own close button");
});

// The page fills the screen and main runs to its foot (values 6.2), so the bar can no longer be an in-flow row under
// the grid: it lies over the page's foot, inside the page (relative), where main's bottom padding keeps it clear.
test("PIN: POS_MOBILE_BAR_CLASS lies over the page's foot (absolute inside the page), with no margins of its own, and hides from 1024px", () => {
  const bar = tokens(POS_MOBILE_BAR_CLASS);
  for (const t of ["absolute", "inset-x-0", "bottom-0", "lg:hidden"]) assert.ok(bar.includes(t), `POS_MOBILE_BAR_CLASS must include ${t}`);
  assert.ok(tokens(POS_PAGE_CLASS).includes("relative"), "the page is the bar's containing block");
  assert.ok(!bar.includes("sticky"), "no longer an in-flow sticky row: main runs under it");
  assert.ok(!bar.includes("fixed"), "not fixed: it stays inside the page, beside the nav");
  assert.ok(!bar.some((t) => /^-?m[xyb]?-/.test(t)), "no margins of its own");
});

test("PIN: the cart is a column from the HTML's 1024px (lg), the category column from its 1100px (desk), never md", () => {
  assert.ok(tokens(POS_CART_CLASS).includes("lg:flex") && tokens(POS_CART_CLASS).includes("hidden"), "the cart column shows from 1024px");
  assert.ok(tokens(POS_ASIDE_CLASS).includes("desk:flex") && tokens(POS_ASIDE_CLASS).includes("hidden"), "the category column shows from 1100px");
  for (const [label, cls] of [["POS_CART_CLASS", POS_CART_CLASS], ["POS_ASIDE_CLASS", POS_ASIDE_CLASS]] as const) {
    assert.ok(!cls.includes("md:"), `${label} must not switch at md`);
  }
});

// U1 Task 2: the category list switches at 1100px between the column (POS_ASIDE_CLASS) and the toolbar's Category
// button + sheet (CategorySidebar.tsx, desk:hidden; pinned in lib/pos-layout-paths.test.ts); the chip strip and the rail
// constants went with it. POS_MOBILE_ONLY_CLASS stays for the bar's wrapper (MobileCartBar).
test("PIN: exactly one cart and one category list show at any width — the column and the bar switch at 1024px, the category column and the Category button at 1100px", () => {
  assert.ok(tokens(POS_MOBILE_BAR_CLASS).includes("lg:hidden"), "the bar hides where the cart column shows (lg)");
  assert.equal(POS_MOBILE_ONLY_CLASS, "desk:hidden", "the bar's wrapper keeps its 1100px gate (U1 Task 7 rebuilds the bar)");
  assert.ok(tokens(POS_ASIDE_CLASS).includes("desk:flex"), "the category column shows from 1100px");
});

test("PIN: the cart sheet's scrollable panel and its line-list floor carry the right utility classes", () => {
  assert.match(POS_CART_SHEET_PANEL_CLASS, /(^|\s)h-full(\s|$)/, "POS_CART_SHEET_PANEL_CLASS must include h-full");
  assert.match(POS_CART_SHEET_PANEL_CLASS, /overflow-y-auto/, "POS_CART_SHEET_PANEL_CLASS must include overflow-y-auto");
  // D9.8 (2026-09-26): raised 32 → 48 (8rem → 12rem). A cart LINE is a
  // two-row block (name+price, then the 36px stepper row) ≈ 76px, so the old
  // 128px floor could only ever show 1.68 of them — the owner's phone
  // screenshot caught the second line clipped mid-stepper. 192px shows 2.5,
  // so the cut always lands INSIDE a line and reads as "scroll for more"
  // rather than as a line with its controls sheared off. Affordable now that
  // the footer's occasional controls live behind the More menu.
  assert.match(POS_CART_LIST_CLASS, /(^|\s)min-h-48(\s|$)/, "POS_CART_LIST_CLASS must include min-h-48");
  assert.ok(
    !POS_CART_LIST_CLASS.includes("min-h-32"),
    "POS_CART_LIST_CLASS must NOT fall back to the old min-h-32 floor — it clipped the second cart line mid-stepper",
  );
  assert.match(POS_CART_LIST_CLASS, /(^|\s)flex-1(\s|$)/, "POS_CART_LIST_CLASS must include flex-1");
  assert.ok(
    !POS_CART_LIST_CLASS.includes("overscroll-contain"),
    "POS_CART_LIST_CLASS must NOT include overscroll-contain — a drag that runs out of list must chain to the scrolling panel so the CTAs come up",
  );
});
