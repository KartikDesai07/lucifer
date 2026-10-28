// The Floor page's (/tables) layout contract. Its frame is the owner's HTML Floor screen (U3 Task 1, 2026-10-28;
// docs/superpowers/specs/2026-10-28-floor-html-values.md values 0.3, 1.1, 2.1, 9.1, 13.1; design 5 and 6.1 in
// docs/superpowers/specs/2026-10-28-floor-match-html-design.md): the page fills the screen under the shell's 56px header
// like /pos and /orders (the paper frame with its 1440px cap goes) and never scrolls itself; the HTML's screen is its own
// scroller, so ours is a flex column whose scroller (below the refresh strip, Task 5) holds the HTML's body with its
// padding and its 8px scrollbar. The shell header stays put above it (the HTML's header, sticky inside its scroller,
// moves 8px beside a classic scrollbar: values 12 #25, not copied).
//
// One place for the class strings the page renders. Every class name is written out here or in the shared constant it
// reads (POS_PAGE_CLASS, HTML_PRESS_CLASS, STATUS_CLASSES), so Tailwind's source scanner sees each one, and the pins
// (lib/floor-layout.test.ts, lib/floor-controls.test.ts) read the SAME constants the page renders. U3 Task 2 adds the
// controls row (the area tabs, the status pills, their fades) and the two scroll helpers.
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import type { FloorFilter } from "@/lib/floor-tiles";
import { POS_PAGE_CLASS } from "@/lib/pos-layout";
import { TABLES_FLOOR_PATH } from "@/lib/table-sections";
import { STATUS_CLASSES } from "@/lib/ui/status";

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

// ── The controls row (U3 Task 2; values 2.2-2.6, design 6.3, owner Q4) ──────────────────────────────────────────────

/** The row (values 2.2): the area tabs left, the status pills right, 10px apart; the pills take a second line (at the
 *  left) when both do not fit (820 and the phone with three areas). */
export const FLOOR_CONTROLS_CLASS = "flex flex-wrap items-center justify-between gap-2.5";

// Both rows scroll sideways when they do not fit, with no visible bar (values 2.4: the HTML's horizontal bar is 0 tall),
// and are each the positioned parent their buttons' offsetLeft is measured from (revealScrollLeft). A tab or a pill
// focused from the keyboard wears an inset 2px ring, so the row's scroll box never clips it and no padding changes the
// HTML's 36 / 32px heights (values 12 #9, not copied). Each presses like the HTML's buttons (values 6.2).
const ROW_SCROLL = "relative max-w-full overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
const FOCUS_RING = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary";

/** The area track (values 2.3): the HTML's segmented control, --surface-3, radius 8, padding 2, 2px between tabs. */
export const FLOOR_TABS_TRACK_CLASS = `flex gap-0.5 rounded-[8px] bg-surface-3 p-0.5 ${ROW_SCROLL}`;
/** A tab (values 2.3): 32px, radius 6, 0 14px, 13.5px 500 in --text, never wrapping (the flex default: its one-line
 *  word is its minimum, so it never shrinks below it). */
export const FLOOR_TAB_CLASS = `h-8 cursor-pointer whitespace-nowrap rounded-[6px] border-0 px-3.5 text-[13.5px] font-medium text-foreground ${FOCUS_RING} ${HTML_PRESS_CLASS}`;
/** The chosen tab: SEG_ON, the white chip with --seg-sh exactly (Tailwind's shadow-* would add four empty ring layers).
 *  --tw-shadow carries --seg-sh into the focus ring's composite, so under keyboard focus the chip keeps its shadow. */
export const FLOOR_TAB_ON_CLASS = "bg-seg [box-shadow:var(--seg-sh)] [--tw-shadow:var(--seg-sh)]";
/** The others: SEG_OFF, plus the kit's --hover where a pointer can hover (design 8 #12: the HTML has none). */
export const FLOOR_TAB_OFF_CLASS = "bg-transparent hover:bg-hover";

