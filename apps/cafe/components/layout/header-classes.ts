// The page header's buttons (the owner's HTML, values 2.5; U0 Task 3), laid over the kit Button's outline and default
// looks (buttonVariants: 1px border colour, surface, radius 8, hover --hover; or the accent fill). cn()'s tailwind-merge
// lets each token here replace the kit's. The same sizes on touch screens (ruling R1). A page's own actions take the
// same look from app/globals.css ([data-header-actions], ruling R6), whatever classes the page gives them. Every one
// presses like the HTML's buttons (values 1.4, HTML_PRESS_CLASS).
import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { PRINTER_ICON_BUTTON_CLASS } from "@/components/print/printer-classes";

/** The header's 36px outline icon square (the HTML's printer button): the printer, Refresh and a back link. The printer's own pinned name for its size stays PRINTER_ICON_BUTTON_CLASS. */
export const HEADER_ICON_BUTTON_CLASS = `${PRINTER_ICON_BUTTON_CLASS} ${HTML_PRESS_CLASS}`;

/** An outline button with a label (the HTML's End of day): 36px, padding 0 12px, 13.5px/500, a 15px icon 7px away. */
export const HEADER_OUTLINE_BUTTON_CLASS =
  "h-9 flex-none gap-[7px] px-3 py-0 text-[13.5px] font-medium [&_svg]:size-[15px]" + " " + HTML_PRESS_CLASS;

/** The primary button (the HTML's New order): accent, hover accent-h, padding 0 14px, 13.5px/600, a 14px plus 6px away. */
export const HEADER_PRIMARY_BUTTON_CLASS =
  "h-9 flex-none gap-1.5 px-3.5 py-0 text-[13.5px] font-semibold hover:bg-primary-hover [&_svg]:size-[14px]" + " " + HTML_PRESS_CLASS;

/** New order on /tables (U3 Task 1; the Floor values 1.2, the HTML Floor header's "Takeaway" button; owner Q1, design
 *  6.1): the outline look — the kit outline's 1px --border, --surface and --text (laid over the kit's primary Button,
 *  whose accent fill and hover they replace), radius 8, 36px, padding 0 12px, 13.5px/500, the 14px plus 6px away;
 *  hover --surface-2 (the HTML's, not the kit outline's --hover). */
export const HEADER_FLOOR_NEW_ORDER_CLASS =
  "h-9 flex-none gap-1.5 border border-border bg-card px-3 py-0 text-[13.5px] font-medium text-foreground hover:bg-surface-2 [&_svg]:size-[14px]" + " " + HTML_PRESS_CLASS;
