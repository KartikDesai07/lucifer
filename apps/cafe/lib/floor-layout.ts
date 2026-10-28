// The Floor page's (/tables) layout contract. Its frame is the owner's HTML Floor screen (U3 Task 1, 2026-10-28;
// docs/superpowers/specs/2026-10-28-floor-html-values.md values 0.3, 1.1, 2.1, 9.1, 13.1; design 5 and 6.1 in
// docs/superpowers/specs/2026-10-28-floor-match-html-design.md): the page fills the screen under the shell's 56px header
// like /pos and /orders (the paper frame with its 1440px cap goes) and never scrolls itself; the HTML's screen is its own
// scroller, so ours is a flex column whose scroller (below the refresh strip, Task 5) holds the HTML's body with its
// padding and its 8px scrollbar. The shell header stays put above it (the HTML's header, sticky inside its scroller,
// moves 8px beside a classic scrollbar: values 12 #25, not copied).
//
// One place for the class strings the page renders. Everything here is a plain literal (FLOOR_PAGE_CLASS also reads
// lib/pos-layout.ts's POS_PAGE_CLASS), so Tailwind's source scanner sees every class name, and the pins
// (lib/floor-layout.test.ts) read the SAME constants the page renders.
import { POS_PAGE_CLASS } from "@/lib/pos-layout";
import { TABLES_FLOOR_PATH } from "@/lib/table-sections";

/** The Floor's route (the Tables screens' own constant, lib/table-sections.ts). */
export const FLOOR_PATH = TABLES_FLOOR_PATH;

/** The route is the Floor itself: the shell then draws the HTML's Floor header (values 1.2: 12px between its items, New
 *  order in the HTML Floor button's look with its label at every width, no Tables link; owner Q1). Only /tables: its
 *  admin pages below it (Setup, QR codes) are not in the HTML and keep U0's header. */
export function isFloorPath(pathname: string): boolean {
  return pathname === FLOOR_PATH || pathname === `${FLOOR_PATH}/`;
}

/** The page (values 1.1, design 5): the /pos frame — exactly the screen under the 56px header and the alert strip,
 *  bleeding over <main>'s padding at every width (on a phone it runs under the 59px tab bar to the window's foot, as the
 *  HTML's) — as a flex column that never scrolls itself: the refresh strip (Task 5) above, the scroller below. */
export const FLOOR_PAGE_CLASS = `${POS_PAGE_CLASS} flex flex-col overflow-hidden`;

/** The scroller (values 1.1, 0.3, 9.1): it fills the rest of the page and scrolls the HTML's body; its padding is the
 *  HTML's body padding, 20px 24px 28px (pagePad, screenPadB), 16px 14px 92px on a phone (the tab bar covers its last
 *  59px there), the foot growing by the safe-area inset at every width (U1 ruling P49); 28px / 92px at an inset of 0.
 *  The HTML's thin bar, scoped to this element (U0 values 1.4's global rule): 8px wide, a --border thumb with radius 8,
 *  no track colour, no sideways bar. The HTML sets no line-height on this screen: normal (values 0.5). */
export const FLOOR_SCROLLER_CLASS =
  "min-h-0 flex-1 overflow-y-auto overflow-x-hidden leading-[normal] pt-5 px-6 pb-[calc(28px+env(safe-area-inset-bottom))] max-tab:pt-4 max-tab:px-3.5 max-tab:pb-[calc(92px+env(safe-area-inset-bottom))] [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar-thumb]:rounded-[8px] [&::-webkit-scrollbar-thumb]:bg-border";

/** The body (values 2.1): a flex column, its parts 16px apart — the controls row, the area sections (or the flat grid),
 *  the empty and error states. */
export const FLOOR_BODY_CLASS = "flex flex-col gap-4";
