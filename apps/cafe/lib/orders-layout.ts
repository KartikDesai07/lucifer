// The Orders page's (/orders) layout contract. Its frame is the owner's HTML Orders screen (U2 Task 1, 2026-10-23;
// docs/superpowers/specs/2026-10-22-orders-html-values.md values 1.1, 2.1, 2.2, 21.1; design 5 in
// docs/superpowers/specs/2026-10-23-orders-match-html-design.md): the page fills the screen under the shell's 56px
// header like /pos and never scrolls; its body grid holds the list column and, from 1280px, the 400px detail column
// (the owner's rule of 2026-10-22: below 1280px a right panel is never a side column or a side sheet); the list
// scroller and the detail scroll on their own. The list's form follows the list column's own width (values 0.2: the
// table from a 700px list, the Items column from 900px; the lane cards from 560px, measured by the lanes), so the column
// is a named container (`list`), outside the list scroller.
//
// One place for the class strings the page renders. Everything here is a plain literal (ORDERS_PAGE_CLASS also reads
// lib/pos-layout.ts's POS_PAGE_CLASS), so Tailwind's source scanner sees every class name, and the pins
// (lib/orders-layout.test.ts) read the SAME constants the page renders.
import { POS_CART_SHEET_CLASS, POS_CART_SHEET_SCRIM_CLASS, POS_PAGE_CLASS } from "@/lib/pos-layout";
import { cn } from "@/lib/utils";

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

/** The list column (values 2.2): a flex column that may shrink, holding the top block and the list scroller; the named
 *  container `list`, so the list's form switches at the column's own width (values 0.2; components/orders/OrderTable.tsx
 *  queries it by name). Measured here, OUTSIDE the scroller (the verification fix, V-A): a classic (Windows, Electron)
 *  scrollbar in the scroller can never narrow what is measured, so the HTML's listW thresholds (700 / 900) sit at the
 *  column's 740 / 940 — the scroller's 20 + 20 side padding added back (below 720px the phone is always cards). The HTML
 *  sets no line-height on this screen: normal (values 0.5). */
export const ORDERS_LIST_COLUMN_CLASS = "@container/list flex min-h-0 min-w-0 flex-col leading-[normal]";

/** The top block (values 2.2 toolPad): the lanes, the toolbar, the Filters panel and the chips, 12px apart; padding
 *  14px 20px 12px, 10px 12px 12px on a phone. Content-sized (flex: 0 1 auto): it shrinks only when taller than the
 *  list column — the scroller's basis is 0 — and then scrolls on its own, so in phone landscape (~862 x 390) the open
 *  Filters panel's Reset and Done stay reachable (the verification fix, V-C F2); wherever it fits nothing moves. */
export const ORDERS_TOP_CLASS =
  "flex flex-[0_1_auto] flex-col gap-3 min-h-0 overflow-y-auto overflow-x-hidden px-5 pt-3.5 pb-3 max-tab:px-3 max-tab:pt-2.5";

/** The list scroller (values 2.2 listPad, screenPadB): it fills the rest of the list column (flex: 1, min-height 0);
 *  the list head and the list scroll together in it; padding 0 20px 28px, 0 12px 92px on a phone (the tab bar covers its
 *  last 59px there), and its foot grows by the safe-area inset at every width (U1 ruling P49), so the last row is never
 *  under the gesture strip; 28px / 92px at an inset of 0. */
export const ORDERS_SCROLLER_CLASS =
  "flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-5 pt-0 pb-[calc(28px+env(safe-area-inset-bottom))] max-tab:px-3 max-tab:pb-[calc(92px+env(safe-area-inset-bottom))]";

/** The detail column (values 11.1 at the HTML's `big`; owner rule 2026-10-22: from 1280px only): the body grid's second
 *  track, 400px, the surface with a 1px rule on its left, no shadow, a flex column that scrolls in parts. Below 1280px
 *  it is not drawn (the detail opens full screen from the bottom, its own portal). */
export const ORDERS_DETAIL_COLUMN_CLASS = "relative z-[1] hidden min-h-0 min-w-0 flex-col border-l border-border bg-card xl:flex";

// ── The order detail's frames (U2 Task 5; design 6.6, Q8; values 11.1, 12) ──────────────────────────────────────────

/** From here (the owner's rule of 2026-10-22) a right panel may be a column or a side sheet; below it the detail opens
 *  full screen from the window's foot. */
export const ORDERS_XL_QUERY = "(min-width: 1280px)";

/** Where the detail opens: in the /orders page's column, or over another page (the dashboard). */
export type OrderDetailPlace = "page" | "overlay";
/** The detail's frame: the page's 400px column, a 400px side sheet over a scrim, or the full-screen bottom sheet. */
export type OrderDetailFrame = "column" | "side" | "bottom";

/** The one frame for the width (design 6.6, Q8): from 1280px the column on /orders and a side sheet elsewhere; below
 *  1280px the bottom sheet on both; none while the width is not known (the server render). */
