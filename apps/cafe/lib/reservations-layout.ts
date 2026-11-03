// The Reservations page's (/reservations) layout contract. U6 Task 1 (2026-11-03): the owner's HTML Reservations screen
// (docs/superpowers/specs/2026-11-02-reservations-html-values.md 1 layout, 2 header, 3 toolbar, 4 status select, 9.1 empty
// box, 9.2 search; design docs/superpowers/specs/2026-11-03-reservations-match-html-design.md 5, 6.1, 6.2, 6.5, B1 - B3,
// B9, B23): the page leaves MenuPageShell and fills the screen under the shell's 56px header like /orders and /kitchen,
// never scrolling itself; its body grid holds the list column and, from 1280px (the owner's rule of 2026-10-22), the 400px
// detail column (Task 3). The list column is a named container (`reslist`) OUTSIDE the scroller, so the table / cards switch
// (Task 2: the table from a 904px column, B1) reads the column's own width.
//
// One place for the class strings the page renders. Everything here is a plain literal (RESERVATIONS_PAGE_CLASS also reads
// lib/pos-layout.ts's POS_PAGE_CLASS), so Tailwind's source scanner sees every class name, and the pins
// (lib/reservations-layout.test.ts) read the SAME constants the page renders. Later tasks append their sections.
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { FLOOR_FOCUS_RING_CLASS } from "@/lib/floor-tile-classes";
import { POS_PAGE_CLASS } from "@/lib/pos-layout";

/** The Reservations page's route. */
export const RESERVATIONS_PATH = "/reservations";

/** The route is the Reservations page (or a page below it): the shell then draws the HTML's Reservations header (the quick
 *  links from 1280px only, B9) and the toasts clear the bottom inset (B8). */
export function isReservationsPath(pathname: string): boolean {
  return pathname === RESERVATIONS_PATH || pathname.startsWith(`${RESERVATIONS_PATH}/`);
}

/** The page (values 1.1, design 5, B2): the /pos frame (exactly the screen under the 56px header and the alert strip,
 *  bleeding over <main>'s padding) as the HTML's flex column that never scrolls: the body below fills it. */
export const RESERVATIONS_PAGE_CLASS = `${POS_PAGE_CLASS} flex flex-col overflow-hidden`;

/** The body grid (values 1.1; owner rule 2026-10-22): the list column alone below 1280px; from 1280px the list and the
 *  400px detail column (the HTML docks from 1024px). It fills the page; the one row stretches to its height. */
export const RES_BODY_CLASS = "grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_400px]";

/** The list column (values 1.2, B2): a flex column that may shrink, holding the scroller; the named container `reslist`,
 *  so the rows' form switches at the column's own width (`@[904px]/reslist:`, Task 2), measured here OUTSIDE the scroller:
 *  a classic scrollbar in the scroller can never narrow what is measured. The HTML sets no line-height here: normal. */
export const RES_LIST_COLUMN_CLASS = "@container/reslist flex min-h-0 min-w-0 flex-col leading-[normal]";

/** The list scroller (values 1.2, 0.3 pagePad / screenPadB): the page's only scroll for the list; padding 20px 24px 28px
 *  from 720px, 16px 14px 92px on a phone (the tab bar covers its last 59px), each foot growing by the safe-area inset at
 *  every width (U1 P49); the children 12px apart (the HTML's column gap); U3's thin 8px bar (the Floor scroller's four
 *  classes). `overflow-x-clip`, never hidden (WebView 109). */
export const RES_SCROLLER_CLASS =
  "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-clip pt-5 px-6 pb-[calc(28px+env(safe-area-inset-bottom))] max-tab:pt-4 max-tab:px-3.5 max-tab:pb-[calc(92px+env(safe-area-inset-bottom))] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar-thumb]:rounded-[8px] [&::-webkit-scrollbar-thumb]:bg-border";

// ── The header's action (values 2) ──────────────────────────────────────────────────────────────────────────────────────

/** "New reservation" / "New" (values 2): the accent button the header slot's rule already draws (36px, radius 8, 0 14px,
 *  13.5px / 600, the 14px plus at 2.4, hover --accent-h); the classes name it so a page outside the slot (the body row on a
 *  narrow phone, B9) keeps the look. */
