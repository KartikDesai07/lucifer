// POS terminal layout ARITHMETIC pins. U1 Task 1 (2026-10-21) replaced the frame: the page is the owner's HTML Order
// screen (values 1.1, 2.0, 6.2 in docs/superpowers/specs/2026-10-20-pos-html-values.md; design 5): it fills the screen
// under the 56px header, its body grid holds the category column (from 1100px), the menu column and the cart column
// (from 1024px), and each region scrolls on its own. CB-1's two-pane switch at 1280px, its stacked phone column, the
// root's floor and the device height matrices that modelled that stack went with it (lib/pos-frame.test.ts pins the
// new page, grid and header; this file keeps the arithmetic: the card grid beside the new columns and the class strings
// that still encode numbers).
//
// lib/pos-layout.ts is the single source of the class strings/numbers the page consumes. Source-read pins live in
// lib/pos-layout-paths.test.ts + lib/pos-header-paths.test.ts.
//
// U1 Task 3 (values 4.1, 4.3): the menu's cards sit in the HTML's auto-fill grid — as many columns of at least 200px as
// the menu column holds, 8px apart — so the column count follows the menu column's own width. CB-1b's viewport tiers
// keyed by the nav's state, the old tile's thumbnail-row arithmetic and its corner button's reserve went with the old
// tile.
//
// Owner Q19 (2026-10-22, after the preview; design 4 Q19-Q21): below 1280px (tablets portrait and landscape, phones) the
// cart is never a side column or a side sheet: the order bar shows and the cart opens like the phone's, full screen,
// sliding up from the window's foot; 1280px and wider (PC / laptop, nav open or collapsed) keep the cart column. This
// overrides the HTML's 1024-1279px cart column and its 820px side sheet, so the pins below that encode those widths moved
// on purpose (the category column still arrives at the HTML's 1100px).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { ABOVE_TAB_BAR_STICKY_CLASS, PHONE_PAGE_FOOT_PX, TAB_BAR_HEIGHT_PX } from "./shell-layout";
import * as layout from "@/lib/pos-layout";

import {
  BREAKPOINT_XL_PX,
  BREAKPOINT_DESK_PX,
  NAV_RAIL_MIN_PX,
  NAV_WIDE_MIN_PX,
  NAV_WIDTH_RAIL_PX,
  POS_CART_COLUMN_MIN_PX,
  navWidthPx,
  posBodyColumnsPx,
  posMainPadBottomPx,
  posOrderBarInsetsPx,
  posGridPaneWidthPx,
  posCardColumns,
  posCardWidthPx,
  POS_BODY_COLUMNS_PX,
  POS_PANE_INSET_PX,
  POS_PAGE_CLASS,
  POS_MAIN_CLASS,
  POS_MAIN_PAD_B_PX,
  POS_ASIDE_CLASS,
  POS_CART_CLASS,
  POS_TOOLBAR_CLASS,
  POS_LIST_CLASS,
  POS_MOBILE_BAR_CLASS,
  POS_MOBILE_BAR_BUTTON_CLASS,
  POS_ORDER_BAR_HEIGHT_PX,
  POS_CART_SHEET_CLASS,
  POS_CART_SHEET_SCRIM_CLASS,
  POS_CART_SHEET_PANEL_CLASS,
  POS_CART_LIST_CLASS,
  POS_CARD_GRID_CLASS,
  POS_CARD_MIN_PX,
  POS_CARD_GAP_PX,
} from "@/lib/pos-layout";

const REM_PX = 16;
const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);

/** The safe-area inset the phone's tab bar grows by: its own bottom padding (components/layout/TabBar.tsx), read from
 *  its class so /pos's order bar and menu column add the very same expression (ruling P44). */
function tabBarInset(): string {
  const src = readFileSync(path.join(CAFE_ROOT, "components/layout/TabBar.tsx"), "utf8");
  const m = src.match(/data-ui="tab-bar"\s*className="[^"]*\spb-\[(env\(safe-area-inset-bottom\))\]/);
  assert.ok(m, "landmark: the tab bar's bottom padding is env(safe-area-inset-bottom)");
  return m![1];
}

