// The page header's buttons (the owner's HTML, values 2.5; U0 Task 3), laid over the kit Button's outline and default
// looks (buttonVariants: 1px border colour, surface, radius 8, hover --hover; or the accent fill). cn()'s tailwind-merge
// lets each token here replace the kit's. The same sizes on touch screens (ruling R1). The 36px icon square (the
// printer, Refresh, the phone's menu and a back link) is PRINTER_ICON_BUTTON_CLASS in components/print/printer-classes.

/** An outline button with a label (the HTML's End of day): 36px, padding 0 12px, 13.5px/500, a 15px icon 7px away. */
export const HEADER_OUTLINE_BUTTON_CLASS = "h-9 flex-none gap-[7px] px-3 py-0 text-[13.5px] font-medium [&_svg]:size-[15px]";

/** The primary button (the HTML's New order): accent, hover accent-h, padding 0 14px, 13.5px/600, a 14px plus 6px away. */
export const HEADER_PRIMARY_BUTTON_CLASS =
  "h-9 flex-none gap-1.5 px-3.5 py-0 text-[13.5px] font-semibold hover:bg-primary-hover [&_svg]:size-[14px]";
