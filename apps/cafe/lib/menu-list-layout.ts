// The Menu list's rows (U5 Task 2): the owner's HTML table, cards, badges, switches and bulk bar (docs/superpowers/specs/
// 2026-10-31-menu-printer-html-values.md 5 table, 6 cards, 7.1 badges, 7.2 toggles, 8 bulk bar; design
// docs/superpowers/specs/2026-10-31-menu-printer-match-html-design.md 6.4-6.7; owner Q2, Q3, Q4, Q6). One place for the
// class strings, so Tailwind's scanner sees each one and lib/menu-list-layout.test.ts pins the SAME constants the
// components render. The list scroller (lib/menu-layout.ts) is the container `list`: its content box is the list box,
// and the table's Category column (738px) and the bulk bar's labels (520px) ask it by name.
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { FLOOR_FOCUS_RING_CLASS } from "@/lib/floor-tile-classes";

/** Rows are a table from 816px (values 0.2: listW >= 700, with the 76px nav) and cards below; one list mounts. */
export const MENU_TABLE_QUERY = "(min-width: 816px)";
/** Before the width is known both lists render and the page box picks one (740 = 816 less the 76px nav). */
export const MENU_TABLE_SSR_CLASS = "hidden @[740px]/menu:block";
export const MENU_CARDS_SSR_CLASS = "@[740px]/menu:hidden";

/** The white list (values 5.1): radius 12, 1px --border, clipping its rows. */
export const MENU_LIST_BOX_CLASS = "flex-none overflow-clip rounded-[12px] border border-border bg-card";

// ── The table ─────────────────────────────────────────────────────────────────────────────────────────────────────────
/** The grid (values 5.1 `tcols`): check, item, [category], price, stock, QR, edit; gap 14. The Category track only from a
 *  738px list box (Q4: the HTML's own 708px of columns need it), and never while a category is picked. */
export const MENU_ROW_GRID_CLASS =
  "grid grid-cols-[18px_minmax(200px,2fr)_110px_72px_72px_32px] items-center gap-3.5 @[738px]/list:grid-cols-[18px_minmax(200px,2fr)_minmax(120px,1fr)_110px_72px_72px_32px]";
export const MENU_ROW_GRID_NO_CATEGORY_CLASS = "grid grid-cols-[18px_minmax(200px,2fr)_110px_72px_72px_32px] items-center gap-3.5";

/** The head (values 5.1): sticky, --surface-2, padding 9px 14px, 12.5px 500 --text-2, 1px --border below. */
export const MENU_HEAD_CLASS =
  "sticky top-0 z-[1] border-b border-border bg-surface-2 px-3.5 py-[9px] text-[12.5px] font-medium text-muted-foreground";
/** A sort button in the head: the label, 5px, its icon; --text while it is the sort. */
export const MENU_HEAD_SORT_CLASS = `flex min-w-0 cursor-pointer items-center gap-[5px] rounded-[6px] border-0 bg-transparent p-0 font-medium ${FLOOR_FOCUS_RING_CLASS}`;
export const MENU_HEAD_SORT_ON_CLASS = "text-foreground";

/** The rows' box: a 1px --border-2 on top of every row but the first (the HTML's, so its 55px rows keep their place). */
export const MENU_ROWS_CLASS = "[&>:not(:first-child)]:border-t [&>:not(:first-child)]:border-border-2";
/** A row (values 5.2): padding 10px 14px; selected --accent-t, archived at .6; hover --hover where a pointer hovers,
 *  replacing the selected row's blue (the HTML's `!important`: it is last in the order). */
export const MENU_ROW_CLASS = "px-3.5 py-2.5 pointer-fine:hover:bg-hover";
export const MENU_ROW_SELECTED_CLASS = "bg-status-info-tint";
export const MENU_ARCHIVED_CLASS = "opacity-60";

/** The 18px box (values 5.1 select-all, 5.2 check): radius 5, 1.5px border, a white tick (an off box shows none). */
export const MENU_CHECK_CLASS = `flex size-[18px] flex-none cursor-pointer items-center justify-center rounded-[5px] border-[1.5px] p-0 text-[11px] leading-none text-white ${FLOOR_FOCUS_RING_CLASS}`;
export const MENU_CHECK_ON_CLASS = "border-primary bg-primary";
export const MENU_CHECK_OFF_CLASS = "border-border bg-card";