type SidebarState = "expanded" | "collapsed";
const SIDEBAR_STATES: ReadonlyArray<SidebarState> = ["expanded", "collapsed"];

// ── pure helpers mirroring the HTML's own rules (never lib/pos-layout.ts's functions) ─────────────────────────────

// The menu column is the viewport minus the nav, the category column (from 1100px: 200px beside the wide nav, else
// 220px) and the cart column (owner Q19: from 1280px only, 360px beside the wide nav, else 380px; below it the cart is
// the bar's full-screen sheet) — values 2.0 bodyCols as Q19 changes them — and the grid sits inside the pane's side
// inset (20px, 12px on a phone).
function paneWidthPx(viewportPx: number, sidebarState: SidebarState = "expanded"): number {
  const collapsed = sidebarState === "collapsed";
  const wide = viewportPx >= BREAKPOINT_XL_PX && !collapsed;
  const desk = viewportPx >= BREAKPOINT_DESK_PX;
  const nav = navWidthPx({ viewportWidth: viewportPx, collapsed });
  const aside = desk ? (wide ? POS_BODY_COLUMNS_PX.wide.aside : POS_BODY_COLUMNS_PX.desk.aside) : 0;
  const cart = viewportPx < BREAKPOINT_XL_PX ? 0 : wide ? POS_BODY_COLUMNS_PX.wide.cart : POS_BODY_COLUMNS_PX.desk.cart;
  const inset = viewportPx < NAV_RAIL_MIN_PX ? POS_PANE_INSET_PX.phone : POS_PANE_INSET_PX.base;
  return viewportPx - nav - aside - cart - 2 * inset;
}

// CSS grid's auto-fill over the HTML's tracks (values 4.1: repeat(auto-fill,minmax(min(200px,100%),1fr)), gap 8px):
// each track is 200px, or the whole width when that is narrower; as many as fit with the 8px gaps between them, and
// never fewer than one. Counted one track at a time, not by lib/pos-layout.ts's division.
function autoFillColumns(gridPx: number): number {
  const track = Math.min(200, gridPx);
  let n = 1;
  while ((n + 1) * track + n * 8 <= gridPx) n += 1;
  return n;
}

// ── A. breakpoint matrix ─────────────────────────────────────────────────────

// U1 Task 1 adds the HTML's own breakpoints: 1100 (the category column arrives; the owner's tablet) and 1180.
const VIEWPORTS = [360, 412, 740, 768, 820, 1024, 1100, 1180, 1280, 1366, 1536, 1920];

