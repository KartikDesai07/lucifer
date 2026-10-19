// Brand control styles (White & Blue since 2026-09-29; first built as "Paper & Ink") — the shared look for fields, labels and the
// primary action on every screen that moves to the brand system. Plain class
// strings passed to the stock shadcn Button/Input/Label via className
// (components/ui/** is never edited); cn()'s tailwind-merge makes each token
// here REPLACE its shadcn default (h-9, border-input, shadow-sm, ring-ring…)
// rather than stack with it. Colours are the brand tokens in app/globals.css,
// all contrast-measured there.

/** Field label: sentence case, medium weight, ink — reads at a glance. */
export const BRAND_LABEL_CLASS = "text-[13px] font-medium text-brand-ink";

/** 48px tall (a counter keyboard and a thumb both hit it first time), a 3.6:1
 *  field border, and a blue focus halo that is visible on bright glass.
 *  text-base below md keeps iOS from zooming the page on focus. A browser-
 *  filled field stays the card colour: the autofill blue is the browser's own
 *  !important background, and an inset shadow is the one thing drawn over it. */
export const BRAND_INPUT_CLASS =
  "h-12 rounded-md border-brand-field bg-brand-slip px-3.5 text-base text-brand-ink shadow-none placeholder:text-brand-muted [&:-webkit-autofill]:shadow-[inset_0_0_0_100px_var(--color-brand-slip)] [&:-webkit-autofill]:[-webkit-text-fill-color:var(--color-brand-ink)] focus-visible:border-brand-primary focus-visible:ring-[3px] focus-visible:ring-brand-accent/25 md:text-[15px]";

/** The primary action: solid blue (--brand-primary), never green (green is
 *  the "Completed" status colour). `group` lets a trailing arrow nudge on hover; a slight
 *  press-in on click (motion-safe) so a tap on glass feels registered. */
export const BRAND_BUTTON_CLASS =
  "group h-12 w-full rounded-md bg-brand-primary text-[15px] font-semibold tracking-wide text-brand-slip shadow-none transition-[background-color,transform] duration-150 hover:bg-brand-primary-hover focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 focus-visible:ring-offset-brand-slip motion-safe:active:scale-[0.985] disabled:opacity-60";

/** An inline error line under a field. */
export const BRAND_FIELD_ERROR_CLASS = "text-xs text-brand-danger";

/** components/ui/checkbox.tsx's own box is `h-4 w-4 rounded-sm` — 16px, and
 *  globals.css's `--radius` (0.75rem until U0, 0.625rem since) made
 *  `--radius-sm` resolve to 8px (6px since), so a "square" with a
 *  border-radius equal to half its side rendered as a CIRCLE (owner: a
 *  checkbox read like the app's round radio buttons).
 *  `--radius` is never touched here — it also shapes every card and button.
 *  `size-5` (20px, up from 16px) gives the kitchen tablet a bigger target
 *  while `rounded-[4px]` stays a visibly small corner, never a circle at any
 *  size; both tokens are named ahead of `className` in the ui Checkbox's own
 *  `cn(...)` call, so tailwind-merge replaces (never stacks with) its
 *  `h-4 w-4 rounded-sm`. The Indicator's `Check` icon is centred by the ui
 *  component's own `grid place-content-center`, independent of box size. */
export const BRAND_CHECKBOX_SQUARE_CLASS = "size-5 rounded-[4px]";

// ── Navigation (the staff nav: the owner's HTML, values 2.3) ─────────────────
// Plain class strings for the nav's own elements (no shadcn menu primitive).
// The bare classes are the 76 px rail (720 px up); `wide:` is the HTML's wide
// form (1280 px up while the nav is not collapsed, and the phone's nav sheet;
// the variant is in app/globals.css). The HTML's sizes on touch screens too:
// no pointer-coarse enlargement (plan ruling R1). The active row is white on
// --nav-on with the 3px blue bar at the window's edge; aria-current, the bar
// and the white label carry the state, never the fill alone.

/** The HTML's button feel (values 1.4): colours ease in 160 ms, a press scales to 97 %; the nav's focus ring. */
export const BRAND_NAV_PRESS_CLASS =
  "outline-none transition-[background-color,color,transform] duration-[160ms] ease-[ease] focus-visible:ring-2 focus-visible:ring-brand-nav-focus active:scale-[0.97]";

const NAV_ACTIVE = "data-[active=true]:bg-nav-on data-[active=true]:text-white";

/** The nav column: 12px 8px padding in the rail, 12px 10px wide, a 2px gap between its rows. */
export const BRAND_NAV_CLASS =
  "flex min-h-0 flex-1 flex-col gap-0.5 bg-nav px-2 py-3 font-sans leading-[normal] text-nav-t wide:px-2.5";

/** The groups' scroller: it bleeds to the nav's edges so the active bar at the window's edge is never clipped, and
 *  carries the HTML's 8px scrollbar (values 1.4). */
export const BRAND_NAV_SCROLL_CLASS =
  "-mx-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overflow-x-hidden px-2 wide:-mx-2.5 wide:px-2.5 [&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-[8px] [&::-webkit-scrollbar-thumb]:bg-border";

/** A top-level row: 60x52 in the rail (the icon over a 10.5px label), 38px tall at 13.5px in the wide form. */
export const BRAND_NAV_ITEM_CLASS =
  "group/item relative flex w-full flex-none flex-col items-center gap-1 rounded-[8px] px-0 pb-1.5 pt-2 text-left text-[10.5px] font-medium text-nav-t hover:bg-nav-on hover:text-white wide:min-h-[38px] wide:flex-row wide:gap-2.5 wide:px-2.5 wide:py-0 wide:text-[13.5px] " +
  BRAND_NAV_PRESS_CLASS +
  " " +
  NAV_ACTIVE;

