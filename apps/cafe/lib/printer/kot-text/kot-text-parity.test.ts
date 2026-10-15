import { KOT_PROP_SETS, KOT_SETTINGS_VARIANTS, settingsOf } from "../../print-template-golden.fixtures"; // FIRST: React's production build
import { before, test } from "node:test";
import assert from "node:assert/strict";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { BLOCK_ALIGNS, BLOCK_SIZES, type KotBlock, type KotTemplate } from "@pos/shared/print-template";
import { KOTReceipt } from "@/components/pos/KOTReceipt";
import { loadSlipCode } from "@/components/print/slip/slip-code";
import { kitchenLinesOf, kitchenOrderOf } from "@/lib/kitchen-lines";
import type { HostKotSlip } from "@/lib/print-host-slips";
import { defaultKotTemplate } from "@/lib/print-template-designs";
import { classicKotTemplate } from "@/lib/print-template-legacy";
import type { Settings } from "@/types";
import { kotTextPlan, kotTextRows } from "./kot-text";
import { slipOf } from "./kot-text.fixtures";
import { asciiText } from "./text-chars";
import { layoutRows, type TextColumns, type TextRow } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §4.4): a text KOT prints the picture's words, in the picture's order. For every
// golden KOT shape, through the legacy ticket, Classic and Kitchen Bold (with every block on, prices on and off, a block
// in each size / alignment / weight, the number's block off, "Show ticket number" off, a banner, a station line and a
// token), the React slip's words (what the picture prints, as PrintSources renders it) equal the text renderer's words
// after the §4.2 map. A change on one side without the other fails here.

// jsx:"preserve" -> React.createElement, so a global React is needed at render time.
(globalThis as { React?: typeof React }).React = React;
before(() => loadSlipCode()); // R6: Kitchen Bold is in the lazy slip chunk

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'" };

function words(text: string): string[] {
  return text
    .split(/\s+/)
    .map((word) => word.toLowerCase().replace(/[[\]]/g, ""))
    .filter((word) => word !== "");
}

