// U2 Task 5 (2026-10-23): the order detail's head (docs/superpowers/specs/2026-10-22-orders-html-values.md 0.1 clock,
// 11.2 head, 11.3 measured, 11.10 per kind; docs/superpowers/specs/2026-10-23-orders-match-html-design.md 6.7): the meta
// row (our channel word, the staff name, the token, the clock) and the four steps (two for a cancelled order) as a pure
// model, then components/orders/OrderDetailHead.tsx as drawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as DialogPrimitive from "@radix-ui/react-dialog";

import { SELF_ORDER_SOURCE } from "@pos/shared/public";
import { REWARD_ITEM_LINE_NOTE } from "@pos/shared/reward-redemption";
import { expectAll, tagOf, tagsOf, textOf } from "./class-tags.fixtures";
import {
  cancelNote,
  detailCustomer,
  detailItemsHead,
  detailLineMeta,
  detailMeta,
  detailSteps,
  detailSums,
  voidLineNote,
  type DetailMetaItem,
  type DetailStep,
  type DetailSums,
} from "./order-detail-view";
import { computeOrderTotals, receiptGst } from "./receipt";
import { NOW, minutesBefore, order, printed, settled } from "./orders-lanes.fixtures";
import { OrderDetailHead } from "@/components/orders/OrderDetailHead";
import type { Order } from "@/types";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (as orders-lanes-view.test.ts).
(globalThis as { React?: typeof React }).React = React;

const fired = (over: Record<string, unknown> = {}) => ({ productId: "p1", name: "Tea", price: 50, qty: 1, modifiers: [], instructions: "", kotRound: 1, ...over });

// ── The meta row (values 11.2, 0.1) ─────────────────────────────────────────────────────────────────────────────────

test("detailMeta: an open dine-in tab with a token, 68 minutes old: channel, staff, token, then the clock with its age in --bad-i", () => {
  const o = order("014", { tableNo: "T-1", receiver: "Sana", tokenNumber: 12, createdAt: minutesBefore(68) });
  const want: DetailMetaItem[] = [
    { icon: "type", text: "Dine-in", tone: "plain" },
    { icon: "staff", text: "Sana", tone: "plain" },
    { icon: "token", text: "Token 12", tone: "plain" },
    { icon: "clock", text: "8:22 PM · 1h 8m", tone: "bad" },
  ];
  assert.deepEqual(detailMeta(o, NOW), want, "the HTML's order (type, staff, clock) with our token before the clock");
});

test("detailMeta: the open clock is coloured as the row's age (--warn-i from 30 minutes, plain under 30)", () => {
  const at = (m: number) => detailMeta(order("1", { tableNo: "T-4", createdAt: minutesBefore(m) }), NOW).at(-1);
  assert.deepEqual(at(32), { icon: "clock", text: "8:58 PM · 32 min", tone: "warn" }, "32 minutes: --warn-i 600");
  assert.deepEqual(at(14), { icon: "clock", text: "9:16 PM · 14 min", tone: "plain" }, "14 minutes: the meta's --text-2 400");
  assert.deepEqual(at(60), { icon: "clock", text: "8:30 PM · 1h 0m", tone: "bad" }, "an hour: --bad-i 600");
});

test("detailMeta: a settled bill today shows its time only, never an age colour; an older one its day first", () => {
  const today = settled("1", 879, 879);
  const todayMeta = detailMeta({ ...today, tableNo: "T-12", receiver: "Ananya", createdAt: minutesBefore(74) }, NOW);
  assert.deepEqual(todayMeta.at(-1), { icon: "clock", text: "8:16 PM", tone: "plain" }, "today: '8:16 PM'");
  const older = detailMeta({ ...today, createdAt: "2026-10-17T20:16:00+05:30" }, NOW);
  assert.deepEqual(older.at(-1), { icon: "clock", text: "17 Oct · 8:16 PM", tone: "plain" }, "an older day: '17 Oct · 8:16 PM'");
});

test("detailMeta: a cancelled order's clock is its cancel time (Ruling P8, values 11.10)", () => {
  const o = order("1", { status: "Cancelled", createdAt: minutesBefore(90), cancelledAt: minutesBefore(0) });
  assert.deepEqual(detailMeta(o, NOW).at(-1), { icon: "clock", text: "9:30 PM", tone: "plain" }, "cancelled at 9:30 PM");
});

