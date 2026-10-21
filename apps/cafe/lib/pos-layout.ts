// The POS terminal's (/pos) layout contract. Its frame is the owner's HTML Order screen (U1 Task 1, 2026-10-21;
// docs/superpowers/specs/2026-10-20-pos-html-values.md values 1.1, 2.0, 6.2; design 5): the page fills the screen
// under the shell's 56px header and never scrolls; the HTML's body grid holds the category column (from 1100px), the
// menu column and the cart column (from 1024px; below it the cart is a sheet behind the bar), and each region scrolls
// on its own. CB-1's frame (the two-pane switch at 1280px, its stacked phone column and the root's floor) is retired
// with its constants.
//
// One place for the class strings and numbers the page renders. Everything here is a plain literal (POS_PAGE_CLASS
// also reads lib/shell-layout.ts's literal), so Tailwind's source scanner sees every class name, and the pins
// (lib/pos-frame, lib/pos-layout, lib/pos-layout-paths, lib/pos-layout-compile and lib/pos-header-paths tests) read
// the SAME constants the page renders instead of re-typing them.
import { MAIN_PADDING_BLEED_CLASS } from "@/lib/shell-layout";

// Tailwind's default viewport breakpoints (px), pinned so the layout test can
// compute the pane-width matrix without importing Tailwind.
export const BREAKPOINT_SM_PX = 640;
export const BREAKPOINT_MD_PX = 768;
export const BREAKPOINT_LG_PX = 1024;
export const BREAKPOINT_XL_PX = 1280;
export const BREAKPOINT_2XL_PX = 1536;
/** The HTML's `desk` (values 0.2; Tailwind `desk:`, app/globals.css): the category column from 1100 px. The HTML's
 *  `cmp` ends at BREAKPOINT_LG_PX (Tailwind `lg:`): the cart is a column from 1024 px, a sheet below. */
export const BREAKPOINT_DESK_PX = 1100;

// The dashboard nav (components/ui/sidebar.tsx SIDEBAR_WIDTH /
// SIDEBAR_WIDTH_ICON — parity-pinned by lib/pos-layout-paths.test.ts), the
// owner's HTML (values 2.1 rootCols, U0 Task 2): the 232 px sidebar from
// 1280 px while not collapsed, the 76 px rail from 720 px (and on a collapsed
// desktop), and no nav below 720 px (a phone; the nav is an overlay sheet).
export const SIDEBAR_WIDTH_REM = 14.5;
export const SIDEBAR_WIDTH_ICON_REM = 4.75;
export const NAV_WIDTH_WIDE_PX = 232;
export const NAV_WIDTH_RAIL_PX = 76;
/** The HTML's `ph` ends here: the rail shows from 720 px (Tailwind `tab:`). */
export const NAV_RAIL_MIN_PX = 720;
/** The HTML's `wide`: the full sidebar from 1280 px (Tailwind `xl:`), unless collapsed. */
export const NAV_WIDE_MIN_PX = BREAKPOINT_XL_PX;

export interface NavViewport {
  viewportWidth: number;
  collapsed: boolean;
}

/** The nav is the wide sidebar (else the rail, or nothing on a phone). */
export function isWideNav({ viewportWidth, collapsed }: NavViewport): boolean {
  return viewportWidth >= NAV_WIDE_MIN_PX && !collapsed;
}

/** The in-flow width the nav takes at this viewport. */
export function navWidthPx(viewport: NavViewport): number {
  if (viewport.viewportWidth < NAV_RAIL_MIN_PX) return 0;
  return isWideNav(viewport) ? NAV_WIDTH_WIDE_PX : NAV_WIDTH_RAIL_PX;
}

/** The POS terminal's route. */
export const POS_PATH = "/pos";

/** The route is the POS terminal (or a page below it, the alert strip's rule in lib/alert-bar-scope.ts): the shell
 *  then draws the HTML's Order header (values 1.2) instead of the title header. */
export function isPosPath(pathname: string): boolean {
  return pathname === POS_PATH || pathname.startsWith(`${POS_PATH}/`);
}

/** The shell's header (components/layout/Header.tsx): the HTML's 56px (values 1.2; U0 values 2.5). */
export const DASHBOARD_HEADER_REM = 3.5;

