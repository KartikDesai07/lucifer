// The reservation form's class strings (U6 Task 4, 2026-11-03; values docs/superpowers/specs/2026-11-02-reservations-html-values.md
// 13; design 8.1, B4, B20, B23). U5's editor frame (lib/menu-editor-layout.ts: scrim, head, close, the body grid, the field and
// label looks) at the HTML's 480px, then the form's own footer (a summary over Save) and the fields in the HTML's order. Kept in
// its own file so lib/reservations-layout.ts stays under the 300-line cap (B25). Plain literals only: Tailwind's source scanner
// sees every class, and the pins (lib/reservation-form-layout.test.ts) read the SAME constants the form renders. WebView 109: no
// light-dark(), no runtime color-mix(), a flex button's children stretch by their own classes (w-full).
import { FLOOR_FOCUS_RING_CLASS } from "@/lib/floor-tile-classes";

// ── Frame and footer (values 13.1) ──────────────────────────────────────────────────────────────────────────────────

/** The aside: 480px (the HTML's, at every width from 1280; below it U2's bottom sheet, MENU_EDITOR_SHEET_CLASS). */
export const RES_FORM_SIDE_CLASS =
  "fixed inset-y-0 right-0 z-[46] flex min-h-0 w-[480px] flex-col border-l border-border bg-card font-sans leading-[normal] text-foreground outline-none [box-shadow:var(--pop)] motion-safe:animate-html-sheet-in-op";
/** The footer: 12px 18px and the bottom inset (14px + inset; 12px + inset on a phone), the summary 10px over Save. */
export const RES_FORM_FOOT_CLASS =
  "flex flex-none flex-col gap-2.5 border-t border-border bg-card px-[18px] pt-3 pb-[calc(14px+env(safe-area-inset-bottom))] max-tab:pb-[calc(12px+env(safe-area-inset-bottom))]";
/** The summary row: the 15px clock then the line (13px, 500, one line, ellipsis). */
export const RES_FORM_SUMMARY_CLASS = "flex min-w-0 items-center gap-2 text-[13px] text-muted-foreground";
export const RES_FORM_SUMMARY_TEXT_CLASS = "min-w-0 truncate font-medium";
/** After a failed Save: "Fix the highlighted fields to continue". */
export const RES_FORM_SUMMARY_BAD_CLASS = "text-status-bad-ink";
/** Save: 48px, --accent, radius 10, 15px 600, hover --accent-h; off with a spinner while it runs. */
export const RES_FORM_SAVE_CLASS = `flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] border-0 bg-primary px-1.5 py-px text-[15px] font-semibold text-primary-foreground pointer-fine:hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 ${FLOOR_FOCUS_RING_CLASS}`;

// ── Fields (values 13.2) ────────────────────────────────────────────────────────────────────────────────────────────

/** Mobile + name: one group, 12px apart. */
export const RES_FORM_PAIR_CLASS = "flex min-w-0 flex-col gap-3";
/** A field's head: the label and its hint on the baseline (Guests, Time, Table). */
export const RES_FORM_HEAD_CLASS = "flex items-baseline justify-between gap-2";
export const RES_FORM_HINT_CLASS = "text-[12px] text-subtle-foreground [overflow-wrap:anywhere]";
/** The phone box: 44px, radius 10, clipped; the red rule while its number is aria-invalid. */
export const RES_FORM_PHONE_BOX_CLASS =
  "flex h-11 items-center overflow-clip rounded-[10px] border border-border bg-card has-[input[aria-invalid=true]]:border-status-bad";
/** The "+91" cell. */
export const RES_FORM_PREFIX_CLASS = "flex h-full items-center border-r border-border-2 bg-surface-2 pl-3 pr-2.5 text-[14px] text-muted-foreground";
/** The number inside the phone box: 15px, .02em apart (16px below 720: the phone never zooms). */
export const RES_FORM_PHONE_INPUT_CLASS =
  "h-full min-w-0 flex-1 border-0 bg-transparent px-3 text-[15px] tracking-[.02em] text-foreground outline-none placeholder:text-subtle-foreground max-tab:text-base";
