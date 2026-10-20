// Shared sizes and colours for the printer dot and the printer panel. Plain
// class strings (components/ui/** is never edited); cn()'s tailwind-merge makes
// each token REPLACE the shadcn default it sits next to.
import { STATUS_CLASSES } from "@/lib/ui";

/** A panel action: 44px tall, readable at arm's length on a counter tablet. */
export const PRINTER_ACTION_CLASS = "h-11 px-4 text-base";

/** A panel field: 44px, text-base at every width. The shared Input carries md:text-sm,
 *  which would shrink it below 16px on an iPad (iOS zooms the page on focus). */
export const PRINTER_INPUT_CLASS = "h-11 text-base md:text-base";

/** The page header's icon square (the owner's HTML printer button, values 2.5): 36px with a 17px icon, on the kit's
 *  outline Button; the same size on a touch screen (U0 ruling R1). Refresh, the phone's menu and a back link share it. */
export const PRINTER_ICON_BUTTON_CLASS = "relative h-9 w-9 flex-none px-1.5 py-px [&_svg]:size-[17px]";

/** The HTML's status dot: 10px on the button's corner (top/right -3px), a 2px ring in the surface colour. On the
 *  header button: the HTML's --ok green when printing works, its --warn orange when it does not (values 2.5). */
export const PRINTER_DOT_CLASS = "absolute -right-[3px] -top-[3px] size-2.5 rounded-[50%] [box-shadow:0_0_0_2px_var(--card)]";
export const PRINTER_DOT_OK_CLASS = STATUS_CLASSES.ok.dot;
export const PRINTER_DOT_WARN_CLASS = STATUS_CLASSES.warn.dot;
/** The Printer setup page's own dots: green connected, red a problem. */
export const PRINTER_DOT_BAD_CLASS = STATUS_CLASSES.bad.dot;

/** The 36px icon tile at the start of a panel header, a printer row and the status
 *  banner (the Settings hub's idiom). The colour comes from one of the tones below. */
export const PRINTER_TILE_CLASS = "grid h-9 w-9 shrink-0 place-items-center rounded-md";
export const PRINTER_TILE_BRAND_CLASS = "bg-brand-primary-soft text-brand-primary";
/** Neutral: no good/bad claim (the "checking" banner). */
export const PRINTER_TILE_NEUTRAL_CLASS = "bg-brand-wash text-brand-primary";
/** Status tints: -700 text on -50 is above 4.5:1; the words beside it carry the meaning. */
export const PRINTER_TILE_OK_CLASS = "bg-green-50 text-green-700";
export const PRINTER_TILE_BAD_CLASS = "bg-red-50 text-red-700";
