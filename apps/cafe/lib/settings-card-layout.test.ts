// Settings card pieces (docs/superpowers/plans/2026-11-06-settings-business-ui.md): the class constants in
// lib/settings-card-layout.ts read the plan's values, the field look is the U5 editor's, and SettingsCard / SettingsBlock /
// CardField render a named section, an h3 block and a hint that gives way to an error. The Business page's own pins
// (order, words, anchors, bans) are lib/settings-business-layout.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import type { ComponentType, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import * as L from "./settings-card-layout";
import * as M from "./menu-editor-layout";
import { FLOOR_FOCUS_RING_CLASS } from "./floor-tile-classes";
import { CardField, SettingsBlock, SettingsCard, SettingsSwitchRow } from "@/components/settings/SettingsCard";

(globalThis as { React?: typeof React }).React = React;

test("grid: one column, then the form beside a 340px sticky preview from 1280px", () => {
  assert.equal(
    L.SETTINGS_PREVIEW_GRID_CLASS,
    "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start xl:gap-5",
    "the page grid",
  );
  assert.equal(L.SETTINGS_MAIN_CARD_CLASS, "xl:col-start-1", "a form card stays in column 1");
  assert.equal(
    L.BUSINESS_PREVIEW_CLASS,
    "xl:sticky xl:top-20 xl:col-start-2 xl:[grid-row:1/span_5]",
    "Business: column 2, spanning the five form rows, one grid-row declaration",
  );
  assert.equal(
    L.TAXES_PREVIEW_CLASS,
    "xl:sticky xl:top-20 xl:col-start-2 xl:[grid-row:1/span_4]",
    "Taxes: column 2, spanning the four form rows, one grid-row declaration",
  );
});

test("card constants: the plan's values", () => {
  assert.equal(L.SETTINGS_CARD_CLASS, "min-w-0 scroll-mt-20 rounded-[12px] border border-border bg-card text-foreground", "card");
  assert.equal(L.SETTINGS_CARD_HEAD_CLASS, "border-b border-border-2 px-[18px] pt-4 pb-3.5 max-tab:px-4", "head");
  assert.equal(L.SETTINGS_CARD_TITLE_CLASS, "text-[15px] font-semibold leading-snug", "title");
  assert.equal(L.SETTINGS_CARD_SUB_CLASS, "mt-0.5 text-[13px] text-muted-foreground text-pretty", "sub");
  assert.equal(
    L.SETTINGS_CARD_BODY_CLASS,
    "grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 px-[18px] pt-4 pb-[18px] max-tab:px-4",
    "body",
  );
  assert.equal(
    L.SETTINGS_BLOCK_CLASS,
    "grid min-w-0 scroll-mt-20 grid-cols-[minmax(0,1fr)] gap-3 border-t border-border-2 pt-4 first:border-t-0 first:pt-0",
    "block",
  );
  assert.equal(L.SETTINGS_BLOCK_TITLE_CLASS, "text-[14px] font-semibold", "block title");
  assert.equal(L.SETTINGS_BLOCK_SUB_CLASS, "mt-0.5 text-[12.5px] text-muted-foreground text-pretty", "block sub");
  assert.equal(L.SETTINGS_HINT_CLASS, "text-[12.5px] leading-snug text-muted-foreground text-pretty", "hint");
  assert.equal(L.SETTINGS_LINK_CLASS, "font-medium text-primary underline underline-offset-2", "link");
  assert.equal(L.SETTINGS_SWITCH_ROW_CLASS, "flex min-h-11 cursor-pointer items-center justify-between gap-3", "switch row");
});

test("field look: re-exported from the U5 editor, one source", () => {
  assert.equal(L.SETTINGS_FIELD_CLASS, M.MENU_EDITOR_FIELD_CLASS, "field");
  assert.equal(L.SETTINGS_LABEL_CLASS, M.MENU_EDITOR_LABEL_CLASS, "label");
  assert.equal(L.SETTINGS_ERROR_CLASS, M.MENU_EDITOR_ERROR_CLASS, "error");
  assert.equal(L.SETTINGS_INPUT_CLASS, M.MENU_EDITOR_INPUT_CLASS, "input");
  assert.equal(L.SETTINGS_CELL_LEFT_CLASS, M.MENU_EDITOR_CELL_LEFT_CLASS, "left cell");
  assert.equal(L.SETTINGS_CELL_RIGHT_CLASS, M.MENU_EDITOR_CELL_RIGHT_CLASS, "right cell");
  assert.equal(L.SETTINGS_NUMBER_CLASS, M.MENU_EDITOR_NUMBER_CLASS, "number");
});

