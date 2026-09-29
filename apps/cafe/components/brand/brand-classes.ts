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
 *  globals.css's `--radius: 0.75rem` makes `--radius-sm` resolve to 8px, so
 *  a "square" with a border-radius equal to half its side renders as a
 *  CIRCLE (owner: a checkbox reads like the app's round radio buttons).
 *  `--radius` is never touched here — it also shapes every card and button.
 *  `size-5` (20px, up from 16px) gives the kitchen tablet a bigger target
 *  while `rounded-[4px]` stays a visibly small corner, never a circle at any
 *  size; both tokens are named ahead of `className` in the ui Checkbox's own
 *  `cn(...)` call, so tailwind-merge replaces (never stacks with) its
 *  `h-4 w-4 rounded-sm`. The Indicator's `Check` icon is centred by the ui
 *  component's own `grid place-content-center`, independent of box size. */
export const BRAND_CHECKBOX_SQUARE_CLASS = "size-5 rounded-[4px]";

// ── Navigation (the staff sidebar; any later nav list reuses these) ─────────
// Passed to the stock shadcn SidebarMenuButton / SidebarMenuSubButton /
// SidebarGroupLabel via className; tailwind-merge replaces each primitive
// default they name. The icon-collapsed rail keeps the primitive's own
// important 32px square, so nothing here can push an icon out of the 3rem
// rail. The active row sits on the soft blue tint with its icon in the blue:
// the blue icon (4.5:1 on the tint), the heavier ink label (15.6:1) and
// aria-current carry the state, never the pale fill alone (White & Blue,
// 2026-09-29 — it replaced Paper & Ink's raised slip-of-paper row).

const NAV_ACTIVE =
  "data-[active=true]:bg-brand-primary-soft data-[active=true]:font-semibold data-[active=true]:text-brand-ink";

/** A top-level nav row: 32px on a mouse (the whole list fits a 768px-tall
 *  laptop screen without scrolling), 44px on touch (tablet / phone). */
export const BRAND_NAV_ITEM_CLASS =
  "h-8 gap-3 rounded-lg px-2.5 text-[14px] font-medium text-brand-ink/80 transition-colors duration-150 hover:bg-brand-wash hover:text-brand-ink active:bg-brand-wash focus-visible:ring-brand-accent pointer-coarse:h-11 group-data-[collapsible=icon]:justify-center [&>svg]:size-[18px] [&>svg]:text-brand-muted [&:hover>svg]:text-brand-ink [&[data-active=true]>svg]:text-brand-primary " +
  NAV_ACTIVE;

/** A row inside an expanded group (Settings' sections). */
export const BRAND_NAV_SUB_ITEM_CLASS =
  "h-7 rounded-md px-2.5 text-[13.5px] text-brand-ink/75 transition-colors duration-150 hover:bg-brand-wash hover:text-brand-ink active:bg-brand-wash focus-visible:ring-brand-accent pointer-coarse:h-10 " +
  NAV_ACTIVE;

/** A section heading in the nav: small, sentence case, muted (5.5:1 on the
 *  sidebar). In the icon rail the primitive fades it out (opacity-0) and pulls
 *  it up over the row above (the -mt below), and each SidebarGroup is
 *  `relative`, so the next group paints — and takes clicks — on top of the
 *  previous one: the invisible "Service" heading sat over the lower half of
 *  the Dashboard icon and swallowed the click (UI batch 1 C, measured in a real
 *  browser 2026-09-29). pointer-events-none makes the folded heading click-
 *  through, so the whole icon above it answers. */
export const BRAND_NAV_LABEL_CLASS =
  "h-6 px-2.5 text-[12px] font-medium tracking-[0.01em] text-brand-muted group-data-[collapsible=icon]:-mt-6 group-data-[collapsible=icon]:pointer-events-none";
