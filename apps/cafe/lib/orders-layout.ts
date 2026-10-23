// The Orders page's (/orders) layout contract. Its frame is the owner's HTML Orders screen (U2 Task 1, 2026-10-23;
// docs/superpowers/specs/2026-10-22-orders-html-values.md values 1.1, 2.1, 2.2, 21.1; design 5 in
// docs/superpowers/specs/2026-10-23-orders-match-html-design.md): the page fills the screen under the shell's 56px
// header like /pos and never scrolls; its body grid holds the list column and, from 1280px, the 400px detail column
// (the owner's rule of 2026-10-22: below 1280px a right panel is never a side column or a side sheet); the list
// scroller and the detail scroll on their own. The list's form follows the list column's own width (values 0.2: the
// table from 700px, the Items column from 900px, the lane cards from 560px), so the column is a container.
//
// One place for the class strings the page renders. Everything here is a plain literal (ORDERS_PAGE_CLASS also reads
// lib/pos-layout.ts's POS_PAGE_CLASS), so Tailwind's source scanner sees every class name, and the pins
// (lib/orders-layout.test.ts) read the SAME constants the page renders.
import { POS_PAGE_CLASS } from "@/lib/pos-layout";

/** The Orders page's route. */
export const ORDERS_PATH = "/orders";

/** The HTML's phone (`ph`, below 720px: Tailwind's max-tab), as a media query for the one thing CSS cannot gate: the
 *  date chip and the Filters count it adds on the phone only (values 6). */
export const ORDERS_PHONE_QUERY = "(width < 45rem)";

/** The route is the Orders page (or a page below it, isPosPath's rule): the shell then draws the HTML's Orders header
 *  (values 1.2: 12px between its items, New order with its label at every width). */
export function isOrdersPath(pathname: string): boolean {
  return pathname === ORDERS_PATH || pathname.startsWith(`${ORDERS_PATH}/`);
}

/** The page (values 1.1): the /pos frame — exactly the screen under the 56px header and the alert strip, bleeding over
 *  <main>'s padding at every width (on a phone it runs under the 59px tab bar to the window's foot, as the HTML's) — as
 *  the HTML's flex column that never scrolls: the body below fills it and scrolls in parts. */
export const ORDERS_PAGE_CLASS = `${POS_PAGE_CLASS} flex flex-col overflow-hidden`;

/** The body grid (values 2.1; owner rule 2026-10-22): the list column alone below 1280px; from 1280px the list and the
 *  400px detail column (the HTML's from 1024px). It fills the page; the one row stretches to its height. */
export const ORDERS_BODY_CLASS = "grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_400px]";

/** The list column (values 2.2): a flex column that may shrink, holding the top block and the list scroller; a
 *  container, so the list's parts switch at the list column's own width (values 0.2). The HTML sets no line-height on
 *  this screen: normal (values 0.5). */
export const ORDERS_LIST_COLUMN_CLASS = "@container flex min-h-0 min-w-0 flex-col leading-[normal]";

/** The top block (values 2.2 toolPad): the lanes, the toolbar, the Filters panel and the chips, 12px apart; padding
 *  14px 20px 12px, 10px 12px 12px on a phone. It never shrinks. */
export const ORDERS_TOP_CLASS = "flex flex-none flex-col gap-3 px-5 pt-3.5 pb-3 max-tab:px-3 max-tab:pt-2.5";

/** The list scroller (values 2.2 listPad, screenPadB): the list head and the list scroll together in it; padding 0 20px
 *  28px, 0 12px 92px on a phone (the tab bar covers its last 59px there), and its foot grows by the safe-area inset at
 *  every width (U1 ruling P49), so the last row is never under the gesture strip; 28px / 92px at an inset of 0. */
export const ORDERS_SCROLLER_CLASS =
  "flex-1 overflow-y-auto overflow-x-hidden px-5 pt-0 pb-[calc(28px+env(safe-area-inset-bottom))] max-tab:px-3 max-tab:pb-[calc(92px+env(safe-area-inset-bottom))]";

/** The detail column (values 11.1 at the HTML's `big`; owner rule 2026-10-22: from 1280px only): the body grid's second
 *  track, 400px, the surface with a 1px rule on its left, no shadow, a flex column that scrolls in parts. Below 1280px
 *  it is not drawn (the detail opens full screen from the bottom, Task 5). */
export const ORDERS_DETAIL_COLUMN_CLASS = "relative z-[1] hidden min-h-0 min-w-0 flex-col border-l border-border bg-card xl:flex";