// The amber RequestAlertBar sits in flow between the header and <main>, so the
// page cannot know its height from CSS alone. The bar publishes its own
// offsetHeight (px) on <html> under this custom property — synchronously in a
// layout effect so the first frame is right, then via a ResizeObserver as its
// content wraps — and removes it whenever it renders nothing. The strip is
// suppressed on /pos (lib/alert-bar-scope.ts), so the term is 0 there today;
// the page's height still subtracts it, so it stays right if the strip shows.
export const POS_ALERT_HEIGHT_VAR = "--pos-alert-h";

/** The HTML's body columns (values 2.0 bodyCols), px: the category column and the cart beside the wide nav, beside the
 *  rail from 1100 px, and the cart alone from 1024 px; the menu column takes the rest (minmax(0,1fr)). */
export const POS_BODY_COLUMNS_PX = {
  wide: { aside: 200, cart: 360 },
  desk: { aside: 220, cart: 380 },
  tablet: { aside: 0, cart: 340 },
} as const;

/** The body grid's columns at this viewport, px (values 2.0's measured grid-template-columns). */
export function posBodyColumnsPx(viewport: NavViewport): number[] {
  const content = viewport.viewportWidth - navWidthPx(viewport);
  if (viewport.viewportWidth < BREAKPOINT_LG_PX) return [content];
  if (viewport.viewportWidth < BREAKPOINT_DESK_PX) return [content - POS_BODY_COLUMNS_PX.tablet.cart, POS_BODY_COLUMNS_PX.tablet.cart];
  const { aside, cart } = isWideNav(viewport) ? POS_BODY_COLUMNS_PX.wide : POS_BODY_COLUMNS_PX.desk;
  return [aside, content - aside - cart, cart];
}

// The page (values 1.1): exactly the screen under the 56px header — `vh` the
// base every browser understands, `dvh` where it exists (the visible
// viewport; with interactive-widget=resizes-content the on-screen keyboard
// shrinks it) — bleeding over <main>'s padding at every width, so its edges
// are the screen's (on a phone it runs under the 59px tab bar to the window's
// foot, as the HTML's). It never scrolls: the regions below scroll on their
// own, so there is no floor. `relative`: the phone/tablet cart bar lies over
// its foot.
export const POS_PAGE_CLASS = `${MAIN_PADDING_BLEED_CLASS} relative h-[calc(100vh-3.5rem-var(--pos-alert-h,0px))] supports-[height:1dvh]:h-[calc(100dvh-3.5rem-var(--pos-alert-h,0px))]`;

/** The HTML's body grid (values 2.0): one menu column below 1024 px; the cart column from 1024 px; the category column
 *  from 1100 px (220 + 380 beside the rail, 200 + 360 beside the wide nav). It fills the page. */
export const POS_BODY_GRID_CLASS =
  "grid h-full min-h-0 grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_340px] desk:grid-cols-[220px_minmax(0,1fr)_380px] wide:grid-cols-[200px_minmax(0,1fr)_360px]";

/** The category column (values 2.1): from 1100 px, the surface with a rule on its right. */
export const POS_ASIDE_CLASS = "hidden min-h-0 flex-col border-r border-border bg-card desk:flex";

/** The menu column's bottom padding (values 6.2 mainPadB), px: room for the order bar and the tab bar on a phone, for
 *  the bar below 1024 px, 16 px beside the cart column. */
export const POS_MAIN_PAD_B_PX = { phone: 150, cmp: 100, base: 16 } as const;

export function posMainPadBottomPx(viewportWidth: number): number {
  if (viewportWidth < NAV_RAIL_MIN_PX) return POS_MAIN_PAD_B_PX.phone;
  return viewportWidth < BREAKPOINT_LG_PX ? POS_MAIN_PAD_B_PX.cmp : POS_MAIN_PAD_B_PX.base;
}

/** The menu column (values 3.1 main): the HTML's one scroller, a block with `min-width:0` and its bottom padding; the
 *  toolbar sticks at its top and the list scrolls under it (U1 Task 2). */
export const POS_MAIN_CLASS = "min-h-0 min-w-0 overflow-auto pb-4 max-lg:pb-[100px] max-tab:pb-[150px]";

/** The toolbar (values 3.1, 0.3 toolPad): sticky at the top of the menu column, over the cards (z-index 3), on the
 *  page's --bg, 14px 20px 4px (10px 12px 4px on a phone). It holds the search row and, below 1100px, the Category
 *  button (components/pos/ProductGrid.tsx). The HTML sets no line-height on this screen: normal. */
