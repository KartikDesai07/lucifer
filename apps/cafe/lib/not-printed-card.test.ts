import { test } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { PrintAttentionRow } from "@pos/shared/print-agent-wire";
import { NotPrintedCard, type NotPrintedCardProps } from "@/components/print/NotPrintedCard";
import { PRINTER_NOT_PRINTED_ROW_WRAP_CLASS } from "@/components/print/printer-classes";
import { notPrintedViewOf, type NotPrintedView } from "@/lib/print-waiting-view";

// PX-2 Task 4 (spec §6.3; mockups s-wait5 / s-wait20 / s-clearall): the Not printed card draws what the pure view says,
// props only. Rendered on the server: what a person sees and what a screen reader hears.

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/floor-dialogs.test.ts).
(globalThis as { React?: typeof React }).React = React;

const T0 = Date.parse("2026-11-05T12:00:00.000Z");
const min = (n: number): string => new Date(T0 - n * 60_000).toISOString();

function row(id: string, label: string, ageMin: number, over: Partial<PrintAttentionRow> = {}): PrintAttentionRow {
  return { id, kind: "kot", label, status: "queued", labels: [], createdAt: min(ageMin), ...over };
}

// The feed hands rows oldest first. Shown first: the bill to check, the bill that could not print, then the newest KOTs.
const SEVEN = [
  row("k7", "KOT round 1 · T-7", 7),
  row("k6", "KOT round 1 · T-6", 6),
  row("b3", "Bill · T-3", 14, { kind: "bill", status: "failed" }),
  row("k1", "KOT round 1 · T-1", 4),
  row("k2", "KOT round 1 · T-2", 3),
  row("b5", "Bill · T-5", 2, { kind: "bill", status: "needs-confirm" }),
  row("k4", "KOT round 2 · T-4", 1),
].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

function viewOf(rows: PrintAttentionRow[]): NotPrintedView {
  const view = notPrintedViewOf(rows, false, T0, []);
  assert.ok(view !== null, "landmark: rows give a view");
  return view;
}

function render(over: Partial<NotPrintedCardProps> = {}): string {
  const props: NotPrintedCardProps = {
    view: viewOf(SEVEN),
    expanded: false,
    onExpanded: () => undefined,
    confirming: false,
    onClearAll: () => undefined,
    onConfirm: () => undefined,
    busy: false,
    tapped: new Set<string>(),
    onAction: () => undefined,
    ...over,
  };
  return renderToStaticMarkup(createElement(NotPrintedCard, props));
}

const items = (html: string): string[] => html.split("<li").slice(1).map((s) => s.slice(0, s.indexOf("</li>")));
function itemOf(html: string, label: string): string {
  const item = items(html).find((s) => s.includes(`>${label}<`));
  assert.ok(item !== undefined, `landmark: the row ${label} is drawn`);
  return item;
}
const buttons = (html: string): string[] => html.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? [];
// The kit's classes carry "disabled:" variants: only the attribute says a button is off.
const off = (button: string): boolean => / disabled=""/.test(button);
const liClass = (item: string): string => (/^ class="([^"]*)"/.exec(item)?.[1] ?? "").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

test("the head says Not printed with the count and Clear all", () => {
  const html = render();
  assert.ok(html.includes(">Not printed<"), "the title");
  assert.match(html, /<span[^>]*>7<\/span>/, "the count bubble says 7, as the printer button");
  assert.ok(html.includes(">Tap a button on the ones that need you.<"), "the summary line");
  assert.equal(buttons(html).filter((b) => />Clear all<\/button>$/.test(b)).length, 1, "one Clear all, in the head");
  assert.ok(html.indexOf(">Clear all</button>") < html.indexOf("<ul"), "the head's button comes before the list");
  const three = render({ view: viewOf(SEVEN.slice(0, 3)) });
  assert.ok(!three.includes("Show all"), "5 rows or fewer: no Show all");
});

