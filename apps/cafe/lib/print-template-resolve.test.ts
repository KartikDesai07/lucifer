import { settingsOf } from "./print-template-golden.fixtures"; // FIRST (selects React's production renderer; harmless here)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  BILL_REQUIRED_BLOCKS,
  KOT_REQUIRED_BLOCKS,
  type BillTemplate,
  type KotTemplate,
} from "@pos/shared/print-template";
import {
  PRINT_TEMPLATE_READ_LIMITS,
  billTemplateSchema,
  kotTemplateSchema,
} from "@pos/shared/schemas/print-template.schema";
import {
  billTemplateOf,
  kotTemplateOf,
  readBillTemplate,
  readKotTemplate,
} from "@/lib/print-template-resolve";
import { classicBillTemplate, classicKotTemplate } from "@/lib/print-template-legacy";
import type { Settings } from "@/types";

// Print customization S2: the stored-template reader. Settings holds the template as Mixed, so this resolver (READ
// schema, never throws) is the only gate between a stored document and the printed slip. (settingsUpdateOf, the
// PUT-side update document is pinned in print-template-settings-update.test.ts.)

type Rec = Record<string, unknown>;
const withBill = (billTemplate: unknown): Settings => ({ ...settingsOf(), billTemplate });
const withKot = (kotTemplate: unknown): Settings => ({ ...settingsOf(), kotTemplate });
const plainClone = <T>(v: T): T => structuredClone(v);

const VARIANTS: { id: string; settings: Settings }[] = [
  { id: "defaults", settings: settingsOf() },
  { id: "flags-off", settings: settingsOf({ billShowLogo: false, billShowAddress: false, billShowMobile: false, billShowGstNumber: false, billShowFssai: false, billShowNumber: false, kotShowPrices: false, kotShowTotal: false, kotShowTable: false, kotShowTime: false, kotShowStaff: false, kotShowNotes: false, kotShowLogo: false, kotShowRestaurantName: false }) },
  { id: "flags-on", settings: settingsOf({ billShowLogo: true, billLogoSize: "large", billShowGstNumber: true, billShowNumber: true, billFontSize: "large", kotShowPrices: true, kotShowTotal: true, kotShowLogo: true, kotFontSize: "small" }) },
  { id: "gst-on", settings: settingsOf({ gstEnabled: true, gstRate: 5, gstMode: "exclusive" }) },
];

// ── none ─────────────────────────────────────────────────────────────────────

test("none: null / undefined settings, {} and a null template all read as none (legacy slip)", () => {
  const nothing: (Settings | null | undefined)[] = [null, undefined, {} as Settings, withBill(null), withKot(null), withBill(undefined)];
  for (const s of nothing) {
    assert.deepEqual(readBillTemplate(s), { state: "none" });
    assert.deepEqual(readKotTemplate(s), { state: "none" });
    assert.equal(billTemplateOf(s), null);
    assert.equal(kotTemplateOf(s), null);
  }
  // Landmark: the same Settings WITH a template reads ok, so "none" above is not a resolver that always says none.
  assert.equal(readBillTemplate(withBill(classicBillTemplate(settingsOf()))).state, "ok");
});

test("none: one kind's template never leaks into the other kind", () => {
  const s: Settings = { ...settingsOf(), billTemplate: classicBillTemplate(settingsOf()) };
  assert.equal(readBillTemplate(s).state, "ok");
  assert.equal(readKotTemplate(s).state, "none");
  assert.equal(kotTemplateOf(s), null);
});

// ── ok ───────────────────────────────────────────────────────────────────────

