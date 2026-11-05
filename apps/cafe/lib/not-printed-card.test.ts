import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { PrintAttentionRow } from "@pos/shared/print-agent-wire";
import { NotPrintedCard, type NotPrintedCardProps } from "@/components/print/NotPrintedCard";
import { PRINTER_NOT_PRINTED_ROW_WRAP_CLASS } from "@/components/print/printer-classes";
import { stripComments } from "@/lib/source-pin-utils";
import { clearAllAskedOf, notPrintedViewOf, type NotPrintedView } from "@/lib/print-waiting-view";

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
    confirming: null,
    onClearAll: () => undefined,
    onConfirm: () => undefined,
    busy: false,
    tapped: new Set<string>(),
    onAction: () => undefined,
    questionId: "np-ask",
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
const ALL = viewOf(SEVEN).ids;
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

test("one slip: no Clear all, its own Clear does it (ruling I)", () => {
  const one = render({ view: viewOf(SEVEN.slice(0, 1)) });
  assert.ok(!buttons(one).some((b) => />Clear all<\/button>$/.test(b)), "no head Clear all for one slip");
  assert.ok(one.includes(`aria-label="Clear ${SEVEN[0]?.label}"`), "the row's own Clear stays");
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
  const view = viewOf(SEVEN.slice(0, 2));
  const bare = { id: "x", label: "KOT · X", age: "3 min", strong: null, reason: "", tone: null, actions: ["clear" as const] };
  assert.match(itemOf(render({ view: { ...view, rows: [bare] } }), "KOT · X"), /<p[^>]*>3 min<\/p>/, "no words at all: the age alone, no \" · \"");
});

test("a bill to check reads warn, a slip that could not print reads bad, a waiting slip neither", () => {
  const html = render();
  const meta = (label: string): string => /<p class="([^"]*)">\d+ min/.exec(itemOf(html, label))?.[1] ?? "";
  assert.ok(meta("Bill · T-5").split(" ").includes("text-status-warn-ink"), "the bill's meta in --status-warn-ink");
  assert.ok(meta("Bill · T-3").split(" ").includes("text-status-bad-ink"), "the failed slip's meta in --status-bad-ink");
  const fresh = meta("KOT round 2 · T-4");
  assert.ok(fresh.includes("text-subtle-foreground") && !/status-(warn|bad)-ink/.test(fresh), "a waiting slip in --text-3");
});

test("the confirm replaces Clear all", () => {
  const html = render({ confirming: ALL });
  assert.ok(html.includes(">Clear all 7 slips? They will not print.<"), "the question");
  assert.match(html, /<div role="group" aria-labelledby="np-ask"[^>]*><p id="np-ask">Clear all 7 slips\?/, "the group is named by its question");
  assert.ok(!html.includes('aria-label="Clear all 7'), "not a second copy of the visible words");
  const all = buttons(html);
  assert.equal(all.filter((b) => />Clear all<\/button>$/.test(b)).length, 1, "one Clear all: the confirm's");
  assert.ok(html.indexOf("Clear all 7 slips?") < html.indexOf(">Clear all</button>"), "no head Clear all before the question");
  const cancel = all.find((b) => />Cancel<\/button>$/.test(b));
  assert.ok(cancel !== undefined, "a Cancel");
  assert.match(cancel, /autofocus/i, "focus moves to Cancel when the confirm opens");
  assert.ok(html.indexOf("Clear all 7 slips?") < html.indexOf("<ul"), "under the head, above the rows");
  const busy = buttons(render({ confirming: ALL, busy: true })).filter((b) => />(Clear all|Cancel)<\/button>$/.test(b));
  assert.ok(busy.length === 2 && busy.every(off), "while the clear runs its buttons wait");
});

test("a tapped row's buttons are disabled", () => {
  const html = render({ tapped: new Set(["b5"]) });
  const bill = buttons(itemOf(html, "Bill · T-5"));
  assert.ok(bill.length === 3 && bill.every(off), "every button of the tapped row");
  assert.ok(buttons(itemOf(html, "Bill · T-3")).every((b) => !off(b)), "another row stays live");
});

// Review Minor 1: the confirm asks about the slips listed when it opened; a KOT that arrives meanwhile is never cleared
// unasked. The container keeps that snapshot (string[] | null) and sends it; the question counts it.
test("Clear all asks about the slips listed when it opened, not the live list", () => {
  assert.ok(render({ confirming: ["k1", "k2", "k4"] }).includes(">Clear all 3 slips? They will not print.<"), "the snapshot's count, though 7 are listed");
  const asked = ["k1", "k2"];
  assert.equal(clearAllAskedOf(asked, ["k2", "k9"]), asked, "one of them still listed: the same snapshot (a new KOT k9 is not added)");
  assert.equal(clearAllAskedOf(asked, ["k9"]), null, "none of them listed any more: the confirm closes");
  assert.equal(clearAllAskedOf(null, ALL), null, "closed stays closed");
});

// Ruling J: Cancel gives the focus back to the head's Clear all. A server render cannot move focus, so the wiring is
// pinned at its source: the container's ref on the card's button, focused after the confirm closes.
test("PIN: Cancel returns the focus to Clear all; the confirm sends its snapshot", () => {
  const read = (rel: string): string => stripComments(readFileSync(path.join(fileURLToPath(new URL("../", import.meta.url)), rel), "utf8"));
  const card = read("components/print/NotPrintedCard.tsx");
  assert.match(card, /<Button ref=\{clearAllRef\}[^>]*onClick=\{onClearAll\}>/, "the head's Clear all takes the container's ref");
  const section = read("components/print/NotPrintedSection.tsx");
  assert.match(section, /useEffect\(\(\) => \{\s*if \(refocus > 0\) clearAllRef\.current\?\.focus\(\);\s*\}, \[refocus\]\);/, "focused after the close renders");
  assert.match(section, /const close = \(\) => \{\s*setAsked\(null\);\s*setRefocus\(\(n\) => n \+ 1\);\s*\};/, "every close asks for it");
  assert.ok(section.includes("onClearAll={() => setAsked([...view.ids])}"), "the snapshot is taken when the confirm opens");
  assert.ok(section.includes("void dismissAll(asking).finally("), "the confirm sends the snapshot");
});
