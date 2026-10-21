// U1 Task 9 (2026-10-21): the payment sheet in the owner's HTML (values 11 in
// docs/superpowers/specs/2026-10-20-pos-html-values.md; the sheet keys in docs/superpowers/specs/2026-10-19-u0-html-values.md
// 2.1; design 6.11; owner Q1, Q4, Q14): its words and its look, shared by PaymentModal and its parts (PaymentAmount,
// PaymentModeGrid, PaymentCollectFields, PaymentSplitFields) and by CustomerSearch's own trigger (the pill). The sheet
// opens from /pos (Pay) and from the Orders / dashboard order sheet (Settle & Pay): the same look and behaviour in both.
// Pure: no React, no fetching; client-safe.
import type { PaymentMode } from "@/lib/constants";
import { WALK_IN, cartTitle } from "@/lib/pos-cart-view";
import { inr } from "@/lib/utils";

// ── words (owner Q1: the HTML's where it has the element; ours for our data) ────────────────────────────────────────

/** The HTML's label over the total. */
export const PAYMENT_AMOUNT_LABEL = "Amount to collect";
/** The HTML's change row. */
export const PAYMENT_CHANGE_LABEL = "Change to return";
/** The picker with no customer: the HTML's "+ Add customer for e-bill" without the e-bill (our sale sends none). */
export const ADD_CUSTOMER_PILL = "+ Add customer";

/** The HTML's title, "Payment · {place}", the place named as the cart names the order (design 6.11; cartTitle): a new
 *  sale on /pos with no table yet is "New order"; a table (a tab's, or the one chosen for a new sale) "Table T-4"; a tab
 *  with no table "Walk-In". Only /pos's new sale passes `newSale`; the Orders / dashboard sheet settles tabs. */
export function paymentTitle(tableNo: string | undefined, newSale: boolean): string {
  return `Payment · ${paymentPlace(tableNo, newSale)}`;
}

/** The title's place word alone ("New order" / "Table T-4" / "Walk-In"): also the customer sheet's sub line when it
 *  opens from the pill (U1 Task 10, ruling P30: the sheet names the order, as the HTML's does). */
export function paymentPlace(tableNo: string | undefined, newSale: boolean): string {
  return cartTitle({ resumedOrder: newSale && !tableNo ? null : { tableNo } });
}

/** Today's description line, kept word for word for screen readers: "3 items · Table T-4 · Neha Joshi". */
export function paymentDescription(view: { itemCount: number; tableNo: string | undefined; customerName: string | undefined }): string {
  const items = `${view.itemCount} item${view.itemCount === 1 ? "" : "s"}`;
  const place = view.tableNo ? `Table ${view.tableNo}` : WALK_IN;
  return `${items} · ${place} · ${view.customerName ?? "No customer"}`;
}

/** The pill where the customer can be chosen (the HTML's cu.payLine). */
export function pickerPillText(customerName: string | undefined): string {
  return customerName ? `Customer: ${customerName} · change` : ADD_CUSTOMER_PILL;
}

/** The pill on a tab that already has its customer (no picker there today): the name stays on screen, read-only. */
export function readOnlyPillText(customerName: string): string {
  return `Customer: ${customerName}`;
}

/** Due / Credit: today's sentence, in the HTML's due box. */
export function dueNoteText(mode: Extract<PaymentMode, "Due" | "Credit">, total: number): string {
  return `${mode === "Due" ? "Payment marked as due" : "Charged to credit"} — the full ${inr(total)} is added to the customer's outstanding balance.`;
}

// ── the look (values 11.1; token names: --text-2 muted-foreground, --text-3 subtle-foreground, --surface card,
//    --accent primary, --accent-h primary-hover, --on-accent primary-foreground, --ok-i / --warn-i / --bad-i
//    status-*-ink) ───────────────────────────────────────────────────────────────────────────────────────────────────

/** The scrim (values 11.1; U0 2.1 sheetAlign / sheetPad): fixed over everything, --scrim, fadeIn .2s; the panel centred
 *  in 16px, on the window's foot with no padding below 720px. z-index 50, not the HTML's 45: the Orders page's order
 *  sheet (z 50) is under it, and the customer dialog and the Discard confirm open over it (z 50, later in the DOM). */
export const PAY_SCRIM_CLASS =
  "fixed inset-0 z-50 flex items-center justify-center bg-scrim p-4 font-sans leading-[normal] text-foreground motion-safe:animate-scrim-in max-tab:items-end max-tab:p-0";
