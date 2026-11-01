// The Menu's layout contract (/products and /categories). U5 Task 1 (2026-11-01): the owner's HTML Menu screen
// (docs/superpowers/specs/2026-10-31-menu-printer-html-values.md 0.2 breakpoints, 0.3 pagePad / screenPadB, 1.2 regions,
// 2 header, 3 rail, 4 toolbar, 4.7 empty box; design docs/superpowers/specs/2026-10-31-menu-printer-match-html-design.md
// 5 layout, 6.1-6.3 header / rail / toolbar, 6.8 states; owner Q1, Q5, Q8): both pages fill the screen under the shell's
// 56px header like /pos, /orders, /tables and /kitchen (the paper frame goes), never scroll themselves; the Items body is
// a grid, the 240px rail from a 1000px page box and the list column the only scroller.
//
// One place for the class strings the pages render, so Tailwind's source scanner sees each one and the pins
// (lib/menu-layout.test.ts) read the SAME constants the pages render. Task 2 adds the table / card rows inside the list
// column; Tasks 3-5 the editors, /categories rows and the printer panel.
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { FLOOR_FOCUS_RING_CLASS } from "@/lib/floor-tile-classes";
import { FLOOR_TAB_ON_CLASS } from "@/lib/floor-layout";
import { MENU_CATEGORIES_PATH, MENU_ITEMS_PATH } from "@/lib/menu-sections";
import { POS_PAGE_CLASS } from "@/lib/pos-layout";

/** Both Menu routes, and a path below either: the shell then draws the HTML's Menu header (quick links from 1280px only,
 *  owner Q8), and the toasts clear the bottom inset (design 6.6). */
