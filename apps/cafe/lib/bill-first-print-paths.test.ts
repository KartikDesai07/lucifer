import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { Order as OrderModel } from "@/models/Order";
import { stripComments } from "@/lib/source-pin-utils";
import { addItemsSchema, createOrderSchema, settleOrderSchema, updateOrderSchema } from "@pos/shared/schemas/order.schema";

// Print customization S3b (A4 + A5): the source pins for the writers of the first-print stamp (split out of
// bill-first-print.test.ts, which holds the behaviour legs). Each pin pairs its absence asserts with a positive landmark.

const FORGED = "2099-01-01T00:00:00.000Z";

// ── source pins: the three writers ───────────────────────────────────────────

const readSrc = (rel: string): string => stripComments(readFileSync(path.join(process.cwd(), rel), "utf8")).replace(/\s+/g, " ");
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

test("bill-first-print.ts: the real CAS $set writes the stamp AND the total it read, through the one filter", () => {
  const src = readSrc("lib/bill-first-print.ts");
  assert.ok(src.includes("{ $set: { billFirstPrintedAt: at, billFirstPrintedTotal: seen.total } }"));
  assert.ok(src.includes("firstBillPrintFilter(id, seen),"), "the CAS uses the shared filter");
  assert.ok(src.includes("export function firstBillPrintFilter("), "landmark: the filter lives here");
  assert.equal(count(src, "findOneAndUpdate("), 1, "one writer in the file");
  // The enqueue stamps for the total ON THE SLIP, so a stale view neither starts nor moves a window.
  assert.ok(src.includes("stampFirstBillPrint(snapshot._id, nowMs, deps, snapshot.total)"));
  assert.ok(src.includes("printedTotal?: number"), "landmark: the parameter exists");
});

test("print-jobs route: connectDB, then billPayloadWithFirstPrint, then the enqueue; the stamped payload feeds BOTH enqueues", () => {
  const src = readSrc("app/api/print-jobs/route.ts");
  const connect = src.indexOf("await connectDB()");
  const stamp = src.indexOf("const payload = await billPayloadWithFirstPrint(parsed.data.payload, nowMs)");
  const enqueue = src.indexOf("await enqueuePrintJob({");
  assert.ok(connect > 0 && stamp > 0 && enqueue > 0, "landmarks: all three are in the source");
  assert.ok(connect < stamp && stamp < enqueue, `order: connectDB ${connect} < stamp ${stamp} < enqueue ${enqueue}`);
  assert.ok(src.includes('import { billPayloadWithFirstPrint } from "@/lib/bill-first-print"'));
  assert.ok(src.includes("enqueuePrintJob({ payload, label: parsed.data.label"), "the first enqueue carries the stamped payload");
  assert.ok(src.includes("enqueueOwnPrintJob({ payload, label: parsed.data.label"), "the agent-tab enqueue carries it too");
  assert.equal(count(src, "payload: parsed.data.payload"), 0, "neither enqueue takes the raw client payload");
});

test("settle route: the stamp is gated on a bill intent AND a stale stamp; `answer` feeds both the print jobs and the response", () => {
  const src = readSrc("app/api/orders/[id]/settle/route.ts");
  assert.ok(src.includes("const stamping = intent?.bill === true && !billFirstPrintFresh(updated);"));
  assert.ok(src.includes('import { billFirstPrintFresh, stampFirstBillPrint, withFirstBillPrint } from "@/lib/bill-first-print"'));
  assert.equal(count(src, "billFirstPrintedAt === undefined"), 0, "the old 'never stamped' gate is gone: a changed total re-stamps");
  assert.ok(src.includes("stamping ? stampFirstBillPrint(id, Date.now()) : Promise.resolve(null)"), "the stamp is the third allSettled entry");
  // A failed restamp must drop the stale stored stamp (withFirstBillPrint(null)), and an order that did not try keeps its own.
  assert.ok(src.includes("const base = numbered.value ?? updated;"));
  assert.ok(src.includes("const answer = stamping ? withFirstBillPrint(base, stamped.status === \"fulfilled\" ? stamped.value : null) : base;"));
  assert.equal(count(src, "withFirstBillPrint("), 1, "one call, only for a caller that tried to stamp");
  assert.ok(src.includes("createOrderPrintJobs({ order: answer,"), "the bill job is made from the stamped order");
  assert.ok(src.includes("return success(withPrintJobs(answer, printJobs));"), "and so is the answer");
  assert.equal(count(src, "stampFirstBillPrint("), 1, "one call site, the gated one");
  assert.equal(count(src, "order: updated"), 0, "no print job is made from the unstamped order");
});

