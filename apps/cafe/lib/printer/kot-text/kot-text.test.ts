import { LOGO_REF, settingsOf } from "../../print-template-golden.fixtures"; // FIRST: React's production build
import { test } from "node:test";
import assert from "node:assert/strict";

import type { KotBlock, KotTemplate } from "@pos/shared/print-template";
import { CUT_PARTIAL_WITH_FEED, ESC_INIT } from "@/lib/printer/escpos";
import type { HostKotSlip } from "@/lib/print-host-slips";
import { classicKotTemplate } from "@/lib/print-template-legacy";
import type { Settings } from "@/types";
import { KOT_TEXT_CLASSIC } from "./kot-text-classic";
import { KOT_TEXT_DESIGNS, kotTextJob, kotTextPlan, type KotTextPlan } from "./kot-text";
import { shownPieces, slipOf } from "./kot-text.fixtures";
import type { TextColumns } from "./text-layout";

// Printing Phase 4 (spec 2026-10-15 §4.1, §4.3): a kitchen-surface slip as text, with Classic's look, or the reason it
// prints as a picture. The golden lines were read against the picture (the parity test pins the words).

function shown(plan: KotTextPlan): string[] {
  assert.ok(plan.ok, `the slip prints as text (${plan.ok ? "" : plan.refusal})`);
  return shownPieces(plan.pieces);
}

const plain = settingsOf({ logo: "" });
const planOf = (slip: HostKotSlip, settings: Settings = plain, columns: TextColumns = 48) => kotTextPlan({ slip, settings, columns });
const withTemplate = (blocks: (template: KotTemplate) => KotBlock[], over: Partial<Settings> = {}): Settings => {
  const settings = settingsOf({ logo: "", ...over });
  const template = classicKotTemplate(settings);
  return { ...settings, kotTemplate: { ...template, blocks: blocks(template) } } as Settings;
};

test("a round's KOT on 80 mm, as Classic prints it", () => {
  assert.deepEqual(shown(planOf(slipOf("round-label-number"))), [
    "tall  B c|KITCHEN ORDER|",
    "big   B c|#7|",
    "normalB c|Round 1|",
    "normal  l|- - - - - - - - - - - - - - - - - - - - - - - -|",
    "normal  l|Order                          ORD-20261004-042|",
    "normal  l|Table                                        T4|",
    "normal  l|Time                                   10:45 am|",
    "normal  l|Staff                                      Asha|",
    "normal  l|- - - - - - - - - - - - - - - - - - - - - - - -|",
    "normalB l|2 x Masala Chai                           Rs 80|",
    "normal  l|    + Less sugar, Extra ginger|",
    "normalB l|    > Hot please|",
    "feed 12",
    "normalB l|1 x Pizza (Large)                        Rs 300|",
    "normal  l|    NO Onion|",
    "normal  l|- - - - - - - - - - - - - - - - - - - - - - - -|",
    "normalB l|Note: Birthday table, no peanuts|",
    "normal  l|- - - - - - - - - - - - - - - - - - - - - - - -|",
    "normal  c|3 item(s)|",
    "normalB c|Round total: Rs 380|",
  ], "Classic's round KOT, line for line");
});

test("a long Classic item wraps from the line's start, its amount on the first line (the 4A gate's review, m-5)", () => {
  const slip = slipOf("round-label-number");
  const long = { ...slip.order.items[0], qty: 1, name: "Paneer Butter Masala With Extra Gravy", price: 1240, modifiers: [], instructions: "" };
  const priced = withTemplate((t) => t.blocks.map((b) => (b.type === "items" ? ({ ...b, options: { ...b.options, prices: true } } as KotBlock) : b)));
  const lines = shown(kotTextPlan({ slip: { ...slip, kotRoundItems: [long] }, settings: priced, columns: 32 })).filter((line) => line.startsWith("normalB l|"));
  assert.deepEqual(lines.slice(0, 2), [`normalB l|${"1 x Paneer Butter".padEnd(23)}Rs 1,240|`, "normalB l|Masala With Extra Gravy|"], "the name wraps from the start, never under the quantity");
});

