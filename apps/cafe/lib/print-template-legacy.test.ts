import { test } from "node:test";
import assert from "node:assert/strict";

import { billTemplateSchema, kotTemplateSchema } from "@pos/shared/schemas";
import { CLASSIC_PRINT_FONT, PRINT_TEMPLATE_VERSION } from "@pos/shared/print-template";
import { PRINT_FONT_SIZES, PRINT_LOGO_SIZES } from "@pos/shared/constants";
import { printConfigOf } from "./print";
import { classicBillTemplate, classicKotTemplate } from "./print-template-legacy";

// Print customization S1: the Classic-from-legacy converters. Pure and DB-free. The render-level byte equality
// against today's components lives in print-template-golden.test.ts; this suite pins the template SHAPE — the
// block order, which legacy flag drives which `on`, and that every legacy settings combination yields a template
// the write schema accepts.

type BillSettings = Parameters<typeof classicBillTemplate>[0];
type KotSettings = Parameters<typeof classicKotTemplate>[0];

const BILL_FLAGS = [
  "billShowNumber",
  "billShowLogo",
  "billShowAddress",
  "billShowMobile",
  "billShowGstNumber",
  "billShowFssai",
] as const;
const KOT_FLAGS = [
  "kotShowPrices",
  "kotShowTotal",
  "kotShowNumber",
  "kotNumberVoidSlips",
  "kotShowLogo",
  "kotShowRestaurantName",
  "kotShowTable",
  "kotShowStaff",
  "kotShowTime",
  "kotShowNotes",
] as const;

const BILL_ORDER = [
  "logo", "name", "tagline", "address", "phone", "gstin", "fssai", "headerText", "divider-1", "title", "cancelBanner",
  "billNo", "token", "orderId", "dateTime", "table", "customer", "cashier", "cancelReason", "divider-2", "items",
  "divider-3", "subtotal", "discount", "taxes", "charges", "loyalty", "total", "taxIncluded", "payment", "due",
  "divider-4", "footerText", "printedAt",
];
const KOT_ORDER = [
  "logo", "name", "title", "station", "kotNo", "token", "roundLabel", "divider-1", "orderId", "table", "time", "staff",
  "voidReason", "divider-2", "items", "notes", "divider-3", "itemCount", "roundTotal",
];

// Every bit pattern of `names` as a settings object (bit i set = names[i] true).
function flagCombos<K extends string>(names: readonly K[]): Record<K, boolean>[] {
  const combos: Record<K, boolean>[] = [];
  for (let mask = 0; mask < 1 << names.length; mask++) {
    const combo = {} as Record<K, boolean>;
    names.forEach((name, i) => {
      combo[name] = (mask & (1 << i)) !== 0;
    });
    combos.push(combo);
  }
  return combos;
}

function onOf(blocks: { id: string; on: boolean }[]): Record<string, boolean> {
  return Object.fromEntries(blocks.map((b) => [b.id, b.on]));
}

test("bill: block order is pinned exactly, ids are unique, header fields are as specified", () => {
  const t = classicBillTemplate(null);
  assert.deepEqual(t.blocks.map((b) => b.id), BILL_ORDER);
  assert.equal(new Set(t.blocks.map((b) => b.id)).size, t.blocks.length);
  assert.equal(t.v, PRINT_TEMPLATE_VERSION);
  assert.equal(t.design, "classic");
  assert.equal(t.font, CLASSIC_PRINT_FONT);
  for (const b of t.blocks) {
    if (b.type === "divider") {
      assert.equal(b.on, true);
      assert.equal("options" in b, false, "a legacy divider carries no options");
    } else {
      assert.equal(b.id, b.type, "a non-repeatable block's id is its type");
    }
  }
});

test("kot: block order is pinned exactly, ids are unique, header fields are as specified", () => {
  const t = classicKotTemplate(undefined);
  assert.deepEqual(t.blocks.map((b) => b.id), KOT_ORDER);
  assert.equal(new Set(t.blocks.map((b) => b.id)).size, t.blocks.length);
  assert.equal(t.v, PRINT_TEMPLATE_VERSION);
  assert.equal(t.design, "classic");
  assert.equal(t.font, CLASSIC_PRINT_FONT);
});

test("null / undefined settings resolve to printConfigOf defaults", () => {
  const bill = printConfigOf(null).bill;
  for (const settings of [null, undefined, {}]) {
    const t = classicBillTemplate(settings);
    const on = onOf(t.blocks);
    assert.equal(t.size, bill.fontSize);
    assert.equal(on.logo, bill.showLogo);
    assert.equal(on.address, bill.showAddress);
    assert.equal(on.phone, bill.showMobile);
    assert.equal(on.gstin, bill.showGstNumber);
    assert.equal(on.fssai, bill.showFssai);
    assert.equal(on.billNo, bill.showNumber);
  }
  const kot = printConfigOf(null).kot;
  for (const settings of [null, undefined, {}]) {
    const t = classicKotTemplate(settings);
    const on = onOf(t.blocks);
    assert.equal(t.size, kot.fontSize);
    assert.equal(on.logo, kot.showLogo);
    assert.equal(on.name, kot.showRestaurantName);
    assert.equal(on.kotNo, kot.showNumber);
    assert.equal(on.roundTotal, kot.showTotal && kot.showPrices);
  }
  // The legacy bill base is 12px ("small") and the kot's 14px ("normal"): defaults must not be unified.
  assert.equal(classicBillTemplate(null).size, "small");
  assert.equal(classicKotTemplate(null).size, "normal");
});

