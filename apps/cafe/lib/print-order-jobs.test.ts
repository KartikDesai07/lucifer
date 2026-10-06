import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";
import { buildKotPrintDevices, printIntentOf, wireOrderOf, withPrintJobs } from "@/lib/print-order-jobs";
import { printPulseDeviceOf } from "@/lib/print-agent-server";

// Printing redesign Phase 1, Session 1B (plan docs/superpowers/plans/2026-10-02-phase-1-lifecycle.md):
// server-side job creation. DB behaviour is proven live (npm run verify:print:live, legs y–ab); these
// are the pure helpers and the source pins.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const src = (rel: string): string => stripComments(readFileSync(path.join(REPO_ROOT, rel), "utf8"));
const count = (text: string, needle: string): number => text.split(needle).length - 1;
function inOrder(text: string, needles: string[], label: string): void {
  let at = -1;
  for (const needle of needles) {
    const next = text.indexOf(needle, at + 1);
    assert.ok(next > at, `${label}: "${needle}" must come after the step before it`);
    at = next;
  }
}

const reqWith = (headers: Record<string, string>): Request => new Request("http://localhost/api/orders", { method: "POST", headers });

test("printIntentOf: only an agent request with a usable device id opts in; a bad header never refuses the order", () => {
  assert.equal(printIntentOf(reqWith({})), null, "a tab from before Phase 1 prints its own slips");
  assert.equal(printIntentOf(reqWith({ "x-pos-device-id": "dev-1" })), null, "the device header alone is not an opt-in");
  assert.equal(printIntentOf(reqWith({ "x-pos-print-agent": "1" })), null, "no device to print at");
  assert.equal(printIntentOf(reqWith({ "x-pos-print-agent": "yes", "x-pos-device-id": "dev-1" })), null, "only the value 1 switches it on");
  assert.equal(printIntentOf(reqWith({ "x-pos-print-agent": "1", "x-pos-device-id": "d".repeat(65) })), null, "an over-long id is ignored, not a 400");
  assert.deepEqual(printIntentOf(reqWith({ "x-pos-print-agent": "1", "x-pos-device-id": " dev-1 " })), { deviceId: "dev-1", bill: false });
  assert.deepEqual(printIntentOf(reqWith({ "x-pos-print-agent": "1", "x-pos-device-id": "dev-1", "x-pos-print-bill": "1" })), { deviceId: "dev-1", bill: true });
});

// Phase 2 Session 2B (spec §7.11): the draining tab that can print now names itself; an unusable name only
// means no direct print (the slips are made queued, as in Phase 1), never a refused order.
test("printIntentOf: the asking tab's lease header joins the intent only with an agent opt-in and a usable tab id", () => {
  const agent = { "x-pos-print-agent": "1", "x-pos-device-id": "dev-1" };
  assert.deepEqual(printIntentOf(reqWith({ ...agent, "x-pos-print-lease": " tab-1 " })), { deviceId: "dev-1", bill: false, leaseTabId: "tab-1" });
  assert.deepEqual(printIntentOf(reqWith({ ...agent, "x-pos-print-lease": "  " })), { deviceId: "dev-1", bill: false }, "a blank tab id is no tab");
  assert.deepEqual(printIntentOf(reqWith({ ...agent, "x-pos-print-lease": "t".repeat(65) })), { deviceId: "dev-1", bill: false }, "an over-long tab id is ignored, not a 400");
  assert.equal(printIntentOf(reqWith({ "x-pos-device-id": "dev-1", "x-pos-print-lease": "tab-1" })), null, "the lease header alone is not an opt-in");
});