test("ok: a stored Classic bill + kot template (4 settings variants) reads back deepEqual to what was stored", () => {
  for (const v of VARIANTS) {
    const bill = classicBillTemplate(v.settings);
    const kot = classicKotTemplate(v.settings);
    const rb = readBillTemplate({ ...v.settings, billTemplate: plainClone(bill) });
    const rk = readKotTemplate({ ...v.settings, kotTemplate: plainClone(kot) });
    assert.equal(rb.state, "ok", `bill ${v.id}`);
    assert.equal(rk.state, "ok", `kot ${v.id}`);
    if (rb.state === "ok") assert.deepEqual(rb.template, bill, `bill ${v.id}`);
    if (rk.state === "ok") assert.deepEqual(rk.template, kot, `kot ${v.id}`);
  }
});

// ── unreadable ───────────────────────────────────────────────────────────────

function tweakBill(fn: (t: Rec) => void): Rec {
  const t = plainClone(classicBillTemplate(settingsOf())) as unknown as Rec;
  fn(t);
  return t;
}
function tweakKot(fn: (t: Rec) => void): Rec {
  const t = plainClone(classicKotTemplate(settingsOf())) as unknown as Rec;
  fn(t);
  return t;
}
const blocksOf = (t: Rec): Rec[] => t.blocks as Rec[];
const manyDividers = (n: number): Rec[] => Array.from({ length: n }, (_, i) => ({ id: `divider-${i + 1}`, type: "divider", on: true }));

test("unreadable (bill): garbage and every strict-shape violation falls back (state unreadable, billTemplateOf null)", () => {
  const bad: [string, unknown][] = [
    ["string", "classic"],
    ["number", 7],
    ["boolean", true],
    ["array", [classicBillTemplate(settingsOf())]],
    ["empty object", {}],
    ["v:2", tweakBill((t) => { t.v = 2; })],
    ["unknown top-level key", tweakBill((t) => { t.extra = 1; })],
    ["unknown design", tweakBill((t) => { t.design = "neon"; })],
    ["unknown block type", tweakBill((t) => { blocksOf(t)[1] = { id: "name", type: "hologram", on: true }; })],
    ["unknown key inside a block", tweakBill((t) => { blocksOf(t)[1].color = "red"; })],
    ["duplicate id", tweakBill((t) => { blocksOf(t)[2] = { ...blocksOf(t)[1] }; })],
    ["malformed id (name-2)", tweakBill((t) => { blocksOf(t)[1].id = "name-2"; })],
    ["malformed repeatable id (divider-x)", tweakBill((t) => { blocksOf(t)[8].id = "divider-x"; })],
    ["65 blocks (over the READ ceiling)", tweakBill((t) => { t.blocks = manyDividers(PRINT_TEMPLATE_READ_LIMITS.blocks + 1); })],
  ];
  for (const [label, raw] of bad) {
    assert.deepEqual(readBillTemplate(withBill(raw)), { state: "unreadable" }, label);
    assert.equal(billTemplateOf(withBill(raw)), null, label);
  }
  // Vision guard: exactly at the ceiling still reads (so the 65-block case fails for the count, not for a bad id).
  assert.equal(PRINT_TEMPLATE_READ_LIMITS.blocks, 64);
  assert.equal(readBillTemplate(withBill(tweakBill((t) => { t.blocks = manyDividers(64); }))).state, "ok");
});

test("unreadable (kot): the same strict-shape violations fall back", () => {
  const bad: [string, unknown][] = [
    ["array", []],
    ["v:0", tweakKot((t) => { t.v = 0; })],
    ["unknown top-level key", tweakKot((t) => { t.extra = 1; })],
    ["bill-only block type on a kot", tweakKot((t) => { blocksOf(t)[1] = { id: "gstin", type: "gstin", on: true }; })],
    ["unknown key inside a block", tweakKot((t) => { blocksOf(t)[1].color = "red"; })],
    ["duplicate id", tweakKot((t) => { blocksOf(t)[2] = { ...blocksOf(t)[1] }; })],
    ["items options missing a key", tweakKot((t) => { blocksOf(t)[blocksOf(t).findIndex((b) => b.type === "items")].options = { prices: true }; })],
    ["65 blocks", tweakKot((t) => { t.blocks = manyDividers(65); })],
  ];
  for (const [label, raw] of bad) {
    assert.deepEqual(readKotTemplate(withKot(raw)), { state: "unreadable" }, label);
    assert.equal(kotTemplateOf(withKot(raw)), null, label);
  }
  assert.equal(readKotTemplate(withKot(classicKotTemplate(settingsOf()))).state, "ok", "landmark: the unmodified template reads");
});