test("bill: all 64 show-flag combos x logoSize x fontSize parse and each `on` mirrors its flag", () => {
  let cells = 0;
  for (const flags of flagCombos(BILL_FLAGS)) {
    for (const billLogoSize of PRINT_LOGO_SIZES) {
      for (const billFontSize of PRINT_FONT_SIZES) {
        const settings: BillSettings = { ...flags, billLogoSize, billFontSize };
        const t = classicBillTemplate(settings);
        const parsed = billTemplateSchema.safeParse(t);
        assert.equal(parsed.success, true, JSON.stringify(settings));
        const on = onOf(t.blocks);
        assert.equal(on.billNo, flags.billShowNumber);
        assert.equal(on.logo, flags.billShowLogo);
        assert.equal(on.address, flags.billShowAddress);
        assert.equal(on.phone, flags.billShowMobile);
        assert.equal(on.gstin, flags.billShowGstNumber);
        assert.equal(on.fssai, flags.billShowFssai);
        assert.equal(t.size, billFontSize);
        const logo = t.blocks.find((b) => b.type === "logo");
        assert.deepEqual(logo && "options" in logo ? logo.options : null, { logoSize: billLogoSize });
        // Forward blocks the legacy bill never printed stay off (title: only the GST lock prints it).
        assert.equal(on.title, false);
        assert.equal(on.loyalty, false);
        // Everything the legacy bill always printed stays on.
        const gated = new Set(["title", "loyalty", "billNo", "logo", "address", "phone", "gstin", "fssai"]);
        for (const b of t.blocks) if (!gated.has(b.id)) assert.equal(b.on, true, b.id);
        cells++;
      }
    }
  }
  assert.equal(cells, 64 * PRINT_LOGO_SIZES.length * PRINT_FONT_SIZES.length);
});

test("kot: all 1024 flag combos parse and each `on` mirrors its flag; roundTotal = showTotal && showPrices", () => {
  let cells = 0;
  for (const flags of flagCombos(KOT_FLAGS)) {
    const settings: KotSettings = { ...flags };
    const t = classicKotTemplate(settings);
    assert.equal(kotTemplateSchema.safeParse(t).success, true, JSON.stringify(settings));
    const on = onOf(t.blocks);
    assert.equal(on.logo, flags.kotShowLogo);
    assert.equal(on.name, flags.kotShowRestaurantName);
    assert.equal(on.kotNo, flags.kotShowNumber);
    assert.equal(on.table, flags.kotShowTable);
    assert.equal(on.time, flags.kotShowTime);
    assert.equal(on.staff, flags.kotShowStaff);
    assert.equal(on.notes, flags.kotShowNotes);
    assert.equal(on.roundTotal, flags.kotShowTotal && flags.kotShowPrices);
    const items = t.blocks.find((b) => b.type === "items");
    assert.deepEqual(items && "options" in items ? items.options : null, {
      prices: flags.kotShowPrices,
      modifiers: true,
      instructions: true,
    });
    const logo = t.blocks.find((b) => b.type === "logo");
    assert.deepEqual(logo && "options" in logo ? logo.options : null, { logoSize: "small" });
    const gated = new Set(["logo", "name", "kotNo", "table", "time", "staff", "notes", "roundTotal"]);
    for (const b of t.blocks) if (!gated.has(b.id)) assert.equal(b.on, true, b.id);
    cells++;
  }
  assert.equal(cells, 1024);
});

test("kotNumberVoidSlips and paper width are Settings policy: they never change the template", () => {
  const base = classicKotTemplate({ kotNumberVoidSlips: true, kotPaperWidth: "80mm" });
  assert.deepEqual(classicKotTemplate({ kotNumberVoidSlips: false, kotPaperWidth: "58mm" }), base);
  const bill = classicBillTemplate({ billPaperWidth: "80mm", billNumberStart: 1 });
  assert.deepEqual(classicBillTemplate({ billPaperWidth: "58mm", billNumberStart: 500 }), bill);
});

test("each call returns a fresh template (callers may edit it freely)", () => {
  assert.notEqual(classicBillTemplate(null), classicBillTemplate(null));
  assert.notEqual(classicBillTemplate(null).blocks, classicBillTemplate(null).blocks);
  assert.notEqual(classicKotTemplate(null).blocks, classicKotTemplate(null).blocks);
});

test("forward blocks: bill title is off, bill/kot token and kot station are on, for every settings", () => {
  for (const settings of [null, { billShowNumber: false, kotShowNumber: false }]) {
    const bill = onOf(classicBillTemplate(settings).blocks);
    assert.equal(bill.title, false, "title prints only when the GST lock forces it");
    assert.equal(bill.token, true);
    const kot = onOf(classicKotTemplate(settings).blocks);
    assert.equal(kot.station, true);
    assert.equal(kot.token, true);
  }
});
