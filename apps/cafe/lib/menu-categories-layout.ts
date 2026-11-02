// U5 Task 4 (2026-11-01): /categories in the owner's HTML (values 11 the view and its rows, 10 the category editor; design
// 6.10, 6.11). One place for the class strings the rows render, so Tailwind's source scanner sees each one and the pins
// (lib/menu-categories-layout.test.ts) read the SAME constants. The editor and the delete check reuse MENU_EDITOR_* /
// MENU_DIALOG_* (lib/menu-editor-layout.ts) and CONFIRM_SHEET_* (lib/sheet-frame.ts). WebView 109: no light-dark(), no
// color-mix(); hover only where a pointer can hover (R14).
import { FLOOR_FOCUS_RING_CLASS } from "@/lib/floor-tile-classes";
import { cn } from "@/lib/utils";

/** The phone (the HTML's `ph`, below 720px: Tailwind's max-tab) as a media query, for the one thing CSS cannot gate: the
 *  meta's " · No KOT" (the chips are hidden there). */
export const MENU_CATEGORIES_PHONE_QUERY = "(width < 45rem)";

/** The note (values 11): 13px --text-2, wrapped "pretty"; it never shrinks inside the scroller's column. */
export const CATEGORY_NOTE_CLASS = "flex-none text-[13px] text-muted-foreground text-pretty";
/** The card (values 11): --surface, a 1px --border, radius 12, clipped. */
export const CATEGORY_CARD_CLASS = "flex-none overflow-clip rounded-[12px] border border-border bg-card";
/** The list inside the card: no bullets, no margins. */
export const CATEGORY_LIST_CLASS = "m-0 list-none p-0";
/** A row (values 11): padding 10px 12px 10px 10px, 12px between the parts, a --border-2 rule above all but the first,
 *  --hover where a pointer can hover. */
export const CATEGORY_ROW_CLASS =
  "flex items-center gap-3 border-border-2 bg-card py-2.5 pr-3 pl-2.5 [&:not(:first-child)]:border-t pointer-fine:hover:bg-hover";

/** Our drag grip (no counterpart in the HTML): a 28px box, 44px hit area on touch (ruling R1) drawn by an ::after so the
 *  row does not grow. `touch-none` is the button's own literal in CategoryRow (the pin: only the handle). */
export const CATEGORY_GRIP_CLASS = cn(
  "relative flex size-7 flex-none cursor-grab items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-subtle-foreground pointer-fine:hover:text-foreground aria-disabled:opacity-30",
  "pointer-coarse:after:absolute pointer-coarse:after:-inset-2 pointer-coarse:after:content-['']",
  FLOOR_FOCUS_RING_CLASS,
);
/** The arrows (values 11): two 28x22 buttons stacked 2px apart; radius 6, --text-2, --surface-3 on hover; the first row's
 *  up and the last row's down at .3 (aria-disabled, today's R23: the focus is never dropped). */
export const CATEGORY_ARROWS_CLASS = "flex flex-none flex-col gap-0.5";
export const CATEGORY_ARROW_CLASS = `flex h-[22px] w-7 cursor-pointer items-center justify-center rounded-[6px] border-0 bg-transparent p-0 text-muted-foreground pointer-fine:hover:bg-surface-3 aria-disabled:cursor-default aria-disabled:opacity-30 aria-disabled:pointer-fine:hover:bg-transparent ${FLOOR_FOCUS_RING_CLASS}`;
/** The hue dot: 10px round, the colour inline (the POS hue by position). */
export const CATEGORY_DOT_CLASS = "size-2.5 flex-none rounded-[50%]";
/** The name block (a link to the category's items): the name 14.5px 600 over the meta 12.5px --text-3 with an ellipsis.
 *  The name wraps (a long unbroken name breaks anywhere, never a sideways scroll). */
export const CATEGORY_NAME_LINK_CLASS = `block min-w-0 flex-1 cursor-pointer text-left text-foreground no-underline ${FLOOR_FOCUS_RING_CLASS}`;
export const CATEGORY_NAME_CLASS = "block text-[14.5px] font-semibold [overflow-wrap:anywhere]";
export const CATEGORY_META_CLASS = "block overflow-hidden text-[12.5px] text-subtle-foreground whitespace-nowrap text-ellipsis";

/** The chips (values 11): 26px pills from 720px (hidden on a phone); the station --surface-3 / --text-2 12px 500, the No
 *  KOT --warn-t / --warn-i 12px 600; each with its glyph. */
export const CATEGORY_STATION_CHIP_CLASS =
  "flex h-[26px] flex-none items-center gap-1.5 rounded-[999px] bg-surface-3 pl-2 pr-2.5 text-[12px] font-medium whitespace-nowrap text-muted-foreground max-tab:hidden";
export const CATEGORY_NO_KOT_CHIP_CLASS =
  "flex h-[26px] flex-none items-center gap-[5px] rounded-[999px] bg-status-warn-tint pl-2 pr-[9px] text-[12px] font-semibold whitespace-nowrap text-status-warn-ink max-tab:hidden";

/** Edit and Delete (values 11): 34px, radius 8, a 16px glyph. Delete is --bad-i (--text-3 while the category holds items,
 *  with the reason as its title); both light --bad-t / --surface-3 where a pointer can hover. */
export const CATEGORY_ICON_BUTTON_CLASS = `flex size-[34px] flex-none cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent p-0 ${FLOOR_FOCUS_RING_CLASS}`;
export const CATEGORY_EDIT_CLASS = cn(CATEGORY_ICON_BUTTON_CLASS, "text-muted-foreground pointer-fine:hover:bg-surface-3");
export const CATEGORY_DELETE_CLASS = cn(CATEGORY_ICON_BUTTON_CLASS, "text-status-bad-ink pointer-fine:hover:bg-status-bad-tint");
export const CATEGORY_DELETE_BLOCKED_CLASS = cn(CATEGORY_ICON_BUTTON_CLASS, "text-subtle-foreground pointer-fine:hover:bg-status-bad-tint");

/** The loading card's rows and the empty box keep today's skeleton / EmptyState look inside the frame. */
export const CATEGORY_SKELETON_CLASS = "grid gap-2 rounded-[12px] border border-border bg-card p-4";
