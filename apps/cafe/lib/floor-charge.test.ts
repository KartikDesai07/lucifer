// U3 Floor verification fix round, item B (2026-10-29): the table charge line keeps its amount (the owner's Q7;
// design 4 Q7 and 6.5 K5 in docs/superpowers/specs/2026-10-28-floor-match-html-design.md; finding VC-2).
// floorTileView's charge kind and its words, the line's classes, then FloorTile's render of the line: inside the one
// detail line a label that gives way first (cut with the ellipsis) and an amount that never shrinks, the line still
// reading "{label} ₹x".
import { test } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { classesOf, expectAll, tagOf, tagsOf, textOf } from "./class-tags.fixtures";
import { FLOOR_CHARGE_AMOUNT_CLASS, FLOOR_CHARGE_LABEL_CLASS, FLOOR_DETAIL_CHARGE_CLASS, FLOOR_TILE_DETAIL_CLASS } from "./floor-tile-classes";
import type { FloorTileModel } from "./floor-tiles";
import { floorTileView } from "./floor-view";
import { build, table } from "./floor-tiles.fixtures";
import { FloorTile } from "@/components/tables/FloorTile";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

const tokens = (cls: string): string[] => cls.split(/\s+/).filter(Boolean);
/** An Available table with this charge, no bill (K5). */
function charged(label: string, amount: number): FloorTileModel {
  const tiles = build([table("T-5", "Available", { chargeLabel: label, chargeAmount: amount })], []);
  assert.equal(tiles.length, 1, "one tile");
  return tiles[0];
}
const LONG_LABEL = "Rooftop live music cover"; // 24 characters, TABLE_CHARGE_LABEL_MAX_LEN
// The verification's labels (VC-2): [label, amount, as shown].
const CASES = [
  ["Rooftop seating", 50, "₹50"],
  ["Service charge", 1000, "₹1,000"],
  ["AC charge", 50, "₹50"],
  ["Cover", 20, "₹20"],
  [LONG_LABEL, 10000, "₹10,000"],
] as const;
const renderTile = (tile: FloorTileModel, busy = false) =>
  renderToStaticMarkup(createElement(FloorTile, { tile, busy, tabsFailed: false, riseIndex: 0, riseElapsedMs: 60_000, onTap: () => {}, onMenu: () => {} }));

test("floorTileView: a table charge is its own kind, the label and the amount apart; the words stay '{label} ₹x' (Q7)", () => {
  assert.equal(LONG_LABEL.length, 24, "the longest label a table can hold");
  for (const [label, amount, shown] of CASES) {
    const view = floorTileView(charged(label, amount), false);
    assert.deepEqual(view.detail, { kind: "charge", label, amount: shown }, `${label}: the charge kind, the amount as the bill shows it`);
    assert.equal(view.accessibleName, `T-5, 4 seats, Available, ${label} ${shown} — start a new order`, `${label}: the accessible name unchanged`);
  }
  // No charge without both a name and an amount (lib/receipt.ts tableChargeOf): the HTML's line, as before.
  for (const [label, amount] of [["", 50], ["Cover", 0]] as const) {
    const detail = floorTileView(charged(label, amount), false).detail;
    assert.deepEqual(detail, { kind: "text", text: "Tap to seat guests", phoneText: "Tap to seat" }, `no charge (${JSON.stringify(label)}, ${amount}): the HTML's line`);
  }
});