test("phone text: the input, number and select constants are 16px below 720px", () => {
  for (const [name, cls] of [
    ["SETTINGS_INPUT_CLASS", L.SETTINGS_INPUT_CLASS],
    ["SETTINGS_NUMBER_CLASS", L.SETTINGS_NUMBER_CLASS],
    ["SETTINGS_SELECT_TRIGGER_CLASS", L.SETTINGS_SELECT_TRIGGER_CLASS],
  ] as const) {
    assert.ok(cls.split(/\s+/).includes("max-tab:text-base"), `${name} carries max-tab:text-base (no iOS zoom)`);
  }
  assert.ok(L.SETTINGS_SELECT_TRIGGER_CLASS.includes("h-[42px]"), "the select trigger is 42px");
  assert.ok(L.SETTINGS_UNIT_BOX_CLASS.includes("h-[42px]"), "the unit box is 42px");
});

test("controls: unit box, add / remove and the card Save bar read the plan", () => {
  assert.equal(
    L.SETTINGS_SELECT_TRIGGER_CLASS,
    "h-[42px] w-full min-w-0 rounded-[10px] border border-border bg-card px-3 text-[14.5px] text-foreground max-tab:text-base [&>svg]:text-muted-foreground [&>svg]:opacity-100",
    "select trigger",
  );
  assert.equal(
    L.SETTINGS_UNIT_BOX_CLASS,
    "flex h-[42px] w-full max-w-[200px] items-center overflow-clip rounded-[10px] border border-border bg-card focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-1 has-[input[aria-invalid=true]]:border-status-bad",
    "unit box",
  );
  assert.equal(
    L.SETTINGS_ADD_BUTTON_CLASS,
    `inline-flex h-[42px] cursor-pointer items-center gap-1.5 self-start justify-self-start rounded-[10px] border border-dashed border-subtle-foreground bg-transparent px-3.5 text-[13.5px] font-semibold text-foreground pointer-fine:hover:bg-hover disabled:cursor-not-allowed disabled:opacity-50 ${FLOOR_FOCUS_RING_CLASS}`,
    "add button",
  );
  assert.equal(
    L.SETTINGS_REMOVE_BUTTON_CLASS,
    `inline-flex h-[42px] cursor-pointer items-center justify-center gap-1.5 rounded-[10px] border-0 bg-transparent px-3 text-[13.5px] font-semibold text-status-bad-ink pointer-fine:hover:bg-status-bad-tint disabled:cursor-not-allowed disabled:opacity-50 ${FLOOR_FOCUS_RING_CLASS}`,
    "remove button",
  );
  assert.equal(
    L.SETTINGS_SAVE_BAR_CARD_CLASS,
    "sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-[12px] border border-border bg-card px-4 py-3 [box-shadow:var(--pop)] pb-[calc(0.75rem+env(safe-area-inset-bottom))]",
    "card Save bar",
  );
  assert.equal(
    L.SETTINGS_SAVE_DISCARD_CLASS,
    "h-[42px] rounded-[10px] border border-border bg-card px-4 text-[14px] font-semibold text-foreground pointer-fine:hover:bg-hover",
    "discard",
  );
  assert.equal(L.SETTINGS_SAVE_SUBMIT_CLASS, "h-[42px] rounded-[10px] px-5 text-[14.5px] font-semibold", "submit");
});

// createElement with children as an argument (the lint rule), props typed without them.
function markup<P extends { children: ReactNode }>(Comp: ComponentType<P>, props: Omit<P, "children">, kids: ReactNode): string {
  return renderToStaticMarkup(createElement(Comp, props as P, kids));
}

