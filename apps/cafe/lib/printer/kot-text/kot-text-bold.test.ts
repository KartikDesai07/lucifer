import { settingsOf } from "../../print-template-golden.fixtures"; // FIRST: React's production build
import { test } from "node:test";
import assert from "node:assert/strict";

import type { KotBlock } from "@pos/shared/print-template";
import { defaultKotTemplate } from "@/lib/print-template-designs";
import type { Settings } from "@/types";
import { kotTextPlan, type KotTextPlan } from "./kot-text";
import { shownPieces, slipOf } from "./kot-text.fixtures";
import type { TextColumns } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §4.3): Kitchen Bold as text. The golden lines were read against the picture
// (components/print/slip/kot-bold-blocks.tsx; the parity test pins the words).

function shown(plan: KotTextPlan): string[] {
  assert.ok(plan.ok, `the slip prints as text (${plan.ok ? "" : plan.refusal})`);
  return shownPieces(plan.pieces);
}

function boldSettings(blocks: (blocks: KotBlock[]) => KotBlock[] = (b) => b): Settings {
  const settings = settingsOf({ logo: "" });
  const template = defaultKotTemplate("kitchenBold", settings);
  return { ...settings, kotTemplate: { ...template, blocks: blocks(template.blocks) } } as Settings;
}

const planOf = (id: string, settings: Settings, columns: TextColumns, over = {}) => kotTextPlan({ slip: slipOf(id, over), settings, columns });

test("a round's KOT in Kitchen Bold on 80 mm: the band, the station, the number box, the big table and items", () => {
  assert.deepEqual(shown(planOf("round-label-number", boldSettings(), 48, { banner: "REPRINT", stationLine: "BAR" })), [
    "tall  BIl|                    REPRINT                    |",
    "tall  B c|BAR|",
    "big   BIl|KOT 7                  |",
    "big   B l|Table T4|",
    "normalB l|Round 1|",
    "normal  l|Time 10:45 am|",
    "normal  l|Staff Asha|",
    "normal  l|Order ORD-20261004-042|",
    "normal  l|===============================================|",
    "tall  B l|[2] MASALA CHAI|",
    "normalB l|    + Less sugar, Extra ginger|",
    "normalB l|    >> Hot please|",
    "feed 12",
    "tall  B l|[1] PIZZA (LARGE)|",
    "normalB l|    NO Onion|",
    "normal  l|===============================================|",
    "normalBIl|NOTE: BIRTHDAY TABLE, NO PEANUTS               |",
    "normalB l|3 item(s)|",
  ], "Kitchen Bold's round KOT, line for line");
});

test("a VOID on 58 mm: white-on-black title bands; a moved slip names from -> to and lists no items", () => {
  const voided = shown(planOf("void-reason-by-at", boldSettings(), 32));
  assert.deepEqual(voided.slice(0, 3), [
    "tall  BIl|         *** VOID ***          |",
    "normalBIl| CANCELLED ITEMS - DO NOT MAKE |",
    "big   BIl|KOT 9          |",
  ], "the void bands, then the number box");
  assert.deepEqual(voided.slice(-3), ["normalBIl|NOTE: BIRTHDAY TABLE, NO       |", "normalBIl|PEANUTS                        |", "normalB l|1 item(s) VOIDED|"], "the note band wraps");
  const moved = shown(planOf("moved-from-by-at", boldSettings(), 48));
  assert.ok(moved.includes("big   B l|Table T2 -> T4|"), "the table, from -> to, at double size");
  assert.ok(!moved.some((line) => line.includes("[")), "no items on a moved slip");
});

test("with prices the amount stays as written beside the upper-case name, and the round total prints", () => {
  const priced = boldSettings((blocks) =>
    blocks.map((b) => (b.type === "items" ? { ...b, options: { ...b.options, prices: true } } : b.type === "roundTotal" ? { ...b, on: true } : b)),
  );
  const lines = shown(planOf("round-label-number", priced, 48));
  assert.ok(lines.includes(`tall  B l|${"[2] MASALA CHAI".padEnd(42)}Rs 80|`), "the amount flush right on the tall line, never upper-cased");
  assert.equal(lines.at(-1), "normalB l|Round total: Rs 380|", "the round total, left, bold");
});

test("Kitchen Bold prints the restaurant's name upper case, as its CSS shows it (the 4A gate's m-2)", () => {
  const named = boldSettings((blocks) => blocks.map((b) => (b.type === "name" ? { ...b, on: true } : b)));
  assert.equal(shown(planOf("round-label-number", named, 48))[0], "tall  B c|TEST CAFE|", "upper case, double height, bold, centred");
});

test("a long item name wraps under the name, after its quantity", () => {
  const slip = slipOf("round-label-number");
  const long = { ...slip.order.items[0], name: "Masala Chai With Extra Ginger And Cardamom" };
  const plan = kotTextPlan({ slip: { ...slip, kotRoundItems: [long] }, settings: boldSettings(), columns: 32 });
  const lines = shown(plan).filter((line) => line.startsWith("tall"));
  assert.deepEqual(lines, ["tall  B l|[2] MASALA CHAI WITH EXTRA|", "tall  B l|    GINGER AND CARDAMOM|"], "continued four spaces in");
});
