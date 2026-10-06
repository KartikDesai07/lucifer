/**
 * Print customization S2 live leg — proves DB-truth the DB-free tests cannot: that a slip template saved through
 * the settings PUT's REAL code path (updateSettingsSchema.safeParse, then Settings.findOneAndUpdate with
 * settingsUpdateOf and the route's four options) survives a real MongoDB intact (the Mixed field keeps every
 * key), that a null really $unsets (no stored null, an upsert on a fresh cluster included), that a rejected body
 * or an unrelated toggle leaves both templates alone, and that the stored-template reader (readBillTemplate)
 * falls back / re-inserts on what a raw write left behind.
 *
 *   npm run verify:print-template:live            (defaults to the local stand-in)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_print_template npm run verify:print-template:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the scratch prefix, and drops that whole
 * scratch database in `finally` (importing the models also creates their empty, indexed collections).
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";

import { connectDB } from "@/lib/db";
import { Settings } from "@/models/Settings";
import { readSettings, invalidateSettingsCache, settingsUpdateOf } from "@/lib/settings";
import { updateSettingsSchema } from "@/schemas";
import { classicBillTemplate, classicKotTemplate } from "@/lib/print-template-legacy";
import { billTemplateOf, readBillTemplate, readKotTemplate, readTokenTemplate } from "@/lib/print-template-resolve";
import { tokenFixture } from "@pos/shared/print-template-fixtures";
import type { BillTemplate, KotTemplate } from "@pos/shared/print-template";
import type { Settings as SettingsView } from "@/types";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}print_template`;
const ROUTE_PATH = path.join(process.cwd(), "app", "api", "settings", "route.ts");
// The route's exact call shape, pinned from its SOURCE so a drift fails this leg (a shortcut call proves nothing).
const ROUTE_NEEDLES = ["settingsUpdateOf(parsed.data)", "new: true", "upsert: true", "setDefaultsOnInsert: true", "runValidators: true"];

type Rec = Record<string, unknown>;
const BILL: BillTemplate = classicBillTemplate(null);
const KOT: KotTemplate = classicKotTemplate(null);

let passed = 0;
let failed = 0;

async function scenario(id: string, name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS ${id}. ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${id}. ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function reset(): Promise<void> {
  await Settings.collection.deleteMany({});
  invalidateSettingsCache();
}

// PUT /api/settings, minus auth and HTTP: the same validator, the same update document builder, the same options.
async function put(body: unknown): Promise<{ ok: true } | { ok: false; paths: string[] }> {
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) return { ok: false, paths: parsed.error.issues.map((i) => i.path.join(".")) };
  await Settings.findOneAndUpdate({}, settingsUpdateOf(parsed.data), {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
    runValidators: true,
  }).lean();
  invalidateSettingsCache();
  return { ok: true };
}
async function mustPut(body: unknown): Promise<void> {
  const r = await put(body);
  assert.ok(r.ok, `the body must pass the write gate: ${r.ok ? "" : r.paths.join(", ")}`);
}

const raw = async (): Promise<Rec> => {
  const doc = (await Settings.collection.findOne({})) as Rec | null;
  assert.ok(doc, "a Settings document exists");
  return doc;
};
// What the app reads: readSettings() (lean, cached), typed as the client-side Settings the resolver takes.
async function viaApp(): Promise<SettingsView> {
  invalidateSettingsCache();
  const doc = await readSettings();
  assert.ok(doc, "readSettings found the document");
  return doc as unknown as SettingsView;
}
const blocksOf = (t: BillTemplate | KotTemplate): Rec[] => t.blocks as unknown as Rec[];

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`);
  }
  const routeSrc = readFileSync(ROUTE_PATH, "utf8");
  for (const needle of ROUTE_NEEDLES) {
    assert.ok(routeSrc.includes(needle), `app/api/settings/route.ts no longer contains ${JSON.stringify(needle)} — this leg's call shape has drifted`);
  }

  process.env.MONGODB_URI = uri;
  await connectDB();

  try {
    await scenario("a", "a valid Classic bill template is stored whole and read back ok, deepEqual", async () => {
      await reset();
      await mustPut({ billTemplate: BILL });
      assert.deepEqual((await raw()).billTemplate, BILL, "the Mixed field kept every key");
      const read = readBillTemplate(await viaApp());
      assert.equal(read.state, "ok");
      if (read.state === "ok") assert.deepEqual(read.template, BILL);
    });

    await scenario("b", "option-carrying blocks (logoSize, customText, link qr, divider style, kot items options) round-trip with no key dropped", async () => {
      await reset();
      const bill = structuredClone(BILL) as BillTemplate;
      const bb = blocksOf(bill);
      bb[0].options = { logoSize: "large" };
      bb[bb.findIndex((b) => b.id === "divider-1")].options = { style: "double" };
      bb.push({ id: "customText-1", type: "customText", on: true, options: { text: "Thank you, come again" } });
      bb.push({ id: "qr-1", type: "qr", on: true, options: { content: "link", url: "https://example.com/menu", caption: "Scan the menu" } });
      const kot = structuredClone(KOT) as KotTemplate;
      const kb = blocksOf(kot);
      kb[kb.findIndex((b) => b.type === "items")].options = { prices: true, modifiers: false, instructions: true };
      kb.push({ id: "qr-1", type: "qr", on: true, options: { content: "link", url: "https://example.com/review" } });
      await mustPut({ billTemplate: bill, kotTemplate: kot });
      const doc = await raw();
      assert.deepEqual(doc.billTemplate, bill, "bill options intact");
      assert.deepEqual(doc.kotTemplate, kot, "kot options intact");
      const app = await viaApp();
      assert.equal(readBillTemplate(app).state, "ok");
      assert.equal(readKotTemplate(app).state, "ok");
    });

    await scenario("c", "an invalid template (missing total; unknown key) is rejected by the gate and the stored doc is unchanged", async () => {
      await reset();
      await mustPut({ billTemplate: BILL, kotTemplate: KOT });
      const before = await raw();
      const noTotal = { ...BILL, blocks: BILL.blocks.filter((b) => b.type !== "total") };
      const r1 = await put({ billTemplate: noTotal });
      const r2 = await put({ billTemplate: { ...BILL, extra: 1 } });
      assert.ok(!r1.ok && r1.paths.some((p) => p.startsWith("billTemplate.blocks")), "missing total rejected under billTemplate.blocks");
      assert.ok(!r2.ok, "an unknown key is rejected");
      assert.deepEqual(await raw(), before, "the stored document is byte-for-byte unchanged");
    });

    await scenario("d", "a PUT of only a print toggle leaves both templates untouched", async () => {
      await reset();
      await mustPut({ billTemplate: BILL, kotTemplate: KOT });
      await mustPut({ billShowLogo: true });
      const doc = await raw();
      assert.equal(doc.billShowLogo, true, "landmark: the toggle was written");
      assert.deepEqual(doc.billTemplate, BILL);
      assert.deepEqual(doc.kotTemplate, KOT);
    });

    await scenario("e", "PUT {billTemplate:null} removes the key (no stored null); kotTemplate untouched; reader says none", async () => {
      await reset();
      await mustPut({ billTemplate: BILL, kotTemplate: KOT });
      await mustPut({ billTemplate: null });
      assert.equal(await Settings.collection.countDocuments({ billTemplate: { $exists: false } }), 1, "the key is ABSENT, not null");
      assert.equal(await Settings.collection.countDocuments({ billTemplate: null }), 1, "landmark: the {x:null} query also matches an absent key, so $exists above is the real check");
      assert.deepEqual((await raw()).kotTemplate, KOT);
      const app = await viaApp();
      assert.deepEqual(readBillTemplate(app), { state: "none" });
      assert.equal(readKotTemplate(app).state, "ok");
    });

    await scenario("f", "PUT {billTemplate:<valid>, kotTemplate:null} in one body sets the bill and unsets the kot", async () => {
      await reset();
      await mustPut({ billTemplate: BILL, kotTemplate: KOT });
      const next: BillTemplate = { ...BILL, size: "large" };
      await mustPut({ billTemplate: next, kotTemplate: null });
      const doc = await raw();
      assert.deepEqual(doc.billTemplate, next);
      assert.ok(!("kotTemplate" in doc), "kotTemplate key is gone");
    });

    await scenario("g", "a raw write of an unreadable bill template (unknown block type) reads unreadable, billTemplateOf null", async () => {
      await reset();
      await mustPut({ restaurantName: "Scratch Cafe" });
      const bad = { ...BILL, blocks: [...BILL.blocks, { id: "hologram", type: "hologram", on: true }] };
      await Settings.collection.updateOne({}, { $set: { billTemplate: bad } });
      const app = await viaApp();
      assert.deepEqual(readBillTemplate(app), { state: "unreadable" });
      assert.equal(billTemplateOf(app), null);
    });

    await scenario("h", "a raw write of Classic minus gstin + billNo is read back with both re-inserted OFF at their converter positions", async () => {
      await reset();
      await mustPut({ restaurantName: "Scratch Cafe" });
      const stripped = { ...BILL, blocks: BILL.blocks.filter((b) => b.type !== "gstin" && b.type !== "billNo") };
      await Settings.collection.updateOne({}, { $set: { billTemplate: stripped } });
      const app = await viaApp();
      const read = readBillTemplate(app);
      assert.equal(read.state, "ok");
      if (read.state !== "ok") return;
      const expected = classicBillTemplate(app);
      expected.blocks = expected.blocks.map((b) => (b.type === "gstin" || b.type === "billNo" ? { ...b, on: false } : b));
      assert.deepEqual(read.template.blocks.map((b) => b.type), BILL.blocks.map((b) => b.type), "converter positions");
      assert.deepEqual(read.template.blocks.filter((b) => !b.on).map((b) => b.type).sort(), expected.blocks.filter((b) => !b.on).map((b) => b.type).sort());
      assert.equal(read.template.blocks.find((b) => b.type === "gstin")?.on, false);
      assert.equal(read.template.blocks.find((b) => b.type === "billNo")?.on, false);
    });

    await scenario("i", "PUT {billTemplate:null} on a cluster with NO settings document upserts one without the key and without error", async () => {
      await Settings.collection.drop().catch(() => undefined);
      invalidateSettingsCache();
      assert.equal(await Settings.collection.countDocuments({}), 0, "landmark: a fresh, empty collection");
      await mustPut({ billTemplate: null });
      assert.equal(await Settings.collection.countDocuments({}), 1, "the upsert created the singleton");
      assert.equal(await Settings.collection.countDocuments({ billTemplate: { $exists: false } }), 1, "and it carries no billTemplate key");
      assert.deepEqual(readBillTemplate(await viaApp()), { state: "none" });
    });

    // Print customization S7: tokenTemplate is the third PUT-only slip template (same gate, same $unset on null).
    const TOKEN = tokenFixture() as unknown as Rec;

    await scenario("j", "a valid token template is stored whole (every key kept) and read back ok, deepEqual", async () => {
      await reset();
      await mustPut({ billTemplate: BILL, kotTemplate: KOT, tokenTemplate: TOKEN });
      const doc = await raw();
      assert.deepEqual(doc.tokenTemplate, TOKEN, "the Mixed field kept every key");
      const read = readTokenTemplate(await viaApp());
      assert.equal(read.state, "ok");
      if (read.state === "ok") assert.deepEqual(read.template, TOKEN);
      assert.deepEqual(doc.billTemplate, BILL, "landmark: the other two templates saved beside it");
    });

    await scenario("k", "an invalid token template (no tokenNo; classic design; unknown key) is rejected by the gate and NOTHING is stored", async () => {
      await reset();
      await mustPut({ restaurantName: "Scratch Cafe" });
      const before = await raw();
      const blocks = TOKEN.blocks as Rec[];
      const r1 = await put({ tokenTemplate: { ...TOKEN, blocks: blocks.filter((b) => b.type !== "tokenNo") } });
      const r2 = await put({ tokenTemplate: { ...TOKEN, design: "classic" } });
      const r3 = await put({ tokenTemplate: { ...TOKEN, extra: 1 } });
      assert.ok(!r1.ok && r1.paths.some((p) => p.startsWith("tokenTemplate.blocks")), "missing tokenNo rejected under tokenTemplate.blocks");
      assert.ok(!r2.ok && r2.paths.includes("tokenTemplate.design"), "a classic token design is rejected");
      assert.ok(!r3.ok, "an unknown key is rejected");
      const after = await raw();
      assert.ok(!("tokenTemplate" in after), "no tokenTemplate key was written");
      assert.deepEqual(after, before, "the stored document is byte-for-byte unchanged");
    });

    await scenario("l", "PUT {tokenTemplate:null} removes the key (no stored null); the bill and kot templates are untouched; reader says none", async () => {
      await reset();
      await mustPut({ billTemplate: BILL, kotTemplate: KOT, tokenTemplate: TOKEN });
      await mustPut({ tokenTemplate: null });
      assert.equal(await Settings.collection.countDocuments({ tokenTemplate: { $exists: false } }), 1, "the key is ABSENT, not null");
      assert.equal(await Settings.collection.countDocuments({ tokenTemplate: { $exists: true } }), 0, "landmark: nothing carries the key (null included)");
      const doc = await raw();
      assert.deepEqual(doc.billTemplate, BILL);
      assert.deepEqual(doc.kotTemplate, KOT);
      assert.deepEqual(readTokenTemplate(await viaApp()), { state: "none" });
    });

    await scenario("m", "an unrelated toggle PUT leaves a stored tokenTemplate untouched; {tokenTemplate:null} on a cluster with NO settings document upserts one without the key", async () => {
      await reset();
      await mustPut({ tokenTemplate: TOKEN });
      await mustPut({ tokenEnabled: true });
      const doc = await raw();
      assert.equal(doc.tokenEnabled, true, "landmark: the toggle was written");
      assert.deepEqual(doc.tokenTemplate, TOKEN);
      await Settings.collection.drop().catch(() => undefined);
      invalidateSettingsCache();
      assert.equal(await Settings.collection.countDocuments({}), 0, "landmark: a fresh, empty collection");
      await mustPut({ tokenTemplate: null });
      assert.equal(await Settings.collection.countDocuments({}), 1, "the upsert created the singleton");
      assert.equal(await Settings.collection.countDocuments({ tokenTemplate: { $exists: false } }), 1, "and it carries no tokenTemplate key");
    });
  } finally {
    // The name was checked against SCRATCH_PREFIX above; re-checked on the live connection before the drop.
    if (mongoose.connection.name.startsWith(SCRATCH_PREFIX)) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