export const POS_TOOLBAR_CLASS =
  "sticky top-0 z-[3] bg-background px-5 pt-3.5 pb-1 leading-[normal] max-tab:px-3 max-tab:pt-2.5";

/** The list wrapper under the toolbar (values 3.1, 0.3 listPad): 16px 20px, 14px 12px on a phone. */
export const POS_LIST_CLASS = "px-5 py-4 max-tab:px-3 max-tab:py-3.5";

/** The list wrapper's side padding, px (POS_LIST_CLASS's px-5 / max-tab:px-3): the inset the grid's tile arithmetic
 *  subtracts from the menu column. */
export const POS_PANE_INSET_PX = { phone: 12, base: 20 } as const;

/** Today's control row (PosHeader: open tabs, table, customer, KOT) has no place in the HTML's menu column; until U1
 *  Tasks 4 and 6 move its controls into the cart head and the header, it sits above the toolbar with the toolbar's side
 *  inset and top padding, and scrolls away with the list. */
export const POS_CONTROLS_CLASS = "px-5 pt-3.5 max-tab:px-3 max-tab:pt-2.5";

/** The cart column (values 5.1): from 1024 px the body grid's last column, the surface with a rule on its left; it
 *  scrolls on its own. Below 1024 px the cart is MobileCartBar's sheet (U1 Task 7 gives it the HTML's sheet). */
export const POS_CART_CLASS =
  "relative z-[15] hidden min-h-0 flex-col overflow-y-auto overflow-x-hidden overscroll-contain border-l border-border bg-card lg:flex";

// The bar's wrapper gate (MobileCartBar; POS_MOBILE_BAR_CLASS hides the bar itself from 1024 px). The category
// column and the toolbar's Category button switch at 1100 px on their own (POS_ASIDE_CLASS, CategorySidebar.tsx).
export const POS_MOBILE_ONLY_CLASS = "desk:hidden";

// Bottom cart bar (below 1024 px, where the cart is not a column): it lies
// over the page's foot — absolute inside the page, which ends at the screen's
// foot — so the menu column keeps its full height and keeps the bar clear with
// its own bottom padding (values 6.2). On a phone it sits 59px up
// (lib/shell-layout.ts ABOVE_TAB_BAR_STICKY_CLASS), on the tab bar. It hides
// from 1024 px, where the cart column takes over (its own gate, since
// POS_MOBILE_ONLY_CLASS switches at 1100 px).
export const POS_MOBILE_BAR_CLASS =
  "absolute inset-x-0 bottom-0 max-tab:bottom-[59px] z-20 border-t bg-background p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden";
export const POS_MOBILE_BAR_BUTTON_CLASS =
  "flex h-12 w-full items-center justify-between touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";

// Cart bottom sheet height: `vh` base, `dvh` where supported (with
// interactive-widget=resizes-content, set in the dashboard layout, the
// on-screen keyboard then shrinks the sheet and its scroll region scrolls the
// focused input into view).
export const POS_CART_SHEET_CLASS =
  "h-[90vh] rounded-t-xl p-0 supports-[height:1dvh]:h-[90dvh] [&>button]:hidden";
// The Cart INSIDE that sheet scrolls as one panel: when the sheet is shorter
// than header + list + notes + footer (phone landscape; portrait with the
// keyboard up) the footer's inputs and CTAs must stay reachable by scrolling
// instead of overflowing past the sheet's bottom edge (review CB-1 F3).
export const POS_CART_SHEET_PANEL_CLASS =
  "h-full overflow-y-auto overscroll-contain rounded-none border-0";
// The cart's line list keeps at least this much height before the panel
// itself starts scrolling — otherwise flex shrinks the list to 0 first and
// the operator sees a cart with no items in it. The Cart root scrolls in BOTH
// mounts (Cart.tsx), so on a short desktop window the footer is reached by
// scrolling the card rather than overflowing it. No overscroll-contain here:
// a drag that runs out of list must chain to the panel so the CTAs come up.
export const POS_CART_LIST_CLASS = "min-h-48 flex-1 overflow-y-auto p-2";

