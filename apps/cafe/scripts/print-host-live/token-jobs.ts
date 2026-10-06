/**
 * Print customization S7 live leg (ay) — the customer's token slip against a REAL MongoDB: which jobs an
 * order makes (and the keys that make a replay collide), the order they lease in, the cancelled-order
 * and reprint eligibility rules, the DUPLICATE label on an own reprint and on an expired lease, and the
 * deploy-skew fence (a pre-S7 tab never leases a token); and the token fix (2026-10-06): a token is never made
 * leased at creation, in printers mode, in simple mode, or by the enqueue. Run by scripts/verify-print-host-live.ts
 * after leg ax.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { PRINT_AGENT_HEADER, PRINT_DEVICE_ID_HEADER, PRINT_HEADER_ON, PRINT_LEASE_HEADER, PRINT_READY_HEADER } from "@pos/shared/print-agent-wire";
import { PRINT_DIRECT_LEASE_DETAIL, PRINT_LEASE_MS } from "@pos/shared/print-lifecycle";
import { PrintJob } from "@/models/PrintJob";
import { PrintHost } from "@/models/PrintHost";
import { PrintDevice } from "@/models/PrintDevice";
import { Printer } from "@/models/Printer";
import { Station } from "@/models/Station";
import { Order } from "@/models/Order";
import { createOrderPrintJobs, enqueueDirectPrintJob, enqueueOwnPrintJob, openingSlipsOf, printIntentOf, type PrintIntent } from "@/lib/print-order-jobs";
import { enqueuePrintJob } from "@/lib/print-queue";
import { ackPrintJob, leasePrintJobs } from "@/lib/print-lease";
import type { PrinterBody } from "@/lib/print-printer-schemas";
import { createPrinter } from "@/lib/print-printers";
import { listStations } from "@/lib/print-stations";
import { billPrintJob, kotPrintJob, tokenPrintJob } from "@/lib/print-routing";
import type { Order as OrderShape } from "@/types";
import { check, resetCollections, seedRealOrder } from "./harness";
import { HOST, STAFF, freshHost, lease, rowOf } from "./lifecycle";

const PHONE = "live-token-phone";
const TOKEN_NUMBER = 7;

async function setOrderRaw(id: string, set: Record<string, unknown>): Promise<void> {
  await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: set });
}

/** A seeded order as the wire sends it; with a token number when `token` is true. */
async function orderOf(token: boolean, extra: Record<string, unknown> = {}): Promise<OrderShape & { _id: string }> {
  const id = await seedRealOrder({ status: "Completed", kotRound: 1 });
  if (token || Object.keys(extra).length > 0) await setOrderRaw(id, { ...(token ? { tokenNumber: TOKEN_NUMBER } : {}), ...extra });
  const doc = await Order.findById(id).lean();
  if (doc === null) throw new Error("seeded order missing");
  return JSON.parse(JSON.stringify(doc)) as OrderShape & { _id: string };
}

const makeJobs = (order: OrderShape, slips: Parameters<typeof createOrderPrintJobs>[0]["slips"], nowMs: number) =>
  createOrderPrintJobs({ order, slips, originDeviceId: PHONE, queuedBy: STAFF, nowMs });

async function queue(job: { payload: Parameters<typeof enqueuePrintJob>[0]["payload"]; label: string }, nowMs: number): Promise<string> {
  const res = await enqueuePrintJob({ ...job, queuedBy: STAFF, nowMs });
  if (res.outcome !== "queued") throw new Error(`seed enqueue refused: ${res.outcome}`);
  return res.id;
}

