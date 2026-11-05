// Shared sizes and colours for the printer dot and the printer panel. Plain
// class strings (components/ui/** is never edited); cn()'s tailwind-merge makes
// each token REPLACE the shadcn default it sits next to.
import { FLOOR_FOCUS_RING_CLASS } from "@/lib/floor-tile-classes";
import { ORDER_DETAIL_SHEET_CLASS, ORDER_DETAIL_SHEET_SCRIM_CLASS } from "@/lib/orders-layout";
import { STATUS_CLASSES } from "@/lib/ui";
import { cn } from "@/lib/utils";

/** A panel action: 44px tall, readable at arm's length on a counter tablet. */
export const PRINTER_ACTION_CLASS = "h-11 px-4 text-base";

/** A panel field: 44px, text-base at every width. The shared Input carries md:text-sm,
 *  which would shrink it below 16px on an iPad (iOS zooms the page on focus). */
export const PRINTER_INPUT_CLASS = "h-11 text-base md:text-base";

/** The page header's icon square (the owner's HTML printer button, values 2.5): 36px with a 17px icon, on the kit's
 *  outline Button; the same size on a touch screen (U0 ruling R1). Refresh, the phone's menu and a back link share it. */
export const PRINTER_ICON_BUTTON_CLASS = "relative h-9 w-9 flex-none px-1.5 py-px [&_svg]:size-[17px]";

/** The HTML's status dot: 10px on the button's corner (top/right -3px), a 2px ring in the surface colour. On the
 *  header button: the HTML's --ok green when printing works, its --warn orange when it does not (values 2.5). */
export const PRINTER_DOT_CLASS = "absolute -right-[3px] -top-[3px] size-2.5 rounded-[50%] [box-shadow:0_0_0_2px_var(--card)]";
export const PRINTER_DOT_OK_CLASS = STATUS_CLASSES.ok.dot;
export const PRINTER_DOT_WARN_CLASS = STATUS_CLASSES.warn.dot;
/** The Printer setup page's own dots: green connected, red a problem. */
export const PRINTER_DOT_BAD_CLASS = STATUS_CLASSES.bad.dot;

/** The 36px icon tile at the start of a panel header, a printer row and the status
 *  banner (the Settings hub's idiom). The colour comes from one of the tones below. */
export const PRINTER_TILE_CLASS = "grid h-9 w-9 shrink-0 place-items-center rounded-md";
export const PRINTER_TILE_BRAND_CLASS = "bg-brand-primary-soft text-brand-primary";
/** The status card's 34px circle (U5 Task 5, values 17): neutral = no good/bad claim (the "checking" card); ok = the
 *  HTML's --ok with its white check; bad = --warn with its "!" in --text (the HTML's white "!" is 2.46:1). The words
 *  beside it carry the meaning. */
export const PRINTER_TILE_NEUTRAL_CLASS = "bg-surface-3 text-muted-foreground";
export const PRINTER_TILE_OK_CLASS = `${STATUS_CLASSES.ok.dot} text-white`;
export const PRINTER_TILE_BAD_CLASS = `${STATUS_CLASSES.warn.dot} text-foreground`;

// ── The printer panel's look (U5 Task 5, 2026-11-02; printer values 16-21, design 7; LOOK ONLY) ─────────────────────────
// The owner's HTML panel: a 420px aside from 1280px, U2's full-screen bottom sheet below (owner rule 2026-10-22); sections
// as cards; 40 / 36 / 32px buttons, 42px inputs, 38px selects. The 44px classes above stay for the Printer setup page's own
// sections. WebView 109: no light-dark(), no runtime color-mix() (the HTML's color-mix borders are precomputed rgba()), flex
// buttons' children stretch by their own classes. Hover only where a pointer can hover (U0 R14).
export const PRINTER_PANEL_XL_QUERY = "(min-width: 1280px)";
/** The scrim (values 16.1): --scrim, fadeIn .2s; z 47 / 48 keep the kit's select list (z 50) above the panel. */
export const PRINTER_PANEL_SCRIM_CLASS = "fixed inset-0 z-[47] bg-scrim motion-safe:animate-scrim-in";
/** The aside: min(420px, 100%) on --bg, a 1px --border rule on its left, --pop, the HTML's lineIn .3s; a column. */
export const PRINTER_PANEL_SIDE_CLASS =
  "fixed inset-y-0 right-0 z-[48] flex min-h-0 w-[min(420px,100%)] flex-col border-l border-border bg-background font-sans leading-[normal] text-foreground outline-none [box-shadow:var(--pop)] motion-safe:animate-html-line-in-panel";
