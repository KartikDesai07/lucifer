// The Kitchen page's (/kitchen) layout contract. Its frame is the owner's HTML Kitchen screen (U4 Task 1, 2026-10-30;
// docs/superpowers/specs/2026-10-29-kitchen-html-values.md values 0.2, 0.3, 1.1, 1.2, 6.1, 6.3; design 5 and 6.1 in
// docs/superpowers/specs/2026-10-30-kitchen-match-html-design.md): the page fills the screen under the shell's 56px header
// like /pos, /orders and /tables (the paper frame with its 1440px cap goes) and never scrolls itself; the HTML's board is
// the screen's only scroller, so ours is a flex column whose board (below the refresh strip, Task 2) holds the cards'
// grid with the HTML's padding and its 8px scrollbar. The shell header stays put above it (the HTML's header never moves
// either: it is outside the scroller, values 6.1).
//
// One place for the class strings the page renders, so Tailwind's source scanner sees each one and the pins
// (lib/kitchen-layout.test.ts) read the SAME constants the page renders. Tasks 2-5 add the filter, the strip, the card
// and the states' classes.
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
