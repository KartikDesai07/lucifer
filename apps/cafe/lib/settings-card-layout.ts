// The settings pages in the new UI (Business details: docs/superpowers/plans/2026-11-06-settings-business-ui.md; GST &
// taxes: 2026-11-08-settings-taxes-ui.md; QR ordering: 2026-11-08-settings-qr-ui.md; Appearance:
// 2026-11-08-settings-appearance-ui.md; Rewards & loyalty: 2026-11-09-settings-loyalty-ui.md; Tokens & numbering:
// 2026-11-09-settings-tokens-ui.md): the class strings
// the settings cards render, in one place so Tailwind's source scanner sees each one and the pins
// (lib/settings-business-layout.test.ts) read the SAME constants. Field look = the U5 item editor's (re-exported below).
// Tokens only; WebView 109: no color-mix(), no light-dark(), no backdrop-blur, overflow-clip for clipping.
import { FLOOR_FOCUS_RING_CLASS } from "@/lib/floor-tile-classes";
import {
  MENU_EDITOR_CELL_LEFT_CLASS,
  MENU_EDITOR_CELL_RIGHT_CLASS,
  MENU_EDITOR_ERROR_CLASS,
  MENU_EDITOR_FIELD_CLASS,
  MENU_EDITOR_INPUT_CLASS,
  MENU_EDITOR_LABEL_CLASS,
  MENU_EDITOR_NUMBER_CLASS,
} from "@/lib/menu-editor-layout";

// ── The page grid ───────────────────────────────────────────────────────────────────────────────────────────────────

/** A settings page with a preview: one column; from 1280px the form beside a 340px column that holds the preview. */
export const SETTINGS_PREVIEW_GRID_CLASS =
  "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start xl:gap-5";
/** Each form card stays in column 1. */
export const SETTINGS_MAIN_CARD_CLASS = "xl:col-start-1";
/** Business details' Bill preview: sticky in column 2, spanning the five form rows (one declaration, row-start +
 *  row-span would fight). */
export const BUSINESS_PREVIEW_CLASS = "xl:sticky xl:top-20 xl:col-start-2 xl:[grid-row:1/span_5]";
/** GST & taxes' sample bill: the same, over its four form rows. */
export const TAXES_PREVIEW_CLASS = "xl:sticky xl:top-20 xl:col-start-2 xl:[grid-row:1/span_4]";
/** Appearance's menu preview: the same over its four form cards, and it scrolls inside itself (it can be taller than
 *  the screen between the 56px header and the Save bar). */
export const APPEARANCE_PREVIEW_CLASS =
  "xl:sticky xl:top-20 xl:col-start-2 xl:[grid-row:1/span_4] xl:max-h-[calc(100dvh-11rem)] xl:overflow-y-auto";
/** Tokens & numbering's slip preview: sticky in column 2 beside ONE stack of form cards (the slip design adds one or
 *  three cards, so a fixed row span would not cover them), and it scrolls inside itself like Appearance's. */
export const TOKENS_PREVIEW_CLASS =
  "xl:sticky xl:top-20 xl:col-start-2 xl:row-start-1 xl:max-h-[calc(100dvh-11rem)] xl:overflow-y-auto";
/** A settings page without a preview (QR ordering): its cards in one column at every width. */
export const SETTINGS_STACK_CLASS = "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4";

// ── The card ────────────────────────────────────────────────────────────────────────────────────────────────────────

export const SETTINGS_CARD_CLASS = "min-w-0 scroll-mt-20 rounded-[12px] border border-border bg-card text-foreground";
export const SETTINGS_CARD_HEAD_CLASS = "border-b border-border-2 px-[18px] pt-4 pb-3.5 max-tab:px-4";
/** An h2: the shell's header holds the page's h1. */
export const SETTINGS_CARD_TITLE_CLASS = "text-[15px] font-semibold leading-snug";
export const SETTINGS_CARD_SUB_CLASS = "mt-0.5 text-[13px] text-muted-foreground text-pretty";
export const SETTINGS_CARD_BODY_CLASS =
  "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 px-[18px] pt-4 pb-[18px] max-tab:px-4";