export function orderDetailFrame(place: OrderDetailPlace, xl: boolean | null): OrderDetailFrame | null {
  if (xl === null) return null;
  if (!xl) return "bottom";
  return place === "page" ? "column" : "side";
}

/** The column frame: it fills the page's detail column (ORDERS_DETAIL_COLUMN_CLASS), which carries the surface and its
 *  left rule, so there is one column frame, never two. The HTML sets no line-height on the detail: normal. */
export const ORDER_DETAIL_COLUMN_CLASS = "flex min-h-0 flex-1 flex-col leading-[normal]";

/** The dashboard's side sheet from 1280px (design 6.6): the kit sheet on the right, over its scrim, at the column's
 *  400px on --surface with the 1px --border rule on its left, square and unpadded (the kit's radius, padding and gap
 *  go), keeping the kit's --pop shadow (the HTML's aside wears --pop whenever it lies over the page, values 11.1) and its
 *  slide. The kit's own close button (its only direct-child button) is hidden: the head's ✕ is the HTML's. The panel
 *  takes the focus as it opens (the shared opener hook, V-C F4): no outline, as the bottom sheet's. */
export const ORDER_DETAIL_SIDE_CLASS =
  "flex w-[400px] flex-col gap-0 rounded-none border-l border-border bg-card p-0 font-sans leading-[normal] text-foreground outline-none sm:max-w-none [&>button]:hidden";

/** The bottom sheet's overlay (owner rule: no scrim at any width below 1280px; at 390 the HTML's is under the sheet):
 *  the /pos cart sheet's own constant — mounted with the dialog (its scroll lock stays), never drawn. */
export const ORDER_DETAIL_SHEET_SCRIM_CLASS = POS_CART_SHEET_SCRIM_CLASS;
/** The bottom sheet below 1280px on both pages (values 12 and 11.1 at 390; owner rule 2026-10-22): the /pos cart sheet
 *  itself (lib/pos-layout.ts POS_CART_SHEET_CLASS, one constant so the two cannot drift): over the whole window (fixed,
 *  inset 0) at z-index 15, over the header, the rail and the tab bar (12), under the sheets it opens; --surface with the
 *  1px --border rule on its left (the HTML's phone content starts at x 1); no shadow; it slides up from the window's foot
 *  and back down (Radix's data-state picks the slide, motion-safe); line-height normal. */
export const ORDER_DETAIL_SHEET_CLASS = POS_CART_SHEET_CLASS;

/** The frame in use: while the payment (and the customer sheet it opens) or the move sheet opened from the detail is up,
 *  the frame it opened from stays — Radix stacks its layers by mount order, so a frame mounted under an open sheet would
 *  become the top layer (the payment behind its overlay, focus trapped below, Escape closing the detail and so the
 *  payment). Once that sheet closes, the frame follows the width. */
export function frameInUse(held: OrderDetailFrame | null, forWidth: OrderDetailFrame | null, nestedOpen: boolean): OrderDetailFrame | null {
  return nestedOpen ? held : forWidth;
}

/** Under the head (values 11.1: the head never shrinks, the rest scrolls) the HTML's body (values 11.4, U2 Task 6): a
 *  flex column, padding 14px 18px 18px, its parts 14px apart (none of them shrinks: each is flex-none), the bottom room
 *  growing by the window's safe-area inset (U1 P49) when it runs to the window's foot (no foot under it). */
export const ORDER_DETAIL_SCROLL_CLASS =
  "flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto overflow-x-hidden px-[18px] pt-3.5 pb-[calc(18px+env(safe-area-inset-bottom))]";
/** With the foot under it (an open tab, values 11.9) the body's bottom room is the HTML's 18px: the foot is at the
 *  window's foot and takes the safe-area inset. */
export const ORDER_DETAIL_SCROLL_OVER_FOOT_CLASS = "pb-[18px]";

// ── The detail's items box (U2 Task 6; values 11.5; design 6.8): shared by its lines and the void trail inside it ─────

/** The items box's head and the void trail's caption (values 11.5): 11.5px 600 uppercase, .06em, --text-3, 4px above
 *  the first line; the two words at either end, on one baseline. */
export const ORDER_DETAIL_BOX_HEAD_CLASS =
  "flex items-baseline justify-between pb-1 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-subtle-foreground";
/** A line (values 11.5): the 28px quantity, the name column, the amount, 2px 8px apart and 8px above and below, on the
 *  text's baseline. */
export const ORDER_DETAIL_LINE_CLASS = "grid grid-cols-[28px_minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-0.5 py-2";
/** A line's "{qty}×" (values 11.5): Geist Mono 13px 600 in --text-2. */
export const ORDER_DETAIL_QTY_CLASS = "font-mono text-[13px] font-semibold text-muted-foreground";
/** The box's dashed rule (values 11.5: 1.5px dashed --border, drawn 1px at DPR 1); its margins are its place's. */
export const ORDER_DETAIL_RULE_CLASS = "border-t-[1.5px] border-dashed border-border";

