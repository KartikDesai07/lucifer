// U5 Task 3 (2026-11-01): the Menu's item editor and its dialogs, the owner's HTML (values
// docs/superpowers/specs/2026-10-31-menu-printer-html-values.md 9 and 10; design 6.9; owner Q9). One place for the class
// strings the editor renders, so Tailwind's source scanner sees each one and the pins (lib/menu-editor-layout.test.ts)
// read the SAME constants. Task 4 reuses MENU_DIALOG_* for the category editor.
//
// The editor is a right-hand aside (500px, scrim z 45 / aside z 46, sheetIn .3s) from 1280px and the full-screen bottom
// sheet below it (owner rule 2026-10-22: U2's frame, one constant). WebView 109: no light-dark(), no color-mix(); flex
// buttons' children stretch by their own classes.
import { FLOOR_FOCUS_RING_CLASS } from "@/lib/floor-tile-classes";
import { ORDER_DETAIL_SHEET_CLASS, ORDER_DETAIL_SHEET_SCRIM_CLASS } from "@/lib/orders-layout";
import { SHEET_CLOSE_CLASS, SHEET_PANEL_BASE, SHEET_PANEL_CAP_CLASS, SHEET_SCRIM_BASE } from "@/lib/sheet-frame";
import { cn } from "@/lib/utils";

// ── The frame (values 9.1) ──────────────────────────────────────────────────────────────────────────────────────────

/** The side aside shows from here (the owner's right-side panel rule). */
export const MENU_EDITOR_XL_QUERY = "(min-width: 1280px)";
/** The scrim (values 9.1): over the window at z 45, --scrim, fadeIn .2s; a tap closes. */
export const MENU_EDITOR_SCRIM_CLASS = "fixed inset-0 z-[45] bg-scrim motion-safe:animate-scrim-in";
/** The aside: 500px on --surface, a 1px --border rule on its left, --pop, z 46, sheetIn .3s; a column. */
export const MENU_EDITOR_SIDE_CLASS =
  "fixed inset-y-0 right-0 z-[46] flex min-h-0 w-[500px] flex-col border-l border-border bg-card font-sans leading-[normal] text-foreground outline-none [box-shadow:var(--pop)] motion-safe:animate-html-sheet-in-op";
/** Below 1280px: U2's bottom sheet (the /pos cart sheet's constant), its scrim never drawn. */
export const MENU_EDITOR_SHEET_CLASS = ORDER_DETAIL_SHEET_CLASS;
export const MENU_EDITOR_SHEET_SCRIM_CLASS = ORDER_DETAIL_SHEET_SCRIM_CLASS;

/** The head (values 9.1): padding 16px 18px 14px, 12px between the words and the close, a --border rule below. */
export const MENU_EDITOR_HEAD_CLASS = "flex flex-none items-start gap-3 border-b border-border px-[18px] pt-4 pb-3.5";
export const MENU_EDITOR_TITLE_CLASS = "text-[18px] font-semibold";
export const MENU_EDITOR_SUB_CLASS = "mt-0.5 text-[13px] text-muted-foreground [overflow-wrap:anywhere]";
/** The 34px round close: --surface-3, --text-2, a 12px "✕" (the HTML sets no hover). */
export const MENU_EDITOR_CLOSE_CLASS = `flex size-[34px] flex-none cursor-pointer items-center justify-center rounded-[50%] border-0 bg-surface-3 px-1.5 py-px text-[12px] text-muted-foreground ${FLOOR_FOCUS_RING_CLASS}`;
/** The form: the body and the footer under the head (the footer's Save submits it). */
export const MENU_EDITOR_FORM_CLASS = "flex min-h-0 flex-1 flex-col";
/** The body (values 9.1): the one scroller, a grid 20px apart, padding 16px 18px 22px. */
export const MENU_EDITOR_BODY_CLASS =
  "grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] content-start auto-rows-max gap-5 overflow-y-auto overflow-x-clip px-[18px] pt-4 pb-[22px]";
/** The fixed footer (values 9.1): 12px 18px and the bottom inset (14px + inset; 12px + inset on a phone: cartFootB), 8px apart. */
export const MENU_EDITOR_FOOT_CLASS =
  "flex flex-none gap-2 border-t border-border bg-card px-[18px] pt-3 pb-[calc(14px+env(safe-area-inset-bottom))] max-tab:pb-[calc(12px+env(safe-area-inset-bottom))]";
/** Cancel: flex 1, 46px, a 1px --border, radius 10, 14px 600 (no hover in the HTML). */
export const MENU_EDITOR_CANCEL_CLASS = `h-[46px] flex-1 cursor-pointer rounded-[10px] border border-border bg-card px-1.5 py-px text-[14px] font-semibold text-foreground ${FLOOR_FOCUS_RING_CLASS}`;
/** Save: flex 2, 46px, --accent, 14.5px 600, hover --accent-h; today's pending look (off, spinner). */
export const MENU_EDITOR_SAVE_CLASS = `flex h-[46px] flex-[2] cursor-pointer items-center justify-center gap-2 rounded-[10px] border-0 bg-primary px-1.5 py-px text-[14.5px] font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 ${FLOOR_FOCUS_RING_CLASS}`;

