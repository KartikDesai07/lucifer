import { KOT_ROUND, maxSettings } from "./print-template-matrix.fixtures"; // FIRST: it selects React's production renderer before react loads
import { FIXED_NOW_MS } from "./print-template-golden.fixtures";
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { KOTReceipt } from "@/components/pos/KOTReceipt";
import { KotSlip } from "@/components/print/slip/SlipEngine";
import { loadSlipCode } from "@/components/print/slip/slip-code";
import { defaultKotTemplate } from "@/lib/print-template-designs";
import { stripComments } from "@/lib/source-pin-utils";
import { KOT_DESIGNS, type KotBlock, type KotDesign, type KotTemplate } from "@pos/shared/print-template";
import type { Settings } from "@/types";

// Merge seam (printing Phase 2 into print customization): the routed station's name reaches the KOT design engine.
// KOTReceipt forwards `stationLine` to KotSlip, the slip context carries it, and the `station` block prints it in
// BOTH designs (Classic exactly as the legacy ticket does, Kitchen Bold in its own larger weight) and prints NOTHING
// when there is no station line. The designs x blocks matrix (print-template-matrix.test.ts) renders a fixture with
// no stationLine, so its "station is the silent block" exemption still holds there; this file is the other half.

(globalThis as { React?: typeof React }).React = React; // jsx:"preserve" -> tsx compiles to React.createElement
before(() => loadSlipCode()); // the non-Classic design is one lazy chunk
before(() => mock.timers.enable({ apis: ["Date"], now: FIXED_NOW_MS }));
after(() => mock.timers.reset());

const STATION_CLASS: Record<KotDesign, string> = {
  classic: "text-center text-[1.29em] font-bold tracking-widest",
  kitchenBold: "text-center text-[1.4em] font-black tracking-widest",
};
const stationDiv = (design: KotDesign, name: string): string => `<div class="${STATION_CLASS[design]}">${name}</div>`;

/** The design's default kitchen ticket with its station block present and ON (added before the items when a design lacks it). */
function templateWithStation(design: KotDesign, settings: Settings, on = true): KotTemplate {
  const base = defaultKotTemplate(design, settings);
  const block = { id: "station", type: "station", on } as KotBlock;
  if (base.blocks.some((b) => b.type === "station")) return { ...base, blocks: base.blocks.map((b) => (b.type === "station" ? { ...b, on } : b)) };
  const at = base.blocks.findIndex((b) => b.type === "items");
  return { ...base, blocks: [...base.blocks.slice(0, at), block, ...base.blocks.slice(at)] };
}

const slip = (settings: Settings, template: KotTemplate, stationLine?: string | null): string =>
  renderToStaticMarkup(
    createElement(KotSlip, { order: KOT_ROUND.order, settings, ...KOT_ROUND.extra, template, ...(stationLine === null ? {} : { stationLine }) }),
  );

test("landmark: the two KOT designs are exactly the ones this file pins", () => {
  assert.deepEqual([...KOT_DESIGNS].sort(), Object.keys(STATION_CLASS).sort(), "a new design must get a station-line pin here");
});

for (const design of KOT_DESIGNS) {
  test(`${design}: the station block prints the station line in the design's own heading style, and nothing without one`, () => {
    const settings = maxSettings();
    const template = templateWithStation(design, settings);
    const withStation = slip(settings, template, "BAR");
    assert.ok(withStation.includes(stationDiv(design, "BAR")), `the station line, exactly: ${stationDiv(design, "BAR")}`);
    assert.equal(withStation.split(">BAR<").length - 1, 1, "printed once");
    // vision guard: the same slip with no station line is the slip minus exactly that div
    const without = slip(settings, template, null);
    assert.ok(!without.includes("BAR"), "no station line, no BAR");
    assert.equal(withStation.replace(stationDiv(design, "BAR"), ""), without, "the line is the ONLY difference");
    // an empty string prints nothing either (a routed slip with an unnamed station)
    assert.equal(slip(settings, template, ""), without, "an empty station line prints nothing");
    assert.equal(slip(settings, template, undefined), without, "undefined prints nothing");
  });

  test(`${design}: the station block follows its own switch, and the line is escaped text`, () => {
    const settings = maxSettings();
    assert.equal(slip(settings, templateWithStation(design, settings, false), "BAR"), slip(settings, templateWithStation(design, settings, false), null), "a station block switched OFF prints no line");
    assert.ok(slip(settings, templateWithStation(design, settings, true), "BAR").includes(">BAR<"), "landmark: the same slip with the block ON does print it");
    const tricky = slip(settings, templateWithStation(design, settings), "A&B <ALL>");
    assert.ok(tricky.includes(">A&amp;B &lt;ALL&gt;<"), "rendered as text, never as markup");
  });
}