/** The panel (values 11.1): 420px on --surface, no border, radius 14 (14 14 0 0 below 720px), --pop, sheetIn .34s,
 *  18px 18px cartFootB (14px; 12px + the safe area below 720px), its rows 16px apart. Content-sized as the HTML's; our
 *  extra rows (bill, points, notices) can make it taller than a short window, so it is capped at the HTML's sheet cap
 *  (csMaxH, as the item options modal: ruling P24) and scrolls. */
export const PAY_PANEL_CLASS =
  "flex w-full max-w-[420px] flex-col gap-4 overflow-y-auto rounded-[14px] bg-card px-[18px] pt-[18px] pb-3.5 [box-shadow:var(--pop)] outline-none motion-safe:animate-sheet-in tab:max-h-[calc(100vh-32px)] tab:supports-[height:1dvh]:max-h-[calc(100dvh-32px)] max-tab:max-h-[88vh] max-tab:rounded-[14px_14px_0_0] max-tab:pb-[calc(12px+env(safe-area-inset-bottom))] max-tab:supports-[height:1dvh]:max-h-[88dvh]";
/** The head (values 11.1): the title 16px 600 and the "✕" apart, 10px gap. */
export const PAY_HEAD_CLASS = "flex items-center justify-between gap-2.5";
export const PAY_TITLE_CLASS = "min-w-0 truncate text-[16px] font-semibold";
/** "✕" (values 11.1): 30px round --surface-3, 12px --text-2; the UA's 1px 6px (the HTML sets no padding). */
export const PAY_CLOSE_CLASS =
  "size-[30px] flex-none cursor-pointer rounded-[50%] border-0 bg-surface-3 px-1.5 py-px text-[12px] text-muted-foreground";

/** The amount block (values 11.1): centred; "Amount to collect" 13px --text-2; the total 36px 600 -.025em, 2px below. */
export const PAY_AMOUNT_CLASS = "text-center";
export const PAY_AMOUNT_LABEL_CLASS = "text-[13px] text-muted-foreground";
export const PAY_TOTAL_CLASS = "mt-0.5 text-[36px] font-semibold tracking-[-0.025em]";
/** The customer pill (values 11.1): 8px below the total, 28px, radius 999, --surface-2, 0 12px, 12.5px 500. A long name
 *  is cut with an ellipsis (its title keeps it whole); aligned to the line's top so the cut never moves it. */
export const PAY_PILL_CLASS =
  "mt-2 inline-block h-7 max-w-full truncate rounded-[999px] border-0 bg-surface-2 px-3 align-top text-[12.5px] font-medium";
/** The picker with no customer (--link) / with one (--text); both buttons. */
export const PAY_PILL_ADD_CLASS = "cursor-pointer text-link disabled:cursor-not-allowed disabled:opacity-50";
export const PAY_PILL_SET_CLASS = "cursor-pointer text-foreground disabled:cursor-not-allowed disabled:opacity-50";
/** The read-only pill (a tab's own customer): text, not a button; the line's height centres its words. */
export const PAY_PILL_READ_CLASS = "leading-7 text-foreground";

/** The methods (values 11.1): a --surface-3 track, radius 10, 3px inset and gap, one column per mode (our five). */
export const PAY_METHODS_CLASS = "grid gap-[3px] rounded-[10px] bg-surface-3 p-[3px]";
/** A method: 40px, radius 8, 0 2px, 13.5px 600 --text; the chosen one SEG_ON, the others SEG_OFF (U0 values 1.6). In
 *  flight or frozen the others dim and the chosen one stays clear. */
export const PAY_METHOD_CLASS =
  "h-10 min-w-0 cursor-pointer rounded-[8px] border-0 px-0.5 text-[13.5px] font-semibold text-foreground disabled:cursor-not-allowed";
export const PAY_METHOD_ON_CLASS = "bg-seg [box-shadow:var(--seg-sh)]";
export const PAY_METHOD_OFF_CLASS = "bg-transparent disabled:opacity-50";

/** A method's block (values 11.1): the caption 8px above its control; the caption 12px 600 --text-2. */
export const PAY_BLOCK_CLASS = "flex flex-col gap-2";
export const PAY_CAPTION_CLASS = "text-[12px] font-semibold text-muted-foreground";
/** Cash / Online "Amount received": the HTML's 44px box (1px --border, radius 8, 0 12px, --surface, 8px gap) with the
 *  13px --text-2 "₹" and the amount 15px 600 right-aligned (16px below 720px, ruling R36: a plain size, as text-base
 *  would bring its 1.5 line-height; the HTML's is normal). The HTML's input keeps the
 *  UA's 1px 2px and no outline; the box shows the focus in the --ring colour instead (ours). No number spinners. */