// ── Fields (values 9.2) ─────────────────────────────────────────────────────────────────────────────────────────────

/** A field: the label 6px above its control. */
export const MENU_EDITOR_FIELD_CLASS = "grid min-w-0 gap-1.5";
export const MENU_EDITOR_LABEL_CLASS = "text-[13px] font-semibold leading-[normal] text-foreground";
export const MENU_EDITOR_ERROR_CLASS = "text-[12.5px] text-status-bad-ink";
/** The text input (and the kit select's trigger look is MENU_SELECT_TRIGGER_CLASS): 42px, radius 10, 14.5px (16px below
 *  720px, the phone never zooms), the red rule while it is aria-invalid. */
export const MENU_EDITOR_INPUT_CLASS =
  "h-[42px] min-w-0 rounded-[10px] border border-border bg-card px-3 py-0 text-[14.5px] text-foreground placeholder:text-subtle-foreground md:text-[14.5px] max-tab:text-base max-tab:leading-[normal] aria-[invalid=true]:border-status-bad";
/** The kit select trigger in the editor: 38px from MENU_SELECT_TRIGGER_CLASS, no left icon. */
export const MENU_EDITOR_SELECT_CLASS = "pl-3";

/** The rupee box (values 9.2): 42px, radius 10, clipped, max 220px; the cell then the number. */
export const MENU_EDITOR_PRICE_BOX_CLASS =
  "flex h-[42px] w-full max-w-[220px] items-center overflow-hidden rounded-[10px] border border-border bg-card has-[input[aria-invalid=true]]:border-status-bad";
/** The discount box: the same look, max 160px, a "%" cell after the number. */
export const MENU_EDITOR_PERCENT_BOX_CLASS = cn(MENU_EDITOR_PRICE_BOX_CLASS, "max-w-40");
export const MENU_EDITOR_CELL_CLASS =
  "flex h-full items-center border-border-2 bg-surface-2 px-3 text-[14px] text-muted-foreground";
export const MENU_EDITOR_CELL_LEFT_CLASS = cn(MENU_EDITOR_CELL_CLASS, "border-r");
export const MENU_EDITOR_CELL_RIGHT_CLASS = cn(MENU_EDITOR_CELL_CLASS, "border-l");
/** The number inside a box: bare, 15px 600 (16px below 720), spin buttons off. */
export const MENU_EDITOR_NUMBER_CLASS =
  "h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-[15px] font-semibold text-foreground outline-none placeholder:text-subtle-foreground max-tab:text-base [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

/** The Price block (values 9.2 #3): its parts 10px apart (the other fields' label sits 6px above its control). */
export const MENU_EDITOR_PRICE_CLASS = "grid min-w-0 gap-2.5";
/** The Price row's head: the label and the mode switch. */
export const MENU_EDITOR_PRICE_HEAD_CLASS = "flex items-center justify-between gap-2.5";
/** Single price / Sizes (values 9.2): a --surface-3 track radius 8, padding 2, 2px between; 28px buttons radius 6. */
export const MENU_EDITOR_MODE_TRACK_CLASS = "flex gap-0.5 rounded-[8px] bg-surface-3 p-0.5";
export const MENU_EDITOR_MODE_BUTTON_CLASS = `h-7 cursor-pointer whitespace-nowrap rounded-[6px] border-0 px-2.5 py-0 text-[12.5px] ${FLOOR_FOCUS_RING_CLASS}`;
export const MENU_EDITOR_MODE_ON_CLASS = "bg-seg font-semibold text-foreground [box-shadow:var(--seg-sh)]";
export const MENU_EDITOR_MODE_OFF_CLASS = "bg-transparent font-medium text-muted-foreground";

/** A size row (values 9.2): the name, the 130px rupee box, the 36px remove; 8px apart. */
export const MENU_EDITOR_SIZES_CLASS = "grid gap-2";
export const MENU_EDITOR_SIZE_ROW_CLASS = "grid grid-cols-[minmax(0,1fr)_130px_36px] items-center gap-2";
export const MENU_EDITOR_SIZE_BOX_CLASS =
  "flex h-[42px] w-full items-center overflow-hidden rounded-[10px] border border-border bg-card has-[input[aria-invalid=true]]:border-status-bad";
