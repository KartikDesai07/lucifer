// CB-7 S3 — the class strings every scratch-card editor control shares, so a field, a Select and a button measure the
// same in the section, the grid and the side panel. Plain strings passed to the stock shadcn controls via className.

// The editor's control height: 44 px, the finger-safe floor (a counter tablet and a phone both hit it first time).
export const REWARD_CONTROL_CLASS = "h-11";
// A Select item: 44 px on touch.
export const REWARD_SELECT_ITEM_CLASS = "pointer-coarse:min-h-11";

// An Input dressed like the expense sheet's inputs (brand field border, text-base below md so iOS never zooms).
export const REWARD_FIELD_CLASS = `${REWARD_CONTROL_CLASS} border-brand-field bg-brand-slip px-3.5 text-base text-brand-ink shadow-none md:text-[15px]`;
// A Select trigger in the same look.
export const REWARD_SELECT_TRIGGER_CLASS = `${REWARD_FIELD_CLASS} data-[placeholder]:text-brand-muted focus:ring-[3px] focus:ring-brand-accent/25`;

// Buttons: 44 px tall; the icon-only ones are a 44 px square.
export const REWARD_BUTTON_CLASS = REWARD_CONTROL_CLASS;
export const REWARD_ICON_BUTTON_CLASS = "h-11 w-11 shrink-0";

// One reward inside the side panel, and a quiet note (a warning or a notice) on the page.
export const REWARD_CARD_CLASS = "space-y-3 rounded-lg border border-brand-rule bg-brand-slip p-3 sm:p-4";
export const REWARD_NOTE_CLASS = "rounded-md border border-brand-rule bg-brand-wash p-3 text-sm text-brand-ink";
