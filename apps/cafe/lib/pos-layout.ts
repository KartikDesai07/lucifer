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
import { MAIN_PADDING_BLEED_CLASS, TAB_BAR_HEIGHT_PX } from "@/lib/shell-layout";

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

/** The list wrapper under the toolbar (values 3.1, 0.3 listPad): 16px 20px, 14px 12px on a phone. The HTML sets no
 *  line-height on the cards, group headings or messages inside it: normal (values 0.5). */
export const POS_LIST_CLASS = "px-5 py-4 leading-[normal] max-tab:px-3 max-tab:py-3.5";

/** The list wrapper's side padding, px (POS_LIST_CLASS's px-5 / max-tab:px-3): the inset the card grid's arithmetic
 *  subtracts from the menu column (posGridPaneWidthPx). */
export const POS_PANE_INSET_PX = { phone: 12, base: 20 } as const;

/** The cart column (values 5.1): from 1024 px the body grid's last column, the surface with a rule on its left; it
 *  scrolls on its own. Below 1024 px the cart is MobileCartBar's sheet (the HTML's, U1 Task 7; below). */
export const POS_CART_CLASS =
  "relative z-[15] hidden min-h-0 flex-col overflow-y-auto overflow-x-hidden overscroll-contain border-l border-border bg-card lg:flex";

// Below 1024 px (where the cart is not a column) the owner's HTML puts the cart behind its glass order bar and opens it
// as a sheet (U1 Task 7; values 6.1-6.3, 0.3 obLeft / obBottom / cartW / cartSh; design 6.9; owner Q18). The category
// column and the toolbar's Category button switch at 1100 px on their own (POS_ASIDE_CLASS, CategorySidebar.tsx).

/** The order bar (values 6.1): a 1px top rule, 10px of padding above and below the 44px "Review order" — 65px. */
export const POS_ORDER_BAR_HEIGHT_PX = 65;

/** Where the order bar sits (values 0.3 obLeft / obBottom; design 8): from the nav's edge (the 76px rail from 720px, the
 *  window's edge on a phone) to the window's right edge; on a phone ON the 59px tab bar (the HTML leaves 1px of the menu
 *  between them: not copied), from 720px on the window's foot. Null from 1024px: the cart is a column, no bar. */
export function posOrderBarInsetsPx(viewport: NavViewport): { left: number; bottom: number } | null {
  if (viewport.viewportWidth >= BREAKPOINT_LG_PX) return null;
  return { left: navWidthPx(viewport), bottom: viewport.viewportWidth < NAV_RAIL_MIN_PX ? TAB_BAR_HEIGHT_PX : 0 };
}

// The order bar (values 6.1): the HTML's glass strip — --glass behind a saturate(180%) blur(20px), a 1px --border rule
// on top, 10px 14px, its two lines and "Review order" 12px apart, centred; z-index 10, under the tab bar's 12 (they
// never overlap). It lies over the page's foot — absolute inside the page, which runs from the nav's edge to the
// window's right edge and foot, so its box is the HTML's fixed one (posOrderBarInsetsPx) and follows the nav by itself
// — and the menu column keeps it clear with its own bottom padding (values 6.2). On a phone it sits 59px up
// (lib/shell-layout.ts ABOVE_TAB_BAR_STICKY_CLASS), on the tab bar. It shows below 1024px only, in every state (owner
// Q18: an empty order too) except while its sheet is open (data-open; values 6.1 showBar: !cartOpen — at 820 the sheet
// and the scrim leave the page's foot bare). The HTML sets no line-height here: normal.
export const POS_MOBILE_BAR_CLASS =
  "absolute inset-x-0 bottom-0 max-tab:bottom-[59px] z-10 hidden items-center gap-3 border-t border-border bg-glass px-3.5 py-2.5 leading-[normal] [backdrop-filter:saturate(180%)_blur(20px)] [-webkit-backdrop-filter:saturate(180%)_blur(20px)] max-lg:flex data-open:hidden";
/** "Review order" (values 6.1): 44px, radius 10, --accent with --on-accent, 0 20px, 15px 600; no hover rule. The HTML's
 *  press comes from BRAND_PRESS_CLASS (MobileCartBar), as on the cart's Send KOT and Pay. */
export const POS_MOBILE_BAR_BUTTON_CLASS =
  "h-11 cursor-pointer rounded-[10px] bg-primary px-5 text-[15px] font-semibold text-primary-foreground";