test("detailMeta: no staff item without a receiver, no token item without a token; our channel words", () => {
  assert.deepEqual(
    detailMeta(order("1", { receiver: "  ", createdAt: minutesBefore(5) }), NOW).map((m) => m.icon),
    ["type", "clock"],
    "a walk-in with no receiver and no token: the channel and the clock",
  );
  const word = (over: Record<string, unknown>) => detailMeta(order("1", over), NOW)[0].text;
  assert.equal(word({}), "Counter", "a walk-in at the counter");
  assert.equal(word({ parcel: true }), "Takeaway", "a takeaway");
  assert.equal(word({ source: SELF_ORDER_SOURCE, tableNo: "T-2" }), "QR self-order", "a diner's QR order");
  assert.equal(word({ tableNo: "T-4" }), "Dine-in", "a table");
  assert.equal(detailMeta(order("1", { tokenNumber: 0 }), NOW)[1].text, "Token 0", "token 0 is a token");
});

// ── The steps (values 11.2; design 6.7) ─────────────────────────────────────────────────────────────────────────────

const steps = (o: Parameters<typeof detailSteps>[0]): string[] => detailSteps(o).map((s) => `${s.label}:${s.state}:${s.time}`);

test("detailSteps: an open tab sent to the kitchen, bill not printed: Opened (its time) · Kitchen Sent · Bill printed current 'Next' · Paid", () => {
  const o = order("1", { createdAt: minutesBefore(32), items: [fired()] });
  assert.deepEqual(steps(o), ["Opened:done:8:58 PM", "Kitchen:done:Sent", "Bill printed:cur:Next", "Paid:todo:"], "values 11.2 (Table 4)");
});

test("detailSteps: an open tab with nothing sent: Kitchen is the current step 'Not sent', the rest to do", () => {
  const o = order("1", { createdAt: minutesBefore(0), kotRounds: 0, items: [fired({ kotRound: 0 })] });
  assert.deepEqual(steps(o), ["Opened:done:9:30 PM", "Kitchen:cur:Not sent", "Bill printed:todo:", "Paid:todo:"], "values 11.2 (sel-new-unsent)");
});

test("detailSteps: an order whose every fired line skips the kitchen reads 'Not needed' and counts as done (design 6.7)", () => {
  const o = order("1", { createdAt: minutesBefore(14), items: [fired({ noKot: true }), fired({ productId: "p2", noKot: true })] });
  assert.deepEqual(steps(o), ["Opened:done:9:16 PM", "Kitchen:done:Not needed", "Bill printed:cur:Next", "Paid:todo:"], "skip-KOT");
});

test("detailSteps: a printed bill (billPrintedNow) is done 'Printed' and Paid is current 'Next'; a bill changed since is not printed (Q11)", () => {
  const o = printed("1", { createdAt: minutesBefore(68), items: [fired()] });
  assert.deepEqual(steps(o), ["Opened:done:8:22 PM", "Kitchen:done:Sent", "Bill printed:done:Printed", "Paid:cur:Next"], "values 11.2 (Table 1)");
  const grown = printed("1", { createdAt: minutesBefore(68), items: [fired()], total: 150, billFirstPrintedTotal: 100 });
  assert.deepEqual(steps(grown).slice(2), ["Bill printed:cur:Next", "Paid:todo:"], "a round after the print makes a new bill");
});

test("detailSteps: a settled bill: four done steps, 'Paid' with no time (we store no paid-at time)", () => {
  assert.deepEqual(steps(settled("1", 879, 879)), ["Opened:done:", "Kitchen:done:", "Bill printed:done:", "Paid:done:"], "paid");
});

test("detailSteps: a settled bill with money owed ends on 'Due' in the bill look", () => {
  const due: DetailStep[] = detailSteps(settled("1", 954, 0, "Due"));
  assert.deepEqual(due.at(-1), { label: "Due", state: "due", time: "" }, "the last step is Due");
  assert.deepEqual(due.slice(0, 3).map((s) => s.state), ["done", "done", "done"], "the first three are done");
  assert.deepEqual(detailSteps(settled("1", 500, 300, "Cash")).at(-1)?.label, "Due", "a short payment is owed too (Q3)");
});

test("detailSteps: a cancelled order: Opened (no time) · Cancelled (bad, its cancel time)", () => {
  const o = order("1", { status: "Cancelled", cancelledAt: minutesBefore(0) });
  assert.deepEqual(steps(o), ["Opened:done:", "Cancelled:bad:9:30 PM"], "values 11.2 cancelled");
  assert.deepEqual(steps(order("1", { status: "Cancelled" })), ["Opened:done:", "Cancelled:bad:"], "no cancel time stored: none shown");
});

