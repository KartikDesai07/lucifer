// Settings > GST & taxes in the new UI (docs/superpowers/plans/2026-11-08-settings-taxes-ui.md): the page's cards in
// order behind the GST-on gate, the sticky sample bill, the words / ids / input attributes that must not change, the
// shared tile look, and the WebView / brand bans. The card constants themselves: lib/settings-card-layout.test.ts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "./source-pin-utils";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8").replace(/\r\n/g, "\n"));

const FIELDS = "components/settings/GstFields.tsx";
const PICKER = "components/settings/GstModePicker.tsx";
const LAYOUT_PICKER = "components/settings/PosLayoutPicker.tsx";
const PAGE = "app/(dashboard)/settings/taxes/page.tsx";
const SELF = "lib/settings-taxes-layout.test.ts";

test("page file: GST & taxes is wide and uses the card Save bar", () => {
  const p = read(PAGE);
  assert.ok(p.includes('<SettingsSectionPage slug="taxes" wide>'), "the page is wide");
  assert.ok(p.includes('saveBarLook="card"'), "the page opts into the card Save bar");
  assert.match(p, /<GstFields\b[^>]*\bsettings=\{settings\}/, "the page still renders GstFields with the saved settings");
});

test("page: root grid; GST, then (GST on) How prices work, GST rate, GST number, Bill preview, in that DOM order", () => {
  const s = read(FIELDS);
  assert.ok(s.includes("className={SETTINGS_PREVIEW_GRID_CLASS}"), "the root is the preview grid");
  const titles = ['title="GST"', 'title="How prices work"', 'title="GST rate"', 'title="GST number"', 'title="Bill preview"'];
  const at = titles.map((needle) => {
    assert.equal(s.split(needle).length - 1, 1, `GstFields has ${needle} once`);
    return s.indexOf(needle);
  });
  for (let i = 1; i < at.length; i++) assert.ok(at[i - 1] < at[i], `${titles[i]} follows ${titles[i - 1]}`);
  const gate = s.indexOf("{gstEnabled && (");
  assert.ok(gate > 0, "the GST-on gate is still there");
  assert.ok(at[0] < gate, "the GST card shows whether GST is on or off");
  assert.ok(gate < at[1], "the four other cards show only while GST is on");
  // ...and the gate closes only after the sample bill, the last card: with GST off nothing else renders (no orphan
  // preview pinned to column 2).
  assert.match(
    s,
    /<GstSampleBill control=\{control\} settings=\{settings\} \/>\s*<\/SettingsCard>\s*<\/>\s*\)\}\s*<\/div>/,
    "the GST-on gate closes right after the Bill preview card, at the end of the grid",
  );
  assert.equal(s.split("className={SETTINGS_MAIN_CARD_CLASS}").length - 1, 4, "the four form cards stay in column 1");
  assert.ok(s.includes("className={TAXES_PREVIEW_CLASS}"), "the sample bill is the sticky preview column");
  assert.ok(s.includes('bodyClassName="rounded-b-[12px] bg-surface-2 p-3"'), "the preview body sits on --surface-2");
  assert.ok(s.includes("<GstSampleBill control={control} settings={settings} />"), "the sample bill itself is untouched");
  assert.ok(at[4] > at[3], "on a phone the sample bill comes last, after every field it shows");
});

test("Charge GST: a SettingsSwitchRow bound to gstEnabled", () => {
  const s = read(FIELDS);
  const controller = s.indexOf('name="gstEnabled"');
  assert.ok(controller > 0, "the gstEnabled Controller");
  const row = s.search(
    /<SettingsSwitchRow\s+label="Charge GST"\s+sub="Bills show the GST on every sale\."\s+checked=\{field\.value\}\s+onCheckedChange=\{field\.onChange\}/,
  );
  assert.ok(row > controller, "the Charge GST row renders inside the gstEnabled Controller, with today's words");
});