/** The name input: 44px, radius 10, 15px (16px below 720). */
export const RES_FORM_INPUT_CLASS =
  "h-11 min-w-0 rounded-[10px] border border-border bg-card px-3 text-[15px] text-foreground outline-none placeholder:text-subtle-foreground max-tab:text-base aria-[invalid=true]:border-status-bad";
/** The returning-guest line under the phone box. */
export const RES_FORM_GUEST_INFO_CLASS = "flex items-center gap-2 rounded-[9px] bg-status-info-tint px-2.5 py-2 text-[12.5px] font-medium text-status-info-ink";

/** Guests: the row wraps (the quick chips go under the stepper on a phone), 8px apart. */
export const RES_FORM_GUESTS_ROW_CLASS = "flex flex-wrap items-center gap-2";
/** The stepper: 44px, radius 10, clipped; its − and + 44px wide on --surface-2, 20px. */
export const RES_FORM_STEPPER_CLASS = "flex h-11 items-center overflow-clip rounded-[10px] border border-border has-[input[aria-invalid=true]]:border-status-bad";
export const RES_FORM_STEP_CLASS = `h-full w-11 cursor-pointer border-0 bg-surface-2 p-0 text-[20px] text-foreground ${FLOOR_FOCUS_RING_CLASS}`;
/** The count: 48px wide, 17px 600, typeable (a numeric text input). */
export const RES_FORM_COUNT_CLASS = "h-full w-12 min-w-0 border-0 bg-transparent p-0 text-center text-[17px] font-semibold text-foreground outline-none";
/** A 44px round-cornered chip (the quick guests 2 4 6 8 10); on = ink. */
export const RES_FORM_QUICK_CLASS = `size-11 cursor-pointer rounded-[10px] border p-0 text-[14px] font-semibold ${FLOOR_FOCUS_RING_CLASS}`;
export const RES_FORM_ON_CLASS = "border-ink bg-ink text-on-ink";
export const RES_FORM_OFF_CLASS = "border-border bg-card text-foreground";

/** The day row (B4): the strip scrolls sideways with no scrollbar and "More" sits outside it, always visible. */
export const RES_FORM_DAY_ROW_CLASS = "flex min-w-0 gap-1.5";
export const RES_FORM_DAY_STRIP_CLASS = "flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";
/** A day chip: 58 wide, a 11px top line (.75) over a 17px number, padding 7px 0 (53px tall). */
export const RES_FORM_DAY_CLASS = `flex w-[58px] flex-none cursor-pointer flex-col items-center gap-px rounded-[10px] border px-0 py-[7px] ${FLOOR_FOCUS_RING_CLASS}`;
export const RES_FORM_DAY_TOP_CLASS = "block w-full text-center text-[11px] font-semibold opacity-75";
export const RES_FORM_DAY_NUM_CLASS = "block w-full text-center text-[17px] font-semibold";
/** More (DatePicker with its label): 58 wide, a dashed rule, stretched to the chips' height; picked = the info tint. */
export const RES_FORM_MORE_CLASS =
  "h-auto min-h-[53px] w-[58px] flex-none flex-col items-center justify-center gap-0.5 rounded-[10px] border border-dashed border-border bg-card p-0 text-[11px] font-semibold text-muted-foreground shadow-none";
export const RES_FORM_MORE_ON_CLASS = "bg-status-info-tint text-status-info-ink";