/** The cart sheet's width from 720px (values 0.3 cartW: min(440px,100%)). */
export const POS_CART_SHEET_WIDTH_PX = 440;
/** The sheet's scrim (values 5.1 cart scrim, 720-1023px): the whole window, the rail and the header too, --scrim at
 *  z-index 14 under the sheet, the HTML's fadeIn; a tap on it closes the sheet. None on a phone (the sheet fills it). */
export const POS_CART_SHEET_SCRIM_CLASS = "fixed inset-0 z-[14] bg-scrim motion-safe:animate-scrim-in max-tab:hidden";
/** The cart sheet (values 6.3, 5.1): the HTML's cart section, fixed from the window's top to its foot at z-index 15 (over
 *  the tab bar's 12), on --surface with its 1px --border rule on the left: 440px from the right with the --pop shadow
 *  from 720px; on a phone the whole screen (left 0, the rule still drawn at x 0) with no shadow, over the header and the
 *  tab bar. No entrance animation. The HTML sets no line-height on the cart: normal. */
export const POS_CART_SHEET_CLASS =
  "fixed inset-y-0 right-0 z-[15] flex w-[min(440px,100%)] flex-col border-l border-border bg-card font-sans leading-[normal] text-foreground outline-none [box-shadow:var(--pop)] max-tab:left-0 max-tab:w-auto max-tab:[box-shadow:none]";
// The Cart INSIDE that sheet scrolls as one panel, as the HTML's cart section does: when the sheet is shorter than the
// head + the lines' floor + the footer (phone landscape; portrait with the keyboard up) the footer's inputs and buttons
// stay reachable by scrolling instead of overflowing past the sheet's bottom edge (review CB-1 F3).
export const POS_CART_SHEET_PANEL_CLASS =
  "h-full overflow-y-auto overscroll-contain rounded-none border-0";
// The HTML's lines wrapper (values 5.4, 0.3 linesMin; U1 Task 4): it grows into the cart's free height and never
// shrinks below its lines (flex 1 0 auto), keeps 150px (180px on a phone) so the empty state has room, 14px sides.
// It has no scroller of its own: the Cart root scrolls in BOTH mounts (Cart.tsx), as the HTML's cart does, so on a
// short window the footer is reached by scrolling the cart rather than overflowing it. The HTML sets no line-height.
export const POS_CART_LIST_CLASS = "flex-[1_0_auto] min-h-[150px] px-3.5 leading-[normal] max-tab:min-h-[180px]";

// The /pos header's room rule (design 6.1; components/layout/PosHeaderBrand.tsx measures, ruling R6's pattern): our
// header buttons the HTML has no place for (Refresh in the apps, Tokens when on) take the actions box's width; when
// it would get narrower than the switch-order button's minimum, the brand text hides first, then the clock block.
/** The HTML's header gap (values 1.2). */
export const POS_HEADER_GAP_PX = 16;
/** The switch-order button's narrowest before it is measured (values 1.2, design 6.1: its code tile and count pill stay
 *  whole), the HTML's with "8 open": 1 + 6 left padding + the 30px tile + 10 + 10 (the text column at 0) + the pill
 *  (8 + 37.34 + 8) + 10 + the 16px chevron + 10 right padding + 1 = 147.34, rounded up. */
export const POS_SWITCH_MIN_PX = 148;
/** 0: everything shows; 1: the brand text is out; 2: the clock block is out too. */
export type PosHeaderRoom = 0 | 1 | 2;

/** The switch-order button's narrowest, measured (U1 Task 6): the parts that never shrink (the code tile, the pill with
 *  its "N open" words, the chevron: `fixedParts`), a gap between each of the button's children (the text column, at 0
 *  wide, keeps its two), and its paddings and border (`edges`), rounded up — so a two-digit count asks for its own few
 *  pixels more. Read from the parts, never from the button's own width, which the box can squeeze below this. */
export function posSwitchMinPx(m: { fixedParts: number[]; gap: number; edges: number }): number {
  const gaps = m.fixedParts.length * m.gap;
  return Math.ceil(m.fixedParts.reduce((sum, w) => sum + w, 0) + gaps + m.edges);
}

