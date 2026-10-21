// U1 Task 9 (2026-10-21): the payment sheet in the owner's HTML (values 11 in
// docs/superpowers/specs/2026-10-20-pos-html-values.md; design 6.11; owner Q1, Q4, Q14). The sheet is shared: /pos's
// Pay and the Orders / dashboard sheet's "Settle & Pay" open the same PaymentModal, so the new look is everywhere with
// the same behaviour. The words and the look are pure (lib/payment-sheet.ts); the amount block renders statically; the
// pins below hold the wiring in PaymentModal and its parts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { stripComments } from "@/lib/source-pin-utils";
import {
  ADD_CUSTOMER_PILL,
  PAY_AMOUNT_CLASS,
  PAY_AMOUNT_LABEL_CLASS,
  PAY_BLOCK_CLASS,
  PAY_CAPTION_CLASS,
  PAY_CHANGE_LABEL_CLASS,
  PAY_CHANGE_ROW_CLASS,
  PAY_CHANGE_VALUE_CLASS,
  PAY_CHECK_CLASS,
  PAY_CLOSE_CLASS,
  PAY_DISCARD_LOOK,
  PAY_FIELD_CLASS,
  PAY_FIELD_INPUT_CLASS,
  PAY_FIELD_PREFIX_CLASS,
  PAY_HEAD_CLASS,
  PAY_MAIN_LOOK,
  PAY_METHOD_CLASS,
  PAY_METHOD_OFF_CLASS,
  PAY_METHOD_ON_CLASS,
  PAY_METHODS_CLASS,
  PAY_PANEL_CLASS,
  PAY_PARTIAL_CLASS,
  PAY_PILL_ADD_CLASS,
  PAY_PILL_CLASS,
  PAY_PILL_READ_CLASS,
  PAY_PILL_SET_CLASS,
  PAY_SCRIM_CLASS,
  PAY_SERVED_BY_CLASS,
  PAY_SPLIT_BOX_CLASS,
  PAY_SPLIT_CASH_CLASS,
  PAY_SPLIT_INPUT_CLASS,
  PAY_SPLIT_ONLINE_CLASS,
  PAY_TITLE_CLASS,
  PAY_TOTAL_CLASS,
  PAYMENT_AMOUNT_LABEL,
  PAYMENT_CHANGE_LABEL,
  dueNoteText,
  paymentDescription,
  paymentPlace,
  paymentTitle,
  pickerPillText,
  readOnlyPillText,
} from "@/lib/payment-sheet";
import { PaymentAmount } from "@/components/pos/PaymentAmount";

// The component compiles with the classic JSX runtime under tsx, so React must be a global for it.
(globalThis as { React?: typeof React }).React = React;

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const readRaw = (rel: string): string => readFileSync(path.join(CAFE_ROOT, rel), "utf8");
const readSrc = (rel: string): string => stripComments(readRaw(rel));
const count = (src: string, needle: string): number => src.split(needle).length - 1;
const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
const hasAll = (cls: string, want: string[], what: string) => {
  for (const t of want) assert.ok(tokens(cls).includes(t), `${what} must carry ${t} (got "${cls}")`);
};

const MODAL = "components/pos/PaymentModal.tsx";
const GRID = "components/pos/PaymentModeGrid.tsx";
const SPLIT = "components/pos/PaymentSplitFields.tsx";
const COLLECT = "components/pos/PaymentCollectFields.tsx";
const SUMMARY = "components/pos/PaymentSummary.tsx";
const POINTS = "components/pos/PaymentPoints.tsx";
const CUSTOMER = "components/pos/CustomerSearch.tsx";

// ── words (owner Q1: the HTML's words where it has the element; ours for our data) ──────────────────────────────────