// The /pos header's room rule (design 6.1; components/layout/PosHeaderBrand.tsx measures, ruling R6's pattern): our
// header buttons the HTML has no place for (Refresh in the apps, Tokens when on) take the actions box's width; when
// it would get narrower than the switch-order button's minimum, the brand text hides first, then the clock block.
/** The HTML's header gap (values 1.2). */
export const POS_HEADER_GAP_PX = 16;
/** The switch-order button's narrowest (values 1.2, design 6.1: its code tile and count pill stay whole): 1 + 6 left
 *  padding + the 30px tile + 10 + 10 (the text column at 0) + the "N open" pill (8 + 37.34 + 8) + 10 + the 16px
 *  chevron + 10 right padding + 1 = 147.34, rounded up. */
export const POS_SWITCH_MIN_PX = 148;
/** 0: everything shows; 1: the brand text is out; 2: the clock block is out too. */
export type PosHeaderRoom = 0 | 1 | 2;

/** The room level for the measured widths: the actions box now (at the current level), and the brand text and the
 *  clock block (0 when the width hides them anyway). The box's width with everything shown is worked back from the
 *  current level, so the answer is the same whichever level it is measured at (nothing flaps). */
export function posHeaderRoom(m: { room: PosHeaderRoom; actionsWidth: number; brandWidth: number; clockWidth: number }): PosHeaderRoom {
  const freedByBrand = m.brandWidth;
  const freedByClock = m.clockWidth > 0 ? m.clockWidth + POS_HEADER_GAP_PX : 0;
  const allShown = m.actionsWidth - (m.room >= 1 ? freedByBrand : 0) - (m.room >= 2 ? freedByClock : 0);
  if (allShown >= POS_SWITCH_MIN_PX) return 0;
  if (allShown + freedByBrand >= POS_SWITCH_MIN_PX) return 1;
  return 2;
}

// D9.8 (owner decision 2026-09-26) — the cart's more-actions control and the
// panel it opens. The occasional money controls (reward, promo, discount, the
// GST preset, extra charges) moved off the always-visible footer stack and
// behind this one button; components/pos/CartMoreMenu.tsx carries the full why.
//
// D9.8b (owner decision 2026-09-26): the three-dot glyph ALONE, no "More"
// label, sitting at the END of the collapsed note row — so the menu costs the
// footer no row of its own. Hence a SQUARE 44px target rather than the earlier
// full-width bar: 44px is the comfort floor these screens are built to, and it
// compacts to 32px only on an xl+ FINE pointer (the POS_HEADER_CONTROL_CLASS
// idiom — keying the SHRINK on a fine pointer is cascade-proof where a coarse
// re-floor would depend on emission order, CB-1d.1 V1), so glass never gets a
// smaller target than touch.
export const POS_CART_MORE_BUTTON_CLASS =
  "flex h-11 w-11 shrink-0 items-center justify-center text-muted-foreground xl:pointer-fine:h-8 xl:pointer-fine:w-8 touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";
// The panel the More button opens. Width is capped to the viewport so it can
// never overhang a phone screen, and the height cap + scroll keeps its
// contents reachable when the reward ladder is long or the on-screen keyboard
// is up — vh base with a dvh override, the POS_DIALOG_LIST_CAP_CLASS pattern,
// for exactly the reason given there.
export const POS_CART_MORE_PANEL_CLASS =
  "w-[min(20rem,calc(100vw-1.5rem))] max-h-[60vh] overflow-y-auto p-3 supports-[height:1dvh]:max-h-[60dvh]";

// Instant-tap feel (CB-1d.1 L1): no double-tap-zoom delay, no long-press text
// selection, and a compositor-only pressed state (scale/opacity — never paint)
// gated to coarse pointers, which have no hover to carry feedback. Duplicated
// VERBATIM inside the interactive tokens below (the scanner and the string
// pins need plain literals); a paths pin keeps every copy in sync. Never on
// an input.
export const POS_PRESS_FEEDBACK_CLASS =
  "touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";

// Header controls (Table / Customer / Open tabs / KOT / Move table): 40px tall
// with 14px text wherever a finger might tap; the compact 32px / 12px
// `size="sm"` look returns at xl+ only behind `pointer-fine:` — keying the
// SHRINK on a fine pointer is cascade-proof where a coarse re-floor would
// depend on emission order, so glass never gets smaller targets at any width
// (CB-1d.1 V1). tailwind-merge lets these override the size variant.
export const POS_HEADER_CONTROL_CLASS =
  "h-10 text-sm xl:pointer-fine:h-8 xl:pointer-fine:text-xs touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";
