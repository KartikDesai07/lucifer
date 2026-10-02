// Shared sizes and colours for the printer dot and the printer panel. Plain
// class strings (components/ui/** is never edited); cn()'s tailwind-merge makes
// each token REPLACE the shadcn default it sits next to.

/** A panel action: 44px tall, readable at arm's length on a counter tablet. */
export const PRINTER_ACTION_CLASS = "h-11 px-4 text-base";

/** A panel field: 44px, text-base at every width. The shared Input carries md:text-sm,
 *  which would shrink it below 16px on an iPad (iOS zooms the page on focus). */
export const PRINTER_INPUT_CLASS = "h-11 text-base md:text-base";

/** The top-bar button: 40px with a mouse, 44px on a touch screen. */
export const PRINTER_ICON_BUTTON_CLASS = "relative h-10 w-10 pointer-coarse:h-11 pointer-coarse:w-11";

/** The dot on the button's corner; the ring keeps it legible over the icon. */
export const PRINTER_DOT_CLASS = "absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background";
export const PRINTER_DOT_OK_CLASS = "bg-green-600";
export const PRINTER_DOT_BAD_CLASS = "bg-red-600";

/** The 36px icon tile at the start of a panel header, a printer row and the status
 *  banner (the Settings hub's idiom). The colour comes from one of the tones below. */
export const PRINTER_TILE_CLASS = "grid h-9 w-9 shrink-0 place-items-center rounded-md";
export const PRINTER_TILE_BRAND_CLASS = "bg-brand-primary-soft text-brand-primary";
/** Neutral: no good/bad claim (the "checking" banner). */
export const PRINTER_TILE_NEUTRAL_CLASS = "bg-brand-wash text-brand-primary";
/** Status tints: -700 text on -50 is above 4.5:1; the words beside it carry the meaning. */
export const PRINTER_TILE_OK_CLASS = "bg-green-50 text-green-700";
export const PRINTER_TILE_BAD_CLASS = "bg-red-50 text-red-700";