/** The Item cell: art 34, 10px, the text block. A button for an admin (it opens the editor), a plain box for staff. */
export const MENU_NAME_BOX_CLASS = "flex min-w-0 items-center gap-2.5 text-left text-foreground";
export const MENU_NAME_BUTTON_CLASS = `w-full cursor-pointer border-0 bg-transparent p-0 ${FLOOR_FOCUS_RING_CLASS} rounded-[6px]`;
export const MENU_NAME_BLOCK_CLASS = "min-w-0 flex-1";
/** The name (Q2): 14px 600, wraps, an unbroken word breaks anywhere, never cut. */
export const MENU_NAME_CLASS = "block text-[14px] font-semibold [overflow-wrap:anywhere]";
/** Line 2 (Q2): the badges, then the sizes text (12px --text-3); wraps with its badges. */
export const MENU_LINE2_CLASS = "flex min-h-4 flex-wrap items-center gap-x-[7px] gap-y-0.5";
export const MENU_SIZES_CLASS = "text-[12px] text-subtle-foreground [overflow-wrap:anywhere]";
/** The category in line 2, below the Category track (Q4). */
export const MENU_LINE2_CATEGORY_CLASS = "@[738px]/list:hidden";

/** Category (values 5.2): a 7px hue dot, 13px --text-2, ellipsis; only from a 738px list box. */
export const MENU_CATEGORY_CELL_HIDE_CLASS = "hidden @[738px]/list:flex";
export const MENU_CATEGORY_CELL_CLASS = `${MENU_CATEGORY_CELL_HIDE_CLASS} min-w-0 items-center gap-[7px] text-[13px] text-muted-foreground`;
export const MENU_CATEGORY_DOT_CLASS = "size-[7px] flex-none rounded-[50%]";
/** Price (values 5.2): Geist Mono 13.5px 600, right; ours: the struck original under it (12px --text-3). */
export const MENU_PRICE_CELL_CLASS = "text-right font-mono text-[13.5px] font-semibold whitespace-nowrap";
export const MENU_PRICE_STRUCK_CLASS = "block text-[12px] font-normal text-subtle-foreground line-through";
/** Stock and QR (values 5.2): the switch centred in its 72px; staff read the QR words (ours, menu inv P106). */
export const MENU_SWITCH_CELL_CLASS = "flex justify-center";
export const MENU_QR_WORDS_CLASS = "text-[12.5px] text-muted-foreground";
/** Edit (values 5.2): 32px, radius 8, --text-2, the pencil; --surface-3 on hover. */
export const MENU_EDIT_CLASS = `flex size-8 flex-none cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent p-0 text-muted-foreground pointer-fine:hover:bg-surface-3 ${FLOOR_FOCUS_RING_CLASS} ${HTML_PRESS_CLASS}`;

// ── The cards (values 6) ──────────────────────────────────────────────────────────────────────────────────────────────
/** A card row: padding 12px 14px, 12px between its parts. */
export const MENU_CARD_CLASS = "flex items-center gap-3 px-3.5 py-3";
export const MENU_CARD_TAPPABLE_CLASS = "cursor-pointer";
/** The name block: art and text, top-aligned; the name 14.5px 600 (wraps, Q2), line 2 12.5px --text-2. */
export const MENU_CARD_BLOCK_CLASS = "flex min-w-0 flex-1 items-start gap-2.5 text-left text-foreground";
export const MENU_CARD_BUTTON_CLASS = `w-full cursor-pointer border-0 bg-transparent p-0 ${FLOOR_FOCUS_RING_CLASS} rounded-[6px]`;
export const MENU_CARD_NAME_CLASS = "block text-[14.5px] font-semibold [overflow-wrap:anywhere]";
export const MENU_CARD_SUB_CLASS = "block text-[12.5px] text-muted-foreground [overflow-wrap:anywhere]";
export const MENU_CARD_PRICE_CLASS = "font-mono font-semibold text-foreground";
export const MENU_CARD_STRUCK_CLASS = "font-mono text-[12px] text-subtle-foreground line-through";
export const MENU_CARD_BADGES_CLASS = "mt-1 flex flex-wrap gap-[5px]";
/** The stock cell: "In stock" / "Sold out" (10.5px --text-3) over the switch. */
export const MENU_CARD_STOCK_CLASS = "flex flex-none flex-col items-center gap-[3px]";
export const MENU_CARD_STOCK_LABEL_CLASS = "text-[10.5px] text-subtle-foreground";