/** A row with sub-pages: lit (data-active) on any of its pages, as in the rail; in the wide form, while its sub-rows
 *  are open and the current page is one of them (data-sub-current), the lit sub-row shows instead. */
export const BRAND_NAV_GROUP_ROW_CLASS =
  BRAND_NAV_ITEM_CLASS +
  " wide:group-data-[state=open]/collapsible:data-[sub-current=true]:bg-transparent wide:group-data-[state=open]/collapsible:data-[sub-current=true]:text-nav-t wide:group-data-[state=open]/collapsible:data-[sub-current=true]:hover:bg-nav-on wide:group-data-[state=open]/collapsible:data-[sub-current=true]:hover:text-white";

/** The 3px blue bar on the active row, flush with the window's left edge. */
export const BRAND_NAV_BAR_CLASS =
  "pointer-events-none absolute -left-2 top-[9px] bottom-[9px] w-[3px] rounded-r-[3px] bg-brand-accent opacity-0 [transform:scaleY(0)] [transition:opacity_.25s,transform_.3s] group-data-[active=true]/item:opacity-100 group-data-[active=true]/item:[transform:scaleY(1)] wide:-left-2.5 wide:group-data-[state=open]/collapsible:group-data-[sub-current=true]/item:opacity-0";

/** A row's label: under the icon in the rail, filling the row in the wide form. */
export const BRAND_NAV_TEXT_CLASS = "whitespace-nowrap wide:flex-1";

/** A count on a row (Order Requests): the HTML's grey pill, wide form only. */
export const BRAND_NAV_BADGE_CLASS =
  "hidden h-5 min-w-5 flex-none items-center justify-center rounded-[10px] bg-nav-2 px-1.5 text-[11.5px] font-semibold text-nav-t wide:inline-flex";

/** A group's heading (Operate, Manage): wide form only. */
export const BRAND_NAV_LABEL_CLASS =
  "hidden px-2.5 pb-1.5 pt-3.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-nav-t2 wide:block";

/** The rule before every group after the first: rail only. */
export const BRAND_NAV_SEPARATOR_CLASS = "mx-3.5 my-2 h-px flex-none bg-nav-2 wide:hidden";

/** A sub-page row under an expanded row (wide form): 34px, 13px, its text at the parent label's x. */
export const BRAND_NAV_SUB_ITEM_CLASS =
  "peer/sub relative ml-[30px] flex h-[34px] min-w-0 items-center rounded-[8px] px-2.5 text-[13px] font-medium text-nav-t hover:bg-nav-on hover:text-white " +
  BRAND_NAV_PRESS_CLASS +
  " " +
  NAV_ACTIVE;

/** The active sub-row's bar, at the window's edge like a row's. */
export const BRAND_NAV_SUB_BAR_CLASS =
  "pointer-events-none absolute -left-2.5 top-[9px] bottom-[9px] w-[3px] rounded-r-[3px] bg-brand-accent opacity-0 [transition:opacity_.25s] peer-data-[active=true]/sub:opacity-100";

/** Collapse / Expand: 1280 px and up only, 34px, 12.5px nav-t2; the chevron alone when collapsed. */
export const BRAND_NAV_COLLAPSE_CLASS =
  "hidden h-[34px] w-full flex-none items-center justify-center gap-2.5 rounded-[8px] px-2.5 text-[12.5px] text-nav-t2 hover:bg-nav-on hover:text-white xl:flex wide:justify-start " +
  BRAND_NAV_PRESS_CLASS;

/** The rail's flyout: the profile sheet's panel (values 2.7: surface, 1px border, radius 14, the pop shadow). */
export const BRAND_NAV_FLYOUT_CLASS =
  "w-60 rounded-[14px] border border-border bg-card p-1.5 font-sans leading-[normal] text-foreground shadow-pop";

/** A flyout row: the profile sheet's row (9px 10px, 14px 500, hover --hover); the current page on the accent tint. */
export const BRAND_NAV_FLYOUT_ITEM_CLASS =
  "flex w-full items-center rounded-[8px] px-2.5 py-[9px] text-[14px] font-medium text-foreground outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring data-[active=true]:bg-accent data-[active=true]:text-accent-foreground";

// ── List screens (Orders, Order Requests, Kitchen, Reservations, Customers,
// Events, Staff — the polish pass of 2026-10-01) ────────────────────────────
// One place for the three things every list screen repeats, so a filter, a
// row action and a panel look and measure the same on every page.

/** A search box, filter select, date picker or page-level button: 40px tall,
 *  the finger-safe floor (the stock h-9 / size="sm" h-8 miss it on a phone). */
export const BRAND_CONTROL_CLASS = "h-10";

/** An icon-only row action: a 44px square on a phone, 40px from md up — the
 *  Tables Setup row idiom (components/tables/AreaRow.tsx). */
export const BRAND_ROW_ACTION_CLASS = "h-11 w-11 md:h-10 md:w-10";

/** A white panel on the paper page (a table wrapper, a row card, a skeleton
 *  box): without a fill a bordered box reads as a hole in bg-brand-paper. */
export const BRAND_PANEL_CLASS = "border-brand-rule bg-brand-slip";

/** On a list table's panel: its width never follows the table inside it. A
 *  table's min-content width otherwise widens the whole page past the screen
 *  (measured: 80px sideways scroll on Orders at 1024px, even inside the shell's
 *  min-w-0 column); a table wider than its panel scrolls inside the ui Table's
 *  own overflow-auto box instead. The Menu toolbar precedent. */
export const BRAND_TABLE_CONTAIN_CLASS = "[contain:inline-size]";
