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
import { expectAll, tagOf } from "./class-tags.fixtures";
import { detailMeta, detailSteps, type DetailMetaItem, type DetailStep } from "./order-detail-view";
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
const tagsOf = (html: string, name: string): string[] => html.match(new RegExp(`<[a-z0-9]+ [^>]*data-ui="${name}"[^>]*>`, "g")) ?? [];
/** The text of the nth element carrying data-ui="<name>" (its own closing tag found by nesting depth). */
const textOf = (html: string, name: string, nth = 0): string => {
  const open = [...html.matchAll(new RegExp(`<([a-z0-9]+) [^>]*data-ui="${name}"[^>]*>`, "g"))][nth];
  assert.ok(open, `landmark: data-ui="${name}" #${nth + 1} renders`);
  const start = (open.index ?? 0) + open[0].length;
  const re = new RegExp(`<(/?)${open[1]}\\b[^>]*>`, "g");
  re.lastIndex = start;
  let depth = 1;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) return html.slice(start, m.index).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
  }
  return "";
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
