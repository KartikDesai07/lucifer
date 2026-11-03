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
import { ORDER_DETAIL_FOOT_CLASS } from "@/lib/orders-layout";
import { POS_PAGE_CLASS } from "@/lib/pos-layout";
import { SHEET_CLOSE_CLASS, SHEET_PANEL_BASE, SHEET_PANEL_CAP_CLASS, SHEET_SCRIM_BASE } from "@/lib/sheet-frame";
import { cn } from "@/lib/utils";

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

// ── The list (U6 Task 2; values 8.1 - 8.4, 16.2; design 6.3, B7, B10, B13, B16) ─────────────────────────────────────────

/** The table form (values 8.2) shows from a 904px list column (B1), the cards below: both are rendered, the container
 *  query (`reslist`, RES_LIST_COLUMN_CLASS) hides one. */
export const RES_TABLE_WRAP_CLASS = "hidden @[904px]/reslist:block";
export const RES_CARDS_WRAP_CLASS = "@[904px]/reslist:hidden";
/** The HTML's cols2 (values 8.2): Time, Guest, Party, Table, Status, Actions; gap 16. */
const RES_TABLE_GRID = "grid grid-cols-[104px_minmax(200px,2fr)_60px_100px_120px_minmax(150px,auto)] items-center gap-4 px-4";
/** The head (values 8.2): 38px, --surface-2, 12.5px / 500 --text-2, a rule below. It sticks at the scroller's top edge (U5
 *  M8: -20px = the scroller's top padding where the table shows, from 720px), not 20px lower as in the HTML. */
export const RES_TABLE_HEAD_CLASS = `sticky top-[-20px] z-[1] ${RES_TABLE_GRID} border-b border-border bg-surface-2 py-2.5 text-[12.5px] font-medium text-muted-foreground`;
/** The rule above every row but the first (values 8.2 / 8.3). */
export const RES_ROW_RULE_CLASS = "border-t border-border-2";
/** The selected row's tint (values 8.4, `--accent-t`). */
export const RES_ROW_SELECTED_CLASS = "bg-status-info-tint";
/** A table row (values 8.2): 12px 16px, centred; hover --hover (it replaces the selected tint; only where a pointer hovers,
 *  R14). The row is not a target: its stretched open button is (B7). */
export const RES_ROW_TABLE_CLASS = `relative cursor-pointer py-3 pointer-fine:hover:bg-hover ${RES_TABLE_GRID}`;
/** A card row (values 8.3): 12px 14px, 12px apart, centred; no hover rule. */
export const RES_ROW_CARD_CLASS = "relative flex cursor-pointer items-center gap-3 px-3.5 py-3";
/** The row's real button (B7), stretched over the row by an ::after layer; the actions sit above it (z-[1]). */
export const RES_OPEN_CLASS =
  "block w-full min-w-0 cursor-pointer border-0 bg-transparent p-0 text-left outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-ring";

/** Dimmed rows (Completed / Cancelled, B16): tokens per part, never opacity (the HTML's .72 fails 4.5:1). */
export const RES_DIM_NAME_CLASS = "text-muted-foreground";
export const RES_DIM_SUB_CLASS = "text-subtle-foreground";

/** The card's time column (values 8.3): 56px, Geist Mono 15 / 600 over the AM / PM in 10.5 / 600 --text-3. */
export const RES_CARD_TIME_CLASS = "w-14 flex-none";
export const RES_CARD_HM_CLASS = "block font-mono text-[15px] font-semibold";
export const RES_CARD_AP_CLASS = "block text-[10.5px] font-semibold text-subtle-foreground";
/** The card's middle (values 8.3): the name 14.5 / 600 (it wraps, Q5 / B10), the sub 12.5 --text-2 (a long table name
 *  wraps), the relative line 12. */
export const RES_CARD_MIDDLE_CLASS = "min-w-0 flex-1";
export const RES_CARD_NAME_CLASS = "text-[14.5px] font-semibold [overflow-wrap:anywhere]";
export const RES_CARD_SUB_CLASS = "block text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]";
/** The card's right column (values 8.3): the pill over the primary, 6px apart, right aligned. */
export const RES_CARD_RIGHT_CLASS = "flex flex-none flex-col items-end gap-1.5";
/** The table's guest cell (values 8.2): the name 14 / 600 (wraps, Q5), the sub-line 12.5 --text-3 on one line with an
 *  ellipsis (B10: the note is whole in the detail). */