// Below xl the header is ONE non-wrapping row, so only one control may
// flex-shrink and truncate — the customer chip (names are the long values).
// The table / move-table chip is content-sized (capped at 7rem so an
// operator-typed table name cannot starve the customer chip), both chips
// drop their leading icon below xl, and Open tabs shows icon + count only:
// review CB-1 F10 probed a 360px header down to two visible glyphs per chip
// when both chips shared the leftover width. Budget at 360px (328px row):
// KOT 40 + tabs ~68 + table ≤112 + 3 gaps 24 = ≤244 → customer ≥84px.
export const POS_HEADER_CHIP_FIXED_CLASS = "shrink-0 max-w-28 xl:max-w-none";
export const POS_HEADER_CHIP_FLEX_CLASS = "min-w-0 flex-1 xl:flex-none";
export const POS_HEADER_CHIP_ICON_CLASS = "hidden h-4 w-4 xl:block";

// Product grid columns are decided by VIEWPORT breakpoints + the sidebar's
// state (ProductGrid reads useSidebar()), which together determine the grid
// pane's real width — chosen in CB-1b over a container query, and kept in
// CB-1c because the tiers are plain data the pins can verify (the browser-
// floor reason CB-1b gave was wrong). Below 720 px the nav is an overlay,
// so both strings agree there. Every tier keeps tiles ≥ POS_MIN_TILE_PX for
// pane = the HTML's menu column minus the pane's inset (U1 Task 1; the
// matrix pin in lib/pos-layout.test.ts derives exactly that).
// AT MOST 3 COLUMNS (owner decision 2026-09-29, UI batch 1 §H — supersedes
// the old "no 5-column tier: the ≥1536 desktop keeps its v1 four columns"):
// once a tier reaches 3 it never grows further, so BOTH tables collapse to
// two rows (a base 2-column tier, then 3 from `sm` up) — the old lg/xl/2xl
// entries (4, 3-again, 4) and the collapsed md/xl entries (4, 4) are simply
// redundant with the sm:3 tier now and are dropped rather than kept at a
// value the owner capped.
// U1 Task 1: from 1100 px the category column and the 380 px cart leave the
// menu 384-563 px beside the rail, too narrow for three tiles (122 px at
// 1100), so two columns there; three again from 1280 px. U1 Task 3 replaces
// these tiers with the HTML's auto-fill cards.
export const POS_GRID_CLASS_SIDEBAR_EXPANDED =
  "grid grid-cols-2 gap-2 sm:grid-cols-3 desk:grid-cols-2 xl:grid-cols-3";
export const POS_GRID_CLASS_SIDEBAR_COLLAPSED =
  "grid grid-cols-2 gap-2 sm:grid-cols-3 desk:grid-cols-2 xl:grid-cols-3";
export const POS_GRID_GAP_REM = 0.5;
// The same tiers as data (viewport px → columns), for the layout pins' tile-
// width matrix. Keep in step with the two class strings above (the test
// asserts each string encodes exactly its table). Both sidebar states share
// the same table now that neither ever exceeds 3 columns.
export const POS_GRID_COLUMN_TIERS_SIDEBAR_EXPANDED: ReadonlyArray<{ minPx: number; cols: number }> = [
  { minPx: 0, cols: 2 },
  { minPx: BREAKPOINT_SM_PX, cols: 3 },
  { minPx: BREAKPOINT_DESK_PX, cols: 2 },
  { minPx: BREAKPOINT_XL_PX, cols: 3 },
];
export const POS_GRID_COLUMN_TIERS_SIDEBAR_COLLAPSED: ReadonlyArray<{ minPx: number; cols: number }> = [
  { minPx: 0, cols: 2 },
  { minPx: BREAKPOINT_SM_PX, cols: 3 },
  { minPx: BREAKPOINT_DESK_PX, cols: 2 },
  { minPx: BREAKPOINT_XL_PX, cols: 3 },
];

/** The columns the POS grid shows at this viewport (the tier table its class string encodes). */
export function posGridColumns({ viewportWidth, collapsed }: NavViewport): number {
  const tiers = collapsed ? POS_GRID_COLUMN_TIERS_SIDEBAR_COLLAPSED : POS_GRID_COLUMN_TIERS_SIDEBAR_EXPANDED;
  let cols = tiers[0].cols;
  for (const tier of tiers) if (tier.minPx <= viewportWidth) cols = tier.cols;
  return cols;
}