test("words, ids and inputs: the form's own text and attributes are kept", () => {
  const s = read(FIELDS);
  for (const word of [
    "Turn on if your restaurant charges GST.",
    "Pick how your menu prices relate to GST.",
    "<GstModePicker value={field.value} onChange={field.onChange} rate={gstRate} />",
    'name="gstMode"',
    "The rate on every bill. Most restaurants charge 5%.",
    'role="group" aria-label="Common GST rates"',
    "GST_RATES.map(",
    "aria-pressed={selected}",
    'setValue("gstRate", r, { shouldDirty: true, shouldValidate: true })',
    'label="Other rate"',
    'htmlFor="settings-gst-rate"',
    'id="settings-gst-rate"',
    'type="number"',
    'inputMode="decimal"',
    "min={0}",
    "max={100}",
    'step="0.5"',
    'register("gstRate", { valueAsNumber: true })',
    "errors.gstRate?.message",
    "Your GSTIN. It prints at the top of the bill.",
    'label="GSTIN"',
    'id="settings-gst-number"',
    'placeholder="22AAAAA0000A1Z5"',
    'autoCapitalize="characters"',
    'register("gstNumber")',
    "errors.gstNumber?.message",
    "sample item with these settings. Choose which lines print in",
    'settingsSectionPath("bill-print")',
    "className={SETTINGS_LINK_CLASS}",
  ]) assert.ok(s.includes(word), `GstFields keeps ${word}`);
  assert.ok(s.includes("className={SETTINGS_UNIT_BOX_CLASS}"), "Other rate sits in the unit box");
  assert.ok(s.includes("aria-invalid={errors.gstRate ? true : undefined}"), "the box turns red while the rate has an error");
  assert.ok(s.includes("className={SETTINGS_CELL_RIGHT_CLASS}>%</span>"), "the % unit cell");
  assert.ok(s.includes("SETTINGS_CHIP_ON_CLASS : SETTINGS_CHIP_OFF_CLASS"), "the rate buttons wear the chip look");
  assert.ok(s.includes("className={SETTINGS_INPUT_CLASS}"), "the GSTIN input wears the U5 input look");
});

test("tiles: How prices work and New order layout share the tile look; the mode copy and wiring are kept", () => {
  const picker = read(PICKER);
  for (const word of [
    "GST in the price",
    "Menu prices already include GST. The bill shows the GST part.",
    "GST added on top",
    "GST is added to the bill, so the customer pays more than the menu price.",
    '<legend className="sr-only">How prices work</legend>',
    "Enter a rate to see an example.",
    'type="radio"',
  ]) assert.ok(picker.includes(word), `GstModePicker keeps ${word}`);
  for (const [name, src] of [["GstModePicker", picker], ["PosLayoutPicker", read(LAYOUT_PICKER)]] as const) {
    assert.ok(src.includes("SETTINGS_TILE_ON_CLASS : SETTINGS_TILE_OFF_CLASS"), `${name} tiles wear the shared tile look`);
    assert.ok(src.includes("SETTINGS_TILE_RADIO_ON_CLASS : SETTINGS_TILE_RADIO_OFF_CLASS"), `${name} draws the shared radio`);
    assert.ok(src.includes("className={SETTINGS_TILE_DOT_CLASS}"), `${name} draws the shared dot`);
  }
});

test("bans: no color-mix, light-dark, backdrop-blur, overflow-hidden, brand- class, native select or /NN colour opacity", () => {
  for (const rel of [FIELDS, PICKER, PAGE]) {
    const s = read(rel);
    assert.ok(s.length > 0 && s.includes("export"), `${rel}: read (landmark)`);
    assert.ok(!s.includes("color-mix"), `${rel}: no color-mix()`);
    assert.ok(!s.includes("light-dark("), `${rel}: no light-dark()`);
    assert.ok(!s.includes("backdrop-blur"), `${rel}: no backdrop-blur`);
    assert.ok(!s.includes("overflow-hidden"), `${rel}: overflow-clip, never overflow-hidden`);
    assert.ok(!s.includes("brand-"), `${rel}: no brand-* class`);
    assert.ok(!/<select\b/.test(s), `${rel}: the kit Select, never a native <select>`);
    const opacity = s.match(/\b(?:bg|text|border|ring|divide|fill|stroke|outline|from|via|to)-[a-z][a-z0-9-]*\/\d+/);
    assert.equal(opacity, null, `${rel}: no /NN opacity modifier on a colour (found ${opacity?.[0]})`);
  }
});

test("every touched file stays within 300 lines", () => {
  for (const rel of [FIELDS, PICKER, LAYOUT_PICKER, PAGE, SELF]) {
    const lines = readFileSync(path.join(CAFE_ROOT, rel), "utf8").split("\n").length - 1;
    assert.ok(lines <= 299, `${rel} is ${lines} lines (wc -l <= 299)`);
  }
});
