import { settingsOf } from "./print-template-golden.fixtures"; // FIRST (selects React's production renderer; harmless here)
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  BILL_BLOCK_TYPES,
  BILL_DESIGNS,
  BILL_REQUIRED_BLOCKS,
  KOT_BLOCK_TYPES,
  KOT_DESIGNS,
  KOT_REQUIRED_BLOCKS,
  PRINT_FONT_KEYS,
  REPEATABLE_BLOCK_TYPES,
  isValidBlockId,
  type BillDesign,
  type BillTemplate,
  type KotTemplate,
} from "@pos/shared/print-template";
import { PRINT_FONT_CATALOG, PRINT_FONT_FAMILIES_MAX, printFontFaceOf, type PrintFontFace } from "@pos/shared/print-fonts";
import {
  billTemplateReadSchema,
  billTemplateSchema,
  kotTemplateReadSchema,
  kotTemplateSchema,
} from "@pos/shared/schemas/print-template.schema";
import {
  BILL_DESIGN_FACES,
  KOT_DESIGN_FACES,
  defaultBillTemplate,
  defaultKotTemplate,
  templateFaces,
} from "@/lib/print-template-designs";
import { classicBillTemplate, classicKotTemplate } from "@/lib/print-template-legacy";
import { readBillTemplate, readKotTemplate } from "@/lib/print-template-resolve";
import { RASTER_ASSET_CACHE_MAX } from "@/lib/printer/raster-assets";
import type { Settings } from "@/types";

// Print customization S3: the built-in designs' DEFAULT block lists (lib/print-template-designs.ts) as data. Each
// must be a template the WRITE gate and the READ schema accept, carry every non-repeatable block of its kind exactly
// once, carry every REQUIRED block, and (Classic) equal the converter. The S2 resolver re-inserts a missing required
// block after its nearest preceding non-repeatable neighbour in THAT design's default order, which is pinned here
// with literal positions as well as with an independently computed one. Faces: no slip can name more families than
// the raster lane's asset cache can hold.

type AnyBlock = { id: string; type: string; on: boolean };
type AnyTemplate = { design: string; font: string; blocks: AnyBlock[] };

const REPEATABLE: readonly string[] = ["divider", "customText", "qr"];
const typesOf = (blocks: readonly { type: string }[]): string[] => blocks.map((b) => b.type);
const plain = <T>(v: T): T => structuredClone(v);

const SETTINGS_VARIANTS: { id: string; settings: Settings }[] = [
  { id: "defaults", settings: settingsOf() },
  { id: "all-flags-off", settings: settingsOf({ billShowLogo: false, billShowAddress: false, billShowMobile: false, billShowGstNumber: false, billShowFssai: false, billShowNumber: false, kotShowPrices: false, kotShowTotal: false, kotShowTable: false, kotShowTime: false, kotShowStaff: false, kotShowNotes: false, kotShowLogo: false, kotShowRestaurantName: false }) },
  { id: "flags-on-large", settings: settingsOf({ billShowLogo: true, billLogoSize: "large", billShowGstNumber: true, billShowNumber: true, billFontSize: "large", kotShowPrices: true, kotShowTotal: true, kotShowLogo: true, kotFontSize: "small" }) },
  { id: "gst-on", settings: settingsOf({ gstEnabled: true, gstRate: 5, gstMode: "exclusive" }) },
];

test("landmark: the design lists are the shipped ones (a new design must get its own rows here)", () => {
  assert.deepEqual([...BILL_DESIGNS], ["classic", "modern", "express", "cafe"]);
  assert.deepEqual([...KOT_DESIGNS], ["classic", "kitchenBold"]);
  assert.deepEqual([...REPEATABLE_BLOCK_TYPES].sort(), [...REPEATABLE].sort());
  assert.ok(BILL_REQUIRED_BLOCKS.length > 0 && KOT_REQUIRED_BLOCKS.length > 0, "the required lists are non-empty");
});

// ── every default is a valid template ────────────────────────────────────────

function expectValid(label: string, schema: { safeParse: (v: unknown) => { success: boolean; error?: { issues: unknown[] } } }, value: unknown): void {
  const r = schema.safeParse(value);
  assert.ok(r.success, `${label}: ${JSON.stringify(r.error?.issues)}`);
}