// ── The head as drawn (values 11.2, 11.3) ───────────────────────────────────────────────────────────────────────────

const noop = (): void => undefined;
/** The head alone (the column), or inside an open dialog with its ✕ (a sheet: the name is the dialog's title). */
const headHtml = (o: Order, onClose?: () => void): string => {
  const head = createElement(OrderDetailHead, { order: o, now: NOW, onClose });
  return renderToStaticMarkup(onClose ? createElement(DialogPrimitive.Root, { open: true }, head) : head);
};
const billed = (): Order => printed("014", { tableNo: "T-1", receiver: "Sana", tokenNumber: 12, createdAt: minutesBefore(68), items: [fired()] });

test("OrderDetailHead: padding 16 18, 14px to the steps, a 1px --border rule; the top row 12px apart (values 11.2)", () => {
  const html = headHtml(billed());
  expectAll(tagOf(html, "order-detail-head"), ["flex", "flex-none", "flex-col", "gap-3.5", "border-b", "border-border", "px-[18px]", "py-4"], "values 11.2 head");
  expectAll(tagOf(html, "order-detail-top"), ["flex", "items-start", "gap-3"], "values 11.2 top row");
});

test("OrderDetailHead: the 46px ink code tile, the name 18/600 -.01em with an ellipsis, '#014' in Geist Mono 12.5 --text-3", () => {
  const html = headHtml(billed());
  expectAll(
    tagOf(html, "order-detail-tile"),
    ["flex", "size-[46px]", "flex-none", "items-center", "justify-center", "rounded-[12px]", "bg-ink", "text-on-ink", "text-[13.5px]", "font-bold"],
    "values 11.2 tile (always ink, also for a billed order)",
  );
  assert.equal(textOf(html, "order-detail-tile"), "T1", "the dashboard's code");
  expectAll(tagOf(html, "order-detail-title"), ["min-w-0", "flex-1"], "the title column");
  expectAll(tagOf(html, "order-detail-name-row"), ["flex", "min-w-0", "items-baseline", "gap-2"], "values 11.2 name row");
  expectAll(tagOf(html, "order-detail-name"), ["truncate", "text-[18px]", "font-semibold", "tracking-[-0.01em]"], "values 11.2 name");
  assert.equal(textOf(html, "order-detail-name"), "Table T-1", "our title words");
  expectAll(tagOf(html, "order-detail-number"), ["flex-none", "font-mono", "text-[12.5px]", "text-subtle-foreground"], "values 11.2 number");
  assert.equal(textOf(html, "order-detail-number"), "#014", "the order's number of the day");
});

test("OrderDetailHead: the meta row 12.5 --text-2, gaps 4 10, 4px under the name; each item an icon (13px, stroke 1.9, .8) 5px from its words, coloured by its tone", () => {
  const html = headHtml(billed());
  expectAll(tagOf(html, "order-detail-meta"), ["mt-1", "flex", "flex-wrap", "gap-x-2.5", "gap-y-1", "text-[12.5px]", "text-muted-foreground"], "values 11.2 meta");
  const items = tagsOf(html, "order-detail-meta-item");
  assert.deepEqual([0, 1, 2, 3].map((i) => textOf(html, "order-detail-meta-item", i)), ["Dine-in", "Sana", "Token 12", "8:22 PM · 1h 8m"], "the four items");
  items.forEach((tag, i) => expectAll(tag, ["flex", "items-center", "gap-[5px]", "whitespace-nowrap"], `meta item ${i + 1}`));
  for (const i of [0, 1, 2]) expectAll(items[i], ["font-normal", "text-muted-foreground"], `meta item ${i + 1}: --text-2 400`);
  expectAll(items[3], ["font-semibold", "text-status-bad-ink"], "an hour open: --bad-i 600");
  const icons = html.match(/<svg[^>]*data-ui="order-detail-meta-icon"[^>]*>/g) ?? [];
  assert.equal(icons.length, 4, "an icon per item (the token's our ticket glyph)");
  for (const svg of icons) {
    for (const attr of ['width="13"', 'height="13"', 'stroke-width="1.9"', 'stroke-linecap="round"', 'stroke-linejoin="round"', 'opacity="0.8"']) {
      assert.ok(svg.includes(attr), `values 11.2 meta icon: ${attr} (${svg})`);
    }
    assert.ok(/class="[^"]*\bflex-none\b/.test(svg), "the icon never shrinks");
  }
});