/** A block inside a card body: a rule above it, except the first. */
export const SETTINGS_BLOCK_CLASS =
  "grid min-w-0 scroll-mt-20 grid-cols-[minmax(0,1fr)] gap-3 border-t border-border-2 pt-4 first:border-t-0 first:pt-0";
/** An h3. */
export const SETTINGS_BLOCK_TITLE_CLASS = "text-[14px] font-semibold";
export const SETTINGS_BLOCK_SUB_CLASS = "mt-0.5 text-[12.5px] text-muted-foreground text-pretty";

export const SETTINGS_HINT_CLASS = "text-[12.5px] leading-snug text-muted-foreground text-pretty";
/** A quiet notice inside a card body (Rewards & loyalty: "Scratch-card levels are on", a blocked feature), on the list
 *  row colours. */
export const SETTINGS_NOTE_CLASS =
  "rounded-[10px] border border-border-2 bg-surface-2 p-3 text-[13.5px] text-foreground text-pretty";
/** A warning inside a card body (Tokens: no bill printer takes the slips; a saved slip design that could not be read):
 *  the note's shape on the bad rule. */
export const SETTINGS_ALERT_CLASS =
  "rounded-[10px] border border-status-bad bg-card p-3 text-[13.5px] text-foreground text-pretty";
export const SETTINGS_LINK_CLASS = "font-medium text-primary underline underline-offset-2";

// ── Fields: the U5 editor's look, one source ────────────────────────────────────────────────────────────────────────

export const SETTINGS_FIELD_CLASS = MENU_EDITOR_FIELD_CLASS;
export const SETTINGS_LABEL_CLASS = MENU_EDITOR_LABEL_CLASS;
export const SETTINGS_ERROR_CLASS = MENU_EDITOR_ERROR_CLASS;
export const SETTINGS_INPUT_CLASS = MENU_EDITOR_INPUT_CLASS;
export const SETTINGS_CELL_LEFT_CLASS = MENU_EDITOR_CELL_LEFT_CLASS;
export const SETTINGS_CELL_RIGHT_CLASS = MENU_EDITOR_CELL_RIGHT_CLASS;
export const SETTINGS_NUMBER_CLASS = MENU_EDITOR_NUMBER_CLASS;

/** The kit select's trigger: 42px, 16px text on a phone (no zoom), the chevron in a readable colour. */
export const SETTINGS_SELECT_TRIGGER_CLASS =
  "h-[42px] w-full min-w-0 rounded-[10px] border border-border bg-card px-3 text-[14.5px] text-foreground max-tab:text-base [&>svg]:text-muted-foreground [&>svg]:opacity-100";
/** A number with a unit cell (left or right) in one box; the box takes the focus ring and the red rule. */
export const SETTINGS_UNIT_BOX_CLASS =
  "flex h-[42px] w-full max-w-[200px] items-center overflow-clip rounded-[10px] border border-border bg-card focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-1 has-[input[aria-invalid=true]]:border-status-bad";

/** A switch row: the whole row is the label, 44px tall. */
export const SETTINGS_SWITCH_ROW_CLASS = "flex min-h-11 cursor-pointer items-center justify-between gap-3";

/** A picture/example tile around a hidden radio (New order layout, How prices work); the ring follows the radio's focus. */
export const SETTINGS_TILE_CLASS =
  "flex cursor-pointer flex-col gap-2 rounded-[12px] border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary has-[:focus-visible]:ring-offset-1";