test("the station line sits in the header, before the items, in both designs (a cook sees whose slip it is first)", () => {
  for (const design of KOT_DESIGNS) {
    const settings = maxSettings();
    const html = slip(settings, templateWithStation(design, settings), "BAR");
    const at = html.indexOf(stationDiv(design, "BAR"));
    const firstItem = html.indexOf(KOT_ROUND.extra.roundItems?.[0]?.name ?? "\u0000");
    assert.ok(at > 0 && firstItem > 0, `${design}: landmarks found`);
    assert.ok(at < firstItem, `${design}: the station line comes before the first item`);
  }
});

test("Classic's station block is byte-identical to the legacy ticket's station line (the golden's promise)", () => {
  const settings = maxSettings();
  const legacy = renderToStaticMarkup(createElement(KOTReceipt, { order: KOT_ROUND.order, settings, ...KOT_ROUND.extra, stationLine: "BAR" }));
  assert.ok(legacy.includes(stationDiv("classic", "BAR")), "landmark: the legacy ticket prints that div");
  assert.ok(slip(settings, templateWithStation("classic", settings), "BAR").includes(stationDiv("classic", "BAR")));
});

test("KOTReceipt forwards stationLine into the design engine: a stored kotTemplate prints it, in both designs", () => {
  for (const design of KOT_DESIGNS) {
    const base = maxSettings();
    const stored: Settings = { ...base, kotTemplate: JSON.parse(JSON.stringify(templateWithStation(design, base))) };
    const through = (stationLine?: string) =>
      renderToStaticMarkup(createElement(KOTReceipt, { order: KOT_ROUND.order, settings: stored, ...KOT_ROUND.extra, ...(stationLine === undefined ? {} : { stationLine }) }));
    const printed = through("BAR");
    assert.ok(printed.includes(stationDiv(design, "BAR")), `${design}: KOTReceipt -> KotSlip carries the station line`);
    assert.ok(!through().includes("BAR"), `${design}: and prints none without one`);
    assert.equal(printed, slip(stored, templateWithStation(design, base), "BAR"), `${design}: KOTReceipt equals the engine called directly`);
  }
});

const CAFE_ROOT = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));

test("PIN: the station line is wired at every hop — KOTReceipt -> KotSlip prop -> slip context -> both station renderers", () => {
  const receipt = read("components/pos/KOTReceipt.tsx");
  const kotSlipUse = receipt.slice(receipt.indexOf("<KotSlip"), receipt.indexOf("/>", receipt.indexOf("<KotSlip")));
  assert.ok(kotSlipUse.length > 50, "landmark: the KotSlip element was found");
  assert.ok(kotSlipUse.includes("stationLine={stationLine}"), "KOTReceipt forwards stationLine to KotSlip");
  assert.match(read("components/print/slip/SlipEngine.tsx"), /stationLine\?: string;/, "KotSlip accepts the prop");
  const ctx = read("components/print/slip/slip-context.ts");
  assert.match(ctx, /stationLine: props\.stationLine,/, "the slip context carries it");
  assert.match(ctx, /stationLine: string \| undefined;/);
  for (const [file, cls] of [["kot-classic-blocks.tsx", STATION_CLASS.classic], ["kot-bold-blocks.tsx", STATION_CLASS.kitchenBold]] as const) {
    const src = read(`components/print/slip/${file}`);
    const at = src.indexOf("station: (_block, { stationLine })");
    assert.ok(at > 0, `${file}: the station renderer reads stationLine from the context`);
    const body = src.slice(at, at + 260);
    assert.ok(body.includes('stationLine !== undefined && stationLine !== ""'), `${file}: nothing when absent or empty`);
    assert.ok(body.includes(`className="${cls}"`), `${file}: the heading style`);
  }
});