test("PIN: at every POS breakpoint, nav open or collapsed, the card grid holds the HTML's auto-fill columns: each card at least 200px (the whole width when the menu is narrower), the row filling the menu exactly", () => {
  for (const vw of VIEWPORTS) {
    for (const sidebarState of SIDEBAR_STATES) {
      const pane = paneWidthPx(vw, sidebarState);
      const cols = posCardColumns(pane);
      const card = posCardWidthPx(pane);
      assert.equal(cols, autoFillColumns(pane), `viewport ${vw}px (sidebar ${sidebarState}): pane ${pane}px holds ${autoFillColumns(pane)} auto-fill column(s), got ${cols}`);
      assert.ok(card >= Math.min(POS_CARD_MIN_PX, pane) - 1e-9, `viewport ${vw}px (sidebar ${sidebarState}): card ${card.toFixed(2)}px is below its 200px track`);
      assert.ok(Math.abs(cols * card + (cols - 1) * POS_CARD_GAP_PX - pane) < 1e-9, `viewport ${vw}px (sidebar ${sidebarState}): the row fills the ${pane}px menu`);
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
// padding is the inset the card arithmetic above subtracts. U1 Task 3: the HTML sets no line-height on its cards, group
// headings or messages (values 0.5: normal).
test("PIN: the grid's inset is the list wrapper's padding POS_LIST_CLASS draws (px-5 py-4, max-tab:px-3 max-tab:py-3.5), at line-height normal", () => {
  const cls = tokens(POS_LIST_CLASS);
  assert.ok(cls.includes(`px-${POS_PANE_INSET_PX.base / 4}`), `POS_LIST_CLASS must carry px-${POS_PANE_INSET_PX.base / 4} (${POS_PANE_INSET_PX.base}px)`);
  assert.ok(cls.includes(`max-tab:px-${POS_PANE_INSET_PX.phone / 4}`), `POS_LIST_CLASS must carry max-tab:px-${POS_PANE_INSET_PX.phone / 4} (${POS_PANE_INSET_PX.phone}px)`);
  assert.ok(cls.includes("py-4") && cls.includes("max-tab:py-3.5"), "16px above and below, 14px on a phone (values 0.3 listPad)");
  assert.ok(cls.includes("leading-[normal]"), "line-height normal for the cards, the group headings and the messages");
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
  // U1 Task 6: the interim control row above the toolbar went with its last controls (the header's switch-order button
  // and the Open orders panel), so the toolbar sits at the HTML's top of main.
  for (const gone of ["POS_PANE_CLASS", "POS_PANE_FLOOR_PX", "POS_CHIP_CLASS", "POS_CHIP_ROW_CLASS", "POS_DESKTOP_ONLY_CLASS", "POS_CONTROLS_CLASS"]) {
    assert.ok(!readFileSync(path.join(CAFE_ROOT, "lib/pos-layout.ts"), "utf8").includes(`export const ${gone}`), `lib/pos-layout.ts no longer exports ${gone}`);
  }
});

// U1 Task 3 (values 4.3, design 5 "The grid is repeat(auto-fill,...)"): the HTML's grid decides the columns from the
// menu column's width, so the 2026-09-29 cap of three columns (UI batch 1 §H, made for the old tile) gives way to it.
// Owner Q19: below 1280px no cart column takes the menu's room, so the menu holds more cards at 1024-1279px than the
// HTML's two (four at 1024px, three at 1100px beside the category column).
test("PIN: the card columns follow the menu column's width: two beside the cart, four at 1024px and three at 1100px with no cart column (owner Q19), three at 820px, one on a phone", () => {
  assert.equal(posCardColumns(paneWidthPx(1280, "expanded")), 2, "1280px, nav open: 2 columns (values 4.3)");
  assert.equal(posCardColumns(paneWidthPx(1280, "collapsed")), 2, "1280px, nav collapsed: 2 columns (values 4.3)");
  assert.equal(posCardColumns(paneWidthPx(1024)), 4, "1024px: the 908px menu holds four (owner Q19: no cart column; the HTML's two)");
  assert.equal(posCardColumns(paneWidthPx(1100)), 3, "1100px beside the rail and the category column: the 764px menu holds three (owner Q19)");
  assert.equal(posCardColumns(paneWidthPx(1279)), 4, "1279px: the 943px menu holds four (owner Q19)");
  assert.equal(posCardColumns(paneWidthPx(820)), 3, "820px: 3 columns (values 4.3)");
  assert.equal(posCardColumns(paneWidthPx(390)), 1, "a phone: 1 column (values 4.3)");
  assert.equal(posCardColumns(paneWidthPx(1920)), 5, "1920px: the 1088px menu holds five");
});

// ── B. the card grid's class string encodes the HTML's grid ─────────────────

test("PIN: POS_CARD_GRID_CLASS is the HTML's card grid (values 4.1): auto-fill tracks of minmax(min(200px,100%),1fr), 8px apart — one grid at every width, no container query", () => {
  const cls = tokens(POS_CARD_GRID_CLASS);
  assert.ok(cls.includes("grid"), "a grid");
  assert.ok(cls.includes(`grid-cols-[repeat(auto-fill,minmax(min(${POS_CARD_MIN_PX}px,100%),1fr))]`), "the HTML's auto-fill tracks");
  assert.ok(cls.includes(`gap-${POS_CARD_GAP_PX / 4}`), "8px apart");
  assert.ok(!cls.some((t) => t.includes(":")), "no variant: the same grid at every width");
  assert.ok(!POS_CARD_GRID_CLASS.includes("@container") && !POS_CARD_GRID_CLASS.includes("@min-"), "no container query");
  for (const gone of [
    "POS_GRID_CLASS_SIDEBAR_EXPANDED",
    "POS_GRID_COLUMN_TIERS_SIDEBAR_EXPANDED",
    "POS_MIN_TILE_PX",
    "POS_TILE_OPTIONS_RESERVE_CLASS",
  ]) {
    assert.ok(!readFileSync(path.join(CAFE_ROOT, "lib/pos-layout.ts"), "utf8").includes(`export const ${gone}`), `lib/pos-layout.ts no longer exports ${gone}`);
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
  assert.ok(POS_MAIN_PAD_B_PX.phone > TAB_BAR_HEIGHT_PX + POS_ORDER_BAR_HEIGHT_PX, "150px clears the order bar on the tab bar");
  // Ruling P44: the bar rides up by the tab bar's safe-area inset, so main's foot grows by it too (150px at inset 0).
  assert.ok(
    tokens(POS_MAIN_CLASS).includes(`max-tab:pb-[calc(${POS_MAIN_PAD_B_PX.phone}px+${tabBarInset()})]`),
    "main's phone padding: 150px plus the tab bar's safe-area inset",
  );
  assert.equal(tokens(POS_MAIN_CLASS).filter((t) => t.startsWith("max-tab:pb-")).length, 1, "one phone padding");
});

// U1 Task 7 (values 6.1, 6.2): the order bar is a 1px rule, 10px of padding above and below the 44px "Review order" —
// 65px — and main's foot is the HTML's room for it: on a phone the bar on the 59px tab bar and 26px of air (150), at
// 720-1023px the bar and 35px (100). Owner Q19: the bar shows up to 1279px, so the 100px foot runs to 1279px too.
test("PIN: the order bar is 65px tall, and main's foot is the HTML's room for it: 150 = bar + tab bar + 26 on a phone, 100 = bar + 35 below 1280px (owner Q19)", () => {
  const bar = tokens(POS_MOBILE_BAR_CLASS);
  assert.ok(bar.includes("border-t") && bar.includes("py-2.5"), "values 6.1: the bar's 1px top rule and its 10px padding");
  assert.ok(tokens(POS_MOBILE_BAR_BUTTON_CLASS).includes("h-11"), "values 6.1: the 44px Review order button");
  assert.equal(POS_ORDER_BAR_HEIGHT_PX, 1 + 10 + 44 + 10, "values 6.1: the bar measures 65px ([76,1115,744,65] at 820)");
  assert.equal(POS_MAIN_PAD_B_PX.phone, POS_ORDER_BAR_HEIGHT_PX + TAB_BAR_HEIGHT_PX + 26, "values 6.2: 150px on a phone");
  assert.equal(POS_MAIN_PAD_B_PX.cmp, POS_ORDER_BAR_HEIGHT_PX + 35, "values 6.2: 100px wherever the bar shows from 720px");
  assert.equal(posMainPadBottomPx(390), 150, "390px: the phone's 150");
  assert.equal(posMainPadBottomPx(820), 100, "820px: the tablet's 100");
  assert.equal(posMainPadBottomPx(1024), 100, "1024px: the bar's 100 (owner Q19; the HTML's column foot was 16)");
  assert.equal(posMainPadBottomPx(1279), 100, "1279px: still the bar's 100 (owner Q19)");
  assert.equal(posMainPadBottomPx(1280), 16, "1280px: beside the cart column, 16");
  assert.ok(tokens(POS_MAIN_CLASS).includes(`max-xl:pb-[${POS_MAIN_PAD_B_PX.cmp}px]`), "main's 100px below 1280px (owner Q19)");
  assert.ok(!tokens(POS_MAIN_CLASS).some((t) => t.startsWith("max-lg:")), "no 1024px foot any more (owner Q19)");
});

// values 0.3 obLeft / obBottom, 6.1; design 8: the bar starts at the nav's edge (the 76px rail from 720px, the window's
// edge on a phone) and runs to the window's right edge; on a phone it sits ON the 59px tab bar (the HTML leaves 1px of
// the menu showing between them: not copied), from 720px on the window's foot. Owner Q19: the bar runs up to 1279px (the
// nav is the rail there, collapsed or not: the wide nav starts at 1280px); from 1280px there is no bar.
test("PIN: the bar's place: beside the nav, on the phone's tab bar, at the window's foot from 720px to 1279px (owner Q19)", () => {
  const at = (w: number, collapsed = false) => posOrderBarInsetsPx({ viewportWidth: w, collapsed });
  assert.deepEqual(at(390), { left: 0, bottom: TAB_BAR_HEIGHT_PX }, "390px: no nav, on the tab bar");
  assert.deepEqual(at(719), { left: 0, bottom: TAB_BAR_HEIGHT_PX }, "719px: still a phone");
  assert.deepEqual(at(720), { left: NAV_WIDTH_RAIL_PX, bottom: 0 }, "720px: beside the rail, on the window's foot");
  assert.deepEqual(at(1023), { left: NAV_WIDTH_RAIL_PX, bottom: 0 }, "1023px: still the bar");
  assert.deepEqual(at(1024), { left: NAV_WIDTH_RAIL_PX, bottom: 0 }, "1024px: the bar beside the rail (owner Q19; the HTML's column)");
  assert.deepEqual(at(1100), { left: NAV_WIDTH_RAIL_PX, bottom: 0 }, "1100px: the bar from the rail's edge, under the category column too (owner Q19)");
  assert.deepEqual(at(1279, true), { left: NAV_WIDTH_RAIL_PX, bottom: 0 }, "1279px, nav collapsed: still the rail and the bar");
  assert.equal(at(1280), null, "1280px: the cart is a column, no bar (owner Q19)");
  assert.equal(at(1280, true), null, "1280px, nav collapsed: the cart column too (owner Q19)");
  const box = (w: number, h: number): number[] => {
    const inset = at(w);
    assert.ok(inset, `${w}px has a bar`);
    return [inset!.left, h - inset!.bottom - POS_ORDER_BAR_HEIGHT_PX, w - inset!.left, POS_ORDER_BAR_HEIGHT_PX];
  };
  assert.deepEqual(box(820, 1180), [76, 1115, 744, 65], "values 6.1 t820: [76,1115,744,65]");
  assert.deepEqual(box(1024, 768), [76, 703, 948, 65], "t1024 (owner Q19): the 820 bar's rule at 1024 x 768");
  assert.deepEqual(box(390, 844), [0, 720, 390, 65], "values 6.1 p390: [0,719,390,65], ours 1px lower, on the tab bar (design 8)");
});

// Owner Q19: one width decides it, the nav's wide breakpoint: the cart is a column from 1280px (a PC or a laptop, nav
// open or collapsed), the bar and its full-screen sheet below.
test("PIN: the cart column starts at 1280px (owner Q19), the nav's own wide breakpoint", () => {
  assert.equal(POS_CART_COLUMN_MIN_PX, 1280, "owner Q19: 1280px and wider keep the cart column");
  assert.equal(POS_CART_COLUMN_MIN_PX, BREAKPOINT_XL_PX, "Tailwind's xl: (80rem) is the switch");
  assert.equal(POS_CART_COLUMN_MIN_PX, NAV_WIDE_MIN_PX, "the same width as the wide nav's");
});

// Ruling P44 (U1 V-C F2, 2026-10-22): inside the Android app on WebView 154 the phone reports a bottom safe-area inset
// (about 24.8 CSS px) and the tab bar grows by it (its bottom padding). The bar lies under the tab bar (z-index 10 <
// 12), so it rides up by the same inset: the tab bar never hides its total or "Review order". At inset 0 it is the
// shell's 59px. The shell's own ABOVE_TAB_BAR_STICKY_CLASS (Settings' save bar, the menu's bulk bar) stays as it is.
test("PIN: on a phone the POS cart bar always sits on the tab bar: its 59px plus the safe-area inset it grows by (ruling P44)", () => {
  assert.equal(ABOVE_TAB_BAR_STICKY_CLASS, "max-tab:bottom-[" + TAB_BAR_HEIGHT_PX + "px]", "the shell's offset is unchanged: the tab bar's height");
  const bar = tokens(POS_MOBILE_BAR_CLASS);
  assert.ok(bar.includes(`max-tab:bottom-[calc(${TAB_BAR_HEIGHT_PX}px+${tabBarInset()})]`), "the bar's phone foot: the tab bar's 59px plus its inset");
  assert.ok(!bar.includes(ABOVE_TAB_BAR_STICKY_CLASS), "not the plain 59px: the taller tab bar would hide the bar's foot");
  assert.equal(bar.filter((t) => t.startsWith("max-tab:bottom-")).length, 1, "one phone foot");
  assert.ok(bar.includes("bottom-0"), "landmark: from 720px it sits on the screen's foot");
});

// U1 Task 7 (values 6.3, 5.1, 0.3 cartW / cartSh / cartLeft; design 6.9): the cart sheet is the HTML's cart section.
// Owner Q19 (2026-10-22): below 1280px it is the PHONE's sheet at every width — the whole screen (fixed, inset 0) over
// the header, the rail and the tab bar (z-index 15 > 12), no side panel, no scrim, no shadow; its left rule stays (the
// HTML's phone content starts at x 1). The HTML's 720-1023px form (440px from the right, --pop, over a --scrim) is gone.
// It slides up from the window's foot (Q19: "niche se open ho"), the phone too: open = translateY(100%) to none over
// .34s on the HTML's sheetIn easing, close = back down over .2s ease-in, keyed on Radix's data-state so the panel stays
// mounted until the close has played (Radix Presence, as the kit's sheet); motion-safe (the app's rule for every
// animation, app/globals.css), transform keyframes only (WebView 109: no @starting-style, no transition-behavior).
test("PIN: the cart sheet is the phone's at every width below 1280px: the whole screen, no scrim, no shadow (owner Q19)", () => {
  const sheet = tokens(POS_CART_SHEET_CLASS);
  for (const t of ["fixed", "inset-0", "z-[15]", "flex", "flex-col", "border-l", "border-border", "bg-card", "outline-none"]) {
    assert.ok(sheet.includes(t), `POS_CART_SHEET_CLASS (owner Q19: the phone's sheet): "${t}"`);
  }
  for (const gone of [
    "inset-y-0",
    "right-0",
    "w-[min(440px,100%)]",
    "[box-shadow:var(--pop)]",
    "max-tab:left-0",
    "max-tab:w-auto",
    "max-tab:[box-shadow:none]",
  ]) {
    assert.ok(!sheet.includes(gone), `the 440px side sheet's "${gone}" is gone (owner Q19)`);
  }
  assert.ok(!sheet.some((t) => /^(?:max-)?(?:sm|md|lg|xl|tab|desk|wide):/.test(t)), "one form at every width below 1280px: no width variant");
  assert.ok(!sheet.some((t) => /shadow/.test(t)), "no shadow at any width");
  for (const gone of ["h-[90vh]", "supports-[height:1dvh]:h-[90dvh]", "rounded-t-xl", "[&>button]:hidden"]) {
    assert.ok(!sheet.includes(gone), `the bottom sheet's ${gone} is gone`);
  }
  assert.ok(!("POS_CART_SHEET_WIDTH_PX" in layout), "the side sheet's 440px width constant is gone (owner Q19)");
  assert.equal(POS_CART_SHEET_SCRIM_CLASS, "hidden", "no scrim at any width (owner Q19): the overlay is never drawn");
});

test("PIN: the cart sheet slides up from the window's foot and back down (owner Q19): .34s on the HTML's sheetIn easing, .2s ease-in, motion-safe, transform keyframes only", () => {
  const sheet = tokens(POS_CART_SHEET_CLASS);
  assert.ok(sheet.includes("motion-safe:data-[state=open]:animate-cart-sheet-up"), "open: the slide up, keyed on Radix's data-state");
  assert.ok(sheet.includes("motion-safe:data-[state=closed]:animate-cart-sheet-down"), "close: the slide down, so Radix keeps it mounted until it ends");
  assert.equal(sheet.filter((t) => t.includes("animate-")).length, 2, "exactly the two slides");
  assert.ok(!sheet.some((t) => /(?:^|:)(?:transition|duration-|ease-|starting:)/.test(t)), "no transition, no @starting-style (WebView 109)");
  const css = readFileSync(path.join(CAFE_ROOT, "app/globals.css"), "utf8");
  assert.ok(
    css.includes("--animate-cart-sheet-up: cart-sheet-up 0.34s cubic-bezier(0.2, 0.8, 0.2, 1) backwards;"),
    "open: .34s on the HTML's sheetIn easing cubic-bezier(.2,.8,.2,1); it fills backwards only, so the settled sheet keeps no transform",
  );
  assert.ok(css.includes("--animate-cart-sheet-down: cart-sheet-down 0.2s ease-in both;"), "close: .2s ease-in, held at the foot until unmounted");
  const frames = (name: string): string => {
    const m = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`));
    assert.ok(m, `app/globals.css declares @keyframes ${name}`);
    return m![1].replace(/\s+/g, " ").trim();
  };
  assert.equal(frames("cart-sheet-up"), "from { transform: translateY(100%); } to { transform: none; }", "up: from below the window's foot to its place");
  assert.equal(frames("cart-sheet-down"), "from { transform: none; } to { transform: translateY(100%); }", "down: from its place to below the foot");
  assert.ok(!/@starting-style|transition-behavior/.test(css), "WebView 109: no @starting-style and no transition-behavior anywhere");
});

// The page fills the screen and main runs to its foot (values 6.2), so the bar is no in-flow row under the grid: it lies
// over the page's foot, inside the page (relative) — the page runs from the nav's edge to the window's right edge and
// foot, so the bar's box is the HTML's fixed one (posOrderBarInsetsPx) and follows the nav by itself — where main's
// bottom padding keeps it clear. U1 Task 7: the HTML's glass bar (values 6.1), shown below 1024px only; owner Q19: below
// 1280px (max-xl:flex), the owner's Q18 "always shows" holding there too.
test("PIN: POS_MOBILE_BAR_CLASS is the HTML's glass bar lying over the page's foot (absolute inside the page), shown below 1280px only (owner Q19)", () => {
  const bar = tokens(POS_MOBILE_BAR_CLASS);
  for (const t of ["absolute", "inset-x-0", "bottom-0", "hidden", "max-xl:flex"]) assert.ok(bar.includes(t), `POS_MOBILE_BAR_CLASS must include ${t}`);
  assert.ok(bar.includes("data-open:hidden"), "values 6.1 showBar (!cartOpen): the bar steps aside while its sheet is open");
  assert.ok(tokens(POS_PAGE_CLASS).includes("relative"), "the page is the bar's containing block");
  assert.ok(!bar.includes("sticky"), "no in-flow sticky row: main runs under it");
  assert.ok(!bar.includes("fixed"), "inside the page, beside the nav (the page's box is the HTML's fixed box)");
  assert.ok(!bar.some((t) => /^-?m[xyb]?-/.test(t)), "no margins of its own");
  for (const t of [
    "z-10",
    "items-center",
    "gap-3",
    "border-t",
    "border-border",
    "bg-glass",
    "px-3.5",
    "py-2.5",
    "leading-[normal]",
    "[backdrop-filter:saturate(180%)_blur(20px)]",
    "[-webkit-backdrop-filter:saturate(180%)_blur(20px)]",
  ]) {
    assert.ok(bar.includes(t), `values 6.1 bar: "${t}"`);
  }
  const button = tokens(POS_MOBILE_BAR_BUTTON_CLASS);
  for (const t of ["h-11", "rounded-[10px]", "bg-primary", "text-primary-foreground", "px-5", "text-[15px]", "font-semibold", "cursor-pointer"]) {
    assert.ok(button.includes(t), `values 6.1 Review order: "${t}"`);
  }
  assert.ok(!button.some((t) => t.startsWith("pointer-coarse:") || t.includes("hover:")), "the HTML's button on touch screens too (ruling R1), and it has no hover rule");
});

test("PIN: the cart is a column from 1280px (xl, owner Q19), the category column from the HTML's 1100px (desk), never md or lg", () => {
  assert.ok(tokens(POS_CART_CLASS).includes("xl:flex") && tokens(POS_CART_CLASS).includes("hidden"), "the cart column shows from 1280px (owner Q19)");
  assert.ok(tokens(POS_ASIDE_CLASS).includes("desk:flex") && tokens(POS_ASIDE_CLASS).includes("hidden"), "the category column shows from 1100px");
  for (const [label, cls] of [["POS_CART_CLASS", POS_CART_CLASS], ["POS_ASIDE_CLASS", POS_ASIDE_CLASS]] as const) {
    assert.ok(!cls.includes("md:"), `${label} must not switch at md`);
    assert.ok(!cls.includes("lg:"), `${label} must not switch at lg (owner Q19 retired the 1024px cart column)`);
  }
});

// U1 Task 2: the category list switches at 1100px between the column (POS_ASIDE_CLASS) and the toolbar's Category
// button + sheet (CategorySidebar.tsx, desk:hidden; pinned in lib/pos-layout-paths.test.ts); the chip strip and the rail
// constants went with it. U1 Task 7: the bar carries its own switch, so its wrapper's 1100px gate (POS_MOBILE_ONLY_CLASS)
// went with the wrapper. Owner Q19: that switch is 1280px (max-xl:flex), the cart column's xl:flex.
test("PIN: exactly one cart and one category list show at any width — the column and the bar switch at 1280px (owner Q19), the category column and the Category button at 1100px", () => {
  const bar = tokens(POS_MOBILE_BAR_CLASS);
  assert.ok(bar.includes("hidden") && bar.includes("max-xl:flex"), "the bar shows exactly where the cart column does not (below xl, owner Q19)");
  assert.ok(tokens(POS_CART_CLASS).includes("xl:flex"), "the cart column's own switch is the same xl");
  assert.ok(!bar.some((t) => /^(?:xl|desk|wide|lg|max-lg):/.test(t)), "no other width gate on the bar: no xl:, desk:, wide:, lg: or max-lg: token");
  assert.ok(!readFileSync(path.join(CAFE_ROOT, "lib/pos-layout.ts"), "utf8").includes("export const POS_MOBILE_ONLY_CLASS"), "the wrapper's gate is gone");
  assert.ok(tokens(POS_ASIDE_CLASS).includes("desk:flex"), "the category column shows from 1100px");
});

test("PIN: the cart sheet's scrollable panel and the HTML's lines wrapper carry the right utility classes", () => {
  assert.match(POS_CART_SHEET_PANEL_CLASS, /(^|\s)h-full(\s|$)/, "POS_CART_SHEET_PANEL_CLASS must include h-full");
  assert.match(POS_CART_SHEET_PANEL_CLASS, /overflow-y-auto/, "POS_CART_SHEET_PANEL_CLASS must include overflow-y-auto");
  // U1 Task 4 (values 5.4, 0.3 linesMin): the HTML's lines wrapper — it grows into the cart's free height and never
  // shrinks below its lines (flex 1 0 auto), keeps 150px (180px on a phone), 14px sides; the whole cart scrolls as one
  // (Cart's root), so the wrapper has no scroller of its own (D9.8's 192px floor for a scrolling list went with it).
  assert.equal(
    POS_CART_LIST_CLASS,
    "flex-[1_0_auto] min-h-[150px] px-3.5 leading-[normal] max-tab:min-h-[180px]",
    "values 5.4 lines wrapper: flex 1 0 auto, min-height linesMin (150 / 180 below 720px), padding 0 14px",
  );
  for (const gone of ["overflow-y-auto", "overscroll-contain", "min-h-48"]) {
    assert.ok(!POS_CART_LIST_CLASS.includes(gone), `POS_CART_LIST_CLASS must not carry ${gone}: the cart scrolls as one`);
  }
});