test("OrderDetailHead: the steps box radius 12 on --surface-2 with a 1px --border-2 rule, padding 12 12 10; four columns (two when cancelled)", () => {
  const html = headHtml(billed());
  expectAll(tagOf(html, "order-detail-steps"), ["grid", "grid-cols-4", "rounded-[12px]", "border", "border-border-2", "bg-surface-2", "px-3", "pt-3", "pb-2.5"], "values 11.2 steps");
  const cancelled = headHtml(order("1", { status: "Cancelled", cancelledAt: minutesBefore(0) }));
  expectAll(tagOf(cancelled, "order-detail-steps"), ["grid-cols-2"], "a cancelled order's two steps");
  assert.equal(tagsOf(cancelled, "order-detail-step").length, 2, "two steps");
});

test("OrderDetailHead: each step a 7px column of the 14px dot and its 2px connector (6px each side), the 12/600 label, the 11px time 4px up", () => {
  const html = headHtml(billed());
  const steps = tagsOf(html, "order-detail-step");
  assert.equal(steps.length, 4, "four steps");
  steps.forEach((tag, i) => expectAll(tag, ["flex", "min-w-0", "flex-col", "gap-[7px]"], `step ${i + 1}`));
  tagsOf(html, "order-detail-step-dot").forEach((tag, i) =>
    expectAll(tag, ["flex", "size-3.5", "flex-none", "items-center", "justify-center", "rounded-[50%]", "text-white"], `dot ${i + 1}`),
  );
  tagsOf(html, "order-detail-step-line").forEach((tag, i) => expectAll(tag, ["mx-1.5", "h-0.5", "flex-1", "rounded-[1px]"], `connector ${i + 1}`));
  tagsOf(html, "order-detail-step-label").forEach((tag, i) => expectAll(tag, ["truncate", "pr-1.5", "text-[12px]", "font-semibold"], `label ${i + 1}`));
  tagsOf(html, "order-detail-step-time").forEach((tag, i) => expectAll(tag, ["-mt-1", "min-h-[14px]", "whitespace-nowrap", "text-[11px]"], `time ${i + 1}`));
  assert.deepEqual([0, 1, 2, 3].map((i) => textOf(html, "order-detail-step-label", i)), ["Opened", "Kitchen", "Bill printed", "Paid"], "the labels");
  assert.deepEqual([0, 1, 2, 3].map((i) => textOf(html, "order-detail-step-time", i)), ["8:22 PM", "Sent", "Printed", "Next"], "the times (values 11.3, Table 1)");
});

test("OrderDetailHead: the step looks — done --ok with the tick and an --ok connector; current white with the 3px --accent ring, its words --accent-i; to do --surface-3 / --text-3; bad --bad; due --bill; the last connector hidden", () => {
  const html = headHtml(billed());
  const dots = tagsOf(html, "order-detail-step-dot");
  const lines = tagsOf(html, "order-detail-step-line");
  const labels = tagsOf(html, "order-detail-step-label");
  const times = tagsOf(html, "order-detail-step-time");
  for (const i of [0, 1, 2]) {
    expectAll(dots[i], ["bg-status-ok"], `done dot ${i + 1}`);
    expectAll(lines[i], ["bg-status-ok"], `done connector ${i + 1}`);
    expectAll(labels[i], ["text-foreground"], `done label ${i + 1}`);
    expectAll(times[i], ["text-subtle-foreground"], `done time ${i + 1}`);
  }
  expectAll(dots[3], ["bg-card", "[box-shadow:inset_0_0_0_3px_var(--color-primary)]"], "the current step's ring");
  expectAll(labels[3], ["text-accent-foreground"], "current label --accent-i");
  expectAll(times[3], ["text-accent-foreground"], "current time --accent-i");
  expectAll(lines[3], ["opacity-0", "bg-border"], "the last connector is hidden");
  const ticks = html.match(/<svg[^>]*data-ui="order-detail-step-tick"[^>]*>/g) ?? [];
  assert.deepEqual(ticks.map((t) => /opacity="1"/.test(t)), [true, true, true, false], "the tick shows on done steps only");
  for (const t of ticks) for (const attr of ['width="8"', 'height="8"', 'stroke-width="4"']) assert.ok(t.includes(attr), `values 11.2 tick: ${attr}`);

  const open = headHtml(order("1", { createdAt: minutesBefore(32), items: [fired()] }));
  expectAll(tagsOf(open, "order-detail-step-dot")[3], ["bg-surface-3"], "a step to do: --surface-3");
  expectAll(tagsOf(open, "order-detail-step-label")[3], ["text-subtle-foreground"], "its label --text-3");
  expectAll(tagsOf(open, "order-detail-step-line")[2], ["bg-border"], "after the current step: --border");
  const cancelled = headHtml(order("1", { status: "Cancelled", cancelledAt: minutesBefore(0) }));
  expectAll(tagsOf(cancelled, "order-detail-step-dot")[1], ["bg-status-bad"], "Cancelled: --bad");
  expectAll(tagsOf(cancelled, "order-detail-step-label")[1], ["text-status-bad-ink"], "its label --bad-i");
  const due = headHtml(settled("1", 954, 0, "Due"));
  expectAll(tagsOf(due, "order-detail-step-dot")[3], ["bg-status-bill"], "Due: --bill");
  expectAll(tagsOf(due, "order-detail-step-label")[3], ["text-status-bill-ink"], "its label --bill-i");
});