export async function legAY(nowMs: number): Promise<void> {
  console.log("\n(ay) the token slip: jobs, keys, lease order, eligibility, DUPLICATE, and the deploy-skew fence");

  // Tokens off: no number on the order, so the opening slips are the KOT alone and no token key exists.
  await freshHost(nowMs);
  const plain = await orderOf(false);
  const off = await makeJobs(plain, [...openingSlipsOf(plain, 1), { kind: "bill" }], nowMs);
  check("(ay) no tokenNumber: the order makes [kot, bill] and no token job", off.map((r) => r.kind).join() === "kot,bill" && (await PrintJob.countDocuments({ kind: "token" })) === 0);
  check("(ay) ... and no token: key exists anywhere", (await PrintJob.countDocuments({ jobKey: /^token:/ })) === 0);

  // Tokens on: kot, token, bill in createdAt order, keyed as planned, leased in that order.
  await freshHost(nowMs);
  const order = await orderOf(true);
  const id = order._id;
  const refs = await makeJobs(order, [{ kind: "bill" }, ...openingSlipsOf(order, 1)], nowMs);
  const rows = await PrintJob.find({ orderId: id }).sort({ createdAt: 1, _id: 1 }).lean();
  check("(ay) a token order makes kot, token, bill, in createdAt order whatever order they were listed in", refs.map((r) => r.kind).join() === "kot,token,bill" && rows.map((r) => r.kind).join() === "kot,token,bill");
  check("(ay) keyed kot:<id>:1, token:<id>, bill:<id> and every job is queued for the host", rows.map((r) => r.jobKey).join() === `kot:${id}:1,token:${id},bill:${id}` && rows.every((r) => r.status === "queued" && r.targetDeviceId === HOST));
  check("(ay) the token job's snapshot carries the number and no reprint flag, labelled with it", (() => {
    const t = rows[1];
    const payload = t ? (JSON.parse(t.payload) as { snapshot?: { tokenNumber?: number }; reprint?: boolean }) : {};
    return payload.snapshot?.tokenNumber === TOKEN_NUMBER && payload.reprint === undefined && (t?.label ?? "").startsWith(`Token ${TOKEN_NUMBER}`) && (t?.labels ?? []).length === 0;
  })());
  const order3: string[] = [];
  for (let i = 0; i < 3; i++) {
    const got = await lease(nowMs, `tab-${i}`);
    const job = got.jobs[0];
    order3.push(job?.kind ?? "none");
    if (job) await ackPrintJob({ id: job.id, deviceId: HOST, epoch: job.epoch, outcome: "printed", nowMs });
  }
  check("(ay) a tokenSlips:true lease hands them out kot, token, bill", order3.join() === "kot,token,bill");

  // A replay and an old tab's enqueue of the token collide on the same key and id.
  const tokenRef = refs.find((r) => r.kind === "token");
  const replay = await makeJobs(order, openingSlipsOf(order, 1), nowMs);
  const oldTab = await enqueuePrintJob({ ...tokenPrintJob(order, { reprint: false }), queuedBy: STAFF, nowMs });
  check("(ay) a replay answers the same token job and makes no second one", replay.find((r) => r.kind === "token")?.id === tokenRef?.id && (await PrintJob.countDocuments({ jobKey: `token:${id}` })) === 1);
  check("(ay) an old tab's enqueue of the token lands on the same job (already printed: resolved)", oldTab.outcome === "already-resolved" && oldTab.id === tokenRef?.id);

  // Round 2 of the same order: KOT only.
  await freshHost(nowMs);
  const tabOrder = await orderOf(true, { kotRounds: 2 });
  const second = await makeJobs(tabOrder, openingSlipsOf(tabOrder, 2), nowMs);
  check("(ay) round 2 makes the KOT only, no token", second.map((r) => r.kind).join() === "kot" && (await PrintJob.countDocuments({ kind: "token" })) === 0);

  // Cancelled: the first token is dismissed order-cancelled; a reprint:true token is leased.
  await freshHost(nowMs);
  const gone = await orderOf(true, { status: "Cancelled" });
  const lone = await makeJobs(gone, [{ kind: "token" }], nowMs);
  const refused = await lease(nowMs);
  const loneRow = await rowOf(lone[0]?.id ?? "");
  check("(ay) a cancelled order's token is dismissed order-cancelled at the lease, never handed out", refused.jobs.length === 0 && loneRow?.status === "dismissed" && loneRow?.dismissReason === "order-cancelled");
  const reprintId = await queue(tokenPrintJob(gone, { reprint: true }), nowMs);
  const reprinted = await lease(nowMs, "tab-b");
  const reprintRow = await rowOf(reprintId);
  check("(ay) a reprint:true token of that cancelled order IS leased (eligible before the cancelled gate), with DUPLICATE", reprinted.jobs[0]?.id === reprintId && reprinted.jobs[0]?.labels.join() === "DUPLICATE" && reprintRow?.jobKey === undefined);

  // An own reprint (no host) twice with the same idempotency key: one job, DUPLICATE.
  await PrintHost.deleteMany({});
  await PrintJob.deleteMany({});
  const mine = await orderOf(true);
  const reprintJob = tokenPrintJob(mine, { reprint: true });
  const first = await enqueueOwnPrintJob({ ...reprintJob, queuedBy: STAFF, idempotencyKey: "live-token-own-0001", originDeviceId: PHONE, nowMs });
  const retry = await enqueueOwnPrintJob({ ...reprintJob, queuedBy: STAFF, idempotencyKey: "live-token-own-0001", originDeviceId: PHONE, nowMs });
  const firstId = first.outcome === "queued" ? first.id : "";
  const ownRow = await rowOf(firstId);
  check("(ay) an own token reprint x2 with the same idempotency key is ONE job, DUPLICATE, aimed at the asking device", first.outcome === "queued" && retry.outcome === "queued" && retry.duplicate && retry.id === firstId && (await PrintJob.countDocuments({ kind: "token" })) === 1 && JSON.stringify(ownRow?.labels) === '["DUPLICATE"]' && ownRow?.targetDeviceId === PHONE);

  // An expired token lease: queued again with DUPLICATE, never needs-confirm.
  await freshHost(nowMs);
  const expiring = await orderOf(true);
  const expId = await queue(tokenPrintJob(expiring, { reprint: false }), nowMs);
  await lease(nowMs);
  const later = nowMs + PRINT_LEASE_MS + 1;
  await lease(later, "tab-b");
  const expRow = await rowOf(expId);
  check("(ay) a token whose lease ran out is queued again with DUPLICATE, never parked for the cashier", expRow?.status === "queued" && expRow?.uncertainAttempts === 1 && JSON.stringify(expRow?.labels) === '["DUPLICATE"]' && expRow?.lease === undefined);

  // The skew fence: a pre-S7 tab (tokenSlips:false) leases the bill behind a token head; the token waits untouched.
  await freshHost(nowMs);
  const skew = await orderOf(true);
  const tokenId = await queue(tokenPrintJob(skew, { reprint: false }), nowMs);
  const billId = await queue(billPrintJob(skew, { reprint: false }), nowMs);
  const old = await leasePrintJobs({ deviceId: HOST, tabId: "old-tab", dismissedBy: STAFF, nowMs, tokenSlips: false });
  const tokenRow = await rowOf(tokenId);
  check("(ay) skew: a tab without tokenSlips leases the BILL behind a token at the head", old.jobs.length === 1 && old.jobs[0]?.id === billId && old.jobs[0]?.kind === "bill");
  check("(ay) skew: the token stays queued and untouched (epoch 0, no attempts, no lease, no log entry past created)", tokenRow?.status === "queued" && (tokenRow?.epoch ?? 0) === 0 && (tokenRow?.attempts ?? 0) === 0 && tokenRow?.lease === undefined && (tokenRow?.log ?? []).length === 1);
  const none = await leasePrintJobs({ deviceId: HOST, tabId: "old-tab-2", dismissedBy: STAFF, nowMs, tokenSlips: false });
  check("(ay) skew: with only the token left, a pre-S7 tab gets nothing and no retry (it is not its job)", none.jobs.length === 0);
  const billLeased = old.jobs[0];
  if (billLeased) await ackPrintJob({ id: billLeased.id, deviceId: HOST, epoch: billLeased.epoch, outcome: "printed", nowMs });
  const capable = await lease(nowMs, "new-tab");
  check("(ay) skew: a later tokenSlips:true lease gets the token, first print (no label)", capable.jobs[0]?.id === tokenId && capable.jobs[0]?.kind === "token" && capable.jobs[0]?.labels.length === 0 && capable.jobs[0]?.epoch === 1);
  // Landmark that the fence is the token's alone: a KOT is still leased by a tab without tokenSlips.
  await freshHost(nowMs);
  const kotOrder = await orderOf(false);
  const kotId = await queue(kotPrintJob(kotOrder, 1), nowMs);
  const kotOld = await leasePrintJobs({ deviceId: HOST, tabId: "old-tab", dismissedBy: STAFF, nowMs, tokenSlips: false });
  check("(ay) skew: the fence is the token's alone, a KOT is still leased by a pre-S7 tab", kotOld.jobs[0]?.id === kotId);

  await tokenNeverDirect(nowMs);
}