/** Below 1280px: U2's bottom sheet (the /pos cart sheet's constant) on --bg; its scrim is mounted and never drawn. */
export const PRINTER_PANEL_SHEET_CLASS = cn(ORDER_DETAIL_SHEET_CLASS, "bg-background");
export const PRINTER_PANEL_SHEET_SCRIM_CLASS = ORDER_DETAIL_SHEET_SCRIM_CLASS;
/** The head (values 16.1): --surface, padding 18px 20px 14px, 12px between the words and the close, a --border rule below. */
export const PRINTER_PANEL_HEAD_CLASS = "flex flex-none items-start gap-3 border-b border-border bg-card px-5 pt-[18px] pb-3.5";
export const PRINTER_PANEL_TITLE_CLASS = "text-[17px] font-semibold";
export const PRINTER_PANEL_SUB_CLASS = "mt-0.5 text-[12.5px] text-muted-foreground";
/** The close: 34px, radius 8, --text-2; --hover and --text under a pointer. */
export const PRINTER_PANEL_CLOSE_CLASS = `flex size-[34px] flex-none cursor-pointer items-center justify-center rounded-[8px] border-0 bg-transparent p-0 text-muted-foreground pointer-fine:hover:bg-hover pointer-fine:hover:text-foreground ${FLOOR_FOCUS_RING_CLASS}`;
/** The body (values 16.1): the one scroller, padding 16px 20px, its parts 12px apart. */
export const PRINTER_PANEL_BODY_CLASS = "flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overflow-x-clip bg-background px-5 py-4";
/** The fixed foot (values 16.1): --surface, a --border rule, 14px 20px and the bottom inset at every width. */
export const PRINTER_PANEL_FOOT_CLASS = "flex-none border-t border-border bg-card px-5 pt-3.5 pb-[calc(14px+env(safe-area-inset-bottom))]";
/** Done: 44px, --accent, radius 10, 14.5px 600, hover --accent-h. */
export const PRINTER_PANEL_DONE_CLASS = `h-11 w-full cursor-pointer rounded-[10px] border-0 bg-primary px-1.5 py-px text-[14.5px] font-semibold text-primary-foreground pointer-fine:hover:bg-primary-hover ${FLOOR_FOCUS_RING_CLASS}`;

// A section card (values 18): --surface, 1px --border, radius 12, clipped; the head row, then the body.
export const PRINTER_SECTION_CARD_CLASS = "flex-none overflow-clip rounded-[12px] border border-border bg-card";
export const PRINTER_SECTION_HEAD_CLASS = "flex items-start gap-3 px-4 py-3.5";
export const PRINTER_SECTION_TILE_CLASS = "grid size-[34px] flex-none place-items-center rounded-[9px] bg-surface-3 text-muted-foreground [&_svg]:size-[17px]";
export const PRINTER_SECTION_TITLE_CLASS = "text-[14px] font-semibold";
export const PRINTER_SECTION_SUB_CLASS = "mt-0.5 text-[12.5px] text-subtle-foreground";
export const PRINTER_SECTION_BODY_CLASS = "flex flex-col gap-3 px-4 pb-4 text-[13.5px]";

// The status card (values 17; design 7.3): ok green, bad orange (its "!" in --text: the HTML's white is 2.46:1), checking neutral.
export const PRINTER_STATUS_CARD_CLASS = "flex flex-none items-start gap-3 rounded-[12px] border px-4 py-3.5";
export const PRINTER_STATUS_CIRCLE_CLASS = "grid size-[34px] flex-none place-items-center rounded-[50%]";
export const PRINTER_STATUS_LOOK = {
  ok: { card: `border-[rgba(36,161,72,.3)] ${STATUS_CLASSES.ok.tint}`, head: STATUS_CLASSES.ok.ink },
  bad: { card: `border-[rgba(255,131,43,.35)] ${STATUS_CLASSES.warn.tint}`, head: STATUS_CLASSES.warn.ink },
  checking: { card: "border-border bg-card", head: "text-foreground" },
} as const;
export const PRINTER_STATUS_HEAD_CLASS = "text-[14.5px] font-semibold";
export const PRINTER_STATUS_DETAIL_CLASS = "mt-0.5 text-[12.5px] text-muted-foreground";
// Waiting slips (design 7.5): the HTML's warn card; each slip a --surface row.
export const PRINTER_WAITING_CARD_CLASS = `flex flex-none flex-col gap-3 rounded-[12px] border border-[rgba(255,131,43,.35)] ${STATUS_CLASSES.warn.tint} px-4 py-3.5`;
export const PRINTER_WAITING_ROW_CLASS = "rounded-[10px] border border-border bg-card px-3 py-2.5";