export const RES_ADD_CLASS = "h-9 flex-none gap-1.5 rounded-[8px] bg-primary px-3.5 py-0 text-[13.5px] font-semibold hover:bg-primary-hover";

/** The title block's floor on a phone (B9): the measured width of the word "Reservations" in the header's 15px / 600 Geist title (93.95px, rounded up), so the
 *  title never cuts: with Tokens on, when the title block would keep less than this beside the button, the button drops to
 *  the body row. */
export const RES_PHONE_TITLE_MIN_PX = 94;

// ── The toolbar (values 3, 4, 9.2; design 6.2, B3, B23) ─────────────────────────────────────────────────────────────────

/** One wrapping row, 8px apart; it scrolls with the list (not sticky) and never shrinks inside the scroller's column. */
export const RES_TOOLBAR_CLASS = "flex flex-none flex-wrap items-center gap-2";
/** The day group: the day box and, on another day, the Today button, 6px apart; it never shrinks. */
export const RES_DAY_GROUP_CLASS = "flex flex-none items-center gap-1.5";
/** The day box (values 3): 38px, radius 9, 1px --border on --surface; clipped (`overflow-clip`, WebView 109) so the
 *  buttons' hover fills keep its corners. */
export const RES_DAY_BOX_CLASS = "flex h-[38px] items-center overflow-clip rounded-[9px] border border-border bg-card";
/** ‹ and › (values 3): 36px wide and as high as the box's inside, --text-2, hover --hover (where a pointer hovers); our
 *  keyboard ring sits inside the box (nothing clips it). */
export const RES_DAY_STEP_CLASS = `flex h-full w-9 flex-none cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted-foreground pointer-fine:hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${HTML_PRESS_CLASS}`;
/** The day label, the popover's trigger (values 3): between two 1px --border-2 rules, 0 12px, 13.5px / 600, the 15px
 *  calendar 8px from the words. */
export const RES_DAY_LABEL_CLASS = `flex h-full cursor-pointer items-center gap-2 border-y-0 border-x border-border-2 bg-transparent px-3 text-[13.5px] font-semibold whitespace-nowrap text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${HTML_PRESS_CLASS}`;
/** "Today" (values 3): 38px, radius 9, 1px --border, 0 12px, 13px / 600, hover --hover. */
export const RES_TODAY_CLASS = `h-[38px] flex-none cursor-pointer rounded-[9px] border border-border bg-card px-3 text-[13px] font-semibold text-foreground pointer-fine:hover:bg-hover ${FLOOR_FOCUS_RING_CLASS} ${HTML_PRESS_CLASS}`;
/** A row of the day popover ("All dates"): the Orders date box's row look (36px, radius 8, 13.5px / 500). */
export const RES_DAY_ROW_CLASS =
  "flex h-9 w-full cursor-pointer items-center justify-between gap-3 rounded-[8px] border-0 bg-transparent px-2.5 text-left text-[13.5px] font-medium whitespace-nowrap text-foreground hover:bg-hover";
/** The popover's calendar cells: DatePicker's touch-friendly 40px (7 columns of 40 + the Calendar's own padding = 304px),
 *  as the Orders date box. */
export const RES_CALENDAR_CELL_CLASS = "[--cell-size:2.5rem]";
/** Keeps the day popover off the screen's edge on a phone (DatePicker's and the Orders date box's gap). */
export const RES_POPOVER_EDGE_GAP_PX = 12;
/** The status select's cell (values 4): 190px from 720px; on a phone it flexes with the B3 floor of 116.81px (the
 *  smallest width the HTML measures at 360), and the select and the search toggle wrap to a second row when the day group,
 *  the select and the toggle do not fit. */
export const RES_STATUS_SELECT_CLASS = "min-w-0 flex-[0_0_190px] max-tab:min-w-[116.81px] max-tab:flex-[1_1_0px]";

/** The search box (values 9.2): 38px, radius 9, 1px --border on --surface, 0 10px, 8px apart; from 720px it takes the
 *  row's rest (flex 1 1 220, 180 to 340); on a phone it is a full row of its own (B3), shown only while the toggle is on.
 *  The input is the HTML's 14px (16px below 720, B23: no iOS zoom); the HTML draws no focus style and our keyboard users
 *  need one: the box lights while its input has the focus. */