// ── READ is wider than WRITE ─────────────────────────────────────────────────

test("READ != WRITE: a template the write gate rejects but the read schema accepts still reads ok", () => {
  const classic = classicBillTemplate(settingsOf());
  const noTotal = { ...classic, blocks: classic.blocks.filter((b) => b.type !== "total") };
  const httpQr = { ...classic, blocks: [...classic.blocks, { id: "qr-1", type: "qr", on: true, options: { content: "link", url: "http://example.com/menu" } }] };
  const emptyText = { ...classic, blocks: [...classic.blocks, { id: "customText-1", type: "customText", on: true, options: { text: "" } }] };
  for (const [label, raw] of [["no total", noTotal], ["http link QR", httpQr], ["empty customText", emptyText]] as const) {
    assert.equal(billTemplateSchema.safeParse(raw).success, false, `${label}: the WRITE gate rejects it`);
    assert.equal(readBillTemplate(withBill(raw)).state, "ok", `${label}: the READ schema accepts it`);
  }
  const kot = classicKotTemplate(settingsOf());
  const kotNoTitle = { ...kot, blocks: kot.blocks.filter((b) => b.type !== "title") };
  assert.equal(kotTemplateSchema.safeParse(kotNoTitle).success, false, "kot without title: WRITE rejects");
  assert.equal(readKotTemplate(withKot(kotNoTitle)).state, "ok", "kot without title: READ accepts");
  // Landmark: the unmodified templates pass BOTH schemas, so the rejections above are about the edits.
  assert.equal(billTemplateSchema.safeParse(classic).success, true);
  assert.equal(kotTemplateSchema.safeParse(kot).success, true);
});

// ── re-insert of missing required blocks ─────────────────────────────────────

const offOf = <B extends { type: string; on: boolean }>(blocks: B[], ...types: string[]): B[] =>
  blocks.map((b) => (types.includes(b.type) ? { ...b, on: false } : b));
const without = <B extends { type: string }>(blocks: B[], ...types: string[]): B[] => blocks.filter((b) => !types.includes(b.type));
const typesOf = (blocks: { type: string }[]): string[] => blocks.map((b) => b.type);

function readBill(template: unknown): BillTemplate {
  const r = readBillTemplate(withBill(template));
  assert.equal(r.state, "ok");
  return (r as { template: BillTemplate }).template;
}
function readKot(template: unknown): KotTemplate {
  const r = readKotTemplate(withKot(template));
  assert.equal(r.state, "ok");
  return (r as { template: KotTemplate }).template;
}

test("re-insert (bill): a missing billNo comes back right after cancelBanner, off", () => {
  const classic = classicBillTemplate(settingsOf());
  const got = readBill({ ...classic, blocks: without(classic.blocks, "billNo") });
  const at = typesOf(got.blocks).indexOf("billNo");
  assert.equal(got.blocks[at - 1].type, "cancelBanner");
  assert.equal(got.blocks[at].on, false);
  assert.deepEqual(got, { ...classic, blocks: offOf(classic.blocks, "billNo") });
});

test("re-insert (bill): billNo + orderId missing -> billNo after cancelBanner, orderId after token; equals Classic with both off", () => {
  const classic = classicBillTemplate(settingsOf());
  const got = readBill({ ...classic, blocks: without(classic.blocks, "billNo", "orderId") });
  const t = typesOf(got.blocks);
  assert.equal(t[t.indexOf("billNo") - 1], "cancelBanner");
  assert.equal(t[t.indexOf("orderId") - 1], "token");
  assert.deepEqual(got, { ...classic, blocks: offOf(classic.blocks, "billNo", "orderId") });
});