test("the same KOT on 58 mm wraps inside 31 characters", () => {
  const lines = shown(planOf(slipOf("round-label-number"), plain, 32));
  assert.ok(lines.includes("normal  l|Order          ORD-20261004-042|"), "the meta row fits 31");
  assert.ok(lines.includes("normalB l|2 x Masala Chai           Rs 80|"), "the item row fits 31");
  assert.ok(lines.includes("normalB l|Note: Birthday table, no|") && lines.includes("normalB l|peanuts|"), "the note wraps");
});

test("a VOID, a cancel notice and a TABLE MOVED slip keep their loud titles and their rules", () => {
  const voided = shown(planOf(slipOf("void-reason-by-at")));
  assert.deepEqual(voided.slice(0, 2), ["tall  B c|*** VOID ***|", "normalB c|CANCELLED ITEMS - DO NOT MAKE|"], "the void title");
  assert.ok(voided.includes("normal  l|Staff                                     Owner|"), "the voider, not the tab's opener");
  assert.ok(voided.includes("normalB l|Reason: Guest changed mind|"), "the reason");
  assert.equal(voided.at(-2), "normal  c|1 item(s) VOIDED|", "the voided count");
  const cancelled = shown(planOf(slipOf("cancel-notice-reason")));
  assert.ok(cancelled.includes("normalB l|3 x Cold Coffee                          Rs 360|"), "a cancel notice lists every item");
  const moved = shown(planOf(slipOf("moved-from-by-at")));
  assert.deepEqual(moved.slice(0, 2), ["tall  B c|*** TABLE MOVED ***|", "normalB c|FOOD ALREADY ORDERED - DO NOT MAKE AGAIN|"], "the moved title");
  assert.ok(moved.includes("normal  l|Table                                  T2 -> T4|"), "from -> to");
  assert.ok(!moved.some((line) => line.includes(" x ")), "a moved slip lists no items");
});

test("the job's banner is a white-on-black band; a station line prints under the title", () => {
  const lines = shown(planOf(slipOf("round-banner-reprint", { banner: "BACKUP PRINTER · REPRINT", stationLine: "BAR" })));
  assert.equal(lines[0], `tall  BIl|${"BACKUP PRINTER - REPRINT".padStart(35).padEnd(47)}|`, "the band spans the line, centred");
  assert.deepEqual(lines.slice(1, 3), ["tall  B c|KITCHEN ORDER|", "tall  B c|BAR|"], "title, then the station");
});

test("a block's own size, alignment and weight, and the template's base size", () => {
  const big = withTemplate((t) => t.blocks.map((b) => (b.type === "title" ? { ...b, size: "xl", align: "left", bold: false } : b)));
  assert.equal(shown(planOf(slipOf("round-label-number"), big))[0], "big     l|KITCHEN ORDER|", "1.29em x 1.5: double size, left, regular");
  const small = withTemplate((t) => t.blocks, { kotFontSize: "small" });
  assert.equal(shown(planOf(slipOf("round-label-number"), small))[0], "normalB c|KITCHEN ORDER|", "1.29em at 12 px is normal size");
  // At the large base the floor shows (the 4A gate's review, I-1): 16/14 x 1.29 x 0.875 = 1.29 is double height, while
  // xs (x 0.75 = 1.106) would be normal.
  const locked = withTemplate((t) => t.blocks.map((b) => (b.type === "title" ? { ...b, size: "xs" } : b)), { kotFontSize: "large" });
  assert.equal(shown(planOf(slipOf("void-reason-by-at"), locked))[0], "tall  B c|*** VOID ***|", "a locked title shrinks to sm, never xs");
});

