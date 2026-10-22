// The owner's HTML sheet frame, written once (U1 audit wave, ruling P54; values 0.3 sheetAlign / sheetPad / sheetRadius /
// csMaxH and 10.1, with 8.1-8.3, 9.1, 11.1 and 12.1, in docs/superpowers/specs/2026-10-20-pos-html-values.md). The /pos
// sheets — the item options (ModifierModal), the void dialog, the payment sheet, the table picker and the move dialog
// (lib/table-sheet.ts), the customer sheet and the confirm sheet (ConfirmDialog) — drew the scrim, the panel, the 46px
// stepper, the 48px field, the foot and the round ✕ from byte-for-byte copies; they import these parts now, so a later
// change (a breakpoint, a radius, a cap) cannot drift between them.
//
// What differs per sheet stays a literal at its call site — the scrim's z-index, the panel's width, border, overflow,
// gap, padding and its sheetIn — composed with cn(): none of the parts conflict under tailwind-merge, so every element
// keeps exactly the class set it had (lib/sheet-frame.test.ts). Every string here is a plain literal, so Tailwind's
// source scanner sees each class. Pure: no React, no fetching; client-safe.

/** The scrim (values 0.3 sheetAlign / sheetPad; 8.1, 9.1, 10.1, 11.1, 12.1): fixed over the window, --scrim, fadeIn .2s;
 *  the panel centred in 16px, along the window's foot with no padding below 720px; the HTML sets no line-height on a
 *  sheet: normal. The z-index is the caller's literal: 20 for the item options (over the phone's tab bar), 46 for the
 *  table picker (the HTML's, over the cart and its sheet), 50 for the void, payment, move and confirm sheets. */
export const SHEET_SCRIM_BASE =
  "fixed inset-0 flex items-center justify-center bg-scrim p-4 font-sans leading-[normal] text-foreground motion-safe:animate-scrim-in max-tab:items-end max-tab:p-0";

/** The panel (values 0.3 sheetRadius; 8.1, 9.1, 10.1, 11.1, 12.1): a full-width column on --surface up to the caller's
 *  max-w, radius 14 (14 14 0 0 below 720px, where it lies along the window's foot), --pop, no outline. The caller adds
 *  its width (420 / 440 / 460 / 600px), its 1px --border or none, its overflow, gap and padding, and its sheetIn (.34s;
 *  .32s for the table and customer sheets). */
export const SHEET_PANEL_BASE =
  "flex w-full flex-col rounded-[14px] bg-card [box-shadow:var(--pop)] outline-none max-tab:rounded-[14px_14px_0_0]";

/** The sheets' height caps (values 0.3 csMaxH): 100dvh - 32px, 88dvh below 720px — the vh caps are the base, the dvh
 *  ones where they exist. A panel is content-sized up to them and its body scrolls (every sheet but the confirm). */
export const SHEET_PANEL_CAP_CLASS =
  "tab:max-h-[calc(100vh-32px)] tab:supports-[height:1dvh]:max-h-[calc(100dvh-32px)] max-tab:max-h-[88vh] max-tab:supports-[height:1dvh]:max-h-[88dvh]";

/** The quantity stepper (values 10.1): 46px, a 1px --border, radius 10; "−" / "+" 42x44, 18px --text with the UA's 1px
 *  6px (the HTML sets none; the buttons add the HTML's press, BRAND_PRESS_CLASS); the qty 15px 600, at least 24px. */
export const SHEET_STEPPER_CLASS = "flex h-[46px] items-center rounded-[10px] border border-border";
export const SHEET_STEP_CLASS = "h-11 w-[42px] cursor-pointer border-0 bg-transparent px-1.5 py-px text-[18px] text-foreground";
export const SHEET_QTY_CLASS = "min-w-6 text-center text-[15px] font-semibold";

/** The 48px field (values 8.3): radius 12, a 1.5px --border rule, 0 12px, 15px (16px below 720px, ruling R36), the
 *  --text-3 placeholder. On the kit Input it replaces the kit's height, radius and type through tailwind-merge (the
 *  kit's focus ring stays). */
export const SHEET_FIELD_CLASS =
  "h-12 rounded-[12px] border-[1.5px] border-border px-3 py-0 text-[15px] leading-[normal] placeholder:text-subtle-foreground md:text-[15px] max-tab:text-base";

/** The foot (values 8.2): 12px 16px and 14px + the bottom safe-area inset, its controls 8px apart, a --border-2 rule. */
export const SHEET_FOOT_CLASS =
  "flex flex-none flex-col gap-2 border-t border-border-2 px-4 pt-3 pb-[calc(14px+env(safe-area-inset-bottom))]";

/** The head's round ✕ (values 8.1, 9.1): 32px on --surface-3, --text-2, the UA's 1px 6px (the HTML sets none). */
export const SHEET_CLOSE_CLASS =
  "flex size-8 flex-none cursor-pointer items-center justify-center rounded-[50%] border-0 bg-surface-3 px-1.5 py-px text-muted-foreground";