export const RES_TABLE_NAME_CLASS = "text-[14px] font-semibold [overflow-wrap:anywhere]";
export const RES_TABLE_SUB_CLASS = "block truncate text-[12.5px] text-subtle-foreground";
/** The relative line (values 19.2): 12px, the tone's ink, the weight the view model names. */
export const RES_RELATIVE_CLASS = "block text-[12px] whitespace-nowrap";
export const RES_RELATIVE_TONE_CLASS = {
  bad: "text-status-bad-ink",
  warn: "text-status-warn-ink",
  accent: "text-status-info-ink",
  muted: "text-subtle-foreground",
  ok: "text-status-ok-ink",
} as const;
export const RES_RELATIVE_WEIGHT_CLASS = { 400: "font-normal", 500: "font-medium", 600: "font-semibold" } as const;

/** The primary button (values 8.2 / 8.3): 32px, radius 8, 0 12px, 600, no wrap; 12.5px on a card, 13px in the table with
 *  6px from the icons and hover opacity .88 (the card has no hover rule). Disabled while a status write runs (B13). */
export const RES_PRIMARY_CLASS = `relative z-[1] inline-flex h-8 flex-none cursor-pointer items-center rounded-[8px] border-0 px-3 font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60 ${FLOOR_FOCUS_RING_CLASS}`;
export const RES_PRIMARY_CARD_CLASS = "text-[12.5px]";
export const RES_PRIMARY_TABLE_CLASS = "ml-1.5 text-[13px] pointer-fine:hover:opacity-[.88]";
/** The primary's colours: ink Seat, accent-tint Open order (bg-card on a selected row, which is already that tint, B16),
 *  surface-3 Book again. */
export function primaryTone(action: "seat" | "openOrder" | "bookAgain", selected: boolean): string {
  if (action === "seat") return "bg-ink text-on-ink";
  if (action === "openOrder") return selected ? "bg-card text-status-info-ink" : "bg-status-info-tint text-status-info-ink";
  return "bg-surface-3 text-foreground";
}
/** A row icon button (values 8.2): 32px, radius 8, hover --surface-3 where a pointer hovers. */
export const RES_ICON_CLASS = `relative z-[1] flex size-8 flex-none cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent p-0 pointer-fine:hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-60 ${FLOOR_FOCUS_RING_CLASS}`;
export const RES_ICONS_CLASS = "flex items-center justify-end gap-0.5";
/** "Assign" (values 8.2): a dashed 28px button, no hover rule. */
export const RES_ASSIGN_CLASS = `relative z-[1] inline-flex h-7 cursor-pointer items-center rounded-[7px] border border-dashed border-subtle-foreground bg-transparent px-[9px] text-[12.5px] font-semibold whitespace-nowrap text-foreground ${FLOOR_FOCUS_RING_CLASS}`;
/** The status pill (values 8.2 / 8.3 / 10.3): 24px in the table, 22px on a card, 26px in the detail; a 6px dot. */
export const RES_PILL_SIZE_CLASS = {
  card: "h-[22px] gap-[5px] px-2 text-[11.5px]",
  table: "h-6 gap-1.5 px-[9px] text-[12px]",
  detail: "h-[26px] gap-1.5 px-2.5 text-[12px]",
} as const;
/** Completed / Cancelled pills (values 8.4): the HTML's --surface-3 on --text-2 (measured rgb(233,233,236)), not the kit's
 *  neutral tint (bg-muted, rgb(242,242,244)); the dot keeps the STATUS_CLASSES neutral (--text-3). */
export const RES_PILL_NEUTRAL_CLASS = "bg-surface-3 text-muted-foreground";

// ── The booking detail (U6 Task 3; values 10.2 - 10.4; design 7, B5, B6, B8, B19) ───────────────────────────────────────

/** "No booking selected" (values 10.2): centred in the column, 6px apart, 13.5px --text-2; the title 600 --text. */
export const RES_DETAIL_NONE_CLASS = "flex min-h-0 flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center text-[13.5px] text-muted-foreground";
export const RES_DETAIL_NONE_TITLE_CLASS = "font-semibold text-foreground";
/** The head (values 10.3): 16px 18px 14px, a --border-2 rule below, its parts 12px apart; it never shrinks. */
export const RES_DETAIL_HEAD_CLASS = "flex flex-none flex-col gap-3 border-b border-border-2 px-[18px] pt-4 pb-3.5";
export const RES_DETAIL_NAME_ROW_CLASS = "flex items-start gap-2.5";
/** The name 18 / 600 -.01em (it wraps, Q5 / B10) over the sub 13 --text-2, 2px apart. */
export const RES_DETAIL_NAME_CLASS = "text-[18px] font-semibold tracking-[-0.01em] [overflow-wrap:anywhere]";
export const RES_DETAIL_SUB_CLASS = "mt-0.5 text-[13px] text-muted-foreground [overflow-wrap:anywhere]";
/** The ✕ (values 10.3, the sheet only, B6): 30px round on --surface-3, 11px --text-2. */
export const RES_DETAIL_CLOSE_CLASS = `flex size-[30px] flex-none cursor-pointer items-center justify-center rounded-[50%] border-0 bg-surface-3 p-0 text-[11px] text-muted-foreground ${FLOOR_FOCUS_RING_CLASS}`;
/** The time banner (values 10.3): 12px 14px, radius 12, --surface-2 on a --border-2 rule; the time Geist Mono 26 / 600 -.78px
 *  (-.03em), the words 13 / 600 right aligned. */