/** The pills row (values 2.4): 6px apart. */
export const FLOOR_PILLS_ROW_CLASS = `flex gap-1.5 ${ROW_SCROLL}`;
/** A pill (values 2.4): 32px, radius 999, a 1px border, 0 12px, 13px 500; dot, word and count 7px apart. */
export const FLOOR_PILL_CLASS = `flex h-8 flex-none cursor-pointer items-center gap-[7px] whitespace-nowrap rounded-[999px] border px-3 text-[13px] font-medium ${FOCUS_RING} ${HTML_PRESS_CLASS}`;
/** The chosen pill: --ink with on-ink text (values 2.4; on-ink, not the HTML's --surface, values 12 #24). */
export const FLOOR_PILL_ON_CLASS = "border-ink bg-ink text-on-ink";
/** The others: --surface, --border, --ink text, plus the kit's hover (design 8 #12). */
export const FLOOR_PILL_OFF_CLASS = "border-border bg-card text-ink hover:bg-hover";
/** The chosen pill's count: a grey that reads on ink, >= 4.5:1 from a token (design 8 #7: the HTML's is 3.36:1). */
export const FLOOR_PILL_COUNT_ON_CLASS = "text-on-ink-muted";
/** A pill's count: --text-3 (values 2.4). */
export const FLOOR_PILL_COUNT_OFF_CLASS = "text-subtle-foreground";
/** The pill's 8px dot (values 2.4); "All" has none. */
export const FLOOR_PILL_DOT_CLASS = "size-2 flex-none rounded-[50%]";

/** The status dots (values 2.4: --ok, --info, --bill, --res), the shared status vocabulary's. The one place the Floor
 *  names them: the tiles' tones read these too (ruling F2). */
export const FLOOR_FILTER_DOT: Record<Exclude<FloorFilter, "all">, string> = {
  free: STATUS_CLASSES.ok.dot,
  occupied: STATUS_CLASSES.info.dot,
  billed: STATUS_CLASSES.bill.dot,
  reserved: STATUS_CLASSES.reserved.dot,
};

/** The fades' frame (owner Q4): the row's own box, not scrolling, so a fade stays at the row's edge. */
export const FLOOR_FADE_WRAP_CLASS = "relative min-w-0 max-w-full";
const FADE = "pointer-events-none absolute w-6";
/** The pills' 24px fades into the page's --background (plain stops: WebView 109 has no mask-image / color-mix). */
export const FLOOR_FADE_PILLS = {
  start: `${FADE} inset-y-0 left-0 [background:linear-gradient(to_right,var(--background),transparent)]`,
  end: `${FADE} inset-y-0 right-0 [background:linear-gradient(to_left,var(--background),transparent)]`,
} as const;
/** The tabs' 24px fades into the track's own --surface-3, inside its 2px padding, so its rounded ends stay grey. */
export const FLOOR_FADE_TABS = {
  start: `${FADE} inset-y-0.5 left-0.5 rounded-l-[6px] [background:linear-gradient(to_right,var(--surface-3),transparent)]`,
  end: `${FADE} inset-y-0.5 right-0.5 rounded-r-[6px] [background:linear-gradient(to_left,var(--surface-3),transparent)]`,
} as const;

/** How far inside the row a revealed tab or pill lands: clear of the 24px fade and the track's 2px padding. */
export const FLOOR_REVEAL_MARGIN = 26;

/** Below this many px of hidden row a fade is not worth drawing (a rounding remainder, not a hidden pill). */
const FADE_TOLERANCE_PX = 1;

/** Which edges of a sideways row hide something (owner Q4): the start once scrolled, the end while more is to the right;
 *  none when it fits. */
export function edgeFades(m: { scrollLeft: number; scrollWidth: number; clientWidth: number }): { start: boolean; end: boolean } {
  const hidden = m.scrollWidth - m.clientWidth;
  return { start: m.scrollLeft > FADE_TOLERANCE_PX, end: hidden - m.scrollLeft > FADE_TOLERANCE_PX };
}

/**
 * The row's scrollLeft that shows the item whole, `margin` px clear of each edge, by the smallest change: unchanged when
 * it already is, else just far enough (its start first when it is wider than the row); never below 0 (the browser caps
 * the far end). The row's own scroll, never scrollIntoView, which would also scroll the page.
 */
export function revealScrollLeft(
  view: { scrollLeft: number; clientWidth: number },
  item: { offsetLeft: number; offsetWidth: number },
  margin: number,
): number {
  const start = item.offsetLeft - margin;
  const end = item.offsetLeft + item.offsetWidth + margin;
  if (start < view.scrollLeft) return Math.max(0, start);
  if (end > view.scrollLeft + view.clientWidth) return Math.max(0, Math.min(start, end - view.clientWidth));
  return view.scrollLeft;
}