test("SettingsCard renders a labelled section; CardField shows the hint only while there is no error", () => {
  const card = markup(SettingsCard, { id: "x", title: "Things", sub: "About things" }, createElement("p", null, "body"));
  assert.match(card, /<section[^>]*id="x"[^>]*aria-labelledby="([^"]+)"/, "a section named by its heading");
  const labelledBy = /aria-labelledby="([^"]+)"/.exec(card)?.[1] ?? "";
  assert.ok(card.includes(`<h2 id="${labelledBy}"`), "the title is the h2 the section names itself by");
  assert.ok(card.includes("About things") && card.includes("body"), "sub and body render");
  const block = markup(SettingsBlock, { title: "Part", sub: "Why" }, createElement("i"));
  assert.match(block, /<h3[^>]*>Part<\/h3>/, "a block's title is an h3");
  const hinted = markup(CardField, { label: "L", htmlFor: "i", hint: "HINT" }, createElement("input", { id: "i" }));
  assert.ok(hinted.includes("HINT") && hinted.includes('for="i"'), "the hint shows, the label names the input");
  const errored = markup(CardField, { label: "L", hint: "HINT", error: "BAD" }, createElement("input"));
  assert.ok(errored.includes("BAD") && !errored.includes("HINT"), "an error replaces the hint");
});

test("tiles and chips: the shared choice looks (New order layout, How prices work, the GST rates)", () => {
  assert.equal(
    L.SETTINGS_TILE_CLASS,
    "flex cursor-pointer flex-col gap-2 rounded-[12px] border p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary has-[:focus-visible]:ring-offset-1",
    "tile",
  );
  assert.equal(L.SETTINGS_TILE_ON_CLASS, "border-primary bg-status-info-tint", "selected tile");
  assert.equal(L.SETTINGS_TILE_OFF_CLASS, "border-border bg-card pointer-fine:hover:bg-hover", "tile at rest");
  assert.equal(L.SETTINGS_TILE_RADIO_CLASS, "grid h-4 w-4 shrink-0 place-items-center rounded-full border", "radio ring");
  assert.equal(L.SETTINGS_TILE_RADIO_ON_CLASS, "border-primary", "radio ring, selected");
  assert.equal(L.SETTINGS_TILE_RADIO_OFF_CLASS, "border-subtle-foreground", "radio ring, at rest");
  assert.equal(L.SETTINGS_TILE_DOT_CLASS, "h-2 w-2 rounded-full bg-primary", "radio dot");
  assert.equal(
    L.SETTINGS_CHIP_CLASS,
    `inline-flex h-[42px] min-w-16 cursor-pointer items-center justify-center rounded-[10px] border px-3 text-[14px] font-semibold tabular-nums text-foreground ${FLOOR_FOCUS_RING_CLASS}`,
    "chip: 42px, the focus ring",
  );
  assert.equal(L.SETTINGS_CHIP_ON_CLASS, "border-primary bg-status-info-tint", "selected chip");
  assert.equal(L.SETTINGS_CHIP_OFF_CLASS, "border-border bg-card pointer-fine:hover:bg-hover", "chip at rest");
});

test("SettingsSwitchRow: one label around the switch, named by the label, described by its line", () => {
  const html = renderToStaticMarkup(
    createElement(SettingsSwitchRow, { label: "Charge GST", sub: "Bills show the GST.", checked: true, onCheckedChange: () => {} }),
  );
  assert.ok(html.startsWith(`<label class="${L.SETTINGS_SWITCH_ROW_CLASS}">`), "the whole row is the label");
  assert.equal(html.split("<label").length - 1, 1, "one label, so a tap on the text flips the switch once");
  assert.ok(html.endsWith("</label>"), "the row is the label alone (no switch outside it)");
  assert.ok(html.indexOf("<button") < html.indexOf("</label>"), "the switch sits inside the label, so a tap on the text flips it");
  assert.match(html, /<button[^>]*role="switch"[^>]*aria-checked="true"/, "the kit switch, checked");
  assert.match(html, /<button[^>]*aria-label="Charge GST"/, "the switch is named by the label");
  const describedBy = /<button[^>]*aria-describedby="([^"]+)"/.exec(html)?.[1];
  assert.ok(describedBy, "the switch is described");
  assert.ok(html.includes(`<span id="${describedBy}" class="${L.SETTINGS_HINT_CLASS}">Bills show the GST.</span>`), "by its line");
});
