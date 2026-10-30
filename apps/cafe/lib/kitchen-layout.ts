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