test("Classic's meta lines are 0.93em in the picture, so a block's own size grows them less (the 4A gate's m-2)", () => {
  const sized = (size: "lg" | "xl") => withTemplate((t) => t.blocks.map((b) => (b.type === "orderId" ? { ...b, size } : b)));
  const orderLine = (settings: Settings) => shown(planOf(slipOf("round-label-number"), settings)).find((line) => line.includes("Order"));
  assert.equal(orderLine(sized("xl")), `tall    l|Order${" ".repeat(26)}ORD-20261004-042|`, "xl: 0.93 x 1.5 is double height, never double size");
  assert.equal(orderLine(sized("lg")), `normal  l|Order${" ".repeat(26)}ORD-20261004-042|`, "lg: 0.93 x 1.25 stays normal");
});

test("a label / value row's block alignment places its value as the picture does (the 4A gate's m-3)", () => {
  const aligned = (align: "left" | "center") =>
    withTemplate((t) => t.blocks.map((b) => (b.type === "orderId" || b.type === "table" ? { ...b, align } : b)));
  const lines = (settings: Settings) => shown(planOf(slipOf("round-label-number"), settings)).filter((line) => /\|(Order|Table) /.test(line));
  assert.deepEqual(lines(aligned("center")), [`normal  l|Order${" ".repeat(13)}ORD-20261004-042|`, `normal  l|Table${" ".repeat(20)}T4|`], "centred in the room after the label");
  assert.deepEqual(lines(aligned("left")), ["normal  l|Order ORD-20261004-042|", "normal  l|Table T4|"], "right after the label");
  assert.deepEqual(lines(withTemplate((t) => t.blocks)), [`normal  l|Order${" ".repeat(26)}ORD-20261004-042|`, `normal  l|Table${" ".repeat(40)}T4|`], "no alignment: the value right, as before");
});

test("an amount wider than a line prints as a picture: never cut, never a throw (the 4A gate's m-4)", () => {
  const xl = withTemplate((t) => t.blocks.map((b) => (b.type === "items" ? ({ ...b, size: "xl", options: { ...b.options, prices: true } } as KotBlock) : b)));
  const slip = slipOf("round-label-number");
  const dear = { ...slip, kotRoundItems: (slip.kotRoundItems ?? []).map((item) => ({ ...item, price: 1_00_00_00_000 })) };
  assert.deepEqual(kotTextJob({ slip: dear, settings: xl, columns: 32 }), { ok: false, refusal: "error" }, "Rs 2,00,00,00,000 at double size on 58 mm: no room, so the picture");
  assert.ok(kotTextJob({ slip: dear, settings: xl, columns: 48 }).ok, "landmark: on 80 mm the amount fits");
});

test("Show ticket number alone decides the number, on the legacy ticket and on a saved template (SlipEngine)", () => {
  const numbered = (settings: Settings): boolean => shown(planOf(slipOf("round-label-number"), settings)).includes("big   B c|#7|");
  assert.equal(numbered(settingsOf({ logo: "", kotShowNumber: false })), false, "the setting off: no number on the legacy ticket");
  const blockOn = withTemplate((t) => t.blocks.map((b) => (b.type === "kotNo" ? { ...b, on: true } : b)), { kotShowNumber: false });
  assert.equal(numbered(blockOn), false, "the setting off: no number even with the number's block on");
  const blockOff = withTemplate((t) => t.blocks.map((b) => (b.type === "kotNo" ? { ...b, on: false } : b)));
  assert.equal(numbered(blockOff), true, "the setting on: the number prints even with its block off");
});

test("custom text keeps its line breaks; a QR line with no usable link prints nothing", () => {
  const settings = withTemplate((t) => [
    ...t.blocks,
    { id: "customText-1", type: "customText", on: true, options: { text: "Thank you\nCome again" } },
    { id: "qr-1", type: "qr", on: true, options: { content: "link", url: "http://not-https.example" } },
  ]);
  const lines = shown(planOf(slipOf("round-label-number"), settings));
  assert.deepEqual(lines.slice(-2), ["normal  c|Thank you|", "normal  c|Come again|"], "two lines, centred, nothing for the QR");
});