// Phase 2 Session 2C (printers mode): the printers the draining tab can print on now, and this device's bill
// printer. Unusable values only mean fewer printers or the default bill printer, never a refused order.
test("printIntentOf: the ready printers and the device's bill printer join the intent; anything unusable is dropped", () => {
  const agent = { "x-pos-print-agent": "1", "x-pos-device-id": "dev-1" };
  const a = "a".repeat(24);
  const b = "b".repeat(24);
  assert.deepEqual(printIntentOf(reqWith({ ...agent, "x-pos-print-ready": `${a}, nope,${b}` })), { deviceId: "dev-1", bill: false, readyPrinterIds: [a, b] });
  assert.deepEqual(printIntentOf(reqWith({ ...agent, "x-pos-print-ready": "nope" })), { deviceId: "dev-1", bill: false }, "no usable id: no ready printers");
  assert.deepEqual(printIntentOf(reqWith({ ...agent, "x-pos-bill-printer": ` ${a} ` })), { deviceId: "dev-1", bill: false, billPrinterId: a });
  assert.deepEqual(printIntentOf(reqWith({ ...agent, "x-pos-bill-printer": "Counter" })), { deviceId: "dev-1", bill: false }, "not a printer id: the default bill printer");
  assert.equal(printIntentOf(reqWith({ "x-pos-print-ready": a, "x-pos-bill-printer": a })), null, "neither header is an opt-in");
});

test("buildKotPrintDevices: positional like kotIdemKeys; a round its tab printed stays empty; no device writes nothing", () => {
  assert.equal(buildKotPrintDevices(undefined, 1, undefined), undefined);
  assert.deepEqual(buildKotPrintDevices(undefined, 1, "dev-1"), ["dev-1"]);
  assert.deepEqual(buildKotPrintDevices(undefined, 3, "dev-1"), ["", "", "dev-1"], "earlier rounds were printed by their tab");
  assert.deepEqual(buildKotPrintDevices(["dev-1"], 2, "dev-2"), ["dev-1", "dev-2"]);
  assert.equal(buildKotPrintDevices(["dev-1"], 2, undefined), undefined, "an old tab's round leaves the marker as it was");
});

test("withPrintJobs: without an opt-in the answer is the very same object; with one it is the wire order plus printJobs", () => {
  const order = { _id: "o1", createdAt: new Date("2026-10-02T10:00:00.000Z") };
  assert.equal(withPrintJobs(order, null), order);
  const refs = [{ id: "j1", kind: "kot" as const, targetDeviceId: "dev-1", label: "KOT round 1 · T-1", status: "queued" as const }];
  assert.deepEqual(withPrintJobs(order, refs), { _id: "o1", createdAt: "2026-10-02T10:00:00.000Z", printJobs: refs });
  assert.deepEqual(withPrintJobs(order, []), { _id: "o1", createdAt: "2026-10-02T10:00:00.000Z", printJobs: [] });
  const wire = wireOrderOf({ createdAt: new Date("2026-10-02T10:00:00.000Z") });
  assert.equal(wire.createdAt, "2026-10-02T10:00:00.000Z", "Dates reach the builders as the ISO strings the client sees");
});

