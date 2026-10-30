// The Kitchen page's (/kitchen) layout contract. Its frame is the owner's HTML Kitchen screen (U4 Task 1, 2026-10-30;
// docs/superpowers/specs/2026-10-29-kitchen-html-values.md values 0.2, 0.3, 1.1, 1.2, 6.1, 6.3; design 5 and 6.1 in
// docs/superpowers/specs/2026-10-30-kitchen-match-html-design.md): the page fills the screen under the shell's 56px header
// like /pos, /orders and /tables (the paper frame with its 1440px cap goes) and never scrolls itself; the HTML's board is
// the screen's only scroller, so ours is a flex column whose board (below the refresh strip, Task 2) holds the cards'
// grid with the HTML's padding and its 8px scrollbar. The shell header stays put above it (the HTML's header never moves
// either: it is outside the scroller, values 6.1).
//
// One place for the class strings the page renders, so Tailwind's source scanner sees each one and the pins
// (lib/kitchen-layout.test.ts, lib/kitchen-filter-states.test.ts) read the SAME constants the page renders. Task 2 adds the
// type filter and the filtered-empty box (the strip is the shared lib/ui/refresh-strip.ts); Tasks 3-5 the card and the
// states' classes.
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { FLOOR_TAB_ON_CLASS } from "@/lib/floor-layout";
import { FLOOR_FOCUS_RING_CLASS } from "@/lib/floor-tile-classes";
import { POS_PAGE_CLASS } from "@/lib/pos-layout";

/** The Kitchen's route. Only here, in lib/: a quoted "/kitchen" in app/, components/ or hooks/ is a nav source, and the
 *  sidebar is the only one (lib/kitchen-paths.test.ts P4). */
export const KITCHEN_PATH = "/kitchen";

/** The route is the Kitchen itself: the shell then draws the HTML's Kitchen header (values 2.1: 12px between its items),
 *  the quick links from 1280px only (owner Q8) and the toasts clear the bottom inset (design 6.6). Nothing lives under
 *  /kitchen; the kitchen-ticket settings are another page. */
export function isKitchenPath(pathname: string): boolean {
  return pathname === KITCHEN_PATH || pathname === `${KITCHEN_PATH}/`;
}

/** The page (values 1.1, design 5): the /pos frame — exactly the screen under the 56px header and the alert strip,
 *  bleeding over <main>'s padding at every width (on a phone it runs under the 59px tab bar to the window's foot, as the
 *  HTML's) — as a flex column that never scrolls itself: the refresh strip (Task 2) above, the board below. */
export const KITCHEN_PAGE_CLASS = `${POS_PAGE_CLASS} flex flex-col overflow-hidden`;

/** The board, the page's only scroller (values 6.1, 0.3 kdPad): it fills the rest of the page; its padding is the HTML's,
 *  16px 20px 24px from 720px and 12px 12px 84px on a phone (the tab bar covers its last 59px there), each foot growing by
 *  the safe-area inset at every width (U1 ruling P49); 24px / 84px at an inset of 0. The HTML's thin bar, scoped to this
 *  element (values 6.3; the Floor scroller's four classes, lib/floor-layout.ts, held equal by the test): 8px wide, a
 *  --border thumb with radius 8, no track colour, no sideways bar, so with a classic scrollbar the cards narrow and the
 *  header never moves. The HTML sets no line-height on this screen: normal (values 0.5). */
export const KITCHEN_BOARD_CLASS =
  "min-h-0 flex-1 overflow-y-auto overflow-x-hidden leading-[normal] pt-4 px-5 pb-[calc(24px+env(safe-area-inset-bottom))] max-tab:pt-3 max-tab:px-3 max-tab:pb-[calc(84px+env(safe-area-inset-bottom))] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar-thumb]:rounded-[8px] [&::-webkit-scrollbar-thumb]:bg-border";

/** The cards' grid (design 5; owner Q1: one board, no status columns), oldest card top-left, each card its own height
 *  (align-items start, the HTML board's own value, written as the property: Tailwind's items-start computes flex-start;
 *  the HTML's stretched rows below 1024px are a slip, values 4.8). Below 1024px the HTML's own column
 *  grid, 300px tracks 10px apart (2 x 347 at 820, 1 x 366 on a phone); from 1024px three tracks of the HTML's three
 *  column widths, 16px apart, 10px between rows (3 x 325.33 / 377.33 / 292 at 1280 / collapsed / 1024), adding a
 *  fourth and fifth track on a wider board (a wall TV) instead of stretching three cards. The 33 (not 32) keeps the third
 *  track from rounding out at the HTML's widths. */