// The Not printed card (PX-2 Task 4; spec §6.3; mockups s-wait5 / s-wait20 / s-clearall): --card on the warn rule at .45,
// radius 12; a 15px / 600 head with the 22px count bubble and a 13px summary; rows of at least 56px split by a --border-2
// rule; 36px buttons that take 44px under a finger; one centered 44px Show all; the inline Clear all confirm.
export const PRINTER_NOT_PRINTED_CARD_CLASS = "flex-none rounded-[12px] border border-[rgba(255,131,43,.45)] bg-card";
export const PRINTER_NOT_PRINTED_HEAD_CLASS = "flex items-start gap-2.5 pt-3 pr-3.5 pb-2.5 pl-4";
export const PRINTER_NOT_PRINTED_TITLE_CLASS = "text-[15px] font-semibold";
/** The spec's #da1e28 in both themes: white 12px / 700 on it reads 5:1 (the dark token's #fa4d56 would not). */
export const PRINTER_NOT_PRINTED_BUBBLE_CLASS =
  "ml-1.5 inline-grid h-[22px] min-w-[22px] place-items-center rounded-[11px] bg-[#da1e28] px-1.5 align-[1px] text-[12px] font-bold leading-none text-white";
export const PRINTER_NOT_PRINTED_SUMMARY_CLASS = "mt-[3px] text-[13px] leading-[1.4] text-muted-foreground";
export const PRINTER_NOT_PRINTED_LIST_CLASS = "border-t border-border-2";
export const PRINTER_NOT_PRINTED_ROW_CLASS = "flex min-h-14 flex-wrap items-center gap-2.5 border-b border-border-2 py-[9px] pr-3.5 pl-4 last:border-b-0";
/** A row with three buttons (the bill to check): its buttons, the row's last child, take a line of their own. */
export const PRINTER_NOT_PRINTED_ROW_WRAP_CLASS = "[&>*:last-child]:w-full";
export const PRINTER_NOT_PRINTED_TEXT_CLASS = "min-w-[150px] flex-1";
export const PRINTER_NOT_PRINTED_LABEL_CLASS = "text-[14px] font-medium";
export const PRINTER_NOT_PRINTED_META_CLASS = "mt-px text-[12.5px] text-subtle-foreground";
/** A bill to check reads --status-warn-ink, a slip that could not print --status-bad-ink; the bold lead is 600. */
export const PRINTER_NOT_PRINTED_TONE = { warn: STATUS_CLASSES.warn.ink, bad: STATUS_CLASSES.bad.ink } as const;
export const PRINTER_NOT_PRINTED_STRONG_CLASS = "font-semibold";
export const PRINTER_NOT_PRINTED_BUTTONS_CLASS = "flex flex-none gap-1.5";
/** A slip's button and the head's Clear all: 36px, radius 8, 13px / 500; a transparent 4px inset makes it 44px to a finger. */
export const PRINTER_BUTTON_SLIP_CLASS =
  "relative h-9 flex-none rounded-[8px] px-3 py-0 text-[13px] font-medium before:absolute before:-inset-1 pointer-coarse:before:content-['']";