/** The period label: 11.5px 600, .06em, upper-case, --text-3. */
export const RES_FORM_PERIOD_CLASS = "mt-0.5 text-[11.5px] font-semibold uppercase tracking-[.06em] text-subtle-foreground";
/** The slot grid: columns of at least 74px, 6px apart. */
export const RES_FORM_SLOTS_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(74px,1fr))] gap-1.5";
/** A slot: 46px, radius 9, 13px 600; the label over three 5px load dots. Passed = struck and dimmed. */
export const RES_FORM_SLOT_CLASS = `flex h-[46px] cursor-pointer flex-col items-center justify-center gap-1 rounded-[9px] border text-[13px] font-semibold ${FLOOR_FOCUS_RING_CLASS}`;
export const RES_FORM_SLOT_OFF_CLASS = "cursor-not-allowed border-border bg-surface-2 text-subtle-foreground line-through opacity-50";
export const RES_FORM_DOTS_CLASS = "flex gap-0.5";
export const RES_FORM_DOT_CLASS = "size-[5px] rounded-[50%]";
/** A load dot: lit = --warn; an empty one on a quiet slot = --border-2, on the picked (ink) slot rgba(255,255,255,.25). */
export const RES_FORM_DOT_LIT_CLASS = "bg-status-warn";
export const RES_FORM_DOT_EMPTY_CLASS = "bg-border-2";
export const RES_FORM_DOT_EMPTY_ON_CLASS = "bg-[rgba(255,255,255,.25)]";
/** "Other time" (TimePicker with its label): a 46px chip after the Dinner grid, as wide as its words. */
export const RES_FORM_OTHER_CLASS = `h-[46px] w-auto min-w-[74px] flex-none justify-center self-start rounded-[9px] border px-3.5 py-0 text-[13px] font-semibold shadow-none ${FLOOR_FOCUS_RING_CLASS}`;

/** The table grid: columns of at least 92px, 6px apart. */
export const RES_FORM_TABLES_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-1.5";
/** A table chip: at least 52px (it grows with a long name), radius 10, 10px across. A flex button: its children are w-full. */
export const RES_FORM_TABLE_CLASS = `flex min-h-[52px] min-w-0 cursor-pointer flex-col items-start justify-center gap-0.5 rounded-[10px] border px-2.5 py-1 text-left ${FLOOR_FOCUS_RING_CLASS}`;
export const RES_FORM_TABLE_LABEL_CLASS = "flex w-full items-center gap-1.5 text-[13.5px] font-semibold [overflow-wrap:anywhere]";
export const RES_FORM_TABLE_SUB_CLASS = "block w-full text-[11px] [overflow-wrap:anywhere]";
/** Show all tables / Show best fits only: the link look, 13px 600. */
export const RES_FORM_LINK_CLASS = `self-start cursor-pointer rounded-[6px] border-0 bg-transparent px-0 py-0.5 text-[13px] font-semibold text-link ${FLOOR_FOCUS_RING_CLASS}`;
/** The message box under the chips: radius 9, 9px 11px, 12.5px 500, line-height 1.45. */
export const RES_FORM_MESSAGE_CLASS = "rounded-[9px] px-[11px] py-[9px] text-[12.5px] font-medium leading-[1.45] [overflow-wrap:anywhere]";
export const RES_FORM_MESSAGE_TONE_CLASS = { bad: "bg-status-bad-tint text-status-bad-ink", warn: "bg-status-warn-tint text-status-warn-ink" } as const;

/** The note: at least 64px, radius 10, 14px (16px below 720), grows by hand. */
export const RES_FORM_NOTE_CLASS =
  "min-h-16 w-full resize-y rounded-[10px] border border-border bg-card px-3 py-2.5 text-[14px] text-foreground outline-none placeholder:text-subtle-foreground max-tab:text-base";
/** Delete reservation: the trash and the words in --bad-i, 13px 600, hover --bad-t; 44px tall, centred. */
export const RES_FORM_DELETE_CLASS = `flex min-h-11 cursor-pointer items-center justify-center gap-1.5 self-center rounded-[8px] border-0 bg-transparent px-2.5 py-1.5 text-[13px] font-semibold text-status-bad-ink pointer-fine:hover:bg-status-bad-tint ${FLOOR_FOCUS_RING_CLASS}`;
