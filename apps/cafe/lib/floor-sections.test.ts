// U3 Floor verification fix round, item C (2026-10-29; finding VC-3, rulings F33 / F35): FloorAreaSections' two
// permanent wrappers, kept for WebView 109's accessibility tree (it left tiles and whole sections that a filter round trip or a
// poll re-inserted out of the tree; the replica with both wrappers kept them all, match\floor\final\vc3-fix\). The list
// wrapper holds every section and lays them out as the body did (16px apart); each section's only child is its inner
// column, laid out as the section was (head over grid, 10px apart). No key, role, aria or tabindex on either.
import { test } from "node:test";
import assert from "node:assert/strict";
import React, { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { expectAll, tagOf, tagsOf } from "./class-tags.fixtures";
import { FLOOR_BODY_CLASS } from "./floor-layout";
import { FLOOR_SECTION_CLASS, FLOOR_SECTION_HEAD_CLASS, FLOOR_SECTION_INNER_CLASS, FLOOR_SECTIONS_CLASS } from "./floor-tile-classes";
import { FLOOR_GRID_CLASS, type FloorTileModel } from "./floor-tiles";
import { build, table } from "./floor-tiles.fixtures";
import { FloorAreaSections } from "@/components/tables/FloorAreaSections";

// jsx:"preserve" -> React.createElement, so a global React is needed at render time (lib/common-components.test.ts).
(globalThis as { React?: typeof React }).React = React;

type Props = Record<string, unknown> & { children?: ReactNode };
const GROUPS = [
  { key: "a1", name: "AC Hall", summary: "2 tables", tiles: build([table("T-1", "Available"), table("T-2", "Occupied")], []) },
  { key: "a2", name: "Garden", summary: "1 table", tiles: build([table("T-3", "Available")], []) },
];
const renderTile = (t: FloorTileModel) => createElement("i", { key: t.table._id, "data-tile": t.table.tableNo });
const tree = (): ReactElement<Props> => {
  const el = FloorAreaSections({ groups: GROUPS, renderTile });
  assert.ok(isValidElement(el), "landmark: FloorAreaSections returns one element");
  return el as ReactElement<Props>;
};
const kids = (el: ReactElement<Props>): ReactNode[] => React.Children.toArray(el.props.children);
/** No key, role, aria-* or tabIndex: the wrappers add nothing a reader or React's reconciliation would see (VC-3). */
function plain(el: ReactElement<Props>, what: string): void {
  assert.equal(el.key, null, `${what}: no key (nothing remounts)`);
  for (const p of Object.keys(el.props)) assert.ok(!/^(role|aria-|tabIndex|key)/.test(p), `${what}: no ${p}`);
}

test("the wrappers' classes are the body's and the section's own layout, so nothing moves (VC-3)", () => {
  assert.equal(FLOOR_SECTIONS_CLASS, "flex flex-col gap-4", "the section list: a column, 16px apart");
  assert.equal(FLOOR_SECTIONS_CLASS, FLOOR_BODY_CLASS, "the section list lays the sections out as the body did (values 2.1)");
  assert.equal(FLOOR_SECTION_INNER_CLASS, "flex flex-col gap-2.5", "the inner column: the head over the grid, 10px apart");
  assert.equal(FLOOR_SECTION_INNER_CLASS, FLOOR_SECTION_CLASS, "the inner column lays them out as the section does (values 3.1)");
  assert.equal(FLOOR_SECTION_CLASS, "flex flex-col gap-2.5", "the section keeps its class, so its computed display / direction / gap stay what the probes read");
});

test("FloorAreaSections: one list wrapper holds every section; each section's only child is its inner column, head then grid (VC-3)", () => {
  const root = tree();
  assert.equal(root.type, "div", "the list wrapper is a div (in place of the Fragment)");
  assert.equal(root.props["data-ui"], "floor-sections", "its landmark");
  assert.equal(root.props.className, FLOOR_SECTIONS_CLASS, "its column");
  plain(root, "the list wrapper");
  const sections = kids(root);
  assert.equal(sections.length, GROUPS.length, "the wrapper holds every section and nothing else");
  sections.forEach((s, i) => {
    const g = GROUPS[i];
    assert.ok(isValidElement(s), `${g.name}: an element`);
    const section = s as ReactElement<Props>;
    assert.equal(section.type, "section", `${g.name}: the section`);
    assert.equal(String(section.key).replace(/^\.\$/, ""), g.key, `${g.name}: keyed by its area, as before`);
    assert.equal(section.props.className, FLOOR_SECTION_CLASS, `${g.name}: the section's class`);
    assert.equal(section.props["aria-labelledby"], `floor-area-${g.key}`, `${g.name}: labelled by its heading, as before`);
    // One element, not a list: the inner column is the section's only child (read as written, so its own key shows).
    const col = section.props.children as ReactElement<Props>;
    assert.ok(!Array.isArray(col) && isValidElement(col) && col.type === "div", `${g.name}: the inner column, a div, is the section's only child`);
    assert.equal(col.props["data-ui"], "floor-section-inner", `${g.name}: its landmark`);
    assert.equal(col.props.className, FLOOR_SECTION_INNER_CLASS, `${g.name}: its column`);
    plain(col, `${g.name}: the inner column`);
    const parts = kids(col).map((k) => (k as ReactElement<Props>).props["data-ui"]);
    assert.deepEqual(parts, ["floor-section-head", "floor-grid"], `${g.name}: the head, then the grid`);
  });
});

test("FloorAreaSections, rendered: the wrapper first, each section's inner column around its head and grid (VC-3)", () => {
  const html = renderToStaticMarkup(createElement(FloorAreaSections, { groups: GROUPS, renderTile }));
  assert.ok(html.startsWith(`<div data-ui="floor-sections" class="${FLOOR_SECTIONS_CLASS}">`) && html.endsWith("</div>"), "the list wrapper is the outermost element");
  assert.equal(tagsOf(html, "floor-sections").length, 1, "one list wrapper");
  assert.equal(tagsOf(html, "floor-section-inner").length, GROUPS.length, "one inner column per section");
  GROUPS.forEach((g, i) => {
    const section = tagOf(html, "floor-section", i);
    const inner = tagOf(html, "floor-section-inner", i);
    assert.ok(html.includes(section + inner), `${g.name}: the inner column opens right inside the section`);
    expectAll(inner, ["flex", "flex-col", "gap-2.5"], `${g.name}: the inner column`);
    const at = html.indexOf(section + inner);
    const end = html.indexOf("</section>", at);
    const body = html.slice(at, end);
    assert.ok(body.endsWith("</div></div>"), `${g.name}: the section closes right after its inner column (and its grid)`);
    assert.ok(body.indexOf(tagOf(html, "floor-section-head", i)) < body.indexOf(tagOf(html, "floor-grid", i)), `${g.name}: the head before the grid`);
    expectAll(tagOf(html, "floor-section-head", i), FLOOR_SECTION_HEAD_CLASS.split(" "), `${g.name}: the head unchanged`);
    expectAll(tagOf(html, "floor-grid", i), FLOOR_GRID_CLASS.split(" "), `${g.name}: the grid unchanged`);
    assert.equal(body.split("<i ").length - 1, g.tiles.length, `${g.name}: its tiles in its grid`);
  });
  for (const attr of ["role=", "tabindex=", "aria-hidden"]) {
    for (const name of ["floor-sections", "floor-section-inner"]) assert.ok(!tagOf(html, name).includes(attr), `${name}: no ${attr}`);
  }
});