// ── The token fix (plan 2026-10-06-token-direct-fix.md, T1): a token is never made leased at creation ──────────
// The kind fence above guards the lease call only; a slip made leased at creation never passes one. So a token is made
// queued on every creation path, and a page that can draw it leases it next: once, unlabelled.

const COUNTER = "live-token-counter";
const KITCHEN = "live-token-kitchen";
const COUNTER_TAB = "live-token-counter-tab";
const NO_SLIPS = { bill: false, kotStations: [] as string[], kotAll: false, notices: false, eod: false };

/** The asking request exactly as an order route parses it: the counter tab drains its device's slips and can print on
 *  `ready` now (x-pos-print-lease, x-pos-print-ready). */
function intentOf(device: string, tab: string, ready: string[]): PrintIntent {
  const headers = { [PRINT_AGENT_HEADER]: PRINT_HEADER_ON, [PRINT_DEVICE_ID_HEADER]: device, [PRINT_LEASE_HEADER]: tab, [PRINT_READY_HEADER]: ready.join(",") };
  const intent = printIntentOf(new Request("http://live.invalid/api/orders", { method: "POST", headers }));
  if (intent === null) throw new Error("the print headers did not parse");
  return intent;
}

/** Printers mode: a kitchen printer the kitchen tablet writes (the default station's KOTs), and a separate bill
 *  printer the counter device writes (bills, hence tokens). */
