// "Paper & Ink" control styles — the shared look for fields, labels and the
// primary action on every screen that moves to the brand system. Plain class
// strings passed to the stock shadcn Button/Input/Label via className
// (components/ui/** is never edited); cn()'s tailwind-merge makes each token
// here REPLACE its shadcn default (h-9, border-input, shadow-sm, ring-ring…)
// rather than stack with it. Colours are the brand tokens in app/globals.css,
// all contrast-measured there.

/** Field label: sentence case, medium weight, ink — reads at a glance. */
export const BRAND_LABEL_CLASS = "text-[13px] font-medium text-brand-ink";

/** 48px tall (a counter keyboard and a thumb both hit it first time), a 3.6:1
 *  field border, and a terracotta focus halo that is visible on bright glass.
 *  text-base below md keeps iOS from zooming the page on focus. A browser-
 *  filled field stays paper-coloured: the autofill blue is the browser's own
 *  !important background, and an inset shadow is the one thing drawn over it. */
export const BRAND_INPUT_CLASS =
  "h-12 rounded-md border-brand-field bg-brand-slip px-3.5 text-base text-brand-ink shadow-none placeholder:text-brand-muted [&:-webkit-autofill]:shadow-[inset_0_0_0_100px_var(--color-brand-slip)] [&:-webkit-autofill]:[-webkit-text-fill-color:var(--color-brand-ink)] focus-visible:border-brand-ink focus-visible:ring-[3px] focus-visible:ring-brand-accent/25 md:text-[15px]";

/** The primary action: solid ink, never green (green is the "Completed"
 *  status colour). `group` lets a trailing arrow nudge on hover; a slight
 *  press-in on click (motion-safe) so a tap on glass feels registered. */
export const BRAND_BUTTON_CLASS =
  "group h-12 w-full rounded-md bg-brand-ink text-[15px] font-semibold tracking-wide text-brand-slip shadow-none transition-[background-color,transform] duration-150 hover:bg-brand-ink-hover focus-visible:ring-2 focus-visible:ring-brand-accent focus-visible:ring-offset-2 focus-visible:ring-offset-brand-slip motion-safe:active:scale-[0.985] disabled:opacity-60";

/** An inline error line under a field. */
export const BRAND_FIELD_ERROR_CLASS = "text-xs text-brand-danger";