export const KITCHEN_GRID_CLASS =
  "grid [align-items:start] gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr))] lg:gap-x-4 lg:gap-y-2.5 lg:[grid-template-columns:repeat(auto-fill,minmax(min(320px,calc((100%_-_33px)_/_3)),1fr))]";

// ── The type filter (U4 Task 2; values 2.1 type control, design 6.1, owner Q2) ───────────────────────────────────────
// The HTML's segmented control, in the header's actions slot. That slot's unlayered button rule (app/globals.css
// [data-header-actions], ruling R6) outranks every utility and would make each tab U0's 36px header button (36px tall,
// radius 8, 13.5px, a 7px gap); the values that differ from the HTML's tab are made important here so the tab keeps its
// own look there. The rest the rule gives alike (padding 0 12px, 500, line-height normal, nowrap, the HTML's button
// transition and press). lib/kitchen-filter-states.test.ts reads the rule and fails if it gains a property not answered
// here.

/** The track (values 2.1): --surface-3, radius 8, padding 2, 2px between tabs, 36px, never shrinking; its tabs stretch
 *  to 32px (align-items normal). Not drawn below 720px (the HTML's kdTypes; the page then shows All). */
export const KITCHEN_FILTER_TRACK_CLASS = "flex h-9 flex-none gap-0.5 rounded-[8px] bg-surface-3 p-0.5 max-tab:hidden";
/** A tab (values 2.1): no height of its own (stretched by the track), radius 6, padding 0 12px, 13px 500 in --text, one
 *  line, its word centred (flex, 6px gap). U3's tabs' inset 2px keyboard ring (lib/floor-layout.ts, held equal by the
 *  test) and the HTML's press. */
export const KITCHEN_FILTER_TAB_CLASS = `flex h-auto! min-h-auto! cursor-pointer items-center gap-1.5! whitespace-nowrap rounded-[6px]! border-0 px-3 py-0 text-[13px]! font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${HTML_PRESS_CLASS}`;
/** The chosen tab: SEG_ON, U3's chip exactly (bg-seg + --seg-sh; Tailwind's shadow-seg would add four empty layers). */
export const KITCHEN_FILTER_TAB_ON_CLASS = FLOOR_TAB_ON_CLASS;
/** The others: SEG_OFF, plus the kit's --hover where a pointer can hover (design 6.1; the HTML has none, values 10 #17). */
export const KITCHEN_FILTER_TAB_OFF_CLASS = "bg-transparent pointer-fine:hover:bg-hover";

// ── The empty boxes (values 3.6; design 6.5; ruling K2) ───────────────────────────────────────────────────────────────

/** The HTML's empty box, across the board: a dashed 1.5px --border (drawn 1px in Chrome, values 0.5), radius 12, padding
 *  28px 12px, centred 13px --text-3 at the board's line-height normal (75px tall). The filtered-empty "No orders here"
 *  (Task 2); Task 5 gives "All caught up" the same box. */
export const KITCHEN_EMPTY_BOX_CLASS = "rounded-[12px] border-[1.5px] border-dashed border-border px-3 py-7 text-center text-[13px] text-subtle-foreground";

// ── The card (U4 Task 3; values 4.1, 4.2, 4.4, 4.5; design 6.3, owner Q5) ─────────────────────────────────────────────
// Card height = 149 + the item list (1 + head 64 + list + footer 19 + 6 + button 46 + 12 + 1; the HTML's 157 + rows with
// its list's 4px paddings). The words: lib/kitchen-view.ts.

/** The frame (values 4.1): --surface, a 1px border, radius 12, a flex column; `overflow: clip` (the HTML's hidden would make
 *  a scroll container, U3's lesson). No hover, no shadow. Its border colour is KITCHEN_CARD_EDGE_CLASS's. */
