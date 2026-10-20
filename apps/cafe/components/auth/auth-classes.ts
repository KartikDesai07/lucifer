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

/** A field: 44px, radius 10, the border colour; focus = the accent border and a 4px accent-t ring; an invalid field =
 *  the bad border. Text 16px below 720px (iPhone Safari zooms a field under 16px on focus, ruling R33), the HTML's
 *  15px from 720px; md:15px replaces the kit Input's own md:text-sm so 720-767px reads 15px too. A browser-filled
 *  field stays the card colour (an inset shadow is the one thing drawn over the browser's own autofill background). */
export const AUTH_INPUT_CLASS =
  "h-11 rounded-[10px] border border-border bg-card px-3 py-0 text-base tab:text-[15px] md:text-[15px] leading-[normal] text-foreground shadow-none placeholder:text-subtle-foreground focus-visible:border-primary focus-visible:ring-4 focus-visible:ring-accent aria-invalid:border-status-bad [&:-webkit-autofill]:shadow-[inset_0_0_0_100px_var(--color-card)] [&:-webkit-autofill]:[-webkit-text-fill-color:var(--color-foreground)]";

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

/** The login page's product logo (ruling R3: the login's mark; review m4). A square mark sits in the HTML's 34px tile
 *  on white; a wide wordmark keeps the login's own wide tile (34px tall, its own width up to 136px, bordered, the
 *  logo multiplied onto the card) so it never shrinks into a square. */
export function loginLogoClasses(wide: boolean): { tile: string; image: string } {
  return wide
    ? {
        tile: "flex h-[34px] min-w-[34px] max-w-[8.5rem] shrink-0 items-center justify-center overflow-hidden rounded-[9px] border border-border bg-card p-1",
        image: "h-full w-auto max-w-full object-contain mix-blend-multiply",
      }
    : {
        tile: "flex size-[34px] flex-none items-center justify-center overflow-hidden rounded-[9px] bg-white p-0.5",
        image: "h-full w-full object-contain",
      };
}

/** A loaded logo wider than it is tall (a wordmark); an image not read yet is not. */
export function isWideLogo(img: { naturalWidth: number; naturalHeight: number }): boolean {
  return img.naturalHeight > 0 && img.naturalWidth > img.naturalHeight;
}