test("re-insert (bill): a minimal [items, total] template gets every required block back, off, in converter order", () => {
  const classic = classicBillTemplate(settingsOf());
  const items = classic.blocks.find((b) => b.type === "items");
  const total = classic.blocks.find((b) => b.type === "total");
  assert.ok(items && total, "landmark: the converter has items and total");
  const got = readBill({ ...classic, blocks: [items, total] });
  assert.deepEqual(typesOf(got.blocks), [
    "name", "address", "gstin", "fssai", "title", "cancelBanner", "billNo", "orderId", "dateTime", "cancelReason",
    "items", "taxes", "total", "taxIncluded",
  ]);
  assert.equal(got.blocks[0].type, "name", "no preceding neighbour present -> index 0");
  for (const b of got.blocks) assert.equal(b.on, b.type === "items" || b.type === "total", `${b.type} on-state`);
  for (const type of BILL_REQUIRED_BLOCKS) assert.ok(typesOf(got.blocks).includes(type), `required ${type} is present`);
});

test("re-insert (bill): a repeatable divider is never the neighbour (items goes after cancelReason, not after divider-2)", () => {
  const classic = classicBillTemplate(settingsOf());
  const divider2 = classic.blocks.find((b) => b.id === "divider-2");
  assert.ok(divider2, "landmark: divider-2 exists");
  const rest = without(classic.blocks, "items").filter((b) => b.id !== "divider-2");
  const got = readBill({ ...classic, blocks: [divider2, ...rest] });
  assert.equal(got.blocks[0].id, "divider-2", "landmark: divider-2 stayed at the start");
  const t = typesOf(got.blocks);
  assert.equal(t[t.indexOf("items") - 1], "cancelReason");
  assert.equal(got.blocks[t.indexOf("items")].on, false);
});

test("re-insert (kot): title after name; with name absent after logo; with both absent at index 0", () => {
  const classic = classicKotTemplate(settingsOf());
  const a = readKot({ ...classic, blocks: without(classic.blocks, "title") });
  assert.deepEqual(a, { ...classic, blocks: offOf(classic.blocks, "title") });
  assert.equal(a.blocks[typesOf(a.blocks).indexOf("title") - 1].type, "name");

  const b = readKot({ ...classic, blocks: without(classic.blocks, "title", "name") });
  assert.equal(b.blocks[typesOf(b.blocks).indexOf("title") - 1].type, "logo");
  assert.ok(!typesOf(b.blocks).includes("name"), "name (not required) is not resurrected");

  const c = readKot({ ...classic, blocks: without(classic.blocks, "title", "name", "logo") });
  assert.equal(c.blocks[0].type, "title");
  assert.equal(c.blocks[0].on, false);
});

test("re-insert: the input is never mutated, and reading the result again yields the same template (idempotent)", () => {
  const classic = classicBillTemplate(settingsOf());
  const raw = { ...classic, blocks: without(classic.blocks, "billNo", "gstin") };
  const before = plainClone(raw);
  const once = readBill(raw);
  assert.deepEqual(raw, before, "bill input untouched");
  assert.deepEqual(readBill(once), once, "bill idempotent");

  const kot = classicKotTemplate(settingsOf());
  const rawKot = { ...kot, blocks: without(kot.blocks, "title") };
  const beforeKot = plainClone(rawKot);
  const onceKot = readKot(rawKot);
  assert.deepEqual(rawKot, beforeKot, "kot input untouched");
  assert.deepEqual(readKot(onceKot), onceKot, "kot idempotent");
});

test("re-insert: nothing missing returns the template's own block order and ons untouched", () => {
  const classic = classicBillTemplate(settingsOf({ billShowLogo: false, billShowFssai: false }));
  const reordered = { ...classic, blocks: [...classic.blocks.slice(-2), ...classic.blocks.slice(0, -2)] };
  assert.deepEqual(readBill(reordered), reordered);
});

