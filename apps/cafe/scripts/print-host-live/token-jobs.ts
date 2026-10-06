/**
 * Print customization S7 live leg (ah) — the customer's token slip against a REAL MongoDB: which jobs an
 * order makes (and the keys that make a replay collide), the order they lease in, the cancelled-order
 * and reprint eligibility rules, the DUPLICATE label on an own reprint and on an expired lease, and the
 * deploy-skew fence (a pre-S7 tab never leases a token). Run by scripts/verify-print-host-live.ts after leg ag.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { PRINT_LEASE_MS } from "@pos/shared/print-lifecycle";
import { PrintJob } from "@/models/PrintJob";
import { PrintHost } from "@/models/PrintHost";
import { Order } from "@/models/Order";
import { createOrderPrintJobs, enqueueOwnPrintJob, openingSlipsOf } from "@/lib/print-order-jobs";
import { enqueuePrintJob } from "@/lib/print-queue";
import { ackPrintJob, leasePrintJobs } from "@/lib/print-lease";
import { billPrintJob, kotPrintJob, tokenPrintJob } from "@/lib/print-routing";
import type { Order as OrderShape } from "@/types";
import { check, seedRealOrder } from "./harness";
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

export async function legAH(nowMs: number): Promise<void> {
  console.log("\n(ah) the token slip: jobs, keys, lease order, eligibility, DUPLICATE, and the deploy-skew fence");

  // Tokens off: no number on the order, so the opening slips are the KOT alone and no token key exists.
  await freshHost(nowMs);
  const plain = await orderOf(false);
  const off = await makeJobs(plain, [...openingSlipsOf(plain, 1), { kind: "bill" }], nowMs);
  check("(ah) no tokenNumber: the order makes [kot, bill] and no token job", off.map((r) => r.kind).join() === "kot,bill" && (await PrintJob.countDocuments({ kind: "token" })) === 0);
  check("(ah) ... and no token: key exists anywhere", (await PrintJob.countDocuments({ jobKey: /^token:/ })) === 0);

  // Tokens on: kot, token, bill in createdAt order, keyed as planned, leased in that order.
  await freshHost(nowMs);
  const order = await orderOf(true);
  const id = order._id;
  const refs = await makeJobs(order, [{ kind: "bill" }, ...openingSlipsOf(order, 1)], nowMs);
  const rows = await PrintJob.find({ orderId: id }).sort({ createdAt: 1, _id: 1 }).lean();
  check("(ah) a token order makes kot, token, bill, in createdAt order whatever order they were listed in", refs.map((r) => r.kind).join() === "kot,token,bill" && rows.map((r) => r.kind).join() === "kot,token,bill");
  check("(ah) keyed kot:<id>:1, token:<id>, bill:<id> and every job is queued for the host", rows.map((r) => r.jobKey).join() === `kot:${id}:1,token:${id},bill:${id}` && rows.every((r) => r.status === "queued" && r.targetDeviceId === HOST));
  check("(ah) the token job's snapshot carries the number and no reprint flag, labelled with it", (() => {
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
  check("(ah) a tokenSlips:true lease hands them out kot, token, bill", order3.join() === "kot,token,bill");

  // A replay and an old tab's enqueue of the token collide on the same key and id.
  const tokenRef = refs.find((r) => r.kind === "token");
  const replay = await makeJobs(order, openingSlipsOf(order, 1), nowMs);
  const oldTab = await enqueuePrintJob({ ...tokenPrintJob(order, { reprint: false }), queuedBy: STAFF, nowMs });
  check("(ah) a replay answers the same token job and makes no second one", replay.find((r) => r.kind === "token")?.id === tokenRef?.id && (await PrintJob.countDocuments({ jobKey: `token:${id}` })) === 1);
  check("(ah) an old tab's enqueue of the token lands on the same job (already printed: resolved)", oldTab.outcome === "already-resolved" && oldTab.id === tokenRef?.id);

  // Round 2 of the same order: KOT only.
  await freshHost(nowMs);
  const tabOrder = await orderOf(true, { kotRounds: 2 });
  const second = await makeJobs(tabOrder, openingSlipsOf(tabOrder, 2), nowMs);
  check("(ah) round 2 makes the KOT only, no token", second.map((r) => r.kind).join() === "kot" && (await PrintJob.countDocuments({ kind: "token" })) === 0);

  // Cancelled: the first token is dismissed order-cancelled; a reprint:true token is leased.
  await freshHost(nowMs);
  const gone = await orderOf(true, { status: "Cancelled" });
  const lone = await makeJobs(gone, [{ kind: "token" }], nowMs);
  const refused = await lease(nowMs);
  const loneRow = await rowOf(lone[0]?.id ?? "");
  check("(ah) a cancelled order's token is dismissed order-cancelled at the lease, never handed out", refused.jobs.length === 0 && loneRow?.status === "dismissed" && loneRow?.dismissReason === "order-cancelled");
  const reprintId = await queue(tokenPrintJob(gone, { reprint: true }), nowMs);
  const reprinted = await lease(nowMs, "tab-b");
  const reprintRow = await rowOf(reprintId);
  check("(ah) a reprint:true token of that cancelled order IS leased (eligible before the cancelled gate), with DUPLICATE", reprinted.jobs[0]?.id === reprintId && reprinted.jobs[0]?.labels.join() === "DUPLICATE" && reprintRow?.jobKey === undefined);

  // An own reprint (no host) twice with the same idempotency key: one job, DUPLICATE.
  await PrintHost.deleteMany({});
  await PrintJob.deleteMany({});
  const mine = await orderOf(true);
  const reprintJob = tokenPrintJob(mine, { reprint: true });
  const first = await enqueueOwnPrintJob({ ...reprintJob, queuedBy: STAFF, idempotencyKey: "live-token-own-0001", originDeviceId: PHONE, nowMs });
  const retry = await enqueueOwnPrintJob({ ...reprintJob, queuedBy: STAFF, idempotencyKey: "live-token-own-0001", originDeviceId: PHONE, nowMs });
  const firstId = first.outcome === "queued" ? first.id : "";
  const ownRow = await rowOf(firstId);
  check("(ah) an own token reprint x2 with the same idempotency key is ONE job, DUPLICATE, aimed at the asking device", first.outcome === "queued" && retry.outcome === "queued" && retry.duplicate && retry.id === firstId && (await PrintJob.countDocuments({ kind: "token" })) === 1 && JSON.stringify(ownRow?.labels) === '["DUPLICATE"]' && ownRow?.targetDeviceId === PHONE);

  // An expired token lease: queued again with DUPLICATE, never needs-confirm.
  await freshHost(nowMs);
  const expiring = await orderOf(true);
  const expId = await queue(tokenPrintJob(expiring, { reprint: false }), nowMs);
  await lease(nowMs);
  const later = nowMs + PRINT_LEASE_MS + 1;
  await lease(later, "tab-b");
  const expRow = await rowOf(expId);
  check("(ah) a token whose lease ran out is queued again with DUPLICATE, never parked for the cashier", expRow?.status === "queued" && expRow?.uncertainAttempts === 1 && JSON.stringify(expRow?.labels) === '["DUPLICATE"]' && expRow?.lease === undefined);

  // The skew fence: a pre-S7 tab (tokenSlips:false) leases the bill behind a token head; the token waits untouched.
  await freshHost(nowMs);
  const skew = await orderOf(true);
  const tokenId = await queue(tokenPrintJob(skew, { reprint: false }), nowMs);
  const billId = await queue(billPrintJob(skew, { reprint: false }), nowMs);
  const old = await leasePrintJobs({ deviceId: HOST, tabId: "old-tab", dismissedBy: STAFF, nowMs, tokenSlips: false });
  const tokenRow = await rowOf(tokenId);
  check("(ah) skew: a tab without tokenSlips leases the BILL behind a token at the head", old.jobs.length === 1 && old.jobs[0]?.id === billId && old.jobs[0]?.kind === "bill");
  check("(ah) skew: the token stays queued and untouched (epoch 0, no attempts, no lease, no log entry past created)", tokenRow?.status === "queued" && (tokenRow?.epoch ?? 0) === 0 && (tokenRow?.attempts ?? 0) === 0 && tokenRow?.lease === undefined && (tokenRow?.log ?? []).length === 1);
  const none = await leasePrintJobs({ deviceId: HOST, tabId: "old-tab-2", dismissedBy: STAFF, nowMs, tokenSlips: false });
  check("(ah) skew: with only the token left, a pre-S7 tab gets nothing and no retry (it is not its job)", none.jobs.length === 0);
  const billLeased = old.jobs[0];
  if (billLeased) await ackPrintJob({ id: billLeased.id, deviceId: HOST, epoch: billLeased.epoch, outcome: "printed", nowMs });
  const capable = await lease(nowMs, "new-tab");
  check("(ah) skew: a later tokenSlips:true lease gets the token, first print (no label)", capable.jobs[0]?.id === tokenId && capable.jobs[0]?.kind === "token" && capable.jobs[0]?.labels.length === 0 && capable.jobs[0]?.epoch === 1);
  // Landmark that the fence is the token's alone: a KOT is still leased by a tab without tokenSlips.
  await freshHost(nowMs);
  const kotOrder = await orderOf(false);
  const kotId = await queue(kotPrintJob(kotOrder, 1), nowMs);
  const kotOld = await leasePrintJobs({ deviceId: HOST, tabId: "old-tab", dismissedBy: STAFF, nowMs, tokenSlips: false });
  check("(ah) skew: the fence is the token's alone, a KOT is still leased by a pre-S7 tab", kotOld.jobs[0]?.id === kotId);
}