export const RES_BANNER_CLASS = "flex items-center gap-3 rounded-[12px] border border-border-2 bg-surface-2 px-3.5 py-3";
export const RES_BANNER_TIME_CLASS = "flex-none font-mono text-[26px] font-semibold tracking-[-0.78px]";
export const RES_BANNER_TEXT_CLASS = "min-w-0 flex-1 text-right text-[13px] font-semibold [overflow-wrap:anywhere]";
/** "Booked for 7:00 PM", "Completed", "Cancelled" (values 10.3 bnFg): --text-2. */
export const RES_BANNER_PLAIN_CLASS = "text-muted-foreground";
/** The three steps (values 10.3, from 720px): Booked, Seated, Completed. */
export const RES_STEPS_CLASS = "grid grid-cols-3 max-tab:hidden";
export const RES_STEP_CLASS = "flex min-w-0 flex-col gap-1.5";
export const RES_STEP_DOT_CLASS = "size-3 flex-none rounded-[50%]";
export const RES_STEP_LINE_CLASS = "mx-[5px] h-0.5 flex-1";
export const RES_STEP_LABEL_CLASS = "text-[11.5px] font-semibold";
export const RES_STEP_TIME_CLASS = "-mt-1 text-[10.5px] text-subtle-foreground";
/** The facts (values 10.3): rows of 9px 0 with a --border-2 rule, 13.5px; the key --text-2, the value 500 right aligned
 *  (it wraps, B10). */
export const RES_FACTS_CLASS = "flex flex-none flex-col";
export const RES_FACT_ROW_CLASS = "flex justify-between gap-3.5 border-b border-border-2 py-[9px] text-[13.5px]";
export const RES_FACT_KEY_CLASS = "flex-none text-muted-foreground";
export const RES_FACT_VALUE_CLASS = "min-w-0 text-right font-medium [overflow-wrap:anywhere]";
/** "+ Assign a table" (values 10.3, Q1): 38px, a dashed --text-3 rule, radius 9, 13 / 600; no hover rule. */
export const RES_DETAIL_ASSIGN_CLASS = `flex h-[38px] flex-none cursor-pointer items-center justify-center rounded-[9px] border border-dashed border-subtle-foreground bg-transparent text-[13px] font-semibold text-foreground ${FLOOR_FOCUS_RING_CLASS}`;
/** The note (values 10.3): 11px 13px, radius 10, the bill tint, 13.5 / 1.45. */
export const RES_NOTE_CLASS = "flex-none rounded-[10px] bg-status-bill-tint px-[13px] py-[11px] text-[13.5px] leading-[1.45] text-foreground [overflow-wrap:anywhere]";
/** The action grid (values 10.3): auto-fit columns of 64px up, a --border rule, radius 12, clipped; its buttons 60px, the
 *  icon over the short label 5px apart, a --border rule between them, hover --hover (where a pointer hovers). */
export const RES_GRID_CLASS = "grid flex-none grid-cols-[repeat(auto-fit,minmax(64px,1fr))] overflow-clip rounded-[12px] border border-border";
export const RES_GRID_BUTTON_CLASS =
  "flex h-[60px] cursor-pointer flex-col items-center justify-center gap-[5px] border-0 border-l border-border bg-transparent px-1 text-center text-[11.5px] font-semibold first:border-l-0 pointer-fine:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";
/** The footer (values 10.3): U2's foot (12px 18px and the inset below, a --border rule, --surface) as the HTML's flex row, 8px apart:
 *  Edit flex 1 and the primary flex 2, each with the UA's 1px 6px (the HTML's widths are 123.67 / 231.33 of 363: the padding is not part of the share). */