test("every default template passes the WRITE schema and the READ schema, and survives a JSON round trip unchanged", () => {
  for (const { id, settings } of SETTINGS_VARIANTS) {
    for (const design of BILL_DESIGNS) {
      const tpl = defaultBillTemplate(design, settings);
      assert.equal(tpl.design, design);
      expectValid(`bill ${design} (${id}) WRITE`, billTemplateSchema, tpl);
      expectValid(`bill ${design} (${id}) READ`, billTemplateReadSchema, tpl);
      assert.deepEqual(billTemplateSchema.parse(JSON.parse(JSON.stringify(tpl))), tpl, `bill ${design} (${id}) round trip`);
    }
    for (const design of KOT_DESIGNS) {
      const tpl = defaultKotTemplate(design, settings);
      assert.equal(tpl.design, design);
      expectValid(`kot ${design} (${id}) WRITE`, kotTemplateSchema, tpl);
      expectValid(`kot ${design} (${id}) READ`, kotTemplateReadSchema, tpl);
      assert.deepEqual(kotTemplateSchema.parse(JSON.parse(JSON.stringify(tpl))), tpl, `kot ${design} (${id}) round trip`);
    }
  }
});

test("vision guard: the schemas used above really reject a broken default (they are not accept-all)", () => {
  const tpl = defaultBillTemplate("modern", settingsOf());
  assert.equal(billTemplateSchema.safeParse({ ...tpl, blocks: tpl.blocks.filter((b) => b.type !== "total") }).success, false, "WRITE: no total");
  assert.equal(billTemplateReadSchema.safeParse({ ...tpl, design: "neon" }).success, false, "READ: unknown design");
  const kot = defaultKotTemplate("kitchenBold", settingsOf());
  assert.equal(kotTemplateSchema.safeParse({ ...kot, blocks: kot.blocks.filter((b) => b.type !== "title") }).success, false, "WRITE: no kot title");
});

// ── completeness: each non-repeatable type once, every required block present, ids ───

const BILL_ONCE = BILL_BLOCK_TYPES.filter((t) => !REPEATABLE.includes(t));
const KOT_ONCE = KOT_BLOCK_TYPES.filter((t) => !REPEATABLE.includes(t));

function expectComplete(label: string, blocks: readonly AnyBlock[], once: readonly string[], required: readonly string[]): void {
  const types = typesOf(blocks);
  for (const type of once) assert.equal(types.filter((t) => t === type).length, 1, `${label}: ${type} appears exactly once`);
  for (const type of required) assert.ok(types.includes(type), `${label}: required ${type} is present`);
  for (const type of types) assert.ok(once.includes(type) || REPEATABLE.includes(type), `${label}: ${type} is a block type of the kind`);
  const ids = blocks.map((b) => b.id);
  assert.equal(new Set(ids).size, ids.length, `${label}: ids are unique`);
  for (const b of blocks) assert.ok(isValidBlockId(b.type, b.id), `${label}: ${b.id} is a valid id for ${b.type}`);
}

test("every default carries each non-repeatable block type of its kind exactly once, every required block, valid unique ids", () => {
  assert.ok(BILL_ONCE.length >= 25 && KOT_ONCE.length >= 14, "landmark: the catalogs are not empty after the repeatable filter");
  for (const design of BILL_DESIGNS) expectComplete(`bill ${design}`, defaultBillTemplate(design, settingsOf()).blocks, BILL_ONCE, BILL_REQUIRED_BLOCKS);
  for (const design of KOT_DESIGNS) expectComplete(`kot ${design}`, defaultKotTemplate(design, settingsOf()).blocks, KOT_ONCE, KOT_REQUIRED_BLOCKS);
});

// REGRESSION PIN (was a failing repro, fixed by the main thread): the Classic converter had no `loyalty` block, so
// Classic's bill default lacked one of the non-repeatable bill types although the defaults promise every one.
test("REGRESSION: the Classic bill default carries every non-repeatable bill block type exactly once (incl. loyalty, off)", () => {
  const loyalty = defaultBillTemplate("classic", settingsOf()).blocks.find((b) => b.type === "loyalty");
  assert.ok(loyalty && loyalty.on === false, "landmark: loyalty is present and OFF (it must not change today's slip)");
  expectComplete("bill classic", defaultBillTemplate("classic", settingsOf()).blocks, BILL_ONCE, BILL_REQUIRED_BLOCKS);
});