test("5 rows and Show all 7 when folded", () => {
  const html = render();
  assert.equal(items(html).length, 5, "five rows shown");
  assert.deepEqual(items(html).map((s) => /> ?([^<>]+ · T-\d)</.exec(s)?.[1]), ["Bill · T-5", "Bill · T-3", "KOT round 2 · T-4", "KOT round 1 · T-2", "KOT round 1 · T-1"], "the order of the view");
  assert.ok(html.includes(">Show all 7<"), "the link names how many");
  assert.match(html, /<button[^>]*aria-expanded="false"[^>]*>Show all 7</, "the link says it is folded");
});

test("every row when expanded, then Show fewer", () => {
  const html = render({ expanded: true });
  assert.equal(items(html).length, 7, "every row");
  assert.match(html, /<button[^>]*aria-expanded="true"[^>]*>Show fewer</, "Show fewer at the end, expanded");
  assert.ok(html.lastIndexOf("</ul>") < html.indexOf("Show fewer"), "after the list");
});

test("each button names its slip", () => {
  const html = render();
  for (const name of ["Clear KOT round 1 · T-1", "Try again Bill · T-3", "Print again Bill · T-5", "It printed Bill · T-5", "Clear Bill · T-5"]) {
    assert.ok(html.includes(`aria-label="${name}"`), `a button named ${name}`);
  }
});

test("a fresh waiting row has no print button", () => {
  const fresh = itemOf(render(), "KOT round 2 · T-4");
  assert.ok(!fresh.includes("Print now") && !fresh.includes("Try again"), "it prints by itself: Clear only");
  assert.equal(buttons(fresh).length, 1, "one button");
  assert.ok(fresh.includes("1 min · Waits for the printer."), "its age and reason");
});

test("the bill row wraps its three buttons", () => {
  const html = render();
  const bill = items(html).find((s) => s.includes(">Bill · T-5<")) ?? "";
  assert.ok(liClass(bill).includes(PRINTER_NOT_PRINTED_ROW_WRAP_CLASS), "its li carries the wrap class");
  assert.equal(buttons(bill).length, 3, "Print again, It printed, Clear");
  const failed = itemOf(html, "Bill · T-3");
  assert.ok(liClass(failed) !== "" && !liClass(failed).includes(PRINTER_NOT_PRINTED_ROW_WRAP_CLASS), "two buttons stay beside the words");
});

test("a failed slip with no words of its own ends at its bold part: no dangling separator", () => {
  const failed = itemOf(render(), "Bill · T-3");
  assert.match(failed, /14 min · <b[^>]*>Could not print\.<\/b><\/p>/, "{age} · Could not print.");
  const bill = itemOf(render(), "Bill · T-5");
  assert.match(bill, /2 min · <b[^>]*>May have printed\.<\/b> Check the printer\.<\/p>/, "the bold part, then the reason");
});

test("the confirm replaces Clear all", () => {
  const html = render({ confirming: true });
  assert.ok(html.includes(">Clear all 7 slips? They will not print.<"), "the question");
  const all = buttons(html);
  assert.equal(all.filter((b) => />Clear all<\/button>$/.test(b)).length, 1, "one Clear all: the confirm's");
  assert.ok(html.indexOf("Clear all 7 slips?") < html.indexOf(">Clear all</button>"), "no head Clear all before the question");
  const cancel = all.find((b) => />Cancel<\/button>$/.test(b));
  assert.ok(cancel !== undefined, "a Cancel");
  assert.match(cancel, /autofocus/i, "focus moves to Cancel when the confirm opens");
  assert.ok(html.indexOf("Clear all 7 slips?") < html.indexOf("<ul"), "under the head, above the rows");
  const busy = buttons(render({ confirming: true, busy: true })).filter((b) => />(Clear all|Cancel)<\/button>$/.test(b));
  assert.ok(busy.length === 2 && busy.every(off), "while the clear runs its buttons wait");
});

test("a tapped row's buttons are disabled", () => {
  const html = render({ tapped: new Set(["b5"]) });
  const bill = buttons(itemOf(html, "Bill · T-5"));
  assert.ok(bill.length === 3 && bill.every(off), "every button of the tapped row");
  assert.ok(buttons(itemOf(html, "Bill · T-3")).every((b) => !off(b)), "another row stays live");
});