// ── The detail's actions (U2 Task 7; values 11.7 quick actions, 11.8 danger link, 11.9 foot; design 6.9) ─────────────

/** The quick actions grid (values 11.7): a 1px --border box, radius 12, clipped, on --surface. It never shrinks: the
 *  HTML's flex body squeezes and clips it at 1280 / 1024 so that a tap can land on "Cancel this order" (values 20 #2-#3,
 *  design 8: not copied) — the body scrolls instead. */
export const ORDER_QUICK_GRID_CLASS = "grid flex-none overflow-hidden rounded-[12px] border border-border bg-card";

const QUICK_COLS = ["grid-cols-1", "grid-cols-2", "grid-cols-3", "grid-cols-4"] as const;
/** The grid's columns (values 11.7 quickCols: repeat(n, minmax(0, 1fr))): up to four actions in one row; five (an open
 *  tab with a token) as 3 + 2 on six columns — three of two columns, then two of three under a 1px rule, the fourth
 *  starting its row with no rule on its left (design 6.9: five 72px cells cut the labels). */
export function quickGridClass(count: number): string {
  if (count <= QUICK_COLS.length) return cn(ORDER_QUICK_GRID_CLASS, QUICK_COLS[Math.max(count, 1) - 1]);
  return cn(
    ORDER_QUICK_GRID_CLASS,
    "grid-cols-6 [&>*]:col-span-2 [&>:nth-child(n+4)]:col-span-3 [&>:nth-child(n+4)]:border-t [&>:nth-child(4)]:[border-left:0]",
  );
}

/** A quick action (values 11.7): 62px, the 18px icon over the 12px 600 label 5px apart, centred, 0 4px, one line, on
 *  no fill with a 1px --border rule on its left (the first's left border the HTML's `0`: none); hover --hover; our disabled (a print being
 *  queued) at .5. The HTML's press: BRAND_PRESS_CLASS at the call site. */
export const ORDER_QUICK_ACTION_CLASS =
  "flex h-[62px] cursor-pointer flex-col items-center justify-center gap-[5px] border-l border-border bg-transparent px-1 py-0 text-center text-[12px] font-semibold whitespace-nowrap text-foreground first:[border-left:0] hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";

/** A quick action's label: one line, cut with an ellipsis rather than spilling past its cell where a phone narrower than
 *  the HTML's 390px leaves a four-action cell too narrow for "Reprint token" (at 390 every label fits whole). */
export const ORDER_QUICK_LABEL_CLASS = "max-w-full truncate";

/** "Cancel this order" (values 11.8): centred under the grid, the 15px icon 6px from the 13px 600 --bad-i words, 6px
 *  10px, radius 8, no fill (hover --bad-t); it never shrinks. */
export const ORDER_DANGER_CLASS =
  "flex flex-none cursor-pointer items-center gap-1.5 self-center rounded-[8px] [border:0] bg-transparent px-2.5 py-1.5 text-[13px] font-semibold text-status-bad-ink hover:bg-status-bad-tint";

/** The foot (values 11.9): under the body at the window's foot, 12px 18px and 14px + the safe-area inset below (the
 *  phone's 12px + the inset: cartFootB; U1 P49), a 1px --border rule above, the buttons 8px apart on --surface. */
export const ORDER_DETAIL_FOOT_CLASS =
  "grid flex-none gap-2 border-t border-border bg-card px-[18px] pt-3 pb-[calc(14px+env(safe-area-inset-bottom))] max-tab:pb-[calc(12px+env(safe-area-inset-bottom))]";

/** The foot's columns (values 11.9 footCols): Edit items and Settle & pay 1fr 2fr; Settle & pay alone, full width. */
export function detailFootClass(both: boolean): string {
  return cn(ORDER_DETAIL_FOOT_CLASS, both ? "grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" : "grid-cols-1");
}

/** "Edit items" (values 11.9): 48px, a 1px --border rule, radius 10, on --surface, the 16px pencil 7px from the 14px 600
 *  words, the UA's 1px 6px, one line; hover --hover. */
export const ORDER_EDIT_ITEMS_CLASS =
  "flex h-12 cursor-pointer items-center justify-center gap-[7px] rounded-[10px] border border-border bg-card px-1.5 py-px text-[14px] font-semibold whitespace-nowrap text-foreground hover:bg-hover";

/** "Settle & pay · ₹x" (values 11.9): 48px on --accent, no rule, radius 10, 15px 600 --on-accent, the UA's 1px 6px, one
 *  line; hover --accent-h. */
export const ORDER_SETTLE_CLASS =
  "flex h-12 cursor-pointer items-center justify-center gap-2 rounded-[10px] [border:0] bg-primary px-1.5 py-px text-[15px] font-semibold whitespace-nowrap text-primary-foreground hover:bg-primary-hover";
