// The staff shell's phone numbers (U0 Task 4; the owner's HTML, values 2.1 and 2.6). Plain literals, so Tailwind's
// scanner sees the class below and the pins (lib/pos-layout.test.ts, lib/tab-bar-paths.test.ts) read the same values.

/** The phone's tab bar (components/layout/TabBar.tsx), fixed at the foot below 720 px (Tailwind `max-tab:`): a 1px
 *  top rule, 2px top padding and 56px tabs. env(safe-area-inset-bottom) is 0 without viewport-fit=cover. */
export const TAB_BAR_HEIGHT_PX = 59;

/** What the dashboard's <main> keeps clear at a phone's foot (values 2.1 screenPadB): the bar plus 33px of air. */
export const PHONE_PAGE_FOOT_PX = 92;

/** A page that lays out its own padding (the dashboard: the HTML's pagePad and screenPadB, values 3.0) bleeds over
 *  <main>'s: its padding `p-4 pb-[92px] tab:pb-4 md:p-6` (app/(dashboard)/layout.tsx), negated class for class, so the
 *  page is exactly as wide as <main> (the HTML's cw: the viewport minus the nav). */
export const MAIN_PADDING_BLEED_CLASS = "-m-4 -mb-[92px] tab:-mb-4 md:-m-6";

/** The HTML's pageIn (values 1.5 and 3.0, ruling R11): a page fades in from 6px below. */
export const PAGE_IN_KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: "translateY(6px)" },
  { opacity: 1, transform: "none" },
];
/** …over .4s on the HTML's shared easing, held at its start until it runs (`backwards`). */
export const PAGE_IN_TIMING: KeyframeAnimationOptions = { duration: 400, easing: "cubic-bezier(.2,.8,.2,1)", fill: "backwards" };

/** A sticky bar at a page's foot (Settings' save bar, the menu's bulk bar, the POS cart bar): on a phone it stops on
 *  the tab bar, never under it, however short the screen. */
export const ABOVE_TAB_BAR_STICKY_CLASS = "max-tab:bottom-[59px]";