export function isMenuPagePath(pathname: string): boolean {
  return [MENU_ITEMS_PATH, MENU_CATEGORIES_PATH].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The page (values 1.1, design 5): the /pos frame (the screen under the 56px header and the alert strip, bleeding over
 *  <main>'s padding) as a flex column that never scrolls itself: the refresh strip above, the body below. It is the query
 *  container the rail, the category select and the Category column ask (`@[1000px]/menu:`): a container cannot query
 *  itself, so it is the page and not the body grid (the HTML's `cw` is the page's width, values 0.2). */
export const MENU_PAGE_CLASS = `${POS_PAGE_CLASS} @container/menu flex flex-col overflow-hidden`;

/** The Items body (values 0.2 `cols`): one column, the 240px rail track from a 1000px page box. It fills the page under
 *  the strip; the rail and the list column scroll on their own. */
export const MENU_BODY_CLASS =
  "grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] @[1000px]/menu:grid-cols-[240px_minmax(0,1fr)]";

/** The list column, the page's only scroller (values 0.3 pagePad / screenPadB, 1.2): padding 20px 24px 28px from 720px,
 *  16px 14px 92px on a phone (the tab bar covers its last 59px), each foot growing by the safe-area inset at every width
 *  (U1 P49), the children 12px apart (the HTML's column gap), U3's 8px scrollbar (the Floor scroller's four classes).
 *  `overflow-x-clip`, never hidden (WebView 109). The HTML sets no line-height here: normal. */
export const MENU_LIST_SCROLLER_CLASS =
  "flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overflow-x-clip leading-[normal] pt-5 px-6 pb-[calc(28px+env(safe-area-inset-bottom))] max-tab:pt-4 max-tab:px-3.5 max-tab:pb-[calc(92px+env(safe-area-inset-bottom))] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar-thumb]:rounded-[8px] [&::-webkit-scrollbar-thumb]:bg-border";

// ── The header's view switch and Add (values 2) ───────────────────────────────────────────────────────────────────────
// A page's actions sit in the header's actions slot, whose unlayered button rule (app/globals.css [data-header-actions],
// ruling R6) outranks every utility and would give each link U0's 36px height, radius 8, 13.5px and a 7px gap; the values
// that differ from the HTML's switch button are made important here (the Kitchen's tabs, lib/kitchen-layout.ts). The rest
// the rule gives alike (padding 0 12px, 500, nowrap, the 15px / 1.8 icon, the HTML's transition and press).

/** The track: --surface-3, radius 9, padding 3, 2px between the links, 36px; never shrinking. */
export const MENU_VIEW_SWITCH_CLASS = "flex h-9 flex-none gap-0.5 rounded-[9px] bg-surface-3 p-[3px]";
/** A link: radius 7, padding 0 12px, 13px, the icon 7px from the label; no height of its own (the track's 30px inside).
 *  U3's inset keyboard ring and the HTML's press. */
export const MENU_VIEW_LINK_CLASS = `flex h-auto! min-h-auto! cursor-pointer items-center gap-[7px]! whitespace-nowrap rounded-[7px]! border-0 px-3 py-0 text-[13px]! outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${HTML_PRESS_CLASS}`;
/** The lit link: SEG_ON (U3's chip), --text, 600. */
export const MENU_VIEW_LINK_ON_CLASS = `${FLOOR_TAB_ON_CLASS} font-semibold! text-foreground`;
/** The other: transparent, --text-2, 500 (no hover in the HTML; the kit's --hover where a pointer can hover, as U4). */
export const MENU_VIEW_LINK_OFF_CLASS = "bg-transparent font-medium text-muted-foreground pointer-fine:hover:bg-hover";

/** Add item / Add category: the accent button the slot's rule already draws (36px, radius 8, 0 14px, 13.5px / 600, the
 *  14px plus 2.4, hover --accent-h); the classes name it so a page outside the slot (the body row) keeps the look. */
export const MENU_ADD_CLASS = "h-9 flex-none gap-1.5 rounded-[8px] bg-primary px-3.5 py-0 text-[13.5px] font-semibold hover:bg-primary-hover";

// ── The toolbar (values 4) ────────────────────────────────────────────────────────────────────────────────────────────

/** The toolbar: wraps, 8px apart. Never shrinks inside the scroller's column. */
export const MENU_TOOLBAR_CLASS = "flex flex-none flex-wrap items-center gap-2";
/** Its first group: the search (flex 1 1 240) with the phone's buttons beside it. */
export const MENU_TOOLBAR_START_CLASS = "flex min-w-0 flex-[1_1_240px] items-center gap-2";
/** Its second group: `display: contents` from 720px so the selects join the toolbar row; on a phone the Filters wrap
 *  (hidden until opened). */
export const MENU_TOOLBAR_WRAP_CLASS = "min-w-0 flex-[1_1_auto] flex-wrap gap-2 tab:contents";

/** The search box (values 4.2): 38px, radius 9, 1px --border on --surface, 0 10px, 8px apart. The input is the HTML's
 *  14px (16px below 720: no iOS zoom), no focus ring of its own; the box lights on keyboard focus (ours: the HTML draws
 *  none and our keyboard users need one). */
export const MENU_SEARCH_CLASS =
  "flex h-[38px] min-w-0 flex-1 items-center gap-2 rounded-[9px] border border-border bg-card px-2.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25";
export const MENU_SEARCH_INPUT_CLASS =
  "h-5 min-w-0 flex-1 border-0 bg-transparent px-0.5 py-px text-[16px] tab:text-[14px] text-foreground outline-none placeholder:text-subtle-foreground [&::-webkit-search-cancel-button]:hidden";
/** Clear search: 22px round, --surface-3, the ✕ 10px. 44px hit area on touch (ruling R1: our control has no size of its
 *  own in the HTML beyond the 22px), drawn by an ::after so the box does not grow. */
export const MENU_SEARCH_CLEAR_CLASS =
  "relative flex size-[22px] flex-none cursor-pointer items-center justify-center rounded-[50%] border-0 bg-surface-3 p-0 text-[10px] text-muted-foreground pointer-coarse:after:absolute pointer-coarse:after:-inset-[11px]";

/** A select (values 4.3, 4.4), the kit's trigger in the HTML's look: 38px, radius 9, 1px --border, --surface, 13.5px / 500,
 *  the padding 0 32px 0 34px that leaves room for the left icon (a sibling, 11px in) and the chevron (14px, 11px from the
 *  right, --text-2, drawn over the trigger's own icon slot). */
export const MENU_SELECT_TRIGGER_CLASS =
  "relative h-[38px] w-full cursor-pointer rounded-[9px] border border-border bg-card py-0 pl-[34px] pr-8 text-[13.5px] font-medium text-foreground [&>svg]:absolute [&>svg]:right-[11px] [&>svg]:top-3 [&>svg]:size-3.5 [&>svg]:text-muted-foreground [&>svg]:opacity-100";
/** The category select's cell (page box < 1000 and >= 720: `@[1000px]/menu:hidden`; never on a phone: the chips). */
export const MENU_CATEGORY_SELECT_CLASS = "max-tab:hidden @[1000px]/menu:hidden min-w-0 flex-[1_1_180px]";
/** The filter select's cell: 200px; on a phone it shares the wrap (1 1 160). */
export const MENU_FILTER_SELECT_CLASS = "min-w-0 flex-[1_1_160px] tab:flex-[0_0_200px]";

/** Import CSV (values 4.4 Veg slot; owner Q5): the outline 38px button from 720px, the icon square below. */
export const MENU_IMPORT_CLASS =
  `flex h-[38px] flex-none cursor-pointer items-center gap-[7px] rounded-[9px] border border-border bg-card px-3 text-[13.5px] font-medium text-foreground pointer-fine:hover:bg-hover ${FLOOR_FOCUS_RING_CLASS} ${HTML_PRESS_CLASS}`;
/** The phone's 38px square buttons (Filters, Select, Import: values 4.5): 1px --border, radius 9; lit = --text border and
 *  --surface-3. */
export const MENU_ICON_BUTTON_CLASS =
  `relative flex size-[38px] flex-none cursor-pointer items-center justify-center rounded-[9px] border border-border bg-card p-0 text-foreground ${FLOOR_FOCUS_RING_CLASS} ${HTML_PRESS_CLASS}`;
export const MENU_ICON_BUTTON_ON_CLASS = "border-foreground bg-surface-3";
/** The Filters badge: the number of active filters, top right. */
export const MENU_FILTER_BADGE_CLASS =
  "absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] bg-primary px-[5px] text-[10.5px] font-bold text-primary-foreground";

// ── The phone's category chips (values 4.5) ───────────────────────────────────────────────────────────────────────────
/** The strip: 6px apart, sideways scroll with no bar, edge to edge (-14px / +14px, as the HTML), and never collapsing to
 *  nothing (the HTML's does, values 23.3: not copied). Not drawn from 720px. */
export const MENU_CHIPS_CLASS =
  "-mx-3.5 flex flex-none gap-1.5 overflow-x-auto px-3.5 tab:hidden [contain:inline-size] [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
export const MENU_CHIP_CLASS =
  `flex h-8 flex-none cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[999px] border px-3 text-[13px] font-medium ${FLOOR_FOCUS_RING_CLASS} ${HTML_PRESS_CLASS}`;
export const MENU_CHIP_ON_CLASS = "border-ink bg-ink text-on-ink";
export const MENU_CHIP_OFF_CLASS = "border-border bg-card text-foreground";

// ── The rail (values 3) ───────────────────────────────────────────────────────────────────────────────────────────────
/** The aside: from a 1000px page, a flex column with its own scroller, a 1px right border, --surface, 12px 10px. */
export const MENU_RAIL_CLASS =
  "hidden @[1000px]/menu:flex min-h-0 flex-col overflow-y-auto border-r border-border bg-card px-2.5 py-3 leading-[normal]";
/** A row: 36px and never shrinking (the HTML's 22.4px is a slip, values 23.2), radius 8, 0 10px, 13.5px, 9px apart; --hover
 *  where a pointer can hover, also on the chosen row (the HTML's). */
export const MENU_RAIL_ROW_CLASS =
  `flex h-9 w-full flex-none cursor-pointer items-center rounded-[8px] border-0 bg-transparent px-2.5 py-0 text-left text-[13.5px] text-foreground pointer-fine:hover:bg-hover ${FLOOR_FOCUS_RING_CLASS} ${HTML_PRESS_CLASS}`;
export const MENU_RAIL_ROW_ON_CLASS = "bg-status-info-tint text-status-info-ink font-semibold";
export const MENU_RAIL_ROW_OFF_CLASS = "font-medium";
/** The row's content: one full-width flex row inside the button (WebView 109: a flex button's children do not stretch). */
export const MENU_RAIL_ROW_INNER_CLASS = "flex w-full min-w-0 items-center gap-[9px]";
export const MENU_RAIL_SOLD_OUT_CLASS =
  "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[9px] bg-status-bad-tint px-[5px] text-[10.5px] font-bold text-status-bad-ink";
export const MENU_RAIL_COUNT_CLASS = "min-w-[22px] text-right text-xs text-subtle-foreground";

// ── The title row and the states (values 4.6, 4.7) ────────────────────────────────────────────────────────────────────
/** "All items · 71 items": baseline-aligned, 10px apart, 0 2px; from 720px. */
export const MENU_TITLE_ROW_CLASS = "flex flex-none items-baseline justify-between gap-2.5 px-0.5 max-tab:hidden";
export const MENU_TITLE_CLASS = "min-w-0 truncate text-[15px] font-semibold text-foreground";
export const MENU_TITLE_COUNT_CLASS = "flex-none text-[12.5px] text-muted-foreground";

/** The HTML's empty box, our guided empties in it too (values 4.7): a dashed 1.5px --border (drawn 1px in Chrome), radius
 *  14, 56px 16px, centred, the 44px tile and two lines. */
export const MENU_EMPTY_BOX_CLASS =
  "flex flex-none flex-col items-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-border bg-card px-4 py-14 text-center";
export const MENU_EMPTY_TILE_CLASS = "mb-1.5 flex size-11 items-center justify-center rounded-[12px] bg-surface-3 text-muted-foreground";
export const MENU_EMPTY_TITLE_CLASS = "text-[15px] font-semibold text-foreground";
export const MENU_EMPTY_SUB_CLASS = "text-[13px] text-muted-foreground";

/** The skeleton in the list's shape (design 6.8): the white list box (radius 12, 1px --border, clipped) of row-high bars. */
export const MENU_SKELETON_LIST_CLASS = "flex-none divide-y divide-border-2 overflow-clip rounded-[12px] border border-border bg-card";
export const MENU_SKELETON_ROW_CLASS = "flex items-center gap-2.5 px-3.5 py-2.5";
