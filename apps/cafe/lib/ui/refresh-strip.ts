// A live page's refresh-failure strip (U3 Task 5 for the Floor; shared with the Kitchen in U4 Task 2, Kitchen design 6.2;
// components/shared/RefreshStrip.tsx). Ours (the owner's HTML has none), in the U0 order-request strip's look exactly
// (components/orders/RequestAlertBar.tsx, U0 design 5.3). Its class strings are written out again here (the U0 strip's
// file keeps its markup untouched); lib/floor-refresh-strip.test.ts holds both to the same tokens, so they never drift.
// lib/floor-layout.ts re-exports them under the Floor's FLOOR_REFRESH_STRIP_* names.

/** The band: one 40px line (min-h-10, py-1) from 720px, wrapping on a phone; the warn tint, its 13px ink, the hairline. */
export const REFRESH_STRIP_CLASS =
  "flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-status-warn-tint px-3 py-1 text-[13px] leading-[normal] text-status-warn-ink tab:px-5";
/** The 14px warn glyph and the words, 6px apart (the U0 button's icon gap). */
export const REFRESH_STRIP_MESSAGE_CLASS = "flex items-center gap-1.5";
export const REFRESH_STRIP_GLYPH_CLASS = "size-[14px] flex-none";
/** Try again: the U0 strip's 30px outline button (Enable sound), on the kit's outline Button. */
export const REFRESH_STRIP_BUTTON_CLASS =
  "h-[30px] gap-1.5 rounded-[8px] border border-border bg-card px-2.5 py-0 text-[13px] font-medium text-foreground hover:bg-hover [&_svg]:size-[14px]";
/** Its 44px hit area on touch (ruling R1: our control, no HTML element), drawn by an ::after so neither the button nor the
 *  strip grows. It starts 4px above the button (-5px from its padding box, inside the 1px border): on the 40px line the
 *  button sits 4.5px down (py-1 plus half the pixel the hairline leaves), so the area starts 0.5px inside the strip and the
 *  page's overflow clip never cuts it; it ends 10px past the button's foot, 4.5-5px into the scroller below the strip.
 *  That top area is empty only at scrollTop 0 (the Floor body's 20 / 16px, the Kitchen board's 16 / 12px top padding).
 *  Scrolled, positioned content (the Floor's tile wraps, tabs track and pills' fade wrap) paints above the overhang and
 *  keeps its own taps, so the band is about 40px there; a non-positioned element loses its top 4.5px to a harmless
 *  refetch (ruling F19). Wrapped on a phone, the button is the strip's last line and the area stays clear of the words
 *  above. */
export const REFRESH_STRIP_HIT_CLASS =
  "relative pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-top-[5px] pointer-coarse:after:h-11";