// Fix round 1 (review): the title names the order as the cart and the order bar do (design 6.11, cartTitle): a new
// sale with no table is "New order"; a table (a tab's, or the one chosen for a new sale) is "Table {n}"; a tab with no
// table is "Walk-In". The Orders / dashboard sheet settles tabs only, so it never says "New order".
test("the title is the HTML's 'Payment · {place}': New order / Table {n} / Walk-In, as the cart names the order", () => {
  assert.equal(paymentTitle(undefined, true), "Payment · New order", "/pos: a new sale with no table");
  assert.equal(paymentTitle("T-4", true), "Payment · Table T-4", "/pos: a new sale at a chosen table");
  assert.equal(paymentTitle("T-4", false), "Payment · Table T-4", "a tab at a table");
  assert.equal(paymentTitle(undefined, false), "Payment · Walk-In", "a tab with no table");
  assert.equal(paymentTitle("", false), "Payment · Walk-In", "an empty table field is no table");
  assert.equal(paymentTitle("", true), "Payment · New order", "an empty table field on a new sale is no table");
  // Ruling P30 (U1 Task 10): the place word alone is the customer sheet's sub line when it opens from the pill.
  assert.equal(paymentPlace(undefined, true), "New order", "the place word: a new sale with no table");
  assert.equal(paymentPlace("T-4", false), "Table T-4", "the place word: a tab at a table");
  assert.equal(paymentPlace(undefined, false), "Walk-In", "the place word: a tab with no table");
  const lib = readSrc("lib/payment-sheet.ts");
  assert.ok(lib.includes("cartTitle({ resumedOrder:"), "the place word is the cart's own title rule (lib/pos-cart-view.ts), not a copy");
});

test("only /pos says which case it is: PosModals marks a new sale from the order on screen; the Orders sheet passes nothing", () => {
  const modal = readSrc(MODAL);
  assert.ok(modal.includes("newSale = false,"), "the default is a tab (the Orders / dashboard sheet)");
  assert.ok(modal.includes("{paymentTitle(tableNo, newSale)}"), "the title reads the case");
  const posModals = readSrc("components/pos/PosModals.tsx");
  assert.ok(posModals.includes("newSale={!resumedOrder}"), "a new sale = nothing resumed (cartTitle's input)");
  const sheet = readSrc("components/orders/OrderDetailSheet.tsx");
  assert.ok(sheet.includes('confirmLabel="Settle"') && !sheet.includes("newSale"), "the Orders sheet settles a tab: Table {n} / Walk-In");
});

test("today's description line stays for screen readers, word for word", () => {
  assert.equal(paymentDescription({ itemCount: 3, tableNo: "T-4", customerName: "Neha Joshi" }), "3 items · Table T-4 · Neha Joshi", "a tab at a table with a customer");
  assert.equal(paymentDescription({ itemCount: 1, tableNo: undefined, customerName: undefined }), "1 item · Walk-In · No customer", "one item, no table, no customer");
});

test("the HTML's amount words and the pill's words (our sale sends no e-bill, so no 'for e-bill')", () => {
  assert.equal(PAYMENT_AMOUNT_LABEL, "Amount to collect", "the HTML's label");
  assert.equal(PAYMENT_CHANGE_LABEL, "Change to return", "the HTML's change label");
  assert.equal(ADD_CUSTOMER_PILL, "+ Add customer", "the picker with no customer");
  assert.equal(pickerPillText(undefined), "+ Add customer", "the picker's empty label is never Walk-In (the table owns that word)");
  assert.equal(pickerPillText("Neha Joshi"), "Customer: Neha Joshi · change", "the picker with a customer");
  assert.equal(readOnlyPillText("Neha Joshi"), "Customer: Neha Joshi", "a tab's own customer: no change (design 6.11)");
});

test("Due / Credit keep today's sentence in the HTML's note box", () => {
  assert.equal(dueNoteText("Due", 954), "Payment marked as due — the full ₹954 is added to the customer's outstanding balance.", "Due");
  assert.equal(dueNoteText("Credit", 1200), "Charged to credit — the full ₹1,200 is added to the customer's outstanding balance.", "Credit");
});

// ── the amount block and its customer pill (design 6.11; the builder-check answer) ───────────────────────────────────

test("a tab that already has a customer shows a read-only 'Customer: {name}' when no picker is offered", () => {
  const html = renderToStaticMarkup(createElement(PaymentAmount, { total: 954, customerName: "Neha Joshi" }));
  assert.ok(html.includes("Amount to collect"), "landmark: the HTML's label");
  assert.ok(html.includes("₹954"), "the total");
  assert.ok(html.includes("Customer: Neha Joshi"), "the tab's customer stays on screen");
  assert.ok(!html.includes("change"), "read-only: no '· change'");
  assert.ok(!html.includes("<button"), "read-only: not a button");
  assert.ok(html.includes('data-ui="pay-customer"'), "the pill is named for the probes");
});