test("the charge line's classes: a row whose label shrinks and cuts first and whose amount never shrinks (Q7)", () => {
  assert.equal(FLOOR_DETAIL_CHARGE_CLASS, "flex", "the line lays its label and amount in a row");
  assert.equal(FLOOR_CHARGE_LABEL_CLASS, "min-w-0 truncate", "the label may shrink below its words and cuts with an ellipsis");
  assert.equal(FLOOR_CHARGE_AMOUNT_CLASS, "flex-none whitespace-pre", "the amount never shrinks; the space before it is kept");
  const amount = tokens(FLOOR_CHARGE_AMOUNT_CLASS);
  for (const t of ["truncate", "min-w-0", "shrink", "flex-1", "flex-auto", "overflow-hidden", "text-ellipsis"]) assert.ok(!amount.includes(t), `the amount is never cut: no ${t}`);
  const label = tokens(FLOOR_CHARGE_LABEL_CLASS);
  for (const t of ["flex-none", "shrink-0", "whitespace-pre"]) assert.ok(!label.includes(t), `the label gives way: no ${t}`);
  // The line keeps the detail line's box: the charge class lays out, it never sets a size, a font or a colour.
  for (const t of [...tokens(FLOOR_DETAIL_CHARGE_CLASS), ...label, ...amount]) {
    assert.ok(!/^(text-|font-|leading-|tracking-|h-|min-h-|py-|pt-|pb-|my-|gap-|p-|px-|pl-|pr-|mx-|ml-|mr-)/.test(t), `the parts never change the line's look: ${t}`);
  }
});

test("FloorTile: the charge line holds its label then its amount, in the detail line's look, reading '{label} ₹x' (Q7)", () => {
  for (const [label, amount, shown] of CASES) {
    for (const busy of [false, true]) {
      const html = renderTile(charged(label, amount), busy);
      const what = `${label}${busy ? " (busy)" : ""}`;
      const line = tagOf(html, "floor-tile-detail");
      expectAll(line, [...tokens(FLOOR_TILE_DETAIL_CLASS), ...tokens(FLOOR_DETAIL_CHARGE_CLASS)], `${what}: the detail line's look, laid out as a row`);
      // The line's only children, in order: the label, then the amount led by one normal space.
      const parts = `<span data-ui="floor-tile-charge-label" class="${FLOOR_CHARGE_LABEL_CLASS}">${label}</span><span data-ui="floor-tile-charge-amount" class="${FLOOR_CHARGE_AMOUNT_CLASS}"> ${shown}</span></span>`;
      assert.ok(html.includes(line + parts), `${what}: the label then the amount, the line's only children (got ${html.slice(html.indexOf(line), html.indexOf(line) + 400)})`);
      assert.equal(textOf(html, "floor-tile-detail"), `${label} ${shown}`, `${what}: the line's text, one normal space`);
      assert.equal(textOf(html, "floor-tile-charge-label"), label, `${what}: the label part`);
      assert.equal(textOf(html, "floor-tile-charge-amount"), ` ${shown}`, `${what}: the amount part, the space before it`);
      for (const part of ["floor-tile-charge-label", "floor-tile-charge-amount"]) assert.ok(!/aria-hidden/.test(tagOf(html, part)), `${what}: ${part} is read`);
      assert.equal(tagsOf(html, "floor-tile-detail-phone").length + tagsOf(html, "floor-tile-detail-wide").length, 0, `${what}: one form at every width`);
    }
    const link = tagOf(renderTile(charged(label, amount)), "floor-tile");
    assert.match(link, /^<a /, `${label}: a link to /pos`);
    assert.ok(link.includes(`aria-label="T-5, 4 seats, Available, ${label} ${shown} — start a new order"`), `${label}: the accessible name unchanged`);
  }
  // The amount part never shrinks and the label part does, on the rendered tile too.
  const html = renderTile(charged(LONG_LABEL, 10000));
  assert.ok(classesOf(tagOf(html, "floor-tile-charge-amount")).includes("flex-none"), "a long label: the amount part never shrinks");
  expectAll(tagOf(html, "floor-tile-charge-label"), ["min-w-0", "truncate"], "a long label: the label part cuts");
  // Every other line keeps its one text: no charge parts without a charge.
  assert.equal(tagsOf(renderTile(charged("", 0)), "floor-tile-charge-label").length, 0, "no charge: no charge parts");
});
