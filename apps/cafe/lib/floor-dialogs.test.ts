// U3 Task 6 fix round 1 (spec-1, ruling F21): the table name stays whole in the confirm sheet's body. From 720px up the
// sheet's text is 378px wide, and both text-wrap: pretty (desktop Chrome, WebView 154) and the greedy wrap (WebView 109)
// broke "T-3" / "T-10" at its hyphen ("…opens with T-" / "3 picked."). FloorDialogs puts U+2060 WORD JOINER after each
// hyphen of the name in the three descriptions only: the words a reader sees and hears stay today's, the titles too.
import { test } from "node:test";
import assert from "node:assert/strict";
import React, { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { FloorDialog } from "@/hooks/use-floor-actions";
import { FloorDialogs, joinNameHyphens } from "@/components/tables/FloorDialogs";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const WJ = "\u2060";
const unjoined = (s: string): string => s.split(WJ).join("");

/** The props FloorDialogs hands its ConfirmDialog for `dialog` (the sheet itself renders in a portal, which a server
 *  render leaves out, so the element FloorDialogs returns is read inside a real render: its hooks run as they do). */
function confirmProps(dialog: FloorDialog): { title: string; description: string } {
  let props: { title: string; description: string } | null = null;
  function Capture() {
    const el = FloorDialogs({ dialog, busy: false, onConfirm: () => undefined, onOpenChange: () => undefined }) as ReactElement<{ title: string; description: string }>;
    props = el.props;
    return null;
  }
  renderToStaticMarkup(createElement(Capture));
  assert.ok(props, "landmark: FloorDialogs rendered its ConfirmDialog");
  return props!;
}

const table = (tableNo: string, status: "Reserved" | "Occupied") => ({ tableNo, status }) as unknown as FloorDialog["table"];

test("joinNameHyphens: a word joiner after each hyphen-like character, nothing else changes", () => {
  assert.equal(joinNameHyphens("T-3"), `T-${WJ}3`, "T-3 can no longer break after its hyphen");
  assert.equal(joinNameHyphens("Patio 4"), "Patio 4", "a name with no hyphen is unchanged");
  assert.equal(joinNameHyphens("T-10"), `T-${WJ}10`, "two digits the same");
  for (const h of ["-", "\u2010", "\u2011", "\u2013"]) {
    assert.equal(joinNameHyphens(`A${h}B${h}C`), `A${h}${WJ}B${h}${WJ}C`, `every U+${h.charCodeAt(0).toString(16).padStart(4, "0")} joined`);
  }
  assert.equal(joinNameHyphens(""), "", "no name, nothing to join");
  for (const name of ["T-3", "Patio 4", "Roof\u2013Deck-12", "AC Hall \u2010 7"]) {
    assert.equal(unjoined(joinNameHyphens(name)), name, `the visible glyphs stay exactly ${name}`);
  }
});

const CASES: { what: string; dialog: (t: string) => FloorDialog; title: (t: string) => string; body: (t: string) => string }[] = [
  {
    what: "Seat now (a Reserved hold)",
    dialog: (t) => ({ kind: "seat", table: table(t, "Reserved") }),
    title: (t) => `Seat guests at ${t}?`,
    body: (t) => `The hold on ${t} is released and New Order opens with ${t} picked.`,
  },
  {
    what: "Free table on a Reserved hold",
    dialog: (t) => ({ kind: "free", table: table(t, "Reserved") }),
    title: (t) => `Free ${t}?`,
    body: (t) => `The hold on ${t} is released and it shows as available for a new order.`,
  },
  {
    what: "Free table on an Occupied table with no bill",
    dialog: (t) => ({ kind: "free", table: table(t, "Occupied") }),
    title: (t) => `Free ${t}?`,
    body: (t) => `${t} is marked occupied but has no open bill. Freeing it makes it available for a new order.`,
  },
];

test("the three bodies: the name joined, and without the joiner today's words exactly", () => {
  for (const c of CASES) {
    for (const name of ["T-3", "T-10", "Patio 4"]) {
      const { description } = confirmProps(c.dialog(name));
      assert.equal(unjoined(description), c.body(name), `${c.what}, ${name}: today's words`);
      assert.equal(description, c.body(joinNameHyphens(name)), `${c.what}, ${name}: each mention of the name joined`);
      if (name.includes("-")) assert.ok(description.includes(`${name.replace("-", `-${WJ}`)}`) && !description.includes(`${name} `), `${c.what}, ${name}: never a bare hyphen to break at`);
    }
  }
});

test("every title stays today's text exactly, with no joiner (the probes compare it)", () => {
  for (const c of CASES) {
    for (const name of ["T-3", "T-10", "Patio 4"]) {
      const { title } = confirmProps(c.dialog(name));
      assert.ok(!title.includes(WJ), `${c.what}, ${name}: no U+2060 in the title`);
      assert.equal(title, c.title(name), `${c.what}, ${name}: today's title`);
    }
  }
});