// ── Badges (values 7.1) ───────────────────────────────────────────────────────────────────────────────────────────────
/** Table badge: 20px, 0 7px 0 6px, radius 10, 11px 600, icon 11px; card badge: 19px, 0 6px 0 5px, radius 9, 10.5px, icon 10px. */
export const MENU_BADGE_TABLE_CLASS = "inline-flex h-5 flex-none items-center gap-1 whitespace-nowrap rounded-[10px] pl-1.5 pr-[7px] text-[11px] font-semibold";
export const MENU_BADGE_CARD_CLASS = "inline-flex h-[19px] flex-none items-center gap-[3px] whitespace-nowrap rounded-[9px] pl-[5px] pr-1.5 text-[10.5px] font-semibold";
export const MENU_BADGE_TONE_CLASS = {
  "sold-out": "bg-status-bad-tint text-status-bad-ink",
  hidden: "bg-surface-3 text-muted-foreground",
  archived: "bg-surface-3 text-muted-foreground",
  "no-kot": "bg-status-warn-tint text-status-warn-ink",
} as const;

// ── The switch (values 7.2) ───────────────────────────────────────────────────────────────────────────────────────────
/** 40x24, radius 12, the track --surface-3 off, --ok (stock) or --accent (QR) on, .15s; pressed .97 (the HTML_PRESS). */
export const MENU_SWITCH_CLASS = `relative h-6 w-10 flex-none cursor-pointer rounded-[12px] border-0 bg-surface-3 p-0 transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50 ${FLOOR_FOCUS_RING_CLASS} not-disabled:active:[transform:scale(.97)]`;
export const MENU_SWITCH_ON_CLASS = { ok: "data-[state=checked]:bg-status-ok", accent: "data-[state=checked]:bg-primary" } as const;
/** The knob: 18px white at 3px (off) / 19px (on), shadow 0 1px 2px rgba(0,0,0,.25), the left moving .15s. */
export const MENU_SWITCH_KNOB_CLASS =
  "pointer-events-none absolute left-[3px] top-[3px] block size-[18px] rounded-[50%] bg-white [box-shadow:0_1px_2px_rgba(0,0,0,.25)] transition-[left] duration-150 data-[state=checked]:left-[19px]";

// ── The bulk bar (values 8; Q6) ───────────────────────────────────────────────────────────────────────────────────────
/** The ink bar: radius 10, padding 8px 10px 8px 14px, 8px apart, wrapping; sticky at the scroller's foot. A sticky offset is
 *  measured from the scroller's PADDING edge (measured: the bar rests 28px above the window's foot on a desktop), and the
 *  scroller's foot padding on a phone is already 92px plus the inset (lib/menu-layout.ts: past the 59px tab bar and its
 *  inset), so `bottom-0` keeps the bar 33px above the tab bar, as the HTML's last card rests; the tab bar's offset added on
 *  top (as before U5, when the bar had no padding to lean on) floated it 92px up. It is last in the scroller, so at the end it
 *  rests after the list. */
export const MENU_BULK_BAR_CLASS =
  "sticky bottom-0 z-10 flex flex-none flex-wrap items-center gap-2 rounded-[10px] bg-ink py-2 pl-3.5 pr-2.5 text-on-ink";
export const MENU_BULK_COUNT_CLASS = "mr-auto text-[13.5px] font-semibold";
/** The cap words (ours: the 500 cap, menu inv P11). */
export const MENU_BULK_CAP_CLASS = "w-full text-[12px] text-on-ink-down";
/** A bulk button: 32px, 0 11px, 1px a white wash border (precomputed; light on the dark bar, dark on the dark theme's light
 *  bar: the HTML's white wash is invisible there), radius 8, 12.5px 600, icon 14px; below a 520px list the label goes and
 *  the button is 38px wide. */
export const MENU_BULK_BUTTON_CLASS = `flex h-8 w-[38px] flex-none cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-[8px] border border-[rgba(255,255,255,.22)] bg-transparent px-[11px] py-0 text-[12.5px] font-semibold text-inherit pointer-fine:hover:bg-[rgba(255,255,255,.1)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[rgba(14,14,16,.22)] dark:pointer-fine:hover:bg-[rgba(14,14,16,.1)] @[520px]/list:w-auto ${FLOOR_FOCUS_RING_CLASS} ${HTML_PRESS_CLASS}`;
export const MENU_BULK_LABEL_CLASS = "hidden @[520px]/list:inline";
/** Clear: 32px square, no border, the ✕ at 12px. */
export const MENU_BULK_CLEAR_CLASS = `flex size-8 flex-none cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent p-0 text-[12px] text-inherit ${FLOOR_FOCUS_RING_CLASS}`;