export const PRINTER_NOT_PRINTED_MORE_CLASS = "flex justify-center border-t border-border-2";
export const PRINTER_NOT_PRINTED_SHOW_CLASS = `flex min-h-11 cursor-pointer items-center gap-0.5 rounded-[6px] border-0 bg-transparent px-2 py-1.5 text-[13px] font-medium text-link [&_svg]:size-[15px] ${FLOOR_FOCUS_RING_CLASS}`;
/** The confirm (values: s-clearall): --status-bad-tint on a .25 bad rule, radius 10, 14px / 500; two 40px buttons side by side. */
export const PRINTER_NOT_PRINTED_CONFIRM_CLASS = `mr-3.5 mb-3 ml-4 flex flex-col gap-2.5 rounded-[10px] border border-[rgba(218,30,40,.25)] ${STATUS_CLASSES.bad.tint} p-3 text-[14px] font-medium`;
export const PRINTER_NOT_PRINTED_CONFIRM_ROW_CLASS = "flex gap-2";
export const PRINTER_BUTTON_CONFIRM_CLASS = "h-10 min-w-0 flex-1 rounded-[8px] px-3.5 py-0 text-[13.5px] font-medium";
export const PRINTER_BUTTON_DANGER_CLASS = `${PRINTER_BUTTON_CONFIRM_CLASS} border-0 bg-status-bad text-white hover:bg-status-bad`;

// Buttons (design 7.4): primary 40px / radius 9 / 14px 600; secondary 36px / radius 8 / 13.5px 500 (on the kit's outline
// variant); the status card's fix button 32px / 12.5px; Remove in --bad-i with the bad rgba border. Each only sizes, so the
// kit variant keeps the colours (a Reconnect that is not connected stays primary). self-start: in the panel's column a
// button keeps the width of its words (the HTML's Connect printer is align-self: flex-start).
export const PRINTER_BUTTON_PRIMARY_CLASS = "h-10 self-start py-0 rounded-[9px] border-0 px-4 text-[14px] font-semibold hover:bg-primary-hover";
export const PRINTER_BUTTON_CLASS = "h-9 self-start py-0 rounded-[8px] px-3.5 text-[13.5px] font-medium";
export const PRINTER_BUTTON_SMALL_CLASS = "h-8 py-0 rounded-[8px] px-[11px] text-[12.5px] font-medium";
export const PRINTER_BUTTON_REMOVE_CLASS = `h-9 self-start py-0 rounded-[8px] border-[rgba(218,30,40,.4)] px-3.5 text-[13.5px] font-medium ${STATUS_CLASSES.bad.ink} hover:bg-[var(--status-bad-tint)]`;