/** The room level for the measured widths: the actions box now (at the current level), the brand text and the clock
 *  block (0 when the width hides them anyway), and the switch button's measured minimum (POS_SWITCH_MIN_PX until it is
 *  measured). The box's width with everything shown is worked back from the current level, so the answer is the same
 *  whichever level it is measured at (nothing flaps). */
export function posHeaderRoom(m: {
  room: PosHeaderRoom;
  actionsWidth: number;
  brandWidth: number;
  clockWidth: number;
  switchMin?: number;
}): PosHeaderRoom {
  const min = m.switchMin ?? POS_SWITCH_MIN_PX;
  const freedByBrand = m.brandWidth;
  const freedByClock = m.clockWidth > 0 ? m.clockWidth + POS_HEADER_GAP_PX : 0;
  const allShown = m.actionsWidth - (m.room >= 1 ? freedByBrand : 0) - (m.room >= 2 ? freedByClock : 0);
  if (allShown >= min) return 0;
  if (allShown + freedByBrand >= min) return 1;
  return 2;
}

// The cart footer's bill rows and the controls inside the Bill options / Note panels (U1 Task 5; values 5.3, 5.5 in
// docs/superpowers/specs/2026-10-20-pos-html-values.md; design 6.7, 6.8; owner Q11, Q12). D9.8's three-dot trigger and
// its panel (2026-09-26) became the links row and the one Bill options panel (components/pos/BillOptionsPanel.tsx);
// these are the looks the bill's rows and the panel's controls share.

/** A bill row (values 5.5 charge rows): the label (with its Remove link) on the left, the amount on the right, 8px apart. */
export const POS_BILL_ROW_CLASS = "flex items-center justify-between gap-2";
/** A bill row's label: its words, then the row's link 8px after them. */
export const POS_BILL_LABEL_CLASS = "flex min-w-0 items-center gap-2";
/** A bill row's amount (values 5.5): --text. */
export const POS_BILL_VALUE_CLASS = "whitespace-nowrap text-foreground";
/** The HTML's "Remove" / "Add back" link in a bill row (values 5.5): 12px --link, no padding (our "Undo" too). */
export const POS_BILL_LINK_CLASS =
  "cursor-pointer whitespace-nowrap bg-transparent p-0 text-[12px] text-link disabled:cursor-not-allowed disabled:opacity-50";

/** A field in the Bill options / Note panels (design 6.7): 34px, radius 8, 13.5px (16px below 720px, ruling R36); on the
 *  kit Input / Textarea it replaces their height, radius and type through tailwind-merge. */
export const POS_PANEL_FIELD_CLASS =
  "h-[34px] rounded-[8px] border-border px-2.5 text-[13.5px] shadow-none md:text-[13.5px] max-tab:text-base";
/** A panel's plain button, the HTML popover's "Move" look (values 5.3): 34px, 1px --border on --surface, radius 8,
 *  0 12px, 13px 500; hover --hover. */
export const POS_PANEL_BUTTON_CLASS =
  "inline-flex h-[34px] cursor-pointer items-center justify-center whitespace-nowrap rounded-[8px] border border-border bg-card px-3 text-[13px] font-medium text-foreground not-disabled:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";
/** A panel's confirming button (Apply, Add), the HTML's small ink button (values 8.3 "Use"): 34px, --ink, --on-ink,
 *  radius 8, 0 12px, 13px 600. */
export const POS_PANEL_PRIMARY_CLASS =
  "inline-flex h-[34px] cursor-pointer items-center justify-center whitespace-nowrap rounded-[8px] border-0 bg-ink px-3 text-[13px] font-semibold text-on-ink disabled:cursor-not-allowed disabled:opacity-50";
/** A panel's pick (a reward rung, a scratch card), the HTML popover's pickup button (values 5.3): a 1px rule, radius 8,
 *  12.5px 500; the chosen one in --ink with --on-ink (POS_PANEL_PICK_ON_CLASS), the others on --surface. */
export const POS_PANEL_PICK_CLASS =
  "flex min-w-0 max-w-full cursor-pointer rounded-[8px] border px-2.5 py-1.5 text-left text-[12.5px] font-medium disabled:cursor-not-allowed";