test("a default's required blocks are present whatever the legacy toggles say (the lock, not the toggle, decides printing)", () => {
  for (const { id, settings } of SETTINGS_VARIANTS) {
    for (const design of BILL_DESIGNS) {
      const types = typesOf(defaultBillTemplate(design, settings).blocks);
      for (const type of BILL_REQUIRED_BLOCKS) assert.ok(types.includes(type), `bill ${design} (${id}) lacks ${type}`);
    }
  }
});

test("Classic's default IS the converter (Reset to design on Classic restores today's slip), for every settings variant and null", () => {
  for (const { id, settings } of SETTINGS_VARIANTS) {
    assert.deepEqual(defaultBillTemplate("classic", settings), classicBillTemplate(settings), `bill ${id}`);
    assert.deepEqual(defaultKotTemplate("classic", settings), classicKotTemplate(settings), `kot ${id}`);
  }
  assert.deepEqual(defaultBillTemplate("classic", null), classicBillTemplate(null));
  assert.deepEqual(defaultKotTemplate("classic", undefined), classicKotTemplate(undefined));
  // Landmark: the variants really differ, so "equals the converter" is not "equals one constant".
  assert.notDeepEqual(classicBillTemplate(SETTINGS_VARIANTS[0].settings), classicBillTemplate(SETTINGS_VARIANTS[1].settings));
});

// REGRESSION PIN (was a failing repro, fixed by the main thread): the totals / tail / UPI blocks were MODULE-LEVEL
// objects spread into every new list, so two calls shared block objects and an in-place edit leaked into the next
// default.
test("REGRESSION: every call returns FRESH block objects (an editor mutating one default never changes the next)", () => {
  const sets: [string, () => AnyTemplate][] = [
    ...BILL_DESIGNS.map((d): [string, () => AnyTemplate] => [`bill ${d}`, () => defaultBillTemplate(d, settingsOf()) as AnyTemplate]),
    ...KOT_DESIGNS.map((d): [string, () => AnyTemplate] => [`kot ${d}`, () => defaultKotTemplate(d, settingsOf()) as AnyTemplate]),
  ];
  for (const [label, make] of sets) {
    const a = make();
    const b = make();
    assert.ok(a.blocks.length > 20 || label.startsWith("kot"), "landmark: a real block list");
    const shared = a.blocks.filter((block) => b.blocks.includes(block)).map((block) => block.id);
    assert.deepEqual(shared, [], `${label}: block objects shared between two calls`);
    const snapshot = plain(make());
    a.blocks.forEach((block) => { block.on = !block.on; });
    assert.deepEqual(make(), snapshot, `${label}: the next default is unchanged by editing the first`);
  }
});

// ── the resolver re-inserts after the design's OWN neighbour ──────────────────

const withBill = (billTemplate: unknown): Settings => ({ ...settingsOf(), billTemplate });
const withKot = (kotTemplate: unknown): Settings => ({ ...settingsOf(), kotTemplate });

function readBill(template: unknown): BillTemplate {
  const r = readBillTemplate(withBill(template));
  assert.equal(r.state, "ok", "the stored bill template reads");
  return (r as { template: BillTemplate }).template;
}
function readKot(template: unknown): KotTemplate {
  const r = readKotTemplate(withKot(template));
  assert.equal(r.state, "ok", "the stored kot template reads");
  return (r as { template: KotTemplate }).template;
}

// The expected position, worked out from the design list alone: just after the nearest preceding block of the DEFAULT
// list that is not a repeatable one and that the stored list still has; index 0 when there is none.
function expectedIndex(defaults: readonly AnyBlock[], stored: readonly AnyBlock[], type: string): number {
  for (let i = defaults.findIndex((b) => b.type === type) - 1; i >= 0; i--) {
    if (REPEATABLE.includes(defaults[i].type)) continue;
    const at = stored.findIndex((b) => b.type === defaults[i].type);
    if (at !== -1) return at + 1;
  }
  return 0;
}

function expectReinserted(label: string, defaults: readonly AnyBlock[], got: readonly AnyBlock[], stored: readonly AnyBlock[], type: string): void {
  const at = expectedIndex(defaults, stored, type);
  const own = defaults.find((b) => b.type === type) as AnyBlock;
  const expected = [...stored.slice(0, at), { ...own, on: false }, ...stored.slice(at)];
  assert.deepEqual(got, expected, `${label}: ${type} is re-inserted at index ${at}, off, and nothing else moved`);
}