test("orders route: printsBillNow is the Pay Now bill condition and feeds BOTH the insert stamp (with the total) and the bill job", () => {
  const src = readSrc("app/api/orders/route.ts");
  assert.ok(src.includes('const printsBillNow = intent?.bill === true && data.status === "Completed";'));
  assert.ok(src.includes("...firstBillPrintInsertFields(printsBillNow, Date.now(), totals.total)"), "the insert carries the stamp and the total it prices");
  assert.ok(src.includes('slips: [...openingSlipsOf(numbered.value ?? landed, 1), ...(printsBillNow ? [{ kind: "bill" as const }] : [])]'), "the opening slips (S7: KOT, then the token) come first and the bill job uses the same const");
  assert.equal(count(src, "printsBillNow"), 3, "declared once, used by the insert and the job - no third derivation");
  assert.equal(count(src, "intent?.bill"), 1, "the bill condition is derived in one place only");
  assert.ok(src.includes("total: totals.total,"), "landmark: totals.total is the total the insert stores");
});

test("models/Order.ts: billFirstPrintedAt (Date) and billFirstPrintedTotal (Number) are declared with NO default (omit-empty)", () => {
  const src = readSrc("models/Order.ts");
  for (const [field, type] of [["billFirstPrintedAt", "Date"], ["billFirstPrintedTotal", "Number"]] as const) {
    const decl = new RegExp(`${field}: \\{([^}]*)\\}`).exec(src);
    assert.ok(decl, `landmark: ${field} is declared in the schema`);
    assert.equal(decl[1].trim(), `type: ${type}`, field);
    assert.ok(!decl[1].includes("default"), `${field} has no default`);
    assert.ok(src.includes(`${field}?: ${type === "Date" ? "Date" : "number"};`), `${field} is on IOrder`);
    const schemaPath = OrderModel.schema.path(field);
    assert.equal(schemaPath.instance, type, field);
    assert.equal(schemaPath.options.default, undefined, field);
  }
  // Vision guard: a `default` in a sibling declaration IS visible to this scan, so the absence above is meaningful.
  assert.ok(/voids: \{[^}]*default: undefined/.test(src), "landmark: the scan does see a default where one is declared");
  const fresh = new OrderModel();
  assert.deepEqual([fresh.billFirstPrintedAt, fresh.billFirstPrintedTotal], [undefined, undefined], "a new order carries no stamp");
});

// ── a client can never forge the stored values ───────────────────────────────

test("the shared order REQUEST schemas carry neither billFirstPrintedAt nor billFirstPrintedTotal, so a client cannot set the stamp", () => {
  const sharedDir = path.join(process.cwd(), "..", "..", "packages", "shared", "src", "schemas");
  const raw = stripComments(readFileSync(path.join(sharedDir, "order.schema.ts"), "utf8"));
  // Positive landmarks: the scan really read the request schemas.
  for (const name of ["createOrderSchema", "settleOrderSchema", "updateOrderSchema", "addItemsSchema"]) assert.ok(raw.includes(`export const ${name}`), name);
  assert.equal(raw.includes("billFirstPrinted"), false, "no request schema names either field");

  const SAMPLE_PRODUCT_ID = "64b7f0c2a1d2e3f4a5b6c7d8";
  const create = { customerName: "Walk-in", items: [{ productId: SAMPLE_PRODUCT_ID, name: "Chai", price: 20, qty: 1 }], subtotal: 20, total: 20, paidAmount: 20, payment: "Cash", receiver: "cashier" };
  const strict: Array<[string, { safeParse(v: unknown): { success: boolean } }, object]> = [
    ["settle", settleOrderSchema, { payment: "Cash" }],
    ["update", updateOrderSchema, { notes: "x" }],
    ["addItems", addItemsSchema, { items: create.items }],
  ];
  for (const forged of [{ billFirstPrintedAt: FORGED }, { billFirstPrintedTotal: 1 }]) {
    // create: not strict, so the key is parsed away and never reaches the route's data.
    const created = createOrderSchema.safeParse({ ...create, ...forged });
    assert.equal(createOrderSchema.safeParse(create).success, true, "landmark: the control payload parses");
    assert.equal(created.success, true);
    assert.equal(created.success && Object.keys(forged)[0] in created.data, false, `create strips ${Object.keys(forged)[0]}`);
    // settle / update / addItems are strict: a forged key is a 400.
    for (const [label, schema, control] of strict) {
      assert.equal(schema.safeParse(control).success, true, `${label}: landmark: the control parses`);
      assert.equal(schema.safeParse({ ...control, ...forged }).success, false, `${label}: ${Object.keys(forged)[0]} is refused`);
    }
  }
});