export const PAY_FIELD_CLASS =
  "flex h-11 items-center gap-2 rounded-[8px] border border-border bg-card px-3 focus-within:border-ring";
export const PAY_FIELD_PREFIX_CLASS = "text-[13px] text-muted-foreground";
const NUMBER_INPUT =
  "[border:0] bg-transparent px-0.5 py-px text-foreground outline-none placeholder:text-subtle-foreground disabled:cursor-not-allowed disabled:opacity-50 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";
export const PAY_FIELD_INPUT_CLASS = `min-w-0 flex-1 text-right text-[15px] font-semibold max-tab:text-[16px] ${NUMBER_INPUT}`;
/** Our partial-payment line where the HTML's "Short by" line sits: 12.5px, --warn-i (it is allowed, not refused). */
export const PAY_PARTIAL_CLASS = "text-[12.5px] text-status-warn-ink";
/** Cash "Change to return" (values 11.1): a --border-2 rule, 14px above; 14px --text-2 / 22px 600 --ok-i. */
export const PAY_CHANGE_ROW_CLASS = "flex items-center justify-between border-t border-border-2 pt-3.5";
export const PAY_CHANGE_LABEL_CLASS = "text-[14px] text-muted-foreground";
export const PAY_CHANGE_VALUE_CLASS = "text-[22px] font-semibold text-status-ok-ink";

/** Split (values 11.1): two boxes 8px apart (1px rule, radius 10, 10px 12px, 4px gap): Cash with the --accent rule on
 *  --surface, Online with --border on --surface-2 (both editable: ours); the label 12px --text-2; "₹" + the amount
 *  18px 600, 2px apart. */
export const PAY_SPLIT_GRID_CLASS = "grid grid-cols-2 gap-2";
export const PAY_SPLIT_BOX_CLASS = "flex min-w-0 flex-col gap-1 rounded-[10px] border px-3 py-2.5 focus-within:border-ring";
export const PAY_SPLIT_CASH_CLASS = "border-primary bg-card";
export const PAY_SPLIT_ONLINE_CLASS = "border-border bg-surface-2";
export const PAY_SPLIT_LABEL_CLASS = "text-[12px] text-muted-foreground";
export const PAY_SPLIT_AMOUNT_CLASS = "flex items-center gap-0.5 text-[18px] font-semibold";
export const PAY_SPLIT_INPUT_CLASS = `min-w-0 flex-1 text-[18px] font-semibold ${NUMBER_INPUT}`;
/** Our "Cash + Online = … (must equal …)" line where the HTML's quick split buttons sit (owner Q14: none): 12.5px,
 *  --text-2, --bad-i while the two do not add up. */
export const PAY_SPLIT_SUM_CLASS = "text-[12.5px] text-muted-foreground";
export const PAY_SPLIT_SUM_BAD_CLASS = "text-status-bad-ink";

/** A check that blocks the confirm ("Select a customer …"): the HTML's 12.5px --bad-i line. */
export const PAY_CHECK_CLASS = "text-[12.5px] text-status-bad-ink";
/** "Served by {name}" (ours): 12px --text-3, centred. */
export const PAY_SERVED_BY_CLASS = "text-center text-[12px] text-subtle-foreground";
/** The main button (values 11.1): 50px, radius 10, --accent, 15px 600 --on-accent, hover --accent-h; blocked at .5
 *  with the not-allowed cursor (the HTML never blocks it: rulings P13 / P25). */
export const PAY_MAIN_LOOK =
  "flex h-[50px] w-full cursor-pointer items-center justify-center rounded-[10px] border-0 bg-primary px-1.5 py-px text-[15px] font-semibold text-primary-foreground not-disabled:hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50";
/** Discard after an unconfirmed sale (ours): the cart's Send look (values 5.5: 50px, a 1px --ink rule on --surface,
 *  radius 10, 14.5px 600), full width under the main button. */
export const PAY_DISCARD_LOOK =
  "flex h-[50px] w-full cursor-pointer items-center justify-center rounded-[10px] border border-ink bg-card px-1.5 py-px text-[14.5px] font-semibold text-foreground not-disabled:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50";