export const SETTINGS_TILE_ON_CLASS = "border-primary bg-status-info-tint";
export const SETTINGS_TILE_OFF_CLASS = "border-border bg-card pointer-fine:hover:bg-hover";
/** The tile's drawn radio: the ring, and the dot inside it while selected. */
export const SETTINGS_TILE_RADIO_CLASS = "grid h-4 w-4 shrink-0 place-items-center rounded-full border";
export const SETTINGS_TILE_RADIO_ON_CLASS = "border-primary";
export const SETTINGS_TILE_RADIO_OFF_CLASS = "border-subtle-foreground";
export const SETTINGS_TILE_DOT_CLASS = "h-2 w-2 rounded-full bg-primary";

/** A one-tap choice button (the GST rates): 42px; the selected one in the primary rule on the info tint. */
export const SETTINGS_CHIP_CLASS = `inline-flex h-[42px] min-w-16 cursor-pointer items-center justify-center rounded-[10px] border px-3 text-[14px] font-semibold tabular-nums text-foreground ${FLOOR_FOCUS_RING_CLASS}`;
export const SETTINGS_CHIP_ON_CLASS = "border-primary bg-status-info-tint";
export const SETTINGS_CHIP_OFF_CLASS = "border-border bg-card pointer-fine:hover:bg-hover";

/** A one-of-a-few choice (Percent off / Amount off): equal-width 42px options in a row, each a label around a hidden
 *  radio, so the ring follows the radio's focus. Selected / at rest: the chip colours above. */
export const SETTINGS_CHOICE_CLASS =
  "flex h-[42px] min-w-0 flex-1 cursor-pointer items-center justify-center rounded-[10px] border px-3 text-[14px] font-semibold text-foreground transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary has-[:focus-visible]:ring-offset-1";

/** One row of a repeating list (UPI slabs, promo codes, announcements), its title, and the list's no-rows-yet box. */
export const SETTINGS_LIST_ROW_CLASS = "grid gap-3 rounded-[10px] border border-border-2 bg-surface-2 p-3";
export const SETTINGS_LIST_ROW_TITLE_CLASS = "min-w-0 truncate text-[14px] font-semibold text-foreground";
export const SETTINGS_LIST_EMPTY_CLASS = "rounded-[10px] border border-dashed border-border p-4 text-[13.5px] text-muted-foreground";

export const SETTINGS_ADD_BUTTON_CLASS =`inline-flex h-[42px] cursor-pointer items-center gap-1.5 self-start justify-self-start rounded-[10px] border border-dashed border-subtle-foreground bg-transparent px-3.5 text-[13.5px] font-semibold text-foreground pointer-fine:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 ${FLOOR_FOCUS_RING_CLASS}`;
export const SETTINGS_REMOVE_BUTTON_CLASS = `inline-flex h-[42px] cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border-0 bg-transparent px-3 text-[13.5px] font-semibold text-status-bad-ink pointer-fine:hover:bg-status-bad-tint disabled:cursor-not-allowed disabled:opacity-50 ${FLOOR_FOCUS_RING_CLASS}`;

/** The kit Button in the card look, 42px: the main one (default variant) and the plain one (Discard, Use the theme's
 *  colour). */
export const SETTINGS_BUTTON_CLASS = "h-[42px] rounded-[10px] px-5 text-[14.5px] font-semibold";
export const SETTINGS_OUTLINE_BUTTON_CLASS =
  "h-[42px] rounded-[10px] border border-border bg-card px-4 text-[14px] font-semibold text-foreground pointer-fine:hover:bg-hover";

// ── The card Save bar (opt-in: SettingsSaveBar look="card") ─────────────────────────────────────────────────────────

export const SETTINGS_SAVE_BAR_CARD_CLASS =
  "sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[12px] border border-border bg-card px-4 py-3 [box-shadow:var(--pop)] pb-[calc(0.75rem+env(safe-area-inset-bottom))]";
export const SETTINGS_SAVE_DISCARD_CLASS = SETTINGS_OUTLINE_BUTTON_CLASS;
export const SETTINGS_SAVE_SUBMIT_CLASS = SETTINGS_BUTTON_CLASS;