test("OrderDetailHead: no ✕ in the column; in a sheet the HTML's 34px round ✕ (title 'Close') and the name is the dialog's title", () => {
  assert.equal(tagOf(headHtml(billed()), "order-detail-close"), "", "the column has no ✕ (values 11.2: below 1024 only)");
  const html = headHtml(billed(), noop);
  const close = tagOf(html, "order-detail-close");
  expectAll(
    close,
    ["flex", "size-[34px]", "flex-none", "cursor-pointer", "items-center", "justify-center", "rounded-[50%]", "border-0", "bg-surface-3", "px-1.5", "py-px", "text-[12px]", "text-muted-foreground"],
    "values 11.2 close",
  );
  assert.match(close, /title="Close"/, "the HTML's title");
  assert.match(close, /aria-label="Close"/, "named for a screen reader (not 'multiplication x')");
  assert.equal(textOf(html, "order-detail-close"), "✕", "the HTML's glyph");
  assert.match(tagOf(html, "order-detail-name"), /\sid="[^"]+"/, "the name labels the dialog (Radix Title)");
});

// ── U2 Task 6: the sums (design 6.8, Q9; values 11.5, 11.10; lib/receipt.ts) ────────────────────────────────────────

const rowsOf = (s: DetailSums): string[] => s.rows.map((r) => `${r.label}|${r.value}|${r.tone}`);
/** A row's rupees, signed ("−₹50" → -50). */
const rupees = (value: string): number => Number(value.replace(/[^\d]/g, "")) * (value.startsWith("−") ? -1 : 1);
/** The bill's own rows (Subtotal, the discount, the charges, an exclusive GST) add up to the total. */
const billRowsAddUp = (s: DetailSums, what: string): void => {
  const bill = s.rows.filter((r) => !/^(Incl\. GST|Paid|Due at billing)/.test(r.label));
  assert.equal(bill.reduce((n, r) => n + rupees(r.value), 0), rupees(s.total), `${what}: ${rowsOf(s).join(", ")} add up to ${s.total}`);
};
const TABLE = { type: "table", label: "Table charge", amount: 30 };

test("detailSums: an open tab with a discount, a table charge and exclusive GST — Subtotal, the discount −₹x in --bad-i, the charge, 'GST @5%'; 'To pay' the total, and the rows add up (computeOrderTotals)", () => {
  const t = computeOrderTotals({ items: [{ price: 250, qty: 2 }], discount: 50, discountKind: undefined, charge: 30, cfg: { gstEnabled: true, gstRate: 5, gstMode: "exclusive" } });
  assert.deepEqual([t.subtotal, t.discount, t.gstAmount, t.charge, t.total], [500, 50, 23, 30, 503], "landmark: the bill's own figures");
  const o = order("1", { subtotal: t.subtotal, discount: t.discount, gstAmount: t.gstAmount, gstRate: 5, gstMode: "exclusive", charges: [TABLE], chargeAmount: 30, chargeLabel: "Table charge", total: t.total });
  const s = detailSums(o);
  assert.deepEqual(rowsOf(s), ["Subtotal|₹500|plain", "Discount|−₹50|bad", "Table charge|₹30|plain", "GST @5%|₹23|plain"], "the HTML's open rows, our labels");
  assert.deepEqual([s.totalLabel, s.total, s.struck], ["To pay", "₹503", false], "values 11.5: 'To pay' · the total");
  billRowsAddUp(s, "exclusive");
});