export const RES_DETAIL_FOOT_CLASS = cn(ORDER_DETAIL_FOOT_CLASS, "flex");
/** The footer's Edit (values 10.3): 46px, a --border rule, radius 10, 14 / 600, hover --hover. */
export const RES_EDIT_CLASS = `h-[46px] min-w-0 flex-1 cursor-pointer rounded-[10px] border border-border bg-card px-1.5 py-px text-[14px] font-semibold text-foreground pointer-fine:hover:bg-hover ${FLOOR_FOCUS_RING_CLASS}`;
/** The footer's primary (values 10.3): 46px on --accent, radius 10, 14.5 / 600 --on-accent, hover --accent-h; Seat is off
 *  while a status write runs (B13). */
export const RES_DETAIL_PRIMARY_CLASS = `flex h-[46px] min-w-0 flex-[2] cursor-pointer items-center justify-center rounded-[10px] border-0 bg-primary px-1.5 py-px text-[14.5px] font-semibold text-primary-foreground pointer-fine:hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60 ${FLOOR_FOCUS_RING_CLASS}`;

// ── The seat / assign dialog (U6 Task 3; values 14; design 8.2, B18, B24, B27) ──────────────────────────────────────────

/** z 47 (values 14): over the detail's sheet (15) and the form, under the confirm sheet (50) and the toasts. */
export const RES_SEAT_SCRIM_CLASS = cn(SHEET_SCRIM_BASE, "z-[47]");
/** The box (values 14): up to 560px on --surface, radius 14 (the shared frame: 14 14 0 0 on a phone), 1px --border, the
 *  sheets' caps, clipped (`overflow-clip`, WebView 109), sheetIn .32s. */
export const RES_SEAT_PANEL_CLASS = cn(SHEET_PANEL_BASE, SHEET_PANEL_CAP_CLASS, "max-w-[560px] overflow-clip border border-border motion-safe:animate-html-sheet-in-cs");
export const RES_SEAT_HEAD_CLASS = "flex flex-none items-center gap-2.5 px-4 pt-4 pb-3";
export const RES_SEAT_TITLE_CLASS = "text-[17px] font-semibold [overflow-wrap:anywhere]";
export const RES_SEAT_SUB_CLASS = "mt-0.5 text-[13px] text-muted-foreground [overflow-wrap:anywhere]";
/** The ✕ (values 14): the shared 32px round. */
export const RES_SEAT_CLOSE_CLASS = cn(SHEET_CLOSE_CLASS, FLOOR_FOCUS_RING_CLASS);
/** The body scrolls (values 14): 4px 16px and 18px + the inset below, its parts 14px apart. */
export const RES_SEAT_BODY_CLASS = "flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overflow-x-clip px-4 pt-1 pb-[calc(18px+env(safe-area-inset-bottom))]";
/** One grid of tiles (values 14; no area heads, P22): `auto-fill` columns of 96px up, 6px apart. */
export const RES_SEAT_GRID_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-1.5";
/** A tile (values 14): 56px (it grows for a long name, B10), radius 10, a 1px rule (the ok colour when it fits), 0 10px,
 *  the label over the sub 2px apart; off at .45 (an Occupied table while seating); no hover rule. */
export const RES_SEAT_TILE_CLASS = `flex min-h-14 cursor-pointer flex-col items-start justify-center gap-0.5 rounded-[10px] border bg-card px-2.5 py-1 text-left text-foreground disabled:cursor-not-allowed disabled:opacity-[.45] ${FLOOR_FOCUS_RING_CLASS}`;
export const RES_SEAT_TILE_FITS_CLASS = "border-status-ok";
export const RES_SEAT_TILE_PLAIN_CLASS = "border-border";
export const RES_SEAT_TILE_LABEL_CLASS = "flex w-full items-center gap-1.5 text-[14px] font-semibold [overflow-wrap:anywhere]";
/** The sub (values 14): 11.5px; it wraps (the HTML clips "Booked 9:45 PM" with an ellipsis: a slip, not copied). */
export const RES_SEAT_TILE_SUB_CLASS = "block w-full text-[11.5px] [overflow-wrap:anywhere]";
/** The sub's ink by the tile's tone (values 14): Occupied reads in warn, as the HTML's. */
export const RES_SEAT_SUB_INK_CLASS = { ok: "text-status-ok-ink", warn: "text-status-warn-ink", info: "text-status-warn-ink", reserved: "text-status-reserved-ink" } as const;
/** "Seat without a table" (B24, ours): 44px, centred, the link look (--text-2, underlined). */
export const RES_SEAT_NOTABLE_CLASS = `h-11 flex-none cursor-pointer self-center rounded-[8px] border-0 bg-transparent px-3 text-[13.5px] font-semibold text-muted-foreground underline underline-offset-2 pointer-fine:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 ${FLOOR_FOCUS_RING_CLASS}`;