export const POS_PANEL_PICK_ON_CLASS = "border-ink bg-ink text-on-ink";
export const POS_PANEL_PICK_OFF_CLASS = "border-border bg-card text-foreground not-disabled:hover:bg-hover";
/** A panel's link ("Add promo code", "Add additional charge"): the footer links' --link at 13px 500, a field's 34px row. */
export const POS_PANEL_LINK_CLASS =
  "inline-flex h-[34px] cursor-pointer items-center gap-1.5 self-start bg-transparent p-0 text-[13px] font-medium text-link disabled:cursor-not-allowed disabled:opacity-50";

// Instant-tap feel (CB-1d.1 L1): no double-tap-zoom delay, no long-press text
// selection, and a compositor-only pressed state (scale/opacity — never paint)
// gated to coarse pointers, which have no hover to carry feedback. Duplicated
// VERBATIM inside the interactive tokens below (the scanner and the string
// pins need plain literals); a paths pin keeps every copy in sync. Never on
// an input.
export const POS_PRESS_FEEDBACK_CLASS =
  "touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";

// Header controls (once Open tabs / KOT on /pos: U1 Task 4 moved the table, move and
// customer chips into the cart head's cells, U1 Task 6 the rest into the header's
// switch-order button and its Open orders panel; still the diner PIN reset row): 40px tall
// with 14px text wherever a finger might tap; the compact 32px / 12px
// `size="sm"` look returns at xl+ only behind `pointer-fine:` — keying the
// SHRINK on a fine pointer is cascade-proof where a coarse re-floor would
// depend on emission order, so glass never gets smaller targets at any width
// (CB-1d.1 V1). tailwind-merge lets these override the size variant.
export const POS_HEADER_CONTROL_CLASS =
  "h-10 text-sm xl:pointer-fine:h-8 xl:pointer-fine:text-xs touch-manipulation select-none pointer-coarse:active:scale-[0.97] pointer-coarse:active:opacity-80";
// The customer chip's leading icon (CustomerSearch's own trigger, the payment
// popup's): shown from xl only. The header's table and customer chips (and
// their fixed / flex width classes, review CB-1 F10) became the cart head's
// cells in U1 Task 4 (owner Q9).
export const POS_HEADER_CHIP_ICON_CLASS = "hidden h-4 w-4 xl:block";

// The menu's card grid (values 4.1, 4.3; design 5): the HTML's auto-fill columns, each at least 200px (the whole width
// when the menu is narrower), 8px apart, so the column count follows the menu column's own width — two beside the
// cart, three at 820px, one on a phone, more on a wide screen. U1 Task 3 replaced CB-1b's viewport tiers (keyed by the
// nav's state, capped at three for the old tile) and the old tile's thumbnail-row arithmetic with it.
export const POS_CARD_GRID_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(min(200px,100%),1fr))] gap-2";
/** The grid's track minimum and gap, px (POS_CARD_GRID_CLASS). */
export const POS_CARD_MIN_PX = 200;
export const POS_CARD_GAP_PX = 8;

/** How many cards a row of the grid holds at this width (CSS auto-fill: as many tracks as fit, at least one). */
export function posCardColumns(gridWidthPx: number): number {
  const track = Math.min(POS_CARD_MIN_PX, gridWidthPx);
  return Math.max(1, Math.floor((gridWidthPx + POS_CARD_GAP_PX) / (track + POS_CARD_GAP_PX)));
}

/** A card's width in a grid this wide, px (the 1fr tracks share what the gaps leave). */
export function posCardWidthPx(gridWidthPx: number): number {
  const columns = posCardColumns(gridWidthPx);
  return (gridWidthPx - (columns - 1) * POS_CARD_GAP_PX) / columns;
}

/** The grid pane's width: the HTML's menu column (posBodyColumnsPx: the viewport minus the nav, the category column
 *  and the cart column) minus the list wrapper's side padding. */
export function posGridPaneWidthPx(viewport: NavViewport): number {
  const columns = posBodyColumnsPx(viewport);
  const menu = columns.length === 3 ? columns[1] : columns[0];
  const inset = viewport.viewportWidth < NAV_RAIL_MIN_PX ? POS_PANE_INSET_PX.phone : POS_PANE_INSET_PX.base;
  return menu - 2 * inset;
}

// (The cart's qty stepper / remove touch-target token went with the old cart
// line in U1 Task 4: the HTML's stepper keeps its own 30/28 and 36/34 sizes on
// touch screens too, ruling R1 — components/pos/CartLine.tsx; the tile's
// corner "add with note" button went with the old tile in U1 Task 3.)
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