// Fields (design 7.4): inputs 42px (16px below 720px: the phone never zooms), selects 38px.
export const PRINTER_FIELD_CLASS = "h-[42px] rounded-[10px] px-3 py-0 text-[14.5px] md:text-[14.5px] max-tab:text-base max-tab:leading-[normal]";
export const PRINTER_SELECT_CLASS = "h-[38px] w-full rounded-[9px] px-3 text-[13.5px] font-medium";
export const PRINTER_LABEL_CLASS = "text-[13px] font-semibold text-foreground";
export const PRINTER_NOTE_CLASS = "text-[12px] text-subtle-foreground";
export const PRINTER_ERROR_CLASS = `text-[12.5px] ${STATUS_CLASSES.bad.ink}`;
/** The HTML's warn line (values 19): --warn-t, radius 8, 12.5px --warn-i. */
export const PRINTER_WARN_LINE_CLASS = `rounded-[8px] ${STATUS_CLASSES.warn.pill} px-3 py-[9px] text-[12.5px]`;
export const PRINTER_NOTICE_CLASS = `flex flex-col gap-2 rounded-[10px] border border-[rgba(255,131,43,.35)] ${STATUS_CLASSES.warn.pill} p-3 text-[13px]`;
export const PRINTER_HINT_CLASS = "rounded-[10px] bg-surface-2 p-3 text-[13px] text-foreground";
export const PRINTER_BLOCK_CLASS = "flex flex-col gap-2 rounded-[10px] border border-border p-3";
/** A block set off by a rule above it (values 19: "Printer not in the list?"); the first one has none. */
export const PRINTER_RULE_BLOCK_CLASS = "flex flex-col gap-2 border-t border-border-2 pt-3 first:border-t-0 first:pt-0";
export const PRINTER_BLOCK_TITLE_CLASS = "text-[12.5px] font-semibold text-muted-foreground";
// The numbered steps (values 19): 20px --accent-t circles, 13px at 1.45.
export const PRINTER_STEP_CLASS = "flex gap-2.5 py-[5px] text-[13px] leading-[1.45]";
export const PRINTER_STEP_NUM_CLASS = `grid size-5 flex-none place-items-center rounded-[50%] ${STATUS_CLASSES.info.pill} text-[11px] font-bold leading-none`;
// A printer's row (values 19): --ok-t with the 8px pulsing dot while connected, --surface-2 with a --text-3 dot otherwise.
export const PRINTER_ROW_CLASS = "flex flex-wrap items-center gap-3 rounded-[10px] px-3.5 py-3";
export const PRINTER_ROW_ON_CLASS = STATUS_CLASSES.ok.tint;
export const PRINTER_ROW_OFF_CLASS = "bg-surface-2";
export const PRINTER_ROW_DOT_CLASS = "size-2 flex-none rounded-[50%]";
export const PRINTER_ROW_DOT_ON_CLASS = `${STATUS_CLASSES.ok.dot} motion-safe:animate-live-pulse`;
export const PRINTER_ROW_DOT_OFF_CLASS = "bg-subtle-foreground";
export const PRINTER_ROW_NAME_CLASS = "break-words text-[13.5px] font-semibold";
export const PRINTER_ROW_META_CLASS = "flex items-center gap-1.5 text-[12px] text-muted-foreground [&_svg]:size-3.5 [&_svg]:flex-none";
/** A found printer (values 19): 10px 12px, radius 10, a 1px --border rule. */
export const PRINTER_LIST_ROW_CLASS = "flex items-center gap-2.5 rounded-[10px] border border-border px-3 py-2.5";
// A segmented choice (values 20): a --surface-3 track radius 8, 2px padding, 32px; its buttons radius 6, 12.5px.
export const PRINTER_SEG_TRACK_CLASS = "flex h-8 gap-0.5 rounded-[8px] bg-surface-3 p-0.5";
export const PRINTER_SEG_BUTTON_CLASS = `cursor-pointer whitespace-nowrap rounded-[6px] border-0 px-3 py-0 text-[12.5px] disabled:cursor-not-allowed disabled:opacity-50 ${FLOOR_FOCUS_RING_CLASS}`;
export const PRINTER_SEG_ON_CLASS = "bg-seg font-semibold text-foreground [box-shadow:var(--seg-sh)]";
export const PRINTER_SEG_OFF_CLASS = "bg-transparent font-medium text-muted-foreground";
// A mode row (values 18): the Windows print method; the real radio stays (sr-only) and the HTML's 18px ring is drawn from it.
export const PRINTER_MODE_ROW_CLASS =
  "flex cursor-pointer items-start gap-3 rounded-[10px] border border-border bg-card px-3.5 py-3 text-left has-[:checked]:border-primary has-[:checked]:bg-[var(--status-info-tint)] has-[:disabled]:cursor-not-allowed has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring";
export const PRINTER_MODE_RING_CLASS =
  "mt-px grid size-[18px] flex-none place-items-center rounded-[50%] border border-subtle-foreground peer-checked:border-primary peer-checked:[&>span]:opacity-100";
export const PRINTER_MODE_DOT_CLASS = "size-2 rounded-[50%] bg-primary opacity-0";
// The 38x22 switch (values 20), on the kit Switch: the thumb is its only child span.
export const PRINTER_SWITCH_CLASS =
  "h-[22px] w-[38px] rounded-[11px] border-0 p-0.5 duration-200 data-[state=checked]:bg-primary data-[state=unchecked]:bg-border [&>span]:h-[18px] [&>span]:w-[18px] [&>span]:bg-white [&>span]:[box-shadow:0_1px_2px_rgba(0,0,0,.25)] [&>span]:data-[state=checked]:translate-x-4";
// More options (values 20): the header is a button; the chevron turns 180 degrees in .2s.
export const PRINTER_MORE_TRIGGER_CLASS = `flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 py-3.5 text-left text-foreground ${FLOOR_FOCUS_RING_CLASS}`;
export const PRINTER_MORE_CHEVRON_CLASS = "size-4 flex-none transition-transform duration-200 group-data-[state=open]:[transform:rotate(180deg)]";
export const PRINTER_MORE_BODY_CLASS = "flex flex-col gap-3.5 border-t border-border-2 px-4 pt-3.5 pb-4";
/** A found network printer as a row button (values 19): 10px 12px, radius 10; its words stack, left-aligned (WebView 109:
 *  the children stretch by items-stretch, not by the UA's button rule). */
export const PRINTER_FOUND_ROW_CLASS = "h-auto border border-border min-h-10 w-full flex-col items-stretch justify-center gap-0.5 rounded-[10px] px-3 py-2.5 text-left text-[13.5px] font-medium";