test("re-insert: every required block removed from a stored default (every design) comes back off, after its design neighbour", () => {
  const cases: { design: string; template: AnyTemplate; required: readonly string[]; read: (t: unknown) => AnyTemplate }[] = [
    ...BILL_DESIGNS.map((d) => ({ design: `bill ${d}`, template: defaultBillTemplate(d, settingsOf()) as AnyTemplate, required: BILL_REQUIRED_BLOCKS as readonly string[], read: readBill as (t: unknown) => AnyTemplate })),
    ...KOT_DESIGNS.map((d) => ({ design: `kot ${d}`, template: defaultKotTemplate(d, settingsOf()) as AnyTemplate, required: KOT_REQUIRED_BLOCKS as readonly string[], read: readKot as (t: unknown) => AnyTemplate })),
  ];
  let checked = 0;
  for (const { design, template, required, read } of cases) {
    for (const type of required) {
      const stored = plain(template.blocks.filter((b) => b.type !== type));
      assert.equal(stored.length, template.blocks.length - 1, `landmark: ${design} had exactly one ${type}`);
      const got = read({ ...plain(template), blocks: stored });
      expectReinserted(design, template.blocks, got.blocks, stored, type);
      checked++;
    }
    // All required removed at once: every one is back, off, once; the survivors keep order and on-state.
    const survivors = plain(template.blocks.filter((b) => !required.includes(b.type)));
    const all = read({ ...plain(template), blocks: survivors });
    for (const type of required) {
      const found = all.blocks.filter((b) => b.type === type);
      assert.equal(found.length, 1, `${design}: ${type} back exactly once`);
      assert.equal(found[0].on, false, `${design}: ${type} comes back off`);
    }
    assert.deepEqual(all.blocks.filter((b) => !required.includes(b.type)), survivors, `${design}: the other blocks are untouched`);
  }
  assert.equal(checked, BILL_DESIGNS.length * BILL_REQUIRED_BLOCKS.length + KOT_DESIGNS.length * KOT_REQUIRED_BLOCKS.length);
});

// Literal expectations, so the independent computation above is not the only thing holding the order: block -> the
// block it lands right after, per design. Express puts token BEFORE billNo and Modern puts orderId AFTER dateTime,
// which is exactly where Classic's converter order would put them differently.
const BILL_AFTER: [BillDesign, string, string][] = [
  ["modern", "title", "headerText"], ["modern", "billNo", "cancelBanner"], ["modern", "orderId", "dateTime"], ["modern", "taxes", "discount"],
  ["modern", "gstin", "phone"], ["modern", "taxIncluded", "total"], ["modern", "cancelReason", "cashier"],
  ["express", "billNo", "token"], ["express", "orderId", "dateTime"], ["express", "taxes", "discount"], ["express", "total", "loyalty"],
  ["cafe", "title", "headerText"], ["cafe", "billNo", "cancelBanner"], ["cafe", "orderId", "dateTime"], ["cafe", "taxIncluded", "total"],
  ["classic", "billNo", "cancelBanner"], ["classic", "orderId", "token"], ["classic", "title", "headerText"],
];

test("re-insert (bill): literal neighbours per design; Express / Modern / Cafe do NOT follow Classic's converter order", () => {
  for (const [design, type, after] of BILL_AFTER) {
    const full = defaultBillTemplate(design, settingsOf());
    const stored = plain(full.blocks.filter((b) => b.type !== type));
    const got = readBill({ ...plain(full), blocks: stored });
    const types = typesOf(got.blocks);
    assert.equal(types[types.indexOf(type) - 1], after, `${design}: a missing ${type} lands right after ${after}`);
    assert.equal(got.blocks[types.indexOf(type)].on, false);
  }
  // The divergence the pin exists for: Classic puts orderId after token, Modern after dateTime.
  const modern = defaultBillTemplate("modern", settingsOf());
  const classicStyle = readBill({ ...plain(modern), design: "classic", blocks: plain(modern.blocks.filter((b) => b.type !== "orderId")) });
  const t = typesOf(classicStyle.blocks);
  assert.equal(t[t.indexOf("orderId") - 1], "token", "landmark: the SAME blocks under design classic use the converter order (after token)");
});

