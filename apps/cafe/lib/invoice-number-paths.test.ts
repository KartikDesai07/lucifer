import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// Print customization S10-B: the source pins for the GST invoice serial. The behaviour legs live in
// slip-numbers.test.ts / gst-invoice.test.ts / Counter.test.ts; these pin the WIRING the fakes cannot see (who may
// draw from the invoice counter, which counter it is, which call shapes the routes use). Every absence assert is
// paired with a positive landmark so a moved symbol cannot turn it vacuous. Banned needles are built by
// concatenation, never written as one literal.

const read = (rel: string): string => stripComments(readFileSync(path.join(process.cwd(), rel), "utf8")).replace(/\s+/g, " ");
const raw = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");
const count = (hay: string, needle: string): number => hay.split(needle).length - 1;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(process.cwd(), dir))) {
    const rel = `${dir}/${name}`;
    if (name === "node_modules" || name === ".next") continue;
    if (statSync(path.join(process.cwd(), rel)).isDirectory()) walk(rel, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

// Everything that runs in the app (not a test, not an ops script).
const APP_SOURCES = ["app", "lib", "hooks", "components", "models"].flatMap((dir) => walk(dir));
const filesMatching = (re: RegExp): string[] => APP_SOURCES.filter((f) => re.test(read(f))).sort();

// ── who may draw from the invoice counter ─────────────────────────────────────

test("nextInvoiceSequence is referenced by exactly one app module (lib/slip-numbers.ts), which wires it as the invoice draw; it is never called anywhere else", () => {
  assert.ok(APP_SOURCES.length > 100, `landmark: the scan really walked the app (${APP_SOURCES.length} files)`);
  const counter = read("models/Counter.ts");
  assert.ok(counter.includes("export async function nextInvoiceSequence("), "landmark: models/Counter.ts defines it, so a scan that includes models/ can see it");
  const users = filesMatching(/\bnextInvoiceSequence\b/).filter((f) => f !== "models/Counter.ts");
  assert.deepEqual(users, ["lib/slip-numbers.ts"], "no route, hook or other lib module draws an invoice number directly");
  const slips = read("lib/slip-numbers.ts");
  assert.ok(slips.includes("nextInvoice: nextInvoiceSequence,"), "landmark: the one reference is the BILL_NUMBERS_DEPS draw");
  assert.equal(count(slips, "nextInvoiceSequence" + "("), 0, "slip-numbers hands the function over; it never calls it inline");
  assert.deepEqual(filesMatching(new RegExp("nextInvoiceSequence" + "\\(")).filter((f) => f !== "models/Counter.ts"), [], "no call anywhere else in app/lib/hooks/components");
});

test("only models/Counter.ts spells the invoice counter key; every other module goes through invoiceCounterKey / the draw", () => {
  const keyLiteral = new RegExp("[\"'`]invoice" + "-(\\$\\{|\\d)");
  assert.deepEqual(filesMatching(keyLiteral), ["models/Counter.ts"]);
  assert.ok(read("models/Counter.ts").includes("return `invoice-${invoiceFyLabel(fy)}`"), "landmark: the one spelling is built from the shared FY label");
});

// ── the invoice counter is the CORE counter, with no restart time ─────────────

test("Counter.nextInvoiceSequence: signature is (fy) only, the body resolves resolveCounter(null), and nothing in the invoice block names a connection or a restart time", () => {
  const src = read("models/Counter.ts");
  const start = src.indexOf("export function invoiceCounterKey(");
  const end = src.indexOf("export async function bumpOrderSequenceTo(");
  assert.ok(start > 0 && end > start, "landmarks: the invoice block sits between the slip series and the recovery path");
  const block = src.slice(start, end);
  assert.ok(block.includes("export async function nextInvoiceSequence(fy: number): Promise<number> {"), "the signature takes the FY alone");
  assert.ok(block.includes("resolveCounter(null)"), "the CORE counter, always");
  for (const banned of ["conn", "Connection", "resetMinutes", "slipDayKey", "cafeDateString", "new Date"]) {
    assert.equal(block.includes(banned), false, `the invoice block must not mention ${banned}`);
  }
  // Landmark for the scan: the sibling slip allocator DOES take a connection and a restart time, so the needles above can fail.
  const slip = src.slice(src.indexOf("export async function nextSlipSequence("), start);
  assert.ok(slip.includes("conn?: Connection | null") && slip.includes("resolveCounter(conn)") && slip.includes("resetMinutes"));
});

// ── the guarded set (the fake deps bypass the real filter, so it is pinned here) ──

test("slip-numbers: the invoice set is guarded by the $exists arm OR the same (number, fy) pair, sets BOTH fields together, runs the validators", () => {
  const src = read("lib/slip-numbers.ts");
  const start = src.indexOf("function setInvoiceIfAbsent(");
  assert.ok(start > 0, "landmark");
  const body = src.slice(start, src.indexOf("export interface InvoiceNumberDeps"));
  assert.ok(body.includes("{ _id: id, $or: [{ invoiceNumber: { $exists: false } }, { invoiceNumber, invoiceFy }] }"), "the retry-adopt arm and the never-renumber arm");
  assert.ok(body.includes("{ $set: { invoiceNumber, invoiceFy } }"), "both fields in one write");
  assert.ok(body.includes("{ new: true, runValidators: true }"));
  // The daily number's set has the same guard shape (landmark for the pattern, and proof the two stay in step).
  assert.ok(src.includes("{ _id: id, $or: [{ billNumber: { $exists: false } }, { billNumber }] }"));
});

test("slip-numbers: issueInvoiceNumber takes its FY from the order instant it was handed, and issueBillNumbers tries the invoice before the daily number", () => {
  const src = read("lib/slip-numbers.ts");
  const issue = src.slice(src.indexOf("export async function issueInvoiceNumber<T>("), src.indexOf("export function issueBillNumbers("));
  assert.ok(issue.includes("const fy = invoiceFyOf(at);"), "landmark: the FY comes from `at`");
  assert.equal(issue.includes("new Date"), false, "never from the clock at draw time");
  const numbers = src.slice(src.indexOf("export async function issueBillNumbers("), src.indexOf("export interface InvoiceReadDeps"));
  const invoiceAt = numbers.indexOf("plan.invoiceAt !== undefined");
  const billAt = numbers.indexOf("plan.bill !== undefined");
  assert.ok(invoiceAt > 0 && billAt > 0, "landmarks: both halves are in the function");
  assert.ok(invoiceAt < billAt, "invoice first");
  assert.ok(numbers.includes("failure ??= { error };"), "a later failure never replaces the first error");
});

// ── the three write paths and the replay use ONE plan ─────────────────────────

test("billNumberingPlan( is called by the settle route, the create route and lib/order-idem.ts, each on the order the write returned", () => {
  const settle = read("app/api/orders/[id]/settle/route.ts");
  const create = read("app/api/orders/route.ts");
  const replay = read("lib/order-idem.ts");
  assert.equal(count(settle, "billNumberingPlan(updated, printConfigOf(settings).bill)"), 1);
  assert.equal(count(create, "billNumberingPlan(landed, printCfg.bill)"), 1);
  assert.equal(count(replay, "billNumberingPlan(order, bill)"), 1);
  // Each one is drawn through issueBillNumbers, gated by planHasWork, and none still calls the single-number draw.
  assert.ok(settle.includes("planHasWork(numbering) ? issueBillNumbers(id, numbering)"));
  // The create route hands its plan to the follow-ups runner (CB-7 S2 Slice A), which draws it.
  const createFollowUps = read("lib/order-create-followups.ts");
  assert.ok(create.includes("runCreateFollowUps({ landed, settings, numbering,"), "the create route passes the plan it just computed");
  assert.ok(createFollowUps.includes("planHasWork(numbering) ? deps.issueBillNumbers(landed._id, numbering)"));
  assert.ok(replay.includes("deps.issueBillNumbers(order._id, plan)"));
  assert.ok(replay.includes("!planHasWork(plan)"));
  const oldDraw = "issueBillNumber" + "(";
  for (const [name, src] of [["settle", settle], ["create", create], ["create follow-ups", createFollowUps], ["replay", replay]] as const) {
    assert.equal(src.includes(oldDraw), false, `${name}: no single-number draw left`);
  }
});

test("the settle route plans AFTER its CAS won, and the create route AFTER its insert won (a refused write never takes a number)", () => {
  const settle = read("app/api/orders/[id]/settle/route.ts");
  const cas = settle.indexOf("const updated = await Order.findOneAndUpdate(filter, update,");
  const missBranch = settle.indexOf("if (!updated) {");
  const plan = settle.indexOf("billNumberingPlan(updated");
  assert.ok(cas > 0 && missBranch > cas && plan > 0, "landmarks: CAS, its miss branch, the plan");
  assert.ok(plan > missBranch, "the plan is after the miss branch returned");
  const create = read("app/api/orders/route.ts");
  const landed = create.indexOf("const landed = order;");
  const createPlan = create.indexOf("billNumberingPlan(landed");
  assert.ok(landed > 0 && createPlan > landed, "the create plan is after `landed` (the insert winner)");
});

// ── the print-jobs route injects the stored serial ─────────────────────────────

test("print-jobs route chains .then(billPayloadWithInvoice) after billPayloadWithFirstPrint, after connectDB and before the enqueues", () => {
  const src = read("app/api/print-jobs/route.ts");
  const chain = "const payload = await billPayloadWithFirstPrint(parsed.data.payload, nowMs).then(billPayloadWithInvoice);";
  const connect = src.indexOf("await connectDB()");
  const at = src.indexOf(chain);
  const enqueue = src.indexOf("await enqueuePrintJob({");
  assert.ok(connect > 0 && at > 0 && enqueue > 0, "landmarks: all three are in the source");
  assert.ok(connect < at && at < enqueue, `order: connectDB ${connect} < chain ${at} < enqueue ${enqueue}`);
  assert.ok(src.includes('import { billPayloadWithInvoice } from "@/lib/slip-numbers"'));
  assert.equal(count(src, "billPayloadWithInvoice"), 2, "the import and the one use");
  // The older needle (bill-first-print-paths.test.ts) stays a SUBSTRING of the chained line.
  assert.ok(src.includes("const payload = await billPayloadWithFirstPrint(parsed.data.payload, nowMs)"));
  // Every enqueue reads the chained `payload`, never the raw parsed one.
  assert.equal(src.includes("payload: parsed.data.payload"), false, "no enqueue takes the client payload as sent");
  assert.ok(src.includes("enqueuePrintJob({ payload, label: parsed.data.label"), "landmark: the enqueue carries `payload`");
});

// ── K1 asks the same rule ────────────────────────────────────────────────────

test("settle-flow K1 asks numbersPending(order, billNumbered) and no longer reads the order's billNumber itself", () => {
  const src = read("lib/settle-flow.ts");
  assert.ok(src.includes('import { numbersPending } from "@/lib/gst-invoice";'));
  assert.ok(src.includes('step.kind === "settled" && numbersPending(step.order, ports.billNumbered())'));
  assert.equal(src.includes("step.order.billNumber"), false, "the bill-number-only test is gone");
  assert.equal(src.includes("invoiceNumber"), false, "the rule itself lives in gst-invoice, not restated here");
  assert.ok(read("lib/gst-invoice.ts").includes("export function numbersPending("), "landmark: the shared rule exists");
});

// ── gst-invoice.ts stays client-safe ─────────────────────────────────────────

test("lib/gst-invoice.ts value-imports only @/lib/receipt; the slip-numbers import is type-only; no mongoose, no models", () => {
  const src = raw("lib/gst-invoice.ts");
  const code = stripComments(src);
  const imports = [...code.matchAll(/^\s*import\s+([^;]*?)\s+from\s+"([^"]+)";?/gm)].map((m) => ({ clause: m[1], from: m[2] }));
  assert.ok(imports.length >= 2, "landmark: the scan really found the file's imports");
  const typeOnly = (clause: string) => clause.startsWith("type ");
  assert.deepEqual(imports.filter((i) => !typeOnly(i.clause)).map((i) => i.from), ["@/lib/receipt"], "the only VALUE import");
  const slips = imports.find((i) => i.from === "@/lib/slip-numbers");
  assert.ok(slips !== undefined && typeOnly(slips.clause), "landmark: slip-numbers IS imported, and `import type` only");
  for (const banned of ["mongoose", "@/models", "@/lib/db", "node:"]) {
    assert.equal(code.includes(banned), false, `gst-invoice.ts must not mention ${banned}`);
  }
  // One hop further: the one module it value-imports is itself free of server imports.
  const receipt = stripComments(raw("lib/receipt.ts"));
  assert.ok(receipt.includes("export function receiptGst("), "landmark");
  for (const banned of ["mongoose", "@/models", "@/lib/db"]) assert.equal(receipt.includes(banned), false, `receipt.ts must not mention ${banned}`);
});

// ── a new field on a shared type: the synthesis sites (cafe.md / A9) ──────────

test("every print snapshot is built by the shared printOrderSnapshot — no hand-built snapshot literal that could miss the invoice keys", () => {
  const routing = read("lib/print-routing.ts");
  // Skip-KOT: the KOT, moved and cancel-notice builders hand the picker the kitchen lines only (kitchenOrderOf); the
  // bill, token and void builders hand it the whole order. Either way the snapshot is the shared picker's.
  const whole = count(routing, "snapshot: printOrderSnapshot(order)");
  const kitchen = count(routing, "snapshot: printOrderSnapshot(kitchenOrderOf(order))");
  assert.ok(whole + kitchen >= 6, "landmark: the six job builders call the shared picker");
  assert.equal(kitchen, 3, "exactly the KOT, moved and cancel-notice builders take the kitchen lines");
  assert.ok(routing.includes('kind: "bill", snapshot: printOrderSnapshot(order)'), "the bill keeps the whole order");
  assert.ok(routing.includes('kind: "token", snapshot: printOrderSnapshot(order)'), "the token keeps the whole order");
  assert.equal(count(routing, "snapshot:"), whole + kitchen, "every `snapshot:` in print-routing is the picker's");
  const literal = new RegExp("snapshot:\\s*\\{");
  assert.deepEqual(APP_SOURCES.filter((f) => literal.test(stripComments(raw(f)))), [], "no module hand-builds a snapshot object");
});

test("parity: the shared picker, the shared schema and the shared Order type all carry the same two invoice keys", () => {
  const shared = (rel: string) => stripComments(readFileSync(path.join(process.cwd(), "..", "..", "packages", "shared", "src", rel), "utf8")).replace(/\s+/g, " ");
  const job = shared("print-job.ts");
  const schema = shared("schemas/print-job.schema.ts");
  const types = shared("types.ts");
  assert.ok(job.includes("{ invoiceNumber: order.invoiceNumber, invoiceFy: order.invoiceFy }"));
  assert.ok(job.includes('typeof order.invoiceNumber === "number" && typeof order.invoiceFy === "number"'), "both-or-neither");
  assert.ok(schema.includes("invoiceNumber: z.number().int().optional(),") && schema.includes("invoiceFy: z.number().int().optional(),"));
  assert.ok(types.includes("invoiceNumber?: number;") && types.includes("invoiceFy?: number;"));
  const model = read("models/Order.ts");
  assert.ok(model.includes("invoiceNumber: { type: Number, validate: isInvoiceSerial }"));
  assert.ok(model.includes("invoiceFy: { type: Number, validate: isInvoiceFy }"));
  assert.ok(model.includes('from "@pos/shared/invoice-number"'), "the model validates with the shared bounds, not its own copy");
});