test("a slip text cannot print exactly prints as a picture", () => {
  const refusal = (plan: KotTextPlan): string => (plan.ok ? "ok" : plan.refusal);
  const hindi = slipOf("round-label-number");
  hindi.order = { ...hindi.order, items: hindi.order.items.map((it, i) => (i === 0 ? { ...it, name: "मसाला चाय" } : it)) };
  hindi.kotRoundItems = hindi.order.items.filter((it) => it.kotRound === 1);
  assert.equal(refusal(planOf(hindi)), "characters", "a Hindi item");
  assert.equal(refusal(planOf(slipOf("round-label-number", { order: { ...slipOf("round-label-number").order, receiver: "ભાવેશ" } }))), "characters", "a Gujarati staff name");
  assert.equal(refusal(planOf(slipOf("round-label-number"), settingsOf({ logo: LOGO_REF, kotShowLogo: true }))), "picture", "the logo on, with a logo");
  assert.equal(refusal(planOf(slipOf("round-label-number"), settingsOf({ logo: "", kotShowLogo: true }))), "ok", "the logo on, with no logo: nothing to draw");
  const qr = withTemplate((t) => [...t.blocks, { id: "qr-1", type: "qr", on: true, options: { content: "link", url: "https://menu.example.com" } }]);
  assert.equal(refusal(planOf(slipOf("round-label-number"), qr)), "picture", "a QR code that would print");
});

test("a design or block with no text renderer, or a renderer that throws, is a refusal, never a throw", () => {
  const saved = KOT_TEXT_DESIGNS.classic;
  try {
    KOT_TEXT_DESIGNS.classic = undefined;
    assert.deepEqual(kotTextJob({ slip: slipOf("round-label-number"), settings: plain, columns: 48 }), { ok: false, refusal: "design" }, "no design");
    const { items: _items, ...rest } = KOT_TEXT_CLASSIC.rows;
    KOT_TEXT_DESIGNS.classic = { ...KOT_TEXT_CLASSIC, rows: rest as typeof KOT_TEXT_CLASSIC.rows };
    assert.deepEqual(kotTextJob({ slip: slipOf("round-label-number"), settings: plain, columns: 48 }), { ok: false, refusal: "block" }, "no items renderer");
    KOT_TEXT_DESIGNS.classic = { ...KOT_TEXT_CLASSIC, rows: { ...KOT_TEXT_CLASSIC.rows, items: () => { throw new Error("boom"); } } };
    assert.deepEqual(kotTextJob({ slip: slipOf("round-label-number"), settings: plain, columns: 48 }), { ok: false, refusal: "error" }, "a throwing renderer");
  } finally {
    KOT_TEXT_DESIGNS.classic = saved;
  }
});

test("the job's bytes begin and end as a picture's, and are far smaller", () => {
  const job = kotTextJob({ slip: slipOf("cancel-notice-reason"), settings: plain, columns: 48 });
  assert.ok(job.ok, "the cancel notice prints as text");
  const bytes = Array.from(job.bytes);
  assert.deepEqual(bytes.slice(0, 2), Array.from(ESC_INIT), "ESC @ first");
  assert.deepEqual(bytes.slice(2, 5), [0x1b, 0x52, 0x00], "then ESC R 0: # [ ] @ print as themselves whatever the printer's own set");
  assert.deepEqual(bytes.slice(5, 8), [0x1b, 0x4d, 0x00], "then ESC M 0: Font A, whatever font the printer starts in");
  assert.deepEqual(bytes.slice(-4), Array.from(CUT_PARTIAL_WITH_FEED), "the picture's cut last");
  assert.ok(bytes.length < 1_500, `a whole-order cancel notice is ${bytes.length} bytes (a picture KOT is about 44,000)`);
});
