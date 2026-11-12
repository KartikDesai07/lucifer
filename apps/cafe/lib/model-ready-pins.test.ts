import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { stripComments } from "./source-pin-utils";

// GATE for the model-init-race hotfix: every "unique index before the write" site goes through modelReady()
// (lib/db.ts), nothing else builds indexes by hand, and no schema uses an option modelReady's fallback ignores.

const CAFE = path.resolve(__dirname, "..");

function sourcesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(path.join(CAFE, dir), { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
    out.push(path.relative(CAFE, path.join(entry.parentPath, entry.name)).split(path.sep).join("/"));
  }
  return out.sort();
}

function code(rel: string): string {
  return stripComments(fs.readFileSync(path.join(CAFE, rel), "utf8"));
}

const ALL = [...sourcesUnder("app"), ...sourcesUnder("lib"), ...sourcesUnder("models")];

test("(a) no source calls .init(), uses .$init, ensureIndexes( or syncIndexes( except modelReady's own model.init()", () => {
  const offenders: string[] = [];
  for (const rel of ALL) {
    const src = code(rel);
    const inits = src.match(/\.init\s*\(/g) ?? [];
    if (rel === "lib/db.ts") {
      assert.equal(inits.length, 1, "lib/db.ts must have exactly one .init( (inside createModelReady)");
      assert.ok(/\bmodel\.init\s*\(/.test(src), "lib/db.ts's one .init( must be model.init()");
    } else if (inits.length > 0) {
      offenders.push(`${rel} (.init)`);
    }
    if (/\.\$init\b/.test(src)) offenders.push(`${rel} (.$init)`);
    if (/\bensureIndexes\s*\(/.test(src)) offenders.push(`${rel} (ensureIndexes)`);
    if (/\bsyncIndexes\s*\(/.test(src)) offenders.push(`${rel} (syncIndexes)`);
  }
  assert.deepEqual(offenders, [], `these files build indexes by hand instead of modelReady(): ${offenders.join(", ")}`);
});

test("(b) no schema sets autoIndex, autoCreate or autoSearchIndex (modelReady's fallback ignores them)", () => {
  const models = sourcesUnder("models");
  assert.ok(models.length > 20, "the models folder was found");
  const offenders = models.filter((rel) => /\bauto(?:Index|Create|SearchIndex)\b/.test(code(rel)));
  assert.deepEqual(offenders, [], `schemas using an option the fallback ignores: ${offenders.join(", ")}`);
});

// file, enclosing function start, model, the write that must follow, whether that function opens the connection itself.
const SITES: Array<[string, string, string, string, boolean]> = [
  ["lib/crud-route.ts", "async function POST(req: Request)", "config.model", "config.model.create(", true],
  ["app/api/areas/route.ts", "export async function POST(", "Area", "Area.countDocuments(", true],
  ["app/api/areas/[id]/route.ts", "export async function PUT(", "Area", "Area.findOneAndUpdate(", true],
  ["app/api/expense-categories/route.ts", "export async function POST(", "ExpenseCategory", "ExpenseCategory.countDocuments(", true],
  ["app/api/expense-categories/[id]/route.ts", "export async function PATCH(", "ExpenseCategory", "ExpenseCategory.findOneAndUpdate(", true],
  ["lib/expenses/categories.ts", "export async function ensureExpenseCategories(", "ExpenseCategory", "ExpenseCategory.countDocuments(", true],
  ["lib/expenses/entries-write.ts", "export async function createExpense(", "ExpenseEntry", "ExpenseEntry.findOne(", true],
  ["lib/due-payment.ts", "export async function receiveDuePayment(", "DuePayment", "Customer.findOneAndUpdate(", true],
  ["lib/order-request-accept-promo.ts", "export async function claimPromoRedemption(", "PromoRedemption", "PromoRedemption.create(", false],
  ["lib/print-device.ts", "export async function beatPrintDevice(", "PrintDevice", "PrintDevice.updateOne(", false],
  ["lib/print-stations.ts", "export async function seedDefaultStation(", "Station", "Station.updateOne(", false],
  ["lib/print-printers.ts", "export async function createPrinter(", "Printer", "Printer.create(", false],
  // Inventory lite Slice 3: the one-tap own-stock upsert (its connect runs first, in trackOwnStock).
  ["lib/inventory/stock-use-write.ts", "upsertItem: async (filter, update) => {", "StockItem", "StockItem.findOneAndUpdate(", false],
  // Inventory lite Slice 4: the entry insert (unique clientRef index) inside the entries-write default ports.
  ["lib/inventory/entries-write.ts", "insert: async (doc) => {", "StockEntry", "StockEntry.create(", false],
];

test("(c) each of the 14 sites awaits modelReady(<its model>) exactly once: after its own connectDB(), before its write", () => {
  assert.equal(SITES.length, 14, "the table lists the 14 sites");
  for (const [rel, start, model, write, connects] of SITES) {
    const src = code(rel);
    const call = `await modelReady(${model});`;
    assert.equal(src.split(call).length - 1, 1, `${rel} awaits ${call} exactly once`);
    assert.equal(src.split(start).length - 1, 1, `${rel}: the enclosing function start "${start}" occurs exactly once`);
    const startAt = src.indexOf(start);
    const callAt = src.indexOf(call, startAt);
    const writeAt = src.indexOf(write, startAt);
    assert.ok(callAt > startAt, `${rel}: ${call} is inside the function that starts at "${start}"`);
    assert.ok(writeAt > callAt, `${rel}: ${write} follows ${call} inside that function`);
    if (connects) {
      const connectAt = src.indexOf("connectDB()", startAt);
      assert.ok(connectAt > startAt, `${rel}: the function calls connectDB() itself`);
      assert.ok(connectAt < callAt, `${rel}: its connectDB() runs before ${call}`);
    }
    assert.ok(/import \{[^}]*\bmodelReady\b[^}]*\} from "@\/lib\/db";/.test(src), `${rel} imports modelReady from @/lib/db`);
  }
});