test("detailSums: every charge of the order's snapshot in its order (table, then the extras); a legacy order's one scalar charge reads 'Table charge'", () => {
  const extra = { type: "extra", label: "Packing", amount: 20 };
  const o = order("1", { subtotal: 300, charges: [extra, TABLE], chargeAmount: 50, total: 350, gstRate: 0, gstMode: "exclusive" });
  assert.deepEqual(rowsOf(detailSums(o)), ["Subtotal|₹300|plain", "Table charge|₹30|plain", "Packing|₹20|plain"], "chargesFromOrder's order");
  billRowsAddUp(detailSums(o), "two charges, no GST");
  const legacy = order("1", { subtotal: 855, chargeAmount: 50, total: 905 });
  assert.deepEqual(rowsOf(detailSums(legacy)), ["Subtotal|₹855|plain", "Table charge|₹50|plain"], "no snapshot of GST: no GST row; the scalar charge");
});

// U2 Task 6 carried (Task 7, fix before merge): an order stored before the GST mode snapshot but with an exclusive GST
// amount must still add up — its stored figure in a plain row, never the cafe's live settings.
test("detailSums: no GST mode snapshot but a stored gstAmount > 0 — a plain 'GST' row (or 'GST @{rate}%' with a stored rate) with that amount, so the rows add up", () => {
  const bare = order("1", { subtotal: 500, gstAmount: 25, total: 525 });
  assert.deepEqual(rowsOf(detailSums(bare)), ["Subtotal|₹500|plain", "GST|₹25|plain"], "no rate stored: 'GST'");
  billRowsAddUp(detailSums(bare), "no mode, no rate");
  const rated = order("1", { subtotal: 855, chargeAmount: 50, gstAmount: 43, gstRate: 5, total: 948 });
  assert.deepEqual(rowsOf(detailSums(rated)), ["Subtotal|₹855|plain", "Table charge|₹50|plain", "GST @5%|₹43|plain"], "a stored rate: 'GST @5%'");
  billRowsAddUp(detailSums(rated), "no mode, a rate");
  const settledOld = detailSums({ ...settled("1", 525, 525, "Cash"), subtotal: 500, gstAmount: 25 });
  assert.deepEqual(rowsOf(settledOld), ["Subtotal|₹500|plain", "GST|₹25|plain", "Paid by Cash|₹525|plain"], "a settled old bill: the GST row before the payment");
  assert.deepEqual(rowsOf(detailSums(order("1", { subtotal: 300, gstAmount: 0, total: 300 }))), ["Subtotal|₹300|plain"], "no amount stored: no row");
});

test("detailSums: inclusive GST is a row inside the total, 'Incl. GST @5%', the bill's own figure (receiptGst: the charge lifted out first)", () => {
  const plain = order("1", { subtotal: 490, gstAmount: 0, gstRate: 5, gstMode: "inclusive", total: 490 });
  assert.deepEqual(rowsOf(detailSums(plain)), ["Subtotal|₹490|plain", "Incl. GST @5%|₹23|plain"], "490 incl. 5%: ₹23 of it is GST");
  billRowsAddUp(detailSums(plain), "inclusive");
  const charged = order("1", { subtotal: 855, gstAmount: 0, gstRate: 5, gstMode: "inclusive", chargeAmount: 50, total: 905 });
  const bill = receiptGst(charged, { gstEnabled: false, gstRate: 0, gstMode: "inclusive" });
  assert.deepEqual(rowsOf(detailSums(charged)), ["Subtotal|₹855|plain", "Table charge|₹50|plain", `Incl. GST @5%|₹${bill.gstAmount}|plain`], "the printed bill's GST (the untaxed charge lifted out)");
  assert.equal(bill.gstAmount, 41, "landmark: 855 incl. 5%");
  const noGst = order("1", { subtotal: 200, gstAmount: 0, gstRate: 0, gstMode: "inclusive", total: 200 });
  assert.deepEqual(rowsOf(detailSums(noGst)), ["Subtotal|₹200|plain"], "GST off when the order was taken: no GST row");
});