/** The grid pane's width: the HTML's menu column (posBodyColumnsPx: the viewport minus the nav, the category column
 *  and the cart column) minus the list wrapper's side padding. */
export function posGridPaneWidthPx(viewport: NavViewport): number {
  const columns = posBodyColumnsPx(viewport);
  const menu = columns.length === 3 ? columns[1] : columns[0];
  const inset = viewport.viewportWidth < NAV_RAIL_MIN_PX ? POS_PANE_INSET_PX.phone : POS_PANE_INSET_PX.base;
  return menu - 2 * inset;
}
// Tile-internal geometry (ProductGrid markup, parity-pinned): what's left of
// a tile after card padding, thumb, row gap and the options-button reserve is
// the product-name box; the matrix pin floors it at POS_MIN_NAME_BOX_PX
// (= the 1280/expanded/coarse tier's 136px tile — the CB-1d.1 V3 trade-off,
// 40px button ⇒ pr-9, accepted at arbitration g1).
export const POS_TILE_CARD_PADDING_PX = 10;
export const POS_TILE_THUMB_PX = 40;
export const POS_TILE_ROW_GAP_PX = 8;
export const POS_MIN_NAME_BOX_PX = 32;
// Coarse lower bound on tile width ("menu nahi dikh raha"). NOTE: at 128px
// the name box would be only 24px (128 − 20 pad − 40 thumb − 8 gap − 36
// reserve), BELOW the enforced 32px name floor — so with pr-9 the BINDING
// constraint is the nameBox >= POS_MIN_NAME_BOX_PX matrix pin (tightest real
// tier: 136px tile), and this constant is the retained secondary bound.
export const POS_MIN_TILE_PX = 128;

// Touch targets: cart qty steppers / remove (36px, compacting to 28px only on
// an xl+ FINE pointer) and the tile's "add with note" corner button — 40px now
// (CB-1d.1 V3: 32px sat under every comfort bar), same pointer-fine compact.
export const POS_CART_STEPPER_CLASS =
  "h-9 w-9 xl:pointer-fine:h-7 xl:pointer-fine:w-7 touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";
export const POS_TILE_OPTIONS_BUTTON_CLASS =
  "h-10 w-10 xl:pointer-fine:h-8 xl:pointer-fine:w-8 touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";
// Title clearance for that button: 40px + 4px inset − 10px card padding =
// 34px ⇒ pr-9 (pr-7 was sized for the 32px button the same way).
export const POS_TILE_OPTIONS_RESERVE_CLASS = "pr-9 xl:pointer-fine:pr-7";
// Primary/secondary cart CTAs: 48px on touch; `size="lg"`'s 40px only at
// xl + FINE pointer (glass keeps 48px — the V1 invariant is uniform, g4).
export const POS_CART_CTA_CLASS =
  "w-full h-12 xl:pointer-fine:h-10 touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";

// CB-2 — the cart's "GST Discount" preset toggle: the 36px control tier (the
// stepper's), full width, compacting to 32px only on an xl+ FINE pointer.
export const POS_CART_GST_BUTTON_CLASS =
  "h-9 w-full xl:pointer-fine:h-8 touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";

// Dialog list caps (CB-1d.1 V2, the CB-1c residual): a plain-vh cap ignores
// the URL bar / on-screen keyboard, pushing a capped list — and the dialog's
// escape buttons — off a keyboard-shrunk phone viewport. vh base + dvh
// override (POS_CART_SHEET_CLASS pattern); 60vh pickers, 50vh Move table.
export const POS_DIALOG_LIST_CAP_CLASS = "max-h-[60vh] supports-[height:1dvh]:max-h-[60dvh]";
export const POS_MOVE_TABLE_LIST_CAP_CLASS = "max-h-[50vh] supports-[height:1dvh]:max-h-[50dvh]";

// The (dashboard) layout mounts <TouchFeel /> (components/shared/TouchFeel.tsx),
// which publishes this attribute on <html> while the staff dashboard is mounted
// (POS_ALERT_HEIGHT_VAR's publish/remove pattern). globals.css keys its touch-
// feel rules on it: dialogs/sheets portal to <body>, out of reach of in-flow
// wrapper classes, and /m — which never mounts the publisher — stays untouched.
export const POS_TOUCH_ATTR = "data-pos-touch";