test("the picker takes the pill's place when offered; with neither, no pill", () => {
  const picker = createElement("button", { type: "button", "data-test": "picker" }, "+ Add customer");
  const offered = renderToStaticMarkup(createElement(PaymentAmount, { total: 954, customerName: "Neha Joshi", picker }));
  assert.ok(offered.includes('data-test="picker"'), "the picker renders");
  assert.ok(!offered.includes("Customer: Neha Joshi<"), "no read-only pill beside the picker");
  const none = renderToStaticMarkup(createElement(PaymentAmount, { total: 954 }));
  assert.ok(!none.includes("Customer:") && !none.includes("pay-customer"), "no customer and no picker: nothing");
});

test("PaymentModal hands the picker only when it is offered and the tab's customer otherwise", () => {
  const src = readSrc(MODAL);
  assert.ok(
    src.includes(
      "picker={onSelectCustomer && <CustomerSearch value={customer} onChange={onSelectCustomer} disabled={locked} context={paymentPlace(tableNo, newSale)} />}",
    ),
    "the picker exactly where today's showed (a new sale, or a tab with no customer); its sheet names the order (ruling P30)",
  );
  assert.ok(src.includes("customerName={customer?.name}"), "the customer passed in, read-only when no picker");
  assert.ok(src.includes("<PaymentAmount"), "the amount block from its own file");
});

// ── the frame (values 11.1; U0 values 2.1 sheetAlign / sheetPad / sheetRadius; cartFootB) ────────────────────────────

