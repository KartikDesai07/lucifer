import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "@/lib/source-pin-utils";
import { buildKotPrintDevices, printIntentOf, wireOrderOf, withPrintJobs } from "@/lib/print-order-jobs";

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
  const refs = [{ id: "j1", kind: "kot" as const, targetDeviceId: "dev-1", label: "KOT round 1 · T-1" }];
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
  assert.match(s, /const jobKey = input\.jobKey \?\? printJobKeyOf\(payload\);/, "today's keys: a server job and an old tab's enqueue of one slip collide");
  assert.equal(count(s, "PrintJob.create("), 1, "one write point");
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
    /\[\{ kind: "kot", round: 1 \}, \.\.\.\(intent\.bill && data\.status === "Completed" \? \[\{ kind: "bill" as const \}\] : \[\]\)\]/,
    "Pay Now prints its bill only when asked",
  );
  const items = src("apps/cafe/app/api/orders/[id]/items/route.ts");
  assert.match(items, /const kotPrintDevices = buildKotPrintDevices\(old\.kotPrintDevices, round, intent\?\.deviceId\);/);
  assert.match(items, /\.\.\.\(kotPrintDevices \? \{ kotPrintDevices \} : \{\}\),/);
  assert.match(src("apps/cafe/app/api/orders/[id]/settle/route.ts"), /slips: intent\.bill \? \[\{ kind: "bill" \}\] : \[\],/, "the settle prints the bill only when asked");
  assert.match(src("apps/cafe/models/Order.ts"), /kotPrintDevices: \{ type: \[String\], default: undefined \},/, "declared, omit-empty");
});

test("PIN: the staff accept creates only on a fresh accept; the public auto-accept creates for the host only (no asking device)", () => {
  assert.match(src("apps/cafe/app/api/order-requests/[id]/accept/route.ts"), /intent && !result\.replayed\s*\? await createOrderPrintJobs\(\{/);
  const auto = src("apps/cafe/lib/order-request-create.ts");
  const fn = auto.slice(auto.indexOf("export async function resolveAutoAcceptStatus("));
  inOrder(fn, ['if ("error" in result) return "pending";', "if (!result.replayed) {", "await createOrderPrintJobs({", 'return "accepted";'], "auto-accept");
  const call = fn.slice(fn.indexOf("await createOrderPrintJobs({"), fn.indexOf('return "accepted";'));
  assert.ok(!call.includes("originDeviceId"), "no device asked: with no host nothing is made and kot-claim prints it");
});

test("PIN: POST /api/print-jobs falls back to the asking device only for an agent request that got no-host", () => {
  const s = src("apps/cafe/app/api/print-jobs/route.ts");
  assert.match(s, /if \(result\.outcome === "no-host" && intent !== null\) \{\s*result = await enqueueOwnPrintJob\(\{/);
});
