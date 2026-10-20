import { HTML_PRESS_CLASS } from "@/components/brand/brand-classes";

// The sign-in and lock screens' own controls (U0 match Task 10). The owner's HTML has no password screen, so the
// username and password form takes its form style (design 5.6, ruling R31): 44px fields, radius 10, 15px text, 13/600
// labels, a 48px primary button with radius 10; a field's focus and error borders are the HTML's sign-in logic's
// (values 4.1: accent with a 4px accent-t ring, bad). The link buttons ("Forgot PIN?", "Sign in with PIN", the way to
// the password form) are the HTML's Forgot PIN? (values 4.4): no fill, link colour, 13.5/500, 4px padding. Plain
// class strings for the kit's Input/Label/Button (cn's tailwind-merge makes each REPLACE the kit's own); a leading-*
// always follows the text size, which tailwind-merge would otherwise drop.

/** A field label: 13px / 600 in the text colour. */
export const AUTH_LABEL_CLASS = "text-[13px] font-semibold leading-[normal] text-foreground";

/** A field: 44px, radius 10, 15px text, the border colour; focus = the accent border and a 4px accent-t ring; an
 *  invalid field = the bad border. A browser-filled field stays the card colour (an inset shadow is the one thing
 *  drawn over the browser's own autofill background). */
export const AUTH_INPUT_CLASS =
  "h-11 rounded-[10px] border border-border bg-card px-3 py-0 text-[15px] md:text-[15px] leading-[normal] text-foreground shadow-none placeholder:text-subtle-foreground focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-accent aria-invalid:border-status-bad [&:-webkit-autofill]:shadow-[inset_0_0_0_100px_var(--color-card)] [&:-webkit-autofill]:[-webkit-text-fill-color:var(--color-foreground)]";

/** The show/hide password control inside a field's right edge (pr-11 on the field keeps the text clear of it). */
export const AUTH_REVEAL_CLASS =
  "absolute inset-y-0 right-0 grid w-11 place-items-center rounded-r-[10px] text-subtle-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** A field's own error line, in bad-i. */
export const AUTH_FIELD_ERROR_CLASS = "text-[12px] leading-[normal] text-status-bad-ink";

/** A refused sign-in's message box: the bad tint with bad-i words; it shakes like the HTML's dots on each refusal. */
export const AUTH_ALERT_CLASS =
  "flex items-start gap-2 rounded-[10px] bg-status-bad-tint px-3 py-2.5 text-[13px] font-medium leading-[normal] text-status-bad-ink motion-safe:animate-html-shake";

/** The primary action: 48px, full width, radius 10, the accent with white 15/600 words, hover accent-h, the HTML's
 *  press. `group` lets the trailing arrow nudge on hover. */
export const AUTH_BUTTON_CLASS =
  "group h-12 w-full rounded-[10px] bg-primary text-[15px] font-semibold leading-[normal] text-primary-foreground shadow-none hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 " +
  HTML_PRESS_CLASS;

/** A link button (the HTML's Forgot PIN?): no fill, the link colour, 13.5/500, 4px padding, the HTML's press. */
export const AUTH_LINK_CLASS =
  "rounded-[6px] p-1 text-[13.5px] font-medium leading-[normal] text-link outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  HTML_PRESS_CLASS;