test("detailSums: the discount reads as the bill does (discountLineLabel: Discount / GST Discount / Reward)", () => {
  const label = (discountKind?: string) => detailSums(order("1", { subtotal: 880, discount: 42, discountKind, total: 838 })).rows[1];
  assert.deepEqual(label(), { label: "Discount", value: "−₹42", tone: "bad" }, "a manual discount");
  assert.equal(label("gst").label, "GST Discount", "the GST preset");
  assert.equal(label("reward").label, "Reward", "a redeemed reward");
});

test("detailSums: a settled bill — 'Bill total'; paid in full by Cash 'Paid by Cash', Online 'Paid online'; a split 'Paid in cash' + 'Paid online' (its split amounts)", () => {
  const cash = detailSums({ ...settled("1", 905, 905, "Cash"), subtotal: 855, chargeAmount: 50 });
  assert.deepEqual(rowsOf(cash), ["Subtotal|₹855|plain", "Table charge|₹50|plain", "Paid by Cash|₹905|plain"], "cash");
  assert.deepEqual([cash.totalLabel, cash.total, cash.struck], ["Bill total", "₹905", false], "values 11.10 paid: 'Bill total'");
  assert.equal(detailSums({ ...settled("1", 940, 940, "Online"), subtotal: 940 }).rows.at(-1)?.label, "Paid online", "online");
  const split = detailSums({ ...settled("1", 320, 320, "Split"), subtotal: 320, splitCash: 50, splitOnline: 270, gstRate: 5, gstMode: "inclusive" });
  assert.deepEqual(rowsOf(split), ["Subtotal|₹320|plain", "Incl. GST @5%|₹15|plain", "Paid in cash|₹50|plain", "Paid online|₹270|plain"], "split");
  assert.equal(split.totalLabel, "Bill total", "split: 'Bill total'");
});

test("detailSums: money owed at billing — a short Cash payment 'Paid ₹x' then 'Due at billing' in --bill-i (Q9); a Due or Credit bill only 'Due at billing'", () => {
  const short = detailSums({ ...settled("1", 240, 140, "Cash"), subtotal: 240 });
  assert.deepEqual(rowsOf(short), ["Subtotal|₹240|plain", "Paid|₹140|plain", "Due at billing|₹100|bill"], "a short payment: what was paid, then what was owed");
  assert.equal(short.totalLabel, "Bill total", "still the bill's total");
  const due = detailSums({ ...settled("1", 600, 0, "Due"), subtotal: 600 });
  assert.deepEqual(rowsOf(due), ["Subtotal|₹600|plain", "Due at billing|₹600|bill"], "Due mode: nothing paid, all owed (never 'Still due': a due paid later goes to the customer's account)");
  assert.deepEqual(rowsOf(detailSums({ ...settled("1", 258, 0, "Credit"), subtotal: 258 })), ["Subtotal|₹258|plain", "Due at billing|₹258|bill"], "Credit mode");
  for (const s of [short, due]) assert.ok(!s.rows.some((r) => /Still due/.test(r.label)), "no 'Still due' (Q9)");
});

test("detailSums: a cancelled order — the bill's rows, no Paid or Due rows (its payment is history the books no longer count), 'Not charged' struck", () => {
  const o = order("1", { status: "Cancelled", payment: "Online", subtotal: 240, discount: 20, total: 220, paidAmount: 220, gstRate: 0, gstMode: "inclusive" });
  const s = detailSums(o);
  assert.deepEqual(rowsOf(s), ["Subtotal|₹240|plain", "Discount|−₹20|bad"], "no 'Paid online' on a cancelled bill");
  assert.deepEqual([s.totalLabel, s.total, s.struck], ["Not charged", "₹220", true], "values 11.10 cancelled: 'Not charged' struck");
  billRowsAddUp(s, "cancelled");
});

// ── U2 Task 6: the customer row, the items head, the cancel note, a void's line (design 6.8; values 11.4-11.6) ───────

test("detailCustomer: a named customer — the initials of the first two words, the name, no second line; a walk-in — '?', 'Walk-in customer', 'No customer added'", () => {
  assert.deepEqual(detailCustomer(order("1", { customerId: "c1", customerName: "Neha Joshi" })), { initials: "NJ", name: "Neha Joshi", sub: null, named: true }, "values 11.4 'NJ'");
  assert.equal(detailCustomer(order("1", { customerId: "c1", customerName: "Ravi Kumar Sharma" })).initials, "RK", "the first two words");
  assert.equal(detailCustomer(order("1", { customerId: "c1", customerName: "  neha  " })).initials, "N", "one word: its initial");
  const walkIn = { initials: "?", name: "Walk-in customer", sub: "No customer added", named: false };
  assert.deepEqual(detailCustomer(order("1", { customerName: "Walk-In" })), walkIn, "no customer attached: a walk-in (the HTML's words; no phone line)");
  assert.deepEqual(detailCustomer(order("1", { customerId: "c1", customerName: " " })), walkIn, "an attached customer with no name reads as a walk-in");
});