// ── pins ─────────────────────────────────────────────────────────────────────

test("PIN: the converters carry every required type (the resolver can only re-insert what the converter has)", () => {
  const bill = typesOf(classicBillTemplate(null).blocks);
  const kot = typesOf(classicKotTemplate(null).blocks);
  assert.ok(BILL_REQUIRED_BLOCKS.length > 0 && KOT_REQUIRED_BLOCKS.length > 0, "landmark: the required lists are non-empty");
  for (const type of BILL_REQUIRED_BLOCKS) assert.ok(bill.includes(type), `bill converter lacks ${type}`);
  for (const type of KOT_REQUIRED_BLOCKS) assert.ok(kot.includes(type), `kot converter lacks ${type}`);
});

const readSrc = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8").replace(/\r\n/g, "\n");

test("PIN (source): OrderReceipt's body opens with exactly the template dispatch", () => {
  const src = readSrc("components/pos/OrderReceipt.tsx");
  const sig = "export function OrderReceipt({ order, settings, banner, ref }: OrderReceiptProps) {\n";
  const at = src.indexOf(sig);
  assert.ok(at >= 0, "landmark: the OrderReceipt signature");
  const body = src.slice(at + sig.length);
  const dispatch =
    /^(?: {2}\/\/[^\n]*\n)+ {2}const template = billTemplateOf\(settings\);\n {2}const view = useSlipView\(template\);\n {2}if \(template && view === "slip"\) return <BillSlip order=\{order\} settings=\{settings\} banner=\{banner\} template=\{template\} ref=\{ref\} \/>;\n {2}if \(view === "skeleton"\) return <SlipSkeleton paperWidth=\{printConfigOf\(settings\)\.bill\.paperWidth\} ref=\{ref\} \/>;\n/;
  assert.match(
    body,
    dispatch,
    "OrderReceipt must start with comment + billTemplateOf + useSlipView + the slip BillSlip return + the preview bill-width SlipSkeleton return",
  );
});

test("PIN (source): KOTReceipt forwards EVERY destructured prop to <KotSlip>, and the destructure covers every KOTReceiptProps field", () => {
  const src = readSrc("components/pos/KOTReceipt.tsx");
  const sig = src.match(/export function KOTReceipt\(\{([\s\S]*?)\}: KOTReceiptProps\)/);
  assert.ok(sig, "landmark: the KOTReceipt signature");
  const destructured = sig[1].split(",").map((s) => s.trim().split(/\s*=\s*/)[0]).filter(Boolean);
  const iface = src.match(/interface KOTReceiptProps \{([\s\S]*?)\n\}/);
  assert.ok(iface, "landmark: the KOTReceiptProps interface");
  const fields = [...iface[1].replace(/\/\/.*$/gm, "").matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]);
  assert.ok(fields.length >= 14, `landmark: harvested ${fields.length} interface fields`);
  assert.deepEqual([...destructured].sort(), [...fields].sort(), "every KOTReceiptProps field is destructured, and nothing else");

  const jsx = src.match(/<KotSlip\n([\s\S]*?)\/>/);
  assert.ok(jsx, "landmark: the <KotSlip ... /> element");
  for (const name of destructured) assert.ok(jsx[1].includes(`${name}={${name}}`), `<KotSlip> must receive ${name}={${name}}`);
  assert.ok(jsx[1].includes("template={template}"), "<KotSlip> receives template={template}");
  const kotDispatch =
    /\n {2}const template = kotTemplateOf\(settings\);\n {2}const view = useSlipView\(template\);\n {2}if \(view === "skeleton"\) return <SlipSkeleton paperWidth=\{printConfigOf\(settings\)\.kot\.paperWidth\} ref=\{ref\} \/>;\n {2}if \(template && view === "slip"\) \{\n {4}return \(\n {6}<KotSlip\n/;
  assert.match(src, kotDispatch, "landmark: the dispatch (template, useSlipView, preview kot-width skeleton, then the slip KotSlip)");
});
