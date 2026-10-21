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
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { ABOVE_TAB_BAR_STICKY_CLASS, PHONE_PAGE_FOOT_PX, TAB_BAR_HEIGHT_PX } from "./shell-layout";

import {
  BREAKPOINT_LG_PX,
  BREAKPOINT_XL_PX,
  BREAKPOINT_DESK_PX,
  NAV_RAIL_MIN_PX,
  navWidthPx,
  posBodyColumnsPx,
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
  POS_MOBILE_ONLY_CLASS,
  POS_TOOLBAR_CLASS,
  POS_LIST_CLASS,
  POS_CONTROLS_CLASS,
  POS_MOBILE_BAR_CLASS,
  POS_CART_SHEET_CLASS,
  POS_CART_SHEET_PANEL_CLASS,
  POS_CART_LIST_CLASS,
  POS_CARD_GRID_CLASS,
  POS_CARD_MIN_PX,
  POS_CARD_GAP_PX,
} from "@/lib/pos-layout";

const REM_PX = 16;
const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);

type SidebarState = "expanded" | "collapsed";
const SIDEBAR_STATES: ReadonlyArray<SidebarState> = ["expanded", "collapsed"];

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
  for (const gone of ["POS_PANE_CLASS", "POS_PANE_FLOOR_PX", "POS_CHIP_CLASS", "POS_CHIP_ROW_CLASS", "POS_DESKTOP_ONLY_CLASS"]) {
    assert.ok(!readFileSync(path.join(CAFE_ROOT, "lib/pos-layout.ts"), "utf8").includes(`export const ${gone}`), `lib/pos-layout.ts no longer exports ${gone}`);
  }
  // Today's control row (until U1 Tasks 4 and 6) sits above the toolbar with the toolbar's own side inset.
  const controls = tokens(POS_CONTROLS_CLASS);
  for (const t of ["px-5", "pt-3.5", "max-tab:px-3", "max-tab:pt-2.5"]) assert.ok(controls.includes(t), `POS_CONTROLS_CLASS lines up with the toolbar: "${t}"`);
});

// U1 Task 3 (values 4.3, design 5 "The grid is repeat(auto-fill,...)"): the HTML's grid decides the columns from the
// menu column's width, so the 2026-09-29 cap of three columns (UI batch 1 §H, made for the old tile) gives way to it.
test("PIN: the card columns follow the menu column's width as the HTML's: two beside the cart, three at 820px, one on a phone, more on a wider screen", () => {
  assert.equal(posCardColumns(paneWidthPx(1280, "expanded")), 2, "1280px, nav open: 2 columns (values 4.3)");
  assert.equal(posCardColumns(paneWidthPx(1280, "collapsed")), 2, "1280px, nav collapsed: 2 columns (values 4.3)");
  assert.equal(posCardColumns(paneWidthPx(1024)), 2, "1024px: 2 columns (values 4.3)");
  assert.equal(posCardColumns(paneWidthPx(820)), 3, "820px: 3 columns (values 4.3)");
  assert.equal(posCardColumns(paneWidthPx(390)), 1, "a phone: 1 column (values 4.3)");
  assert.equal(posCardColumns(paneWidthPx(1100)), 1, "1100px beside the rail: the 384px menu holds one 200px track");
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