export const RES_SEARCH_CLASS =
  "flex h-[38px] min-w-[180px] max-w-[340px] flex-[1_1_220px] items-center gap-2 rounded-[9px] border border-border bg-card px-2.5 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/25 max-tab:max-w-none max-tab:basis-full";
export const RES_SEARCH_INPUT_CLASS =
  "h-5 min-w-0 flex-1 border-0 bg-transparent px-0.5 py-px text-[16px] tab:text-[14px] text-foreground outline-none placeholder:text-subtle-foreground [&::-webkit-search-cancel-button]:hidden";
/** Clear search (values 9.2): 22px round, --surface-3, the ✕ 10px; 44px hit area on touch (R1), drawn by an ::after. */
export const RES_SEARCH_CLEAR_CLASS =
  "relative flex size-[22px] flex-none cursor-pointer items-center justify-center rounded-[50%] border-0 bg-surface-3 p-0 text-[10px] text-muted-foreground pointer-coarse:after:absolute pointer-coarse:after:-inset-[11px]";
/** The phone's Search toggle (values 9.2): a 38px square, 1px --border, radius 9; its border turns --text while the box is
 *  open or a query exists. */
export const RES_SEARCH_TOGGLE_CLASS = `relative flex size-[38px] flex-none cursor-pointer items-center justify-center rounded-[9px] border bg-card p-0 text-foreground tab:hidden ${FLOOR_FOCUS_RING_CLASS} ${HTML_PRESS_CLASS}`;

// ── The states (design 6.5) ─────────────────────────────────────────────────────────────────────────────────────────────

/** The list card (values 8.1): --surface, 1px --border, radius 12, clipped; it never shrinks inside the scroller. */
export const RES_LIST_CARD_CLASS = "flex-none overflow-clip rounded-[12px] border border-border bg-card";
/** The skeleton's rows: five 60px bars in the list card, a rule between them. */
export const RES_SKELETON_ROW_CLASS = "flex h-[60px] items-center gap-3 border-b border-border-2 px-4 last:border-b-0";
/** The offline line (P5), in the HTML's empty style: one line, centred, 13px --text-2. */
export const RES_OFFLINE_CLASS = "px-4 py-14 text-center text-[13px] text-muted-foreground";
/** The HTML's empty box (values 9.1): a dashed 1.5px --border (drawn 1px), radius 14, 56px 16px, centred, 6px apart, on
 *  --surface; the 46px tile in --res-t / --res-i, the 15px / 600 title, the 13px --text-2 line (320px, balanced), and
 *  "+ New reservation" 38px. */
export const RES_EMPTY_BOX_CLASS =
  "flex flex-none flex-col items-center gap-1.5 rounded-[14px] border-[1.5px] border-dashed border-border bg-card px-4 py-14 text-center";
export const RES_EMPTY_TILE_CLASS = "mb-1.5 flex size-[46px] items-center justify-center rounded-[12px] bg-status-reserved-tint text-status-reserved-ink";
export const RES_EMPTY_TITLE_CLASS = "text-[15px] font-semibold text-foreground [overflow-wrap:anywhere]";
export const RES_EMPTY_TEXT_CLASS = "max-w-[320px] text-[13px] text-muted-foreground [text-wrap:pretty]";
export const RES_EMPTY_BUTTON_CLASS = `mt-2.5 h-[38px] cursor-pointer rounded-[9px] border border-border bg-card px-4 text-[13.5px] font-semibold text-foreground pointer-fine:hover:bg-hover ${FLOOR_FOCUS_RING_CLASS} ${HTML_PRESS_CLASS}`;

// ── The detail column (Task 3 fills it; design 5, 7) ────────────────────────────────────────────────────────────────────

/** The body grid's second track from 1280px (the owner's rule of 2026-10-22): 400px, --surface with a 1px --border rule on
 *  its left, a flex column that scrolls in parts. Below 1280px it is not drawn (the detail opens full screen from the
 *  bottom, Task 3). */
export const RES_DETAIL_COLUMN_CLASS = "relative z-[1] hidden min-h-0 min-w-0 flex-col border-l border-border bg-card xl:flex";