test("the frame: a Radix dialog drawn as the HTML's scrim and 420px panel, a bottom sheet below 720px", () => {
  const src = readSrc(MODAL);
  assert.ok(src.includes('import * as DialogPrimitive from "@radix-ui/react-dialog";'), "Radix: focus trap, Escape, role=dialog");
  assert.ok(!src.includes('from "@/components/ui/dialog"'), "not the kit dialog (its corner X and black overlay)");
  assert.ok(src.includes("<DialogPrimitive.Root open={open} onOpenChange={openChange}>"), "every close still goes through the guard");
  assert.ok(src.includes("{paymentTitle(tableNo, newSale)}"), "the HTML's title");
  assert.match(src, /<DialogPrimitive\.Description className="sr-only">\s*\{paymentDescription\(/, "today's description, read out only");
  assert.ok(src.includes('title="Close"') && src.includes("✕"), "the HTML's close: title Close and the ✕ character");
  // Ruling P22 (as the item options modal): the panel takes the focus on open and gives it back to the opener on close.
  assert.ok(src.includes('<DialogPrimitive.Content data-ui="pay-panel" {...openerFocus} className={PAY_PANEL_CLASS}>'), "the focus handlers on the panel");
  const hook = readSrc("hooks/use-opener-focus.ts");
  assert.ok(hook.includes("e.currentTarget.focus();") && hook.includes("openerRef.current.focus();"), "the panel on open, the opener on close");
  // The scrim sits over the Orders page's sheet (z 50, earlier in the DOM), so it is z 50, not the HTML's 45.
  hasAll(PAY_SCRIM_CLASS, ["fixed", "inset-0", "z-50", "flex", "items-center", "justify-center", "bg-scrim", "p-4", "max-tab:items-end", "max-tab:p-0", "motion-safe:animate-scrim-in", "leading-[normal]"], "the scrim");
  hasAll(PAY_PANEL_CLASS, [
    "flex", "w-full", "max-w-[420px]", "flex-col", "gap-4", "rounded-[14px]", "bg-card", "px-[18px]", "pt-[18px]", "pb-3.5",
    "[box-shadow:var(--pop)]", "motion-safe:animate-sheet-in", "max-tab:rounded-[14px_14px_0_0]", "max-tab:pb-[calc(12px+env(safe-area-inset-bottom))]",
  ], "the panel");
  assert.ok(!tokens(PAY_PANEL_CLASS).includes("border"), "the HTML's panel has no border");
  hasAll(PAY_HEAD_CLASS, ["flex", "items-center", "justify-between", "gap-2.5"], "the head");
  hasAll(PAY_TITLE_CLASS, ["text-[16px]", "font-semibold"], "the title");
  hasAll(PAY_CLOSE_CLASS, ["size-[30px]", "rounded-[50%]", "border-0", "bg-surface-3", "text-[12px]", "text-muted-foreground"], "the ✕");
});

test("the amount block and the pill: the HTML's 13px label, 36px total and 28px pill", () => {
  hasAll(PAY_AMOUNT_CLASS, ["text-center"], "the amount block");
  hasAll(PAY_AMOUNT_LABEL_CLASS, ["text-[13px]", "text-muted-foreground"], "Amount to collect");
  hasAll(PAY_TOTAL_CLASS, ["mt-0.5", "text-[36px]", "font-semibold", "tracking-[-0.025em]"], "the total");
  hasAll(PAY_PILL_CLASS, ["mt-2", "inline-block", "h-7", "rounded-[999px]", "border-0", "bg-surface-2", "px-3", "text-[12.5px]", "font-medium", "max-w-full", "truncate", "align-top"], "the pill");
  hasAll(PAY_PILL_ADD_CLASS, ["text-link"], "+ Add customer");
  hasAll(PAY_PILL_SET_CLASS, ["text-foreground"], "Customer: {name} · change");
  hasAll(PAY_PILL_READ_CLASS, ["text-foreground", "leading-7"], "the read-only pill");
});

// ── the methods (values 11.1): the HTML's segmented track with our five modes ───────────────────────────────────────

test("the methods: the HTML's 5-column track, SEG_ON / SEG_OFF, our five modes — the per-mode PAY_STYLES colours go", () => {
  const grid = readSrc(GRID);
  // Reason (U1 Task 9): the HTML's segmented look replaces today's coloured buttons (Cash yellow, Online blue, ...).
  assert.ok(!grid.includes("PAY_STYLES"), "no per-mode colours on the grid");
  assert.ok(!grid.includes("ring-current") && !grid.includes("style.bg"), "no coloured ring or fill");
  assert.equal(count(grid, "onClick={() => onSelect(m)}"), 1, "landmark: one button per mode");
  assert.ok(grid.includes("aria-pressed={active}"), "the chosen mode is announced");
  assert.ok(grid.includes("active ? PAY_METHOD_ON_CLASS : PAY_METHOD_OFF_CLASS"), "SEG_ON for the chosen mode, SEG_OFF for the rest");
  assert.ok(grid.includes("disabled={locked}"), "in flight or frozen: no mode change");
  hasAll(PAY_METHODS_CLASS, ["grid", "gap-[3px]", "rounded-[10px]", "bg-surface-3", "p-[3px]"], "the track");
  hasAll(PAY_METHOD_CLASS, ["h-10", "rounded-[8px]", "border-0", "px-0.5", "text-[13.5px]", "font-semibold", "text-foreground"], "a method");
  hasAll(PAY_METHOD_ON_CLASS, ["bg-seg", "[box-shadow:var(--seg-sh)]"], "SEG_ON");
  hasAll(PAY_METHOD_OFF_CLASS, ["bg-transparent", "disabled:opacity-50"], "SEG_OFF (the others dim while locked)");
});

// ── the method blocks (values 11.1-11.2; owner Q14: no quick amounts) ──────────────────────────────────────────────

test("Cash / Online: 'Amount received' and one 44px field; Cash adds 'Change to return'; the partial line in --warn-i", () => {
  const src = readSrc(COLLECT);
  assert.ok(src.includes('<label htmlFor="amount-received" className={PAY_CAPTION_CLASS}>Amount received</label>'), "today's caption names the field");
  assert.ok(src.includes('id="amount-received"') && src.includes("disabled={disabled}"), "today's field, locked with the sheet");
  assert.ok(src.includes("{PAYMENT_CHANGE_LABEL}") && src.includes("{inr(change)}"), "the change row");
  assert.ok(src.includes("unpaid — added to"), "today's partial-payment line");
  for (const quick of ["Exact", "Other amount", "₹1,000", "₹2,000"]) assert.ok(!src.includes(quick), `no quick amount "${quick}" (owner Q14)`);
  hasAll(PAY_BLOCK_CLASS, ["flex", "flex-col", "gap-2"], "a method block");
  hasAll(PAY_CAPTION_CLASS, ["text-[12px]", "font-semibold", "text-muted-foreground"], "a caption");
  hasAll(PAY_FIELD_CLASS, ["flex", "h-11", "items-center", "gap-2", "rounded-[8px]", "border", "border-border", "bg-card", "px-3"], "the field box");
  hasAll(PAY_FIELD_PREFIX_CLASS, ["text-[13px]", "text-muted-foreground"], "the ₹ prefix");
  hasAll(PAY_FIELD_INPUT_CLASS, ["min-w-0", "flex-1", "[border:0]", "bg-transparent", "text-right", "text-[15px]", "font-semibold", "text-foreground", "max-tab:text-[16px]"], "the amount");
  hasAll(PAY_PARTIAL_CLASS, ["text-[12.5px]", "text-status-warn-ink"], "the partial line");
  hasAll(PAY_CHANGE_ROW_CLASS, ["flex", "items-center", "justify-between", "border-t", "border-border-2", "pt-3.5"], "the change row");
  hasAll(PAY_CHANGE_LABEL_CLASS, ["text-[14px]", "text-muted-foreground"], "Change to return");
  hasAll(PAY_CHANGE_VALUE_CLASS, ["text-[22px]", "font-semibold", "text-status-ok-ink"], "the change");
});

test("Split: today's two editable fields in the HTML's two boxes (Cash with the accent rule) and the must-equal line", () => {
  const src = readSrc(SPLIT);
  assert.ok(src.includes('id="split-cash"') && src.includes('id="split-online"'), "today's two fields");
  assert.ok(src.includes("(must equal {inr(total)})"), "today's line");
  for (const quick of ["Half", "₹100 cash", "₹500 cash"]) assert.ok(!src.includes(quick), `no quick split "${quick}" (owner Q14)`);
  hasAll(PAY_SPLIT_BOX_CLASS, ["flex", "flex-col", "gap-1", "rounded-[10px]", "border", "px-3", "py-2.5"], "a split box");
  hasAll(PAY_SPLIT_CASH_CLASS, ["border-primary", "bg-card"], "the Cash box");
  hasAll(PAY_SPLIT_ONLINE_CLASS, ["border-border", "bg-surface-2"], "the Online box");
  hasAll(PAY_SPLIT_INPUT_CLASS, ["min-w-0", "flex-1", "[border:0]", "bg-transparent", "text-[18px]", "font-semibold"], "a split amount");
});

test("Due / Credit: the note box, warn without a customer; the checks in --bad-i; Served by; the 50px button", () => {
  const src = readSrc(MODAL);
  assert.ok(src.includes('noticeBoxClass(customer ? "neutral" : "warn")'), "the HTML's due box: warn colours without a customer");
  assert.ok(src.includes("{dueNoteText(mode, total)}"), "our sentence");
  assert.ok(src.includes("Select a customer for ${mode} orders."), "today's check");
  assert.ok(src.includes("Served by {receiver}"), "today's line");
  assert.ok(!src.includes("AlertCircle"), "the check is the HTML's plain line");
  hasAll(PAY_CHECK_CLASS, ["text-[12.5px]", "text-status-bad-ink"], "a check line");
  hasAll(PAY_SERVED_BY_CLASS, ["text-center", "text-[12px]", "text-subtle-foreground"], "Served by");
  hasAll(PAY_MAIN_LOOK, ["h-[50px]", "w-full", "rounded-[10px]", "border-0", "bg-primary", "text-[15px]", "font-semibold", "text-primary-foreground", "not-disabled:hover:bg-primary-hover"], "the main button");
  hasAll(PAY_DISCARD_LOOK, ["h-[50px]", "w-full", "rounded-[10px]", "border", "border-ink", "bg-card", "text-[14.5px]", "font-semibold"], "Discard");
});

test("the bill rows are the HTML's 13px rows; the points row keeps its 44px switch row in the sheet's box", () => {
  const summary = readSrc(SUMMARY);
  assert.ok(summary.includes('className="flex flex-col gap-[5px] text-[13px] text-muted-foreground"'), "the HTML's bill block");
  assert.ok(summary.includes("POS_BILL_VALUE_CLASS"), "the amounts in --text, as the cart's rows");
  assert.ok(!summary.includes("<span>Total</span>"), "the total is the sheet's 36px amount, not a row");
  assert.ok(summary.includes('noticeBoxClass("warn")'), "the bill-changed warning in the HTML's note box");
  const points = readSrc(POINTS);
  assert.ok(points.includes("rounded-[10px] border border-border"), "the sheet's box");
});

test("CustomerSearch's own trigger is the payment pill (the cart's cell brings its own)", () => {
  const src = readSrc(CUSTOMER);
  assert.ok(src.includes("{pickerPillText(value?.name)}"), "the pill's words");
  assert.ok(src.includes("cn(PAY_PILL_CLASS, value ? PAY_PILL_SET_CLASS : PAY_PILL_ADD_CLASS, BRAND_PRESS_CLASS, className)"), "the pill's look");
  assert.ok(src.includes('data-ui="pay-customer"'), "named for the probes");
});