export const KITCHEN_CARD_CLASS = "flex flex-col overflow-clip rounded-[12px] border bg-card";
/** The border (design 6.3): --border, or --bad while late with lines open (lib/kitchen-view.ts kitchenCardLate). */
export const KITCHEN_CARD_EDGE_CLASS = { normal: "border-border", late: "border-status-bad" } as const;
/** The HTML's rise (values 7: `rise .35s cubic-bezier(.2,.8,.2,1) both`, no delay; globals.css brand-rise is its
 *  keyframes: opacity 0 → 1, translateY(12px) → none) when a card first appears (lib/kitchen-rise.ts); none with reduced
 *  motion. */
export const KITCHEN_CARD_RISE_CLASS = "motion-safe:animate-html-rise-row";
/** The head row (values 4.1): the title block and the pill top-aligned, 10px apart, padding 12px 12px 10px, a --border-2
 *  hairline under it (64px with a one-line code). */
export const KITCHEN_CARD_HEAD_CLASS = "flex items-start gap-2.5 border-b border-border-2 px-3 pt-3 pb-2.5";
/** The title block (values 4.1): takes the room the pill leaves. */
export const KITCHEN_CARD_TITLE_CLASS = "min-w-0 flex-1";
/** The code (values 4.1): 20px 700, -0.01em, line-height 1.1 (22px), --text; it wraps, an unbreakable name anywhere
 *  (values 10 #13: never clipped). overflow-wrap anywhere alone: Tailwind 4.3 writes .break-words after the arbitrary
 *  property, so the pair would compute break-word. */
export const KITCHEN_CARD_CODE_CLASS = "text-[20px] font-bold leading-[1.1] tracking-[-0.01em] [overflow-wrap:anywhere]";
/** The where line (values 4.1): 12px --text-2, 3px under the code, line-height normal (16px); it wraps (anywhere). */
export const KITCHEN_CARD_WHERE_CLASS = "mt-[3px] text-[12px] text-muted-foreground [overflow-wrap:anywhere]";
/** The time pill (values 4.1): 26px, 0 9px, radius 999 (the HTML's own; rounded-full computes another value), 12.5px 700,
 *  its words centred; never shrinks. A span: " Late" for screen readers sits in it (sr-only). */
export const KITCHEN_PILL_CLASS = "flex h-[26px] flex-none items-center rounded-[999px] px-[9px] text-[12.5px] font-bold";
/** The pill's tints per band (values 4.4): --ok-t / --ok-i, --warn-t / --warn-i, --bad-t / --bad-i. */
export const KITCHEN_PILL_BAND_CLASS = {
  fresh: "bg-status-ok-tint text-status-ok-ink",
  warn: "bg-status-warn-tint text-status-warn-ink",
  late: "bg-status-bad-tint text-status-bad-ink",
} as const;
/** The item list (values 4.1): a column, 4px above and below its rows. */
export const KITCHEN_CARD_LINES_CLASS = "flex flex-col py-1";

// ── The lines (U4 Task 4; values 4.1, 4.2, 4.6, 5.4, 5.5; design 6.3) ─────────────────────────────────────────────────
// A row is 9 + the box's 2px drop + 18 + 9 = 38px with a one-line name, 54 with one meta or note line, 56 with a
// two-line name (values 4.2): the whole row is the tap target, the HTML's own size (ruling R1). Every text breaks
// anywhere (values 10 #13: never clipped by the card, never a sideways page).

/** A line: the HTML's row, ONE button across the card (edge to edge inside its border, square corners), its parts
 *  top-aligned (written: WebView 109's UA gives buttons flex-start too, U3 VC-1) 10px apart, padding 9px 12px, text left in
 *  --text. Hover --hover where a pointer can hover (R14; the HTML's scp4), the HTML's button feel (its opacity fades .16s
 *  on a tick; the press), an inset 2px keyboard ring (the card clips: an outer ring would be cut at its edges; the HTML's
 *  is Chrome's default, values 10 #17). No look of its own while its write runs (design 6.3: the optimistic tick shows). */
export const KITCHEN_ROW_CLASS = `flex w-full cursor-pointer items-start gap-2.5 border-0 bg-transparent px-3 py-[9px] text-left text-foreground pointer-fine:hover:bg-hover outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary ${HTML_PRESS_CLASS}`;
/** A ticked line (values 4.6): the whole row at half opacity. */
export const KITCHEN_ROW_DONE_CLASS = "opacity-50";
/** The box (values 4.1): 18px, 2px below the row's text top, radius 5, a 1.5px border (drawn 1px, values 0.5), the
 *  HTML's white tick centred in it. Its colours are KITCHEN_ROW_BOX_KIND_CLASS's. */