test("detailItemsHead: Σ quantity, '1 item' / 'n items' (values 11.5)", () => {
  const items = (...qty: number[]) => order("1", { items: qty.map((q) => ({ productId: "p", name: "Tea", price: 10, qty: q, modifiers: [], instructions: "", kotRound: 1 })) });
  assert.equal(detailItemsHead(items(1, 4, 1)), "6 items", "values 11.5 '6 items'");
  assert.equal(detailItemsHead(items(1)), "1 item", "singular");
  assert.equal(detailItemsHead(items()), "0 items", "none");
});

// U2 Task 6 carried (Task 7, fix before merge): with no cancel time stored the note names no time (the opened time
// would read as the cancel time).
test("cancelNote: our words — 'Cancelled at {time} by {who}.' (the cancel time) and 'Reason: {reason}'; no cancel time stored: no time ('Cancelled by {who}.'); nothing for an order not cancelled", () => {
  const o = (over: Record<string, unknown>) => order("1", { status: "Cancelled", createdAt: minutesBefore(90), ...over });
  assert.deepEqual(cancelNote(o({ cancelledAt: minutesBefore(0), cancelledBy: "Rohan", cancelReason: "Guest left" })), { text: "Cancelled at 9:30 PM by Rohan.", reason: "Reason: Guest left" }, "design 6.8");
  assert.deepEqual(cancelNote(o({ cancelledBy: "Rohan", cancelReason: "Guest left" })), { text: "Cancelled by Rohan.", reason: "Reason: Guest left" }, "no cancel time stored: never the opened time");
  assert.deepEqual(cancelNote(o({ cancelledAt: minutesBefore(0) })), { text: "Cancelled at 9:30 PM.", reason: null }, "no name, no reason: none said");
  assert.deepEqual(cancelNote(o({})), { text: "Cancelled.", reason: null }, "nothing stored: no time, no name");
  assert.equal(cancelNote(order("1", { cancelReason: "x" })), null, "an open tab has no note");
  assert.equal(cancelNote(settled("1", 100, 100)), null, "a settled bill has no note");
});

test("voidLineNote: 'round {n} · {reason} — {who}, {date}' under a voided line (design 6.8); no round named when the line carries none", () => {
  const v = { productId: "p", name: "Hot Cappuccino", price: 130, qty: 1, kotRound: 2, reason: "Customer sent it back", voidedBy: "Priya Shah", at: "2026-10-14T07:47:24.000Z" };
  assert.equal(voidLineNote(v), "round 2 · Customer sent it back — Priya Shah, 14 Oct 2026", "today's words with the round first");
  assert.equal(voidLineNote({ ...v, kotRound: 0 }), "Customer sent it back — Priya Shah, 14 Oct 2026", "no round");
});

// U2 Task 6 carried (Task 7): a line's meta words live here with the rest of the detail's words (OrderDetailBody draws them).
test("detailLineMeta: our removed / added modifiers (orderItemModifierLines), the instructions trimmed and, on a reward line, its note (else the shared constant), joined ', '; empty parts dropped", () => {
  const item = (over: Record<string, unknown>) => fired(over) as unknown as Order["items"][number];
  assert.equal(detailLineMeta(item({ name: "Pizza", modifiers: ["Extra cheese", "Olives"], removedModifiers: ["Mushroom"], instructions: " Well done " })), "NO Mushroom, + Extra cheese, Olives, Well done", "removals, additions, then the note");
  assert.equal(detailLineMeta(item({ modifiers: ["Extra thick"] })), "+ Extra thick", "an addition alone");
  assert.equal(detailLineMeta(item({ reward: true, note: "Reward — free" })), "Reward — free", "a reward line's stored note");
  assert.equal(detailLineMeta(item({ reward: true })), REWARD_ITEM_LINE_NOTE, "a reward line stored before the note: the shared constant");
  assert.equal(detailLineMeta(item({ instructions: "   " })), "", "nothing to say: empty (the body draws no meta line)");
});
