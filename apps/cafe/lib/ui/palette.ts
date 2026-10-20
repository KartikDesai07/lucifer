// The sign-in pad's keys (values 4.4 keyH): 62px on a phone, 60px from 720px (the HTML's breakpoint, `tab:`).
export const PIN_KEY_CLASS = "h-[62px] tab:h-[60px]";

/** Sales by category's hues (values 3.13, ruling R20; staff screens only): the owner's HTML's five section hues
 *  (SEC_HUE: Starters, Mains, Sides, Drinks, Desserts), handed out by rank, the same in light and dark as the HTML's.
 *  A sixth row (our "Other categories") takes the HTML's own fallback, text-3. */
export const CATEGORY_HUES = ["#e8590c", "#c92a2a", "#d19a00", "#1c7ed6", "#ae3ec9"] as const;
export const CATEGORY_FALLBACK_HUE = "var(--subtle-foreground)";
export const categoryHue = (rank: number): string => CATEGORY_HUES[rank] ?? CATEGORY_FALLBACK_HUE;