export const MENU_EDITOR_SIZE_CELL_CLASS = "flex h-full items-center border-r border-border-2 bg-surface-2 px-2.5 text-[13.5px] text-muted-foreground";
export const MENU_EDITOR_SIZE_NUMBER_CLASS = cn(MENU_EDITOR_NUMBER_CLASS, "px-2.5 text-[14.5px]");
/** Remove: 36px, radius 8, --bad-i, --bad-t on hover where a pointer can; off = .3. */
export const MENU_EDITOR_SIZE_REMOVE_CLASS = `flex size-9 cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent p-0 text-status-bad-ink pointer-fine:hover:bg-status-bad-tint disabled:cursor-default disabled:opacity-30 disabled:pointer-fine:hover:bg-transparent ${FLOOR_FOCUS_RING_CLASS}`;
/** Add size: 34px, a dashed --text-3 rule, radius 8, 13px 600. */
export const MENU_EDITOR_ADD_SIZE_CLASS = `flex h-[34px] cursor-pointer items-center gap-1.5 self-start justify-self-start rounded-[8px] border border-dashed border-subtle-foreground bg-transparent px-3 py-0 text-[13px] font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-50 ${FLOOR_FOCUS_RING_CLASS}`;

/** The switches card (values 9.2 #4): a 1px --border box, radius 12, clipped; each row 12px 14px, 12px apart, divided. */
export const MENU_EDITOR_CARD_CLASS = "flex flex-col overflow-hidden rounded-[12px] border border-border";
export const MENU_EDITOR_CARD_ROW_CLASS = "flex items-center gap-3 border-border-2 px-3.5 py-3 [&:not(:first-child)]:border-t";
/** The 34px tile (radius 9) in a tone, the 17px glyph inside. */
export const MENU_EDITOR_TILE_CLASS = "flex size-[34px] flex-none items-center justify-center rounded-[9px]";
export const MENU_EDITOR_TILE_TONES = {
  ok: "bg-status-ok-tint text-status-ok-ink",
  accent: "bg-status-info-tint text-status-info-ink",
} as const;
export const MENU_EDITOR_ROW_TEXT_CLASS = "min-w-0 flex-1";
export const MENU_EDITOR_ROW_LABEL_CLASS = "block text-[13.5px] font-semibold";
export const MENU_EDITOR_ROW_SUB_CLASS = "mt-0.5 block text-[12px] text-subtle-foreground text-pretty";
/** A hint under a field (ours): 12px --text-3. */
export const MENU_EDITOR_HINT_CLASS = "text-[12px] text-subtle-foreground";

/** Archive item / Restore item (values 9.2 #6): the red link, 13px 600, padding 6px 10px, radius 8, centred. */
export const MENU_EDITOR_ARCHIVE_CLASS = `flex cursor-pointer items-center gap-1.5 self-center justify-self-center rounded-[8px] border-0 bg-transparent px-2.5 py-1.5 text-[13px] font-semibold text-status-bad-ink pointer-fine:hover:bg-status-bad-tint disabled:cursor-not-allowed disabled:opacity-50 ${FLOOR_FOCUS_RING_CLASS}`;

/** Photo and icon (ours, in the HTML's language): the 72px preview tile (radius 12) and the two 36px outline buttons. */
export const MENU_EDITOR_ART_TILE_CLASS = "relative grid size-[72px] flex-none place-items-center overflow-clip rounded-[12px] border border-dashed border-border bg-surface-2";
export const MENU_EDITOR_OUTLINE_BUTTON_CLASS = `inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[8px] border border-border bg-card px-3 py-0 text-[13px] font-semibold whitespace-nowrap text-foreground pointer-fine:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 ${FLOOR_FOCUS_RING_CLASS}`;

// ── The dialogs (values 10): the icon picker, the move dialog, the import wizard; Task 4's category editor ─────────────

/** The scrim: z 50 over the editor, --scrim, fadeIn .2s; the box centred in 16px, along the window's foot on a phone. */
export const MENU_DIALOG_SCRIM_CLASS = cn(SHEET_SCRIM_BASE, "z-50");
/** The box (values 10): 440px max, radius 14 (the sheet's top corners on a phone), padding 20, 16px apart, --pop, sheetIn;
 *  the phone's bottom padding adds the inset. Content-sized up to the sheets' height cap, its body scrolls. */
export const MENU_DIALOG_BOX_CLASS = cn(
  SHEET_PANEL_BASE,
  SHEET_PANEL_CAP_CLASS,
  "max-w-[440px] gap-4 border border-border p-5 max-tab:pb-[calc(20px+env(safe-area-inset-bottom))] motion-safe:animate-html-sheet-in-op",
);
/** The import wizard's wider box (today's width; its five-column preview needs it, design 6.9). */
export const MENU_DIALOG_WIDE_CLASS = "max-w-2xl";
export const MENU_DIALOG_HEAD_CLASS = "flex flex-none items-start gap-3";
export const MENU_DIALOG_TITLE_CLASS = "text-[18px] font-semibold";
export const MENU_DIALOG_SUB_CLASS = "mt-0.5 text-[13px] text-muted-foreground";
export const MENU_DIALOG_CLOSE_CLASS = cn(SHEET_CLOSE_CLASS, "text-[11px]");
/** The dialog's scrolling middle and its foot buttons. */
export const MENU_DIALOG_BODY_CLASS = "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto";
export const MENU_DIALOG_FOOT_CLASS = "flex flex-none gap-2";