async function counterAndKitchen(): Promise<{ counter: string; kitchen: string }> {
  await Promise.all([resetCollections(), PrintDevice.deleteMany({}), Station.deleteMany({}), Printer.deleteMany({})]);
  const [kitchenStation] = await listStations();
  const printer = (name: string, host: string, writer: string, slips: PrinterBody["slips"]): PrinterBody => ({
    name,
    connection: { kind: "lan", host, port: 9100 },
    primaryDeviceId: writer,
    paper: 80,
    slips,
    copies: { kot: 1, bill: 1 },
    enabled: true,
  });
  const idOf = async (made: ReturnType<typeof createPrinter>): Promise<string> => {
    const result = await made;
    return result.ok && result.data !== undefined ? result.data.id : "";
  };
  const kitchen = await idOf(createPrinter(printer("Kitchen", "10.0.0.71", KITCHEN, { ...NO_SLIPS, kotStations: [kitchenStation?.id ?? ""] })));
  const counter = await idOf(createPrinter(printer("Counter", "10.0.0.72", COUNTER, { ...NO_SLIPS, bill: true })));
  return { counter, kitchen };
}

async function tokenNeverDirect(nowMs: number): Promise<void> {
  console.log("\n(ay) the token fix: a token is never made leased at creation (printers mode, simple mode, the enqueue)");
  const { counter, kitchen } = await counterAndKitchen();
  const intent = intentOf(COUNTER, COUNTER_TAB, [counter]);
  check("(ay) direct: the route's own parse of the counter's request names its tab and its ready bill printer", intent.deviceId === COUNTER && intent.leaseTabId === COUNTER_TAB && intent.readyPrinterIds?.join() === counter);
  const payNow = (order: OrderShape) =>
    createOrderPrintJobs({
      order,
      slips: [...openingSlipsOf(order, 1), { kind: "bill" }],
      originDeviceId: intent.deviceId,
      leaseTabId: intent.leaseTabId,
      readyPrinterIds: intent.readyPrinterIds,
      queuedBy: STAFF,
      nowMs,
    });
  const counterLease = (tokenSlips: boolean, at: number, tabId = COUNTER_TAB) =>
    leasePrintJobs({ deviceId: COUNTER, tabId, tokenSlips, printerIds: [counter], dismissedBy: STAFF, nowMs: at });

  // Landmark: with no token, the same request's bill (first on the counter's line) is still made leased(direct).
  const plainRefs = await payNow(await orderOf(false));
  const plainBill = plainRefs.find((r) => r.kind === "bill");
  check("(ay) direct, landmark: no token: the bill, first on the counter's line, is made leased(direct) to the asking tab as before", plainBill?.status === "leased" && plainBill.leased !== undefined && (await rowOf(plainBill.id))?.log?.[1]?.detail === PRINT_DIRECT_LEASE_DETAIL);

  // Tokens on: the token heads the counter's line, made queued; the bill waits behind it; the KOT is the kitchen's.
  await resetCollections();
  const refs = await payNow(await orderOf(true));
  const [kot, token, bill] = ["kot", "token", "bill"].map((kind) => refs.find((r) => r.kind === kind));
  const tokenRow = await rowOf(token?.id ?? "");
  check("(ay) direct: printers mode, the token on the asking tab's own bill printer is queued, NOT leased(direct)", token?.status === "queued" && token.leased === undefined && token.printerId === counter && tokenRow?.status === "queued" && tokenRow.lease === undefined && JSON.stringify(tokenRow.log?.map((e) => e.event)) === '["created"]');
  check("(ay) direct: the bill waits queued behind it; the KOT waits for the kitchen tablet", bill?.status === "queued" && bill.leased === undefined && bill.printerId === counter && kot?.status === "queued" && kot.targetDeviceId === KITCHEN && kot.printerId === kitchen);
  const first = await counterLease(true, nowMs + 1_000);
  check("(ay) direct: the counter's page leases it right after: the token first, epoch 1, attempt 1, no label", first.jobs.length === 1 && first.jobs[0]?.id === token?.id && first.jobs[0]?.epoch === 1 && first.jobs[0]?.attempt === 1 && first.jobs[0]?.labels.length === 0);
  const acked = await ackPrintJob({ id: token?.id ?? "", deviceId: COUNTER, epoch: 1, outcome: "printed", nowMs: nowMs + 2_000 });
  const second = await counterLease(true, nowMs + 3_000);
  check("(ay) direct: printed once; the ack says the line holds more, and the next lease is the bill", acked.status === "printed" && acked.more === true && second.jobs[0]?.id === bill?.id && (await rowOf(token?.id ?? ""))?.attempts === 1);

  // An older page still open on the counter: it is never handed the token. It steps over it (the kind fence) and
  // prints the bill; the token waits untouched for a page that can draw it, which prints it once, unlabelled.
  await resetCollections();
  const skewRefs = await payNow(await orderOf(true));
  const skewToken = skewRefs.find((r) => r.kind === "token");
  const old = await counterLease(false, nowMs + 1_000, "old-counter-tab");
  const untouched = await rowOf(skewToken?.id ?? "");
  check("(ay) direct: an older page's lease gets the bill and steps over the token, which stays queued (epoch 0, no attempt)", old.jobs.length === 1 && old.jobs[0]?.kind === "bill" && untouched?.status === "queued" && (untouched?.epoch ?? 0) === 0 && (untouched?.attempts ?? 0) === 0);
  await ackPrintJob({ id: old.jobs[0]?.id ?? "", deviceId: COUNTER, epoch: old.jobs[0]?.epoch ?? 0, outcome: "printed", nowMs: nowMs + 2_000 });
  const reloaded = await counterLease(true, nowMs + 3_000);
  check("(ay) direct: a reloaded page then prints the token once, unlabelled: no maybe, no DUPLICATE", reloaded.jobs[0]?.id === skewToken?.id && reloaded.jobs[0]?.labels.length === 0 && reloaded.jobs[0]?.epoch === 1);
  await Printer.deleteMany({});

  // Simple mode: the token is the request's first slip on the host tab's own free line.
  await freshHost(nowMs);
  const kotFirst = await createOrderPrintJobs({ order: await orderOf(true), slips: [{ kind: "kot", round: 1 }], originDeviceId: HOST, leaseTabId: "host-tab", queuedBy: STAFF, nowMs });
  check("(ay) direct, landmark: simple mode, a KOT first on the host tab's free line is still made leased(direct)", kotFirst[0]?.status === "leased" && kotFirst[0]?.leased !== undefined);
  await freshHost(nowMs);
  const lone = await orderOf(true);
  const loneRefs = await createOrderPrintJobs({ order: lone, slips: [{ kind: "token" }], originDeviceId: HOST, leaseTabId: "host-tab", queuedBy: STAFF, nowMs });
  const loneRow = await rowOf(loneRefs[0]?.id ?? "");
  check("(ay) direct: simple mode, a token that would have been the request's first slip is queued, NOT leased(direct)", loneRefs.length === 1 && loneRefs[0]?.status === "queued" && loneRefs[0]?.leased === undefined && loneRow?.status === "queued" && loneRow.lease === undefined);
  const got = await lease(nowMs + 1_000, "host-tab");
  check("(ay) direct: the host's next lease prints it once, unlabelled", got.jobs[0]?.id === loneRefs[0]?.id && got.jobs[0]?.labels.length === 0 && got.jobs[0]?.epoch === 1);

  // The enqueue (POST /api/print-jobs with the lease header): its direct lane refuses a token, so Phase 1's lane makes it.
  await freshHost(nowMs);
  const reprint = tokenPrintJob(lone, { reprint: true });
  const direct = await enqueueDirectPrintJob({ payload: reprint.payload, label: reprint.label, queuedBy: STAFF, originDeviceId: HOST, leaseTabId: "host-tab", nowMs });
  const phase1 = await enqueuePrintJob({ payload: reprint.payload, label: reprint.label, queuedBy: STAFF, idempotencyKey: "live-token-enq-0001", originDeviceId: HOST, nowMs });
  const phase1Row = await rowOf(phase1.outcome === "queued" ? phase1.id : "");
  check("(ay) direct: the enqueue's direct lane refuses a token (null): the host lane makes it queued, never leased", direct === null && (await PrintJob.countDocuments({})) === 1 && phase1Row?.status === "queued" && phase1Row.lease === undefined);
}
