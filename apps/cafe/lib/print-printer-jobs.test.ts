import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PRINT_JOB_NO_PRINTER } from "@pos/shared/print-printers";
import type { PrintJobRef } from "@pos/shared/print-agent-wire";
import { stripComments } from "@/lib/source-pin-utils";
import type { InsertedPrintJob } from "@/lib/print-job-insert";
import type { RoutedPrintJob } from "@/lib/print-printer-routing";
import { askingTabOf, printPayloadProductIds, routedEnqueueResultOf } from "@/lib/print-printer-jobs";

// Phase 2 Session 2C (spec §8, plan decisions 1–5, 15, 16): job creation in printers mode. The rules are pure
// here; the creation itself is proven live (npm run verify:print:live, legs an–aq).

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

const SNAPSHOT_ITEMS = [{ productId: "p-chai" }, { productId: "p-cake" }];

test("printPayloadProductIds: a slip's stations are resolved for its own lines; a void for its voided line; End of day for none", () => {
  const snapshot = { items: SNAPSHOT_ITEMS } as never;
  assert.deepEqual(printPayloadProductIds({ kind: "kot", snapshot, round: 1 } as never), ["p-chai", "p-cake"]);
  assert.deepEqual(printPayloadProductIds({ kind: "bill", snapshot } as never), ["p-chai", "p-cake"]);
  assert.deepEqual(printPayloadProductIds({ kind: "void", snapshot, line: { productId: "p-gone" } } as never), ["p-gone"], "the voided line may have left the order");
  assert.deepEqual(printPayloadProductIds({ kind: "eod", dateKey: "2026-10-04", dateLabel: "4 Oct" } as never), []);
});

function routed(printerId: string | null, writerDeviceId: string | null): RoutedPrintJob {
  return { printerId, writerDeviceId, request: { payload: {} as never, label: "KOT" }, copies: 1, part: "-" };
}

test("askingTabOf: only a printer this device writes and names as ready, and only the request's first job on it", () => {
  const input = { originDeviceId: "dev-a", leaseTabId: "tab-1", readyPrinterIds: ["p-counter"] };
  const seen = new Set<string>();
  assert.equal(askingTabOf(routed("p-counter", "dev-a"), input, seen), "tab-1", "the asking device writes it and can print it now");
  assert.equal(askingTabOf(routed("p-counter", "dev-a"), input, seen), undefined, "the second job on that line waits for the first one's ack (more)");
  assert.equal(askingTabOf(routed("p-kitchen", "dev-k"), input, new Set()), undefined, "another device writes it");
  assert.equal(askingTabOf(routed("p-bar", "dev-a"), input, new Set()), undefined, "this device writes it but did not say it can print it now");
  assert.equal(askingTabOf(routed("p-counter", "dev-a"), { ...input, leaseTabId: undefined }, new Set()), undefined, "no draining tab asked");
  assert.equal(askingTabOf(routed(null, null), input, new Set()), undefined, "no printer: made failed, never leased");
});

function inserted(over: Partial<PrintJobRef> & { created?: boolean } = {}): InsertedPrintJob {
  const { created = true, ...ref } = over;
  const full: PrintJobRef = { id: "j1", kind: "kot", targetDeviceId: "dev-a", label: "KOT", status: "queued", printerId: "p1", ...ref };
  return { ref: full, created, status: full.status };
}