function pictureWords(slip: HostKotSlip, settings: Settings): string[] {
  // PrintSources.tsx: the kitchen view of the order and of the round's lines.
  const html = renderToStaticMarkup(
    createElement(KOTReceipt, {
      order: kitchenOrderOf(slip.order),
      settings,
      roundItems: slip.kotRoundItems ? [...kitchenLinesOf(slip.kotRoundItems)] : undefined,
      roundLabel: slip.kotRoundLabel,
      roundNumber: slip.kotRoundNumber,
      variant: slip.kotVariant,
      reason: slip.voidReason,
      voidedBy: slip.voidedBy,
      voidedAt: slip.voidedAt,
      movedFrom: slip.movedFrom,
      movedBy: slip.movedBy,
      movedAt: slip.movedAt,
      stationLine: slip.stationLine,
      banner: slip.banner,
    }),
  );
  const text = html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, " ").replace(/&(amp|lt|gt|quot|#x27|#39);/g, (e) => ENTITIES[e] ?? e);
  const mapped = asciiText(text);
  assert.ok(mapped !== null, "the fixtures print only characters text knows");
  return words(mapped);
}

function mappedWords(text: string): string[] {
  const mapped = asciiText(text);
  assert.ok(mapped !== null, `the text renderer's ${JSON.stringify(text)} maps`);
  return words(mapped);
}

/** The words of the design's rows, in their order: what the slip says, before the lines are laid out. */
function rowWords(rows: TextRow[]): string[] {
  return rows.flatMap((row) => {
    if (row.kind === "text") return mappedWords(row.text);
    if (row.kind === "split") return [...mappedWords(row.label), ...mappedWords(row.value)];
    if (row.kind === "item") return [...mappedWords(row.name), ...mappedWords(row.amount)];
    return [];
  });
}

/** Every character the rows print but their rules (the picture's borders and ornaments, not words) and spaces, laid out
 *  at the columns, sorted: the layout loses and adds nothing. */
function printedChars(rows: TextRow[], columns: TextColumns): string {
  const laid = layoutRows(rows.filter((row) => row.kind !== "rule"), columns);
  assert.ok(laid !== null, "the rows lay out");
  return laid
    .flatMap((piece) => ("text" in piece ? [...piece.text.toLowerCase().replace(/[\s[\]]/g, "")] : []))
    .sort()
    .join("");
}

const withKot = (settings: Settings, template: KotTemplate): Settings => ({ ...settings, kotTemplate: template }) as Settings;
// Every block on but the logo, which is a picture by rule (kot-text.test.ts pins that refusal).
const allOn = (template: KotTemplate): KotTemplate => ({ ...template, blocks: template.blocks.map((b) => ({ ...b, on: b.type !== "logo" })) });
const priced = (template: KotTemplate, prices: boolean): KotTemplate => ({
  ...template,
  blocks: template.blocks.map((b) => (b.type === "items" ? ({ ...b, options: { ...b.options, prices } } as KotBlock) : b)),
});
const extras = (template: KotTemplate): KotTemplate => ({
  ...template,
  blocks: [
    ...template.blocks,
    { id: "customText-1", type: "customText", on: true, options: { text: "Thank you\nCome again" } },
    { id: "divider-9", type: "divider", on: true, options: { style: "ornament" } },
  ],
});
// "Show ticket number" alone decides the number (SlipEngine): a number block that is off still prints while it is on.
const numberBlockOff = (template: KotTemplate): KotTemplate => ({
  ...template,
  blocks: template.blocks.map((b) => (b.type === "kotNo" ? { ...b, on: false } : b)),
});
// Every block in one size / alignment / weight, cycling through them.
const styled = (template: KotTemplate): KotTemplate => ({
  ...template,
  blocks: template.blocks.map((b, i) => ({
    ...b,
    size: BLOCK_SIZES[i % BLOCK_SIZES.length],
    align: BLOCK_ALIGNS[i % BLOCK_ALIGNS.length],
    bold: i % 2 === 0,
  })),
});

function templatesFor(settings: Settings): Array<[string, Settings]> {
  const classic = classicKotTemplate(settings);
  const bold = defaultKotTemplate("kitchenBold", settings);
  return [
    ["legacy", settings],
    ["classic all on", withKot(settings, extras(allOn(classic)))],
    ["classic no prices", withKot(settings, priced(allOn(classic), false))],
    ["classic styled", withKot(settings, styled(allOn(classic)))],
    ["classic small", withKot(settings, { ...allOn(classic), size: "small" })],
    ["classic number block off", withKot(settings, numberBlockOff(allOn(classic)))],
    ["bold default", withKot(settings, bold)],
    ["bold all on", withKot(settings, extras(priced(allOn(bold), true)))],
    ["bold styled", withKot(settings, styled(allOn(bold)))],
    ["bold large", withKot(settings, { ...allOn(bold), size: "large" })],
    ["bold number block off", withKot(settings, numberBlockOff(allOn(bold)))],
  ];
}

const SLIP_EXTRAS: Array<[string, Partial<HostKotSlip>]> = [
  ["plain", {}],
  ["banner and station", { banner: "BACKUP PRINTER · REPRINT", stationLine: "ALL STATIONS" }],
];

test("every golden KOT shape prints the picture's words, in its order, in every design", () => {
  let compared = 0;
  // The golden's four settings, and "Show ticket number" off (the number must vanish on every path).
  const variants = [...KOT_SETTINGS_VARIANTS, { id: "number-off", settings: settingsOf({ logo: "", restaurantName: "", kotShowNumber: false }) }];
  for (const { id: variant, settings: base } of variants) {
    // The logo is a picture: a variant whose logo would print is refused, so the logo flag stays off here.
    const settings = { ...base, kotShowLogo: false } as Settings;
    for (const [design, designSettings] of templatesFor(settings)) {
      for (const set of KOT_PROP_SETS) {
        if (set.order === null) continue;
        for (const [extraId, over] of SLIP_EXTRAS) {
          for (const token of [undefined, 23]) {
            const slip = slipOf(set.id, over);
            const withToken: HostKotSlip = token === undefined ? slip : { ...slip, order: { ...slip.order, tokenNumber: token } };
            const cell = `${variant} / ${design} / ${set.id} / ${extraId} / token ${token ?? "none"}`;
            for (const columns of [32, 48] as const satisfies readonly TextColumns[]) {
              const plan = kotTextPlan({ slip: withToken, settings: designSettings, columns });
              assert.ok(plan.ok, `[${cell} / ${columns}] prints as text (${plan.ok ? "" : plan.refusal})`);
              const rows = kotTextRows({ slip: withToken, settings: designSettings });
              assert.ok(rows.ok, `[${cell}] has rows`);
              const said = rowWords(rows.rows);
              assert.deepEqual(said, pictureWords(withToken, designSettings), `[${cell}] the picture's words, in its order`);
              assert.equal(printedChars(rows.rows, columns), [...said.join("").replace(/[[\]]/g, "")].sort().join(""), `[${cell} / ${columns}] every character laid out`);
              compared++;
            }
          }
        }
      }
    }
  }
  // 5 settings x 11 designs x 20 slips x 2 extras x 2 tokens x 2 widths.
  assert.equal(compared, 5 * 11 * 20 * 2 * 2 * 2, `${compared} cells compared`);
});