export const KITCHEN_ROW_BOX_CLASS = "mt-0.5 flex size-[18px] flex-none items-center justify-center rounded-[5px] border-[1.5px] text-white";
/** Open: a --text-3 border; ticked: --ok fill and border (the tick is drawn only then, design 8 #1). */
export const KITCHEN_ROW_BOX_KIND_CLASS = { open: "border-subtle-foreground", done: "border-status-ok bg-status-ok" } as const;
/** The quantity "{qty}×" (values 4.1): 15px 700, 26px at least (a longer number pushes its name right, as the HTML's). */
export const KITCHEN_ROW_QTY_CLASS = "min-w-[26px] text-[15px] font-bold [overflow-wrap:anywhere]";
/** The text column (values 4.1): the room the box and the quantity leave (w-full is WebView 109's stretch rule, U3 VC-1;
 *  flex-1's 0% basis decides the width everywhere). */
export const KITCHEN_ROW_TEXT_CLASS = "w-full min-w-0 flex-1";
/** The name (values 4.1): 15px 500 (19px lines), struck through when ticked. */
export const KITCHEN_ROW_NAME_CLASS = "block text-[15px] font-medium [overflow-wrap:anywhere]";
/** A modifier line from the shared formatter (values 4.1 meta): 12.5px (17px lines); its colour per kind. */
export const KITCHEN_ROW_MOD_CLASS = "block text-[12.5px] [overflow-wrap:anywhere]";
/** Additions in --text-2 (the HTML's meta); a "NO …" removal in --text 600 (today's emphasis: what the cook must not miss). */
export const KITCHEN_ROW_MOD_KIND_CLASS = { added: "text-muted-foreground", removed: "font-semibold text-foreground" } as const;
/** The modifier lines and the note together (the row's accessible description, Task 4 fix 1): a plain block, so the lines
 *  lay out as the HTML's meta and note under the name. */
export const KITCHEN_ROW_MORE_CLASS = "block";
/** The instruction "Note: …" (values 4.1): 12.5px 600 in --warn-i. */
export const KITCHEN_ROW_NOTE_CLASS = "block text-[12.5px] font-semibold text-status-warn-ink [overflow-wrap:anywhere]";
/** A round divider (owner Q6, design 6.3, ours): the footer's type (11.5px --text-3, 15px lines), padding 6px 12px 2px. */
export const KITCHEN_ROUND_CLASS = "px-3 pt-1.5 pb-0.5 text-[11.5px] text-subtle-foreground [overflow-wrap:anywhere]";
/** The footer (values 4.1): the ticket numbers and time left, the count right, 8px apart at least, padding 0 12px 4px,
 *  11.5px --text-3 (15px lines, a 19px row). */
export const KITCHEN_CARD_FOOTER_CLASS = "flex items-center justify-between gap-2 px-3 pb-1 text-[11.5px] text-subtle-foreground";
/** Mark ready (values 4.1 / 4.5): margin 6px 12px 12px (the card's width minus 24), 46px, no border, radius 10, 14.5px 600,
 *  the UA's 1px 6px padding, its words centred by the button itself (no flex, so nothing to stretch on WebView 109). No
 *  hover look (the HTML's); the HTML's press; our 2px accent focus ring (the HTML's is invisible on ink, values 10 #17);
 *  today's kit look while its own write runs. Its fill is KITCHEN_READY_KIND_CLASS's. */
export const KITCHEN_READY_CLASS = `mx-3 mt-1.5 mb-3 h-[46px] cursor-pointer rounded-[10px] border-0 px-1.5 py-px text-[14.5px] font-semibold disabled:pointer-events-none disabled:opacity-50 ${FLOOR_FOCUS_RING_CLASS} ${HTML_PRESS_CLASS}`;
/** The button's fill (Q5): lines open, --ink with --on-ink; every line ticked, the darker green (#198038, 5.0:1 with white;
 *  the HTML's --ok is 3.35:1, values 10 #18) with white. */
export const KITCHEN_READY_KIND_CLASS = { open: "bg-ink text-on-ink", done: "bg-status-ok-ink text-white" } as const;
