import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { PRINT_JOB_NO_PRINTER } from "@pos/shared/print-printers";
import type { PrintJobRef } from "@pos/shared/print-agent-wire";
import { stripComments } from "@/lib/source-pin-utils";
import type { InsertedPrintJob } from "@/lib/print-job-insert";
import type { PrintRouting, RoutedPrintJob } from "@/lib/print-printer-routing";
import { askingTabOf, createRoutedPrintJobs, printPayloadProductIds, routedEnqueueResultOf } from "@/lib/print-printer-jobs";
import { printJobKeyOf } from "@/lib/print-queue";
import { billPrintJob, kotPrintJob, tokenPrintJob } from "@/lib/print-routing";
import { PrintJob } from "@/models/PrintJob";
import type { Order } from "@/types";

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

test("printPayloadProductIds: a token slip reads no catalog (no station: it goes where the bill does); a kot still yields its lines", () => {
  const snapshot = { items: SNAPSHOT_ITEMS } as never;
  assert.deepEqual(printPayloadProductIds({ kind: "token", snapshot } as never), [], "a token has lines in its snapshot but resolves no station");
  assert.deepEqual(printPayloadProductIds({ kind: "token", snapshot, reprint: true } as never), []);
  // positive landmark: the same snapshot DOES yield its product ids for a kot and a bill, so [] above is the token rule
  assert.deepEqual(printPayloadProductIds({ kind: "kot", snapshot, round: 1 } as never), ["p-chai", "p-cake"]);
  assert.deepEqual(printPayloadProductIds({ kind: "bill", snapshot } as never), ["p-chai", "p-cake"]);
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
  assert.match(
    lib,
    /if \(announcesQueuedJob\(made, directOn\.has\(job\.printerId\)\)\) publishPrintStatus\(\{ id: made\.ref\.id, status: "queued", target: made\.ref\.targetDeviceId, printerId: job\.printerId \}\);/,
    "each new queued job to its writer, never to yourself, with its printer (the 2E gate, M-1)",
  );
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

// ── The token fix (plan 2026-10-06-token-direct-fix.md, T1): the REAL createRoutedPrintJobs over a fake PrintJob ──
// A counter device writes the bill printer and asks with its tab and that printer ready (x-pos-print-lease and
// x-pos-print-ready); the kitchen tablet writes the KOT printer. What is made and what is announced is read from
// the fake's writes and from the realtime publish itself (its fetch), never from a fake of the logic.

const T = Date.UTC(2026, 9, 6, 12);
const COUNTER_ID = "665f0a0000000000000000c1";
const KITCHEN_ID = "665f0a0000000000000000c2";
const LAN = { kind: "lan", host: "10.0.0.9", port: 9100 } as const;
const NONE_TAKEN = { bill: false, kotStations: [] as string[], kotAll: false, notices: false, eod: false };
const OUTLET: PrintRouting = {
  printers: [
    { id: KITCHEN_ID, name: "Kitchen", connection: LAN, primaryDeviceId: "dev-k", order: 0, paper: 80, slips: { ...NONE_TAKEN, kotStations: ["st-k"] }, copies: { kot: 1, bill: 1 }, enabled: true },
    { id: COUNTER_ID, name: "Counter", connection: LAN, primaryDeviceId: "dev-a", order: 1, paper: 80, slips: { ...NONE_TAKEN, bill: true }, copies: { kot: 1, bill: 1 }, enabled: true },
  ],
  stations: [{ id: "st-k", name: "Kitchen", order: 0, isDefault: true }],
  itemStations: new Map([["p1", "st-k"]]),
};

function tokenOrder(): Order {
  return {
    _id: "665f0a0000000000000000a1",
    orderId: "ORD-0001",
    customerName: "Walk-in",
    items: [{ productId: "p1", name: "Filter Coffee", price: 4000, qty: 2, modifiers: [], instructions: "", kotRound: 1 }],
    subtotal: 8000,
    discount: 0,
    total: 8000,
    paidAmount: 8000,
    payment: "Cash",
    status: "Completed",
    receiver: "Staff",
    kotRounds: 1,
    tokenNumber: 7,
    createdAt: "2026-10-06T12:00:00.000Z",
    updatedAt: "2026-10-06T12:00:00.000Z",
  } as Order;
}

type MadeRow = { kind: string; status?: string; printerId?: string; targetDeviceId?: string; lease?: unknown };
type Published = { status?: string; target?: string; printerId?: string };

/** A fake PrintJob (every create kept in call order; every line free) and a captured realtime publish. */
async function withFakeJobs(run: (made: MadeRow[], published: Published[]) => Promise<void>): Promise<void> {
  const made: MadeRow[] = [];
  const published: Published[] = [];
  const model = PrintJob as unknown as Record<string, unknown>;
  const [realCreate, realFindOne, realFetch] = [model.create, model.findOne, globalThis.fetch];
  const env = { url: process.env.REALTIME_PUBLISH_URL, secret: process.env.REALTIME_PUBLISH_SECRET };
  model.create = async (doc: MadeRow) => {
    const row = { ...doc, _id: `job-${made.length + 1}`, createdAt: new Date(T) };
    made.push({ ...doc, status: doc.status ?? "queued" });
    return row;
  };
  // printerLineIsFree: nothing older waits on any line.
  model.findOne = () => ({ select: () => ({ lean: async () => null }) });
  process.env.REALTIME_PUBLISH_URL = "https://realtime.invalid/publish";
  process.env.REALTIME_PUBLISH_SECRET = "test-secret";
  globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
    const body = JSON.parse(String(init?.body)) as { kind?: string; job?: Published };
    if (body.kind === "print-status" && body.job !== undefined) published.push(body.job);
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  try {
    await run(made, published);
  } finally {
    model.create = realCreate;
    model.findOne = realFindOne;
    globalThis.fetch = realFetch;
    for (const [key, value] of [["REALTIME_PUBLISH_URL", env.url], ["REALTIME_PUBLISH_SECRET", env.secret]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const routedRequest = (asker: { device: string; tab?: string; ready: string[] }, requests: ReturnType<typeof kotPrintJob>[]) =>
  createRoutedPrintJobs({
    routing: OUTLET,
    requests,
    baseKeyOf: (request) => printJobKeyOf(request.payload),
    originDeviceId: asker.device,
    ...(asker.tab !== undefined ? { leaseTabId: asker.tab } : {}),
    readyPrinterIds: asker.ready,
    queuedBy: "Asha",
    nowMs: T,
  });
const shapeOf = (made: MadeRow[]): string[] => made.map((row) => `${row.kind}@${row.printerId === COUNTER_ID ? "counter" : "kitchen"}:${row.status}`);
const announced = (published: Published[]): string[] => published.map((job) => `${job.status}>${job.target}`);

test("createRoutedPrintJobs (the token fix): a token on the asking tab's own bill printer is made queued, never leased, and is not announced to that tab", async () => {
  await withFakeJobs(async (made, published) => {
    const order = tokenOrder();
    const { jobs } = await routedRequest({ device: "dev-a", tab: "tab-1", ready: [COUNTER_ID] }, [kotPrintJob(order, 1), tokenPrintJob(order, { reprint: false }), billPrintJob(order, { reprint: false })]);
    assert.deepEqual(shapeOf(made), ["kot@kitchen:queued", "token@counter:queued", "bill@counter:queued"], "the token waits queued at the head of the counter's line, the bill behind it");
    assert.equal(made[1]?.lease, undefined, "no lease is written for the token at creation");
    const token = jobs.find((job) => job.ref.kind === "token");
    assert.ok(token !== undefined && token.ref.status === "queued" && token.ref.leased === undefined, "the answer names the token queued, handed to no tab: the page that can draw it leases it next");
    assert.deepEqual(announced(published), ["queued>dev-k"], "only the kitchen's KOT is announced, to its writer; the token and the bill are the asking tab's, from the answer (decision 16)");
  });
});

test("createRoutedPrintJobs (the token fix): landmark, tokens off: the same request's bill IS made leased to the asking tab (kot and bill direct print unchanged)", async () => {
  await withFakeJobs(async (made, published) => {
    const order = tokenOrder();
    const { jobs } = await routedRequest({ device: "dev-a", tab: "tab-1", ready: [COUNTER_ID] }, [kotPrintJob(order, 1), billPrintJob(order, { reprint: false })]);
    assert.deepEqual(shapeOf(made), ["kot@kitchen:queued", "bill@counter:leased"], "the bill is the request's first job on the counter: made leased to the asking tab");
    assert.ok(jobs.find((job) => job.ref.kind === "bill")?.ref.leased !== undefined, "its ref carries the lease");
    assert.deepEqual(announced(published), ["queued>dev-k"], "the leased bill is not announced");
  });
});

test("createRoutedPrintJobs (the token fix): landmark, a token another device's printer prints is announced to that writer, as before", async () => {
  await withFakeJobs(async (made, published) => {
    const order = tokenOrder();
    await routedRequest({ device: "dev-phone", tab: "tab-p", ready: [] }, [kotPrintJob(order, 1), tokenPrintJob(order, { reprint: false }), billPrintJob(order, { reprint: false })]);
    assert.deepEqual(shapeOf(made), ["kot@kitchen:queued", "token@counter:queued", "bill@counter:queued"], "a phone that writes no printer gets nothing leased");
    assert.deepEqual(announced(published), ["queued>dev-k", "queued>dev-a", "queued>dev-a"], "each new queued job is announced to its writer");
  });
});