test("PIN: createOrderPrintJobs never throws, announces each new job to its device, and nudges an old host only when there is one", () => {
  const s = src("apps/cafe/lib/print-order-jobs.ts");
  const fn = s.slice(s.indexOf("export async function createOrderPrintJobs("), s.indexOf("export async function enqueueOwnPrintJob("));
  inOrder(fn, ["try {", "const target = host?.deviceId ?? input.originDeviceId;", "await insertPrintJob({", "} catch {", "return refs;"], "createOrderPrintJobs");
  assert.match(fn, /publishPrintStatus\(\{ id: job\.ref\.id, status: "queued", target \}\);/);
  assert.match(fn, /if \(made > 0 && host !== null\) publishCafeEvent\("print-job"\);/);
  // Session 2C moved insertPrintJob to lib/print-job-insert.ts (this file stays under its ~300-line budget).
  const insert = src("apps/cafe/lib/print-job-insert.ts");
  assert.match(insert, /const jobKey = input\.jobKey \?\? printJobKeyOf\(payload\);/, "today's keys: a server job and an old tab's enqueue of one slip collide");
  assert.equal(count(insert, "PrintJob.create(") + count(s, "PrintJob.create("), 1, "one write point");
  // Session 2B (spec §7.11): a job is made leased only on the asking device's own line, only the request's
  // first slip there, only when the line is free; and a job printed by the asking tab is never announced.
  assert.match(fn, /const leaseTabId = target === input\.originDeviceId \? input\.leaseTabId : undefined;/, "never for a slip another device prints");
  assert.match(fn, /const lineFree = leaseTabId !== undefined && \(await printLineIsFree\(target, input\.nowMs\)\);/, "one read of the line, only when it can matter");
  assert.match(fn, /const tab = leaseTabId === undefined \|\| refs\.length > 0 \? \{\} : \{ tab: \{ tabId: leaseTabId, direct: lineFree \} \};/, "only the first slip of the request on the line");
  assert.match(fn, /if \(announcesQueuedJob\(job, directOnLine\)\) \{/, "no realtime message to yourself");
  assert.match(insert, /\.\.\.\(failed \?\? direct \?\? \{ \.\.\.printJobLifecycleInit\(input\.nowMs, labels\), log: \[printJobCreatedLog\(input\.nowMs, input\.originDeviceId\)\] \}\),/, "made leased (or failed, 2C) in the same write that creates it");
  assert.ok(!s.includes("console."), "no console.* in a server lib");
});

// ── The order routes (Session 1B) ────────────────────────────────────────────

const ROUTES: Array<[string, string]> = [
  ["apps/cafe/app/api/orders/route.ts", 'publishCafeEvent("order-changed");'],
  ["apps/cafe/app/api/orders/[id]/items/route.ts", 'publishCafeEvent("kot-fired");'],
  ["apps/cafe/app/api/orders/[id]/settle/route.ts", 'publishCafeEvent("order-changed");'],
  ["apps/cafe/app/api/orders/[id]/items/void/route.ts", 'publishCafeEvent("order-changed");'],
  ["apps/cafe/app/api/orders/[id]/table/route.ts", 'publishCafeEvent("order-changed");'],
  ["apps/cafe/app/api/order-requests/[id]/accept/route.ts", 'publishCafeEvent("kot-fired");'],
];

test("PIN: every order route opts in only through printIntentOf(req), and creates its slips once, after its landed publish (replays return before it)", () => {
  for (const [rel, publish] of ROUTES) {
    const s = src(rel);
    assert.equal(count(s, "printIntentOf(req)"), 1, `${rel}: one opt-in read`);
    assert.equal(count(s, "await createOrderPrintJobs({"), 1, `${rel}: one creation site`);
    const at = s.lastIndexOf(publish);
    assert.ok(at >= 0 && s.indexOf("await createOrderPrintJobs({") > at, `${rel}: creation follows the landed path's publish`);
    assert.ok(!/PrintJob\./.test(s), `${rel}: no direct PrintJob access`);
  }
  for (const rel of ROUTES.slice(0, 5).map(([r]) => r)) {
    assert.match(src(rel), /return (success|created)\(withPrintJobs\(/, `${rel}: the answer goes through withPrintJobs`);
  }
});

test("PIN: the create and add-round CAS writes mark a round as the server's only when the request opted in", () => {
  const create = src("apps/cafe/app/api/orders/route.ts");
  assert.match(create, /\.\.\.\(intent \? \{ kotPrintDevices: \[intent\.deviceId\] \} : \{\}\),/);
  assert.match(
    create,
    /slips: \[\.\.\.openingSlipsOf\(numbered\.value \?\? landed, 1\), \.\.\.\(printsBillNow \? \[\{ kind: "bill" as const \}\] : \[\]\)\]/,
    "the opening slips (KOT, then the S7 token) come first; Pay Now prints its bill only when asked",
  );
  // S3b: the condition is named once (printsBillNow) and the first-print stamp rides the same flag.
  assert.match(
    create,
    /const printsBillNow = intent\?\.bill === true && data\.status === "Completed";/,
    "the Pay Now bill condition lives in one named const",
  );
  const items = src("apps/cafe/app/api/orders/[id]/items/route.ts");
  assert.match(items, /const kotPrintDevices = buildKotPrintDevices\(old\.kotPrintDevices, round, intent\?\.deviceId\);/);
  assert.match(items, /\.\.\.\(kotPrintDevices \? \{ kotPrintDevices \} : \{\}\),/);
  assert.match(src("apps/cafe/app/api/orders/[id]/settle/route.ts"), /slips: intent\.bill \? \[\{ kind: "bill" \}\] : \[\],/, "the settle prints the bill only when asked");
  assert.match(src("apps/cafe/models/Order.ts"), /kotPrintDevices: \{ type: \[String\], default: undefined \},/, "declared, omit-empty");
});

// Session 1B final review C1: the print host's self-order lane (PrintHostDrain → useSelfOrderAutoPrint
// with hostLane) wins /kot-claim and prints the KOT through its own bridge, with no job key, and the
// auto-accept leaves kotPrintedAt unstamped. A server-made job for the host would therefore print a
// second, unlabelled KOT for every auto-accepted QR order. Ruling R4 moves to Session 1C, where the
// lane becomes job-aware; until then the auto-accept answers exactly as before Phase 1.
test("PIN: the staff accept creates only on a fresh accept; the public auto-accept creates no print job (the self-order lane's claim does, Session 1C)", () => {
  assert.match(src("apps/cafe/app/api/order-requests/[id]/accept/route.ts"), /intent && !result\.replayed\s*\? await createOrderPrintJobs\(\{/);
  // Session 1C (R4, job-aware lane): the host lane hands a claimed KOT to the agent, never to the bridge.
  assert.match(
    src("apps/cafe/components/print/PrintHostDrain.tsx"),
    /routePrint\(\(\) => kotPrintJob\(order, round\), \(\) => undefined, printJobRefOf\(order, "kot"\)\)/,
    "the host lane prints a claimed KOT only as a print job",
  );
  assert.ok(!src("apps/cafe/components/layout/PrintHostProvider.tsx").includes("onKotRound="), "the bridge's own KOT print is no longer handed to the lane");
  const auto = src("apps/cafe/lib/order-request-create.ts");
  assert.ok(!auto.includes("createOrderPrintJobs"), "the auto-accept makes no print job in 1B (final review C1)");
  const fn = auto.slice(auto.indexOf("export async function resolveAutoAcceptStatus("));
  assert.match(fn, /return "error" in result \? "pending" : "accepted";/, "the auto-accept answers exactly as before Phase 1");
});

test("PIN: POST /api/print-jobs falls back to the asking device only for an agent request that got no-host", () => {
  const s = src("apps/cafe/app/api/print-jobs/route.ts");
  assert.match(s, /if \(result\.outcome === "no-host" && intent !== null\) \{\s*result = await enqueueOwnPrintJob\(\{/);
});

// Session 2B (spec §7.11): every request that makes slips carries the asking tab to job creation.
test("PIN (2B): every order route and the self-order claim pass the asking tab; the enqueue tries direct print first", () => {
  for (const rel of [...ROUTES.map(([r]) => r), "apps/cafe/lib/print-agent-server.ts"]) {
    const s = src(rel);
    assert.equal(count(s, "leaseTabId: intent.leaseTabId,"), 1, `${rel}: the asking tab reaches createOrderPrintJobs`);
    assert.ok(s.indexOf("originDeviceId: intent.deviceId,") < s.indexOf("leaseTabId: intent.leaseTabId,"), `${rel}: beside the asking device`);
  }
  const route = src("apps/cafe/app/api/print-jobs/route.ts");
  inOrder(route, ["const intent = printIntentOf(req);", "intent?.leaseTabId !== undefined", "await enqueueDirectPrintJob({", "direct ??", "(await enqueuePrintJob({"], "the enqueue");
  const lib = src("apps/cafe/lib/print-order-jobs.ts");
  const direct = lib.slice(lib.indexOf("export async function enqueueDirectPrintJob("), lib.indexOf("export function withPrintJobs<T>("));
  assert.match(direct, /if \(host !== null && host\.deviceId !== input\.originDeviceId\) return null;/, "another device's host: Phase 1's enqueue");
  assert.match(direct, /tab: \{ tabId: leaseTabId, direct: await printLineIsFree\(input\.originDeviceId, input\.nowMs\) \}/, "made leased only on a free line");
  const own = lib.slice(lib.indexOf("export async function enqueueOwnPrintJob("), lib.indexOf("export async function enqueueDirectPrintJob("));
  inOrder(own, ["if (job.ref.leased !== undefined) return {", "leased: job.ref.leased };", "if (!job.created && job.status !== \"queued\")", "if (job.created) publishPrintStatus("], "a leased job is answered with its lease before any announcement");
});

// ── Session 1C, the server half (the 1B gate rulings: M-a, M-d, M-e, M-f, R4 job-aware lane, the pulse) ──

test("printPulseDeviceOf: only a usable ?device= names the agent; anything else is ignored, never a 400", () => {
  assert.equal(printPulseDeviceOf("http://localhost/api/order-requests/pulse"), null, "a tab that is not an agent sends none");
  assert.equal(printPulseDeviceOf("http://localhost/api/order-requests/pulse?device="), null, "empty");
  assert.equal(printPulseDeviceOf(`http://localhost/api/order-requests/pulse?device=${"d".repeat(65)}`), null, "too long");
  assert.equal(printPulseDeviceOf("http://localhost/api/order-requests/pulse?device=%20dev-1%20"), "dev-1");
});

test("PIN (M-d): every ref says what state its job is in, made now or found under its key", () => {
  const s = src("apps/cafe/lib/print-job-insert.ts");
  // Session 2B deliberately changed the first two: a new job is queued, or leased to the asking tab and
  // carrying its lease; a found job keeps its own state, plus its lease when it is still the asking tab's.
  assert.match(
    s,
    /label: input\.request\.label,\s*status: failed !== null \? "failed" : direct === null \? "queued" : "leased",\s*\.\.\.\(direct !== null \? \{ leased: leasedJobOf\(created, direct, payload\) \} : \{\}\),\s*\.\.\.\(input\.line !== undefined \? \{ printerId: input\.line\.printerId \} : \{\}\),\s*\};\s*return \{ ref, created: true, status: ref\.status \};/,
    "a new job is queued, or made leased to the asking tab",
  );
  assert.match(s, /label: existing\.label,\s*status: existing\.status,\s*\.\.\.\(again !== null \? \{ leased: again \} : \{\}\),\s*\.\.\.\(existing\.printerId !== undefined \? \{ printerId: existing\.printerId \} : \{\}\),\s*\};/, "a found job keeps its own state");
  assert.match(src("packages/shared/src/print-agent-wire.ts"), /export interface PrintJobRef \{[^}]*status: PrintJobStatus;/, "the wire type carries it");
});

test("PIN (M-a, M-e): an enqueue whose host vanished sends a row with an asking device home; every new row announces itself", () => {
  const s = src("apps/cafe/lib/print-queue.ts");
  const fn = s.slice(s.indexOf("export async function enqueuePrintJob("), s.indexOf("export type DismissPrintJobResult"));
  inOrder(
    fn,
    [
      "if (!hostStillThere && input.originDeviceId !== undefined) {",
      "$set: { targetDeviceId: input.originDeviceId }",
      'publishPrintStatus({ id: createdId, status: "queued", target: input.originDeviceId });',
      'return { outcome: "queued", id: createdId, duplicate: false };',
      "if (!hostStillThere) {",
      "await dismissPrintJob({",
    ],
    "the orphan check",
  );
  assert.equal(count(fn, 'publishPrintStatus({ id: createdId, status: "queued", target: host.deviceId });'), 1, "a new job for the host announces itself");
  assert.equal(count(fn, "publishPrintStatus("), 2, "no other print-status from the enqueue (a duplicate is not new; a failed re-read keeps the old nudge only)");
});

test("PIN (R4, job-aware lane): an agent's kot-claim makes the KOT a job in the same request; the D9 marker is never reopened", () => {
  const route = src("apps/cafe/app/api/order-requests/[id]/kot-claim/route.ts");
  assert.match(route, /const intent = printIntentOf\(req\);\s*const result = intent \? await claimKotPrintForAgent\(id, intent, Date\.now\(\)\) : await claimKotPrint\(id\);/);
  const lib = src("apps/cafe/lib/print-agent-server.ts");
  inOrder(lib, ["const result = await claimKotPrint(id);", "if (!result.claimed) return result;", "await createOrderPrintJobs({", "slips: openingSlipsOf(result.order, result.kotRound)"], "the claim, then the job (the KOT, and the token slip when the order opens with one)");
  assert.ok(!/\$unset/.test(lib) && !/kotPrintedAt/.test(lib), "a failed create never reopens the claim: the lane enqueues the KOT itself");
  assert.match(lib, /printJobs\.length > 0 \? \{ \.\.\.order, printJobs \} : order/, "no job: the answer names none, so the lane re-sends it under the same key");
  assert.match(src("apps/cafe/lib/order-request-create.ts"), /return "error" in result \? "pending" : "accepted";/, "the public auto-accept stays exactly as live today");
});

test("PIN (M-f): a staff accept the server prints records the asking device in the same order write, on both writers", () => {
  assert.match(src("apps/cafe/app/api/order-requests/[id]/accept/route.ts"), /\.\.\.\(intent \? \{ printDeviceId: intent\.deviceId \} : \{\}\),/);
  assert.match(src("apps/cafe/lib/order-request-accept.ts"), /\.\.\.\(ctx\.printDeviceId \? \{ kotPrintDevices: \[ctx\.printDeviceId\] \} : \{\}\),/, "a new tab: round 1");
  const add = src("apps/cafe/lib/order-request-accept-addround.ts");
  assert.match(add, /const kotPrintDevices = buildKotPrintDevices\(openTab\.kotPrintDevices, round, ctx\.printDeviceId\);/, "an open tab: positional");
  assert.match(add, /\.\.\.\(kotPrintDevices \? \{ kotPrintDevices \} : \{\}\),/);
  assert.ok(!src("apps/cafe/lib/order-request-create.ts").includes("printDeviceId"), "the auto-accept marks nothing");
});

// Session 1D deliberately changed this pin: the pulse now also sweeps AFTER its answer (D2; pinned in
// print-attention.test.ts), and its print fields are spread in, each omitted on a failed read.
test("PIN: the pulse adds printJobsForMe only for a tab that named itself, fail-soft, and the route itself writes nothing", () => {
  const s = src("apps/cafe/app/api/order-requests/pulse/route.ts");
  assert.match(s, /const device = printPulseDeviceOf\(req\.url\);/);
  assert.match(s, /device === null \? Promise\.resolve\(null\) : readJobsForDevice\(device, nowMs\)\.catch\(\(\) => null\)/);
  assert.ok(s.includes("...(printJobsForMe === null ? {} : { printJobsForMe }),"), "omitted on a failed read");
  for (const write of ["updateOne(", "updateMany(", "create(", "findOneAndUpdate("]) {
    assert.ok(!s.includes(write), `the pulse route itself writes nothing: no ${write}`);
  }
});