test("re-insert (kot): Kitchen Bold's title lands after name; Classic's after name; with the name gone, after the logo", () => {
  for (const design of KOT_DESIGNS) {
    const full = defaultKotTemplate(design, settingsOf());
    const got = readKot({ ...plain(full), blocks: plain(full.blocks.filter((b) => b.type !== "title")) });
    const types = typesOf(got.blocks);
    assert.equal(types[types.indexOf("title") - 1], "name", `${design}: after name`);
    const noName = readKot({ ...plain(full), blocks: plain(full.blocks.filter((b) => b.type !== "title" && b.type !== "name")) });
    const t = typesOf(noName.blocks);
    assert.equal(t[t.indexOf("title") - 1], "logo", `${design}: with the name gone, after logo`);
  }
});

test("re-insert: Classic stored templates still follow the converter exactly (deepEqual with the required block turned off)", () => {
  const classic = defaultBillTemplate("classic", settingsOf());
  const got = readBill({ ...plain(classic), blocks: plain(classic.blocks.filter((b) => b.type !== "billNo")) });
  assert.deepEqual(got, { ...classic, blocks: classic.blocks.map((b) => (b.type === "billNo" ? { ...b, on: false } : b)) });
  const kot = defaultKotTemplate("classic", settingsOf());
  const gotKot = readKot({ ...plain(kot), blocks: plain(kot.blocks.filter((b) => b.type !== "title")) });
  assert.deepEqual(gotKot, { ...kot, blocks: kot.blocks.map((b) => (b.type === "title" ? { ...b, on: false } : b)) });
});

// ── faces ────────────────────────────────────────────────────────────────────

test("templateFaces: every design x every font key x devanagari on/off stays within the family and raster-cache budgets", () => {
  let cells = 0;
  let widest = 0;
  const all: [string, readonly PrintFontFace[]][] = [
    ...BILL_DESIGNS.map((d): [string, readonly PrintFontFace[]] => [`bill ${d}`, BILL_DESIGN_FACES[d]]),
    ...KOT_DESIGNS.map((d): [string, readonly PrintFontFace[]] => [`kot ${d}`, KOT_DESIGN_FACES[d]]),
  ];
  for (const [label, designFaces] of all) {
    for (const font of PRINT_FONT_KEYS) {
      for (const devanagari of [false, true]) {
        const faces = templateFaces({ font }, designFaces, devanagari);
        cells++;
        widest = Math.max(widest, faces.length);
        assert.ok(faces.length <= PRINT_FONT_FAMILIES_MAX, `${label} ${font} dev=${devanagari}: ${faces.length} families`);
        assert.equal(new Set(faces).size, faces.length, `${label} ${font}: no duplicate family`);
        const weights = faces.reduce((n, f) => n + PRINT_FONT_CATALOG[f].weights.length, 0);
        assert.ok(weights <= RASTER_ASSET_CACHE_MAX, `${label} ${font} dev=${devanagari}: ${weights} font files exceed the raster cache`);
        // Positive landmarks: a self-hosted font names its own face first; Devanagari joins only when asked.
        const base = printFontFaceOf(font);
        if (base !== null) assert.equal(faces[0], base, `${label} ${font}: the base face leads`);
        assert.equal(faces.includes("devanagari"), devanagari && (base !== null || designFaces.length > 0), `${label} ${font} dev=${devanagari}: devanagari presence`);
      }
    }
  }
  assert.equal(cells, (BILL_DESIGNS.length + KOT_DESIGNS.length) * PRINT_FONT_KEYS.length * 2);
  assert.ok(widest >= 3, `landmark: the matrix reaches a multi-family stack (widest ${widest})`);
});

test("templateFaces: Classic + geistMono names no self-hosted family; Cafe adds the slab heading face on top of any base", () => {
  assert.deepEqual(templateFaces({ font: "geistMono" }, BILL_DESIGN_FACES.classic, true), []);
  assert.deepEqual(BILL_DESIGN_FACES.cafe, ["slab"]);
  for (const font of PRINT_FONT_KEYS) {
    assert.ok(templateFaces({ font }, BILL_DESIGN_FACES.cafe, false).includes("slab"), `cafe + ${font} names slab`);
  }
});