test("routedEnqueueResultOf: one slip's jobs as the enqueue's answer (the 2B gate's ruling R1)", () => {
  assert.deepEqual(routedEnqueueResultOf([], 0), { outcome: "not-routed" }, "a notice no printer takes notices for: nothing to print, never a local print");
  assert.deepEqual(routedEnqueueResultOf([], 2), { outcome: "too-large" }, "routed, but no job could be stored");
  assert.deepEqual(routedEnqueueResultOf([inserted()], 1), { outcome: "queued", id: "j1", duplicate: false }, "one job: today's answer");
  assert.deepEqual(routedEnqueueResultOf([inserted({ created: false })], 1), { outcome: "queued", id: "j1", duplicate: true }, "a re-send of a waiting job");
  assert.deepEqual(routedEnqueueResultOf([inserted({ created: false, status: "printed" })], 1), { outcome: "already-resolved", id: "j1" }, "a re-send of a printed one");
  const leased = { id: "j2", epoch: 1 } as never;
  const two = routedEnqueueResultOf([inserted(), inserted({ id: "j2", printerId: "p2", status: "leased", leased })], 2);
  assert.equal(two.outcome, "queued");
  assert.deepEqual(two.outcome === "queued" ? [two.id, two.duplicate, two.leased, two.jobs?.map((j) => j.id)] : [], ["j1", false, leased, ["j1", "j2"]], "the first id, every job, and the one made leased to the asking tab");
  const failed = routedEnqueueResultOf([inserted({ status: "failed", printerId: PRINT_JOB_NO_PRINTER })], 1);
  assert.deepEqual(failed, { outcome: "queued", id: "j1", duplicate: false }, "a job failed at creation is new, and shows under Couldn't print");
});

test("PIN: printers mode routes every slip an order request makes; simple mode (no routing) is unchanged", () => {
  const s = src("apps/cafe/lib/print-order-jobs.ts");
  const fn = s.slice(s.indexOf("export async function createOrderPrintJobs("), s.indexOf("export async function enqueueOwnPrintJob("));
  inOrder(
    fn,
    [
      "try {",
      "const routing = await readPrintRouting({",
      "if (routing !== null) {",
      "await createRoutedPrintJobs({",
      "return jobs.map((job) => job.ref);",
      "const host = await PrintHost.findOne(",
      "const target = host?.deviceId ?? input.originDeviceId;",
      "} catch {",
    ],
    "createOrderPrintJobs",
  );
  const lib = src("apps/cafe/lib/print-printer-jobs.ts");
  assert.match(lib, /const jobKey = routedJobKey\(baseKey, job\);/, "a routed job's key adds its printer and part (decision 3)");
  assert.match(lib, /line: \{ printerId: PRINT_JOB_NO_PRINTER, copies: 1 \},\s*failed: job\.error/, "a slip no printer takes is made failed at once");
  assert.match(lib, /if \(announcesQueuedJob\(made, directOn\.has\(job\.printerId\)\)\) publishPrintStatus\(\{ id: made\.ref\.id, status: "queued", target: made\.ref\.targetDeviceId \}\);/, "each new queued job to its writer, never to yourself");
  assert.ok(!lib.includes('publishCafeEvent("print-job")'), "printers mode nudges no host");
  assert.equal(count(lib, "PrintJob.create("), 0, "one write point stays insertPrintJob");
  assert.ok(!lib.includes("console."), "no console.* in a server lib");
});

test("PIN: every order route and the self-order claim pass the ready printers and the device's bill printer; the enqueue routes first", () => {
  const routes = [
    "apps/cafe/app/api/orders/route.ts",
    "apps/cafe/app/api/orders/[id]/items/route.ts",
    "apps/cafe/app/api/orders/[id]/settle/route.ts",
    "apps/cafe/app/api/orders/[id]/items/void/route.ts",
    "apps/cafe/app/api/orders/[id]/table/route.ts",
    "apps/cafe/app/api/order-requests/[id]/accept/route.ts",
    "apps/cafe/lib/print-agent-server.ts",
  ];
  for (const rel of routes) {
    const s = src(rel);
    inOrder(s, ["leaseTabId: intent.leaseTabId,", "readyPrinterIds: intent.readyPrinterIds,", "billPrinterId: intent.billPrinterId,"], rel);
  }
  const route = src("apps/cafe/app/api/print-jobs/route.ts");
  inOrder(route, ["const intent = printIntentOf(req);", "const routed = await enqueueRoutedPrintJob({", "routed ??", "(await enqueuePrintJob({"], "the enqueue");
});
