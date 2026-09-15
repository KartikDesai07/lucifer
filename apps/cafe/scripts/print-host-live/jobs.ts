/**
 * PH-10 Slice F — legs a-d, i, k: enqueue dedupe/CAS races, claim CAS races,
 * dismiss CAS races, and the wire-payload round-trip. See
 * .claude/plan/v2/_research/ph10-plan-wf_c0fffa3b.md §Slice F for the table
 * this implements; amendment (a) adds the concurrent enqueue variant.
 */
import assert from "node:assert/strict";
import { PrintJob } from "@/models/PrintJob";
import { enqueuePrintJob, dismissPrintJob } from "@/lib/print-queue";
import { claimPrintJob } from "@/lib/print-queue-claim";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import {
  kotPrintJob,
  billPrintJob,
  voidPrintJob,
  movedPrintJob,
  eodPrintJob,
  cancelNoticePrintJob,
} from "@/lib/print-routing";
import type { OrderVoid } from "@/types";
import { check, seedPrintHost, seedRealOrder, resetCollections, baseOrderFields } from "./harness";

const HOST_DEVICE = "HOST-1";

async function seedHost(nowMs: number): Promise<void> {
  await seedPrintHost({ deviceId: HOST_DEVICE, label: "Counter PC", setBy: "Admin", nowMs });
}

// ── Leg a — dedupe key collisions + amendment (a)'s concurrent variant ──────
export async function legA(nowMs: number): Promise<void> {
  console.log("\nLeg a — enqueuePrintJob dedupe: sequential retry, already-resolved, and a CONCURRENT double-mint\n");
  await resetCollections();
  await seedHost(nowMs);

  // A first-time (non-reprint) bill NEEDS a live Order read at claim time
  // (printJobNeedsOrderRead), so this fixture's snapshot._id must match a REAL
  // seeded Order — an opaque string id would dismiss the claim as
  // invalid-payload (mongoose.isValidObjectId gate), never reach the CAS.
  const seqOrderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const order = baseOrderFields({ _id: seqOrderId, orderId: "ORD-A-SEQ" });
  const { payload, label } = billPrintJob(order, { reprint: false });

  const first = await enqueuePrintJob({ payload, label, queuedBy: "Staff" });
  check("leg a: first enqueue queues a fresh doc", first.outcome === "queued" && first.duplicate === false);
  if (first.outcome !== "queued") throw new Error("leg a: first enqueue did not queue");

  const second = await enqueuePrintJob({ payload, label, queuedBy: "Staff" });
  check(
    'leg a: 2nd sequential enqueue with the SAME jobKey -> {outcome:"queued", duplicate:true}, same id',
    second.outcome === "queued" && second.duplicate === true && second.id === first.id,
  );

  const countBeforeResolve = await PrintJob.countDocuments({ jobKey: `bill:${order._id}` });
  check("leg a: exactly one PrintJob doc exists for the jobKey", countBeforeResolve === 1);

  // Resolve it (claim), THEN retry -> already-resolved.
  const claimed = await claimPrintJob({ id: first.id, deviceId: HOST_DEVICE, tabId: "tabA", dismissedBy: "Staff" });
  check("leg a: claim on the resolved-target doc succeeds so the 3rd enqueue sees printed", claimed.claimed === true);

  const third = await enqueuePrintJob({ payload, label, queuedBy: "Staff" });
  check(
    'leg a: 3rd enqueue after claim -> {outcome:"already-resolved", id: <first doc id>}',
    third.outcome === "already-resolved" && third.id === first.id,
  );

  // Amendment (a): the CONCURRENT variant on a FRESH jobKey (a different
  // order) — Promise.all of two enqueuePrintJob calls with the same minted
  // jobKey must collapse to exactly one doc, BOTH outcomes "queued", exactly
  // one duplicate:true, and both carrying the same id.
  const orderConcurrent = baseOrderFields({ _id: "order-a-conc", orderId: "ORD-A-CONC" });
  const concurrentPayload = billPrintJob(orderConcurrent, { reprint: false });
  const [r1, r2] = await Promise.all([
    enqueuePrintJob({ payload: concurrentPayload.payload, label: concurrentPayload.label, queuedBy: "Staff" }),
    enqueuePrintJob({ payload: concurrentPayload.payload, label: concurrentPayload.label, queuedBy: "Staff" }),
  ]);
  check('leg a (concurrent): both results report outcome "queued"', r1.outcome === "queued" && r2.outcome === "queued");
  if (r1.outcome !== "queued" || r2.outcome !== "queued") throw new Error("leg a (concurrent): non-queued outcome");
  const duplicateFlags = [r1.duplicate, r2.duplicate];
  check(
    "leg a (concurrent): exactly ONE of the two results carries duplicate:true",
    duplicateFlags.filter((d) => d === true).length === 1,
  );
  check("leg a (concurrent): both results carry the SAME id", r1.id === r2.id);
  const concurrentCount = await PrintJob.countDocuments({ jobKey: `bill:${orderConcurrent._id}` });
  check("leg a (concurrent): exactly one PrintJob doc exists despite two concurrent creates", concurrentCount === 1);
}

// ── Legs b/c — the claim CAS race, both directions of repeated claim ───────
export async function legsBC(nowMs: number): Promise<void> {
  console.log("\nLeg b — two concurrent claimPrintJob calls on ONE queued job ⇒ exactly one winner\n");
  await resetCollections();
  await seedHost(nowMs);

  const order = baseOrderFields({ _id: "order-bc", orderId: "ORD-BC" });
  // void: skip kind (no Order read needed) — keeps legs b/c/d as pure CAS legs.
  const { payload, label } = voidPrintJob(order, {
    productId: "00000000000000000000aaa1",
    name: "Tea",
    price: 100,
    qty: 1,
    modifiers: [],
    instructions: "",
    kotRound: 1,
    reason: "wrong item",
    voidedBy: "Staff",
    at: order.createdAt,
  } as OrderVoid, { reprint: false });
  const enq = await enqueuePrintJob({ payload, label, queuedBy: "Staff" });
  if (enq.outcome !== "queued") throw new Error("leg b: enqueue failed to queue");

  const [claimA, claimB] = await Promise.all([
    claimPrintJob({ id: enq.id, deviceId: HOST_DEVICE, tabId: "tabA", dismissedBy: "Staff" }),
    claimPrintJob({ id: enq.id, deviceId: HOST_DEVICE, tabId: "tabB", dismissedBy: "Staff" }),
  ]);
  const results = [claimA, claimB];
  const winners = results.filter((r) => r.claimed);
  check("leg b: exactly ONE claim wins", winners.length === 1);
  const loser = results.find((r) => !r.claimed);
  check(
    'leg b: the loser reports {claimed:false, reason:"raced"}',
    loser !== undefined && !loser.claimed && loser.reason === "raced",
  );

  console.log('\nLeg c — a THIRD claimPrintJob on the already-claimed job ⇒ {claimed:false, reason:"raced"}, claimedAt unchanged\n');
  const before = await PrintJob.findById(enq.id).select("claimedAt").lean();
  const claimC = await claimPrintJob({ id: enq.id, deviceId: HOST_DEVICE, tabId: "tabC", dismissedBy: "Staff" });
  check('leg c: a second claim attempt reports {claimed:false, reason:"raced"}', !claimC.claimed && claimC.reason === "raced");
  const after = await PrintJob.findById(enq.id).select("claimedAt").lean();
  check(
    "leg c: claimedAt is byte-identical before/after the losing claim",
    before?.claimedAt instanceof Date &&
      after?.claimedAt instanceof Date &&
      before.claimedAt.getTime() === after.claimedAt.getTime(),
  );
}

// ── Leg d — both directions of the claim/dismiss race ──────────────────────
export async function legD(nowMs: number): Promise<void> {
  console.log("\nLeg d — claim-then-dismiss AND dismiss-then-claim: each loser reports raced\n");
  await resetCollections();
  await seedHost(nowMs);

  // Direction 1: claim wins, then dismiss on the same id races and loses.
  const order1 = baseOrderFields({ _id: "order-d1", orderId: "ORD-D1" });
  const cancelPayload1 = cancelNoticePrintJob(order1, "kitchen closed"); // skip kind
  const enq1 = await enqueuePrintJob({ payload: cancelPayload1.payload, label: cancelPayload1.label, queuedBy: "Staff" });
  if (enq1.outcome !== "queued") throw new Error("leg d(1): enqueue failed");
  const claimed1 = await claimPrintJob({ id: enq1.id, deviceId: HOST_DEVICE, tabId: "tabA", dismissedBy: "Staff" });
  check("leg d(1): the claim wins first", claimed1.claimed === true);
  const dismissAfterClaim = await dismissPrintJob({ id: enq1.id, reason: "staff", dismissedBy: "Staff" });
  check(
    'leg d(1): a dismiss AFTER the claim already won ⇒ {dismissed:false, reason:"raced"}',
    dismissAfterClaim.dismissed === false && dismissAfterClaim.reason === "raced",
  );
  const stored1 = await PrintJob.findById(enq1.id).select("status").lean();
  check('leg d(1): stored status stays "printed" (the claim\'s write), never "dismissed"', stored1?.status === "printed");

  // Direction 2: dismiss wins, then claim on the same id races and loses.
  const order2 = baseOrderFields({ _id: "order-d2", orderId: "ORD-D2" });
  const cancelPayload2 = cancelNoticePrintJob(order2, "kitchen closed");
  const enq2 = await enqueuePrintJob({ payload: cancelPayload2.payload, label: cancelPayload2.label, queuedBy: "Staff" });
  if (enq2.outcome !== "queued") throw new Error("leg d(2): enqueue failed");
  const dismissed2 = await dismissPrintJob({ id: enq2.id, reason: "staff", dismissedBy: "Staff" });
  check("leg d(2): the dismiss wins first", dismissed2.dismissed === true);
  const claimAfterDismiss = await claimPrintJob({ id: enq2.id, deviceId: HOST_DEVICE, tabId: "tabB", dismissedBy: "Staff" });
  check(
    'leg d(2): a claim AFTER the dismiss already won ⇒ {claimed:false, reason:"raced"}',
    claimAfterDismiss.claimed === false && claimAfterDismiss.reason === "raced",
  );
  const stored2 = await PrintJob.findById(enq2.id).select("status").lean();
  check('leg d(2): stored status stays "dismissed", never "printed"', stored2?.status === "dismissed");
}

// ── Leg i — wire-payload parity: builder -> Zod -> stored JSON -> claim ────
export async function legI(nowMs: number): Promise<void> {
  console.log("\nLeg i — one payload per kind through enqueue -> claim: byte-identical wire round-trip\n");
  await resetCollections();
  await seedHost(nowMs);

  // kot/round-null is the ONE skip kind here (printJobNeedsOrderRead is false
  // only for kot with round===null) — MEASURED deviation from the amendment's
  // note: printJobNeedsOrderRead (lib/print-queue-claim.ts:29-31) returns true
  // for EVERY "bill" kind regardless of `reprint`, so a first-time bill AND a
  // bill reprint both need a live Order read at claim time. Seed a real Order
  // for both bill fixtures (see the summary's Deviations for the write-up).
  const kotReprintOrder = baseOrderFields({ _id: "order-i-kot-reprint", orderId: "ORD-I-KOTR" });

  const kotOrderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const kotSeededOrder = baseOrderFields({ _id: kotOrderId, orderId: "ORD-I-KOT" });
  const billOrderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const billSeededOrder = baseOrderFields({ _id: billOrderId, orderId: "ORD-I-BILL" });
  const billReprintOrderId = await seedRealOrder({ status: "Completed", kotRound: 1 });
  const billReprintOrder = baseOrderFields({ _id: billReprintOrderId, orderId: "ORD-I-BILLR" });

  const voidOrder = baseOrderFields({ _id: "order-i-void", orderId: "ORD-I-VOID" });
  const movedOrder = baseOrderFields({ _id: "order-i-moved", orderId: "ORD-I-MOVED" });
  const cancelOrder = baseOrderFields({ _id: "order-i-cancel", orderId: "ORD-I-CANCEL" });

  const requests = [
    { name: "kot (round null, reprint)", req: kotPrintJob(kotReprintOrder, null) },
    { name: "kot (round non-null, needs Order)", req: kotPrintJob(kotSeededOrder, 1) },
    { name: "bill (first-time, needs Order)", req: billPrintJob(billSeededOrder, { reprint: false }) },
    { name: "bill (reprint, needs Order — measured, see deviations)", req: billPrintJob(billReprintOrder, { reprint: true }) },
    {
      name: "void",
      req: voidPrintJob(
        voidOrder,
        {
          productId: "00000000000000000000aaa1",
          name: "Tea",
          price: 100,
          qty: 1,
          modifiers: [],
          instructions: "",
          kotRound: 1,
          reason: "wrong item",
          voidedBy: "Staff",
          at: voidOrder.createdAt,
        } as OrderVoid,
        { reprint: false },
      ),
    },
    {
      name: "moved",
      req: movedPrintJob(movedOrder, { from: "T-1", movedBy: "Staff", movedAt: movedOrder.createdAt }, { reprint: false }),
    },
    { name: "eod", req: eodPrintJob({ dateKey: "2026-09-06", dateLabel: "6 Sep 2026" }) },
    { name: "cancel-notice", req: cancelNoticePrintJob(cancelOrder, "kitchen closed") },
  ] as const;

  for (const { name, req } of requests) {
    const wire: PrintJobPayload = JSON.parse(JSON.stringify(req.payload)) as PrintJobPayload;

    const parsedWire = printJobPayloadSchema.parse(wire);
    assert.deepStrictEqual(parsedWire, wire, `${name}: Zod must add/strip nothing from the wire form`);
    check(`leg i (${name}): printJobPayloadSchema.parse(wire) deep-strict-equals wire`, true);

    const enq = await enqueuePrintJob({ payload: wire, label: req.label, queuedBy: "Staff" });
    check(`leg i (${name}): enqueue reports "queued"`, enq.outcome === "queued");
    if (enq.outcome !== "queued") throw new Error(`leg i (${name}): enqueue did not queue`);

    const stored = await PrintJob.findById(enq.id).select("payload").lean();
    check(
      `leg i (${name}): STORED PrintJob.payload string is byte-identical to JSON.stringify(wire)`,
      stored?.payload === JSON.stringify(wire),
    );

    const claimed = await claimPrintJob({ id: enq.id, deviceId: HOST_DEVICE, tabId: `tab-${name}`, dismissedBy: "Staff" });
    check(`leg i (${name}): claim succeeds`, claimed.claimed === true);
    if (!claimed.claimed) throw new Error(`leg i (${name}): claim did not win`);
    assert.deepStrictEqual(claimed.job.payload, wire, `${name}: claimed job.payload must deep-strict-equal wire`);
    check(`leg i (${name}): claimPrintJob's returned job.payload deep-strict-equals wire`, true);
  }
}

// ── Leg k — an imposter device claiming a host-bound job ───────────────────
export async function legK(nowMs: number): Promise<void> {
  console.log('\nLeg k — claimPrintJob from a non-host device ⇒ {claimed:false, reason:"not-host"}, job stays queued\n');
  await resetCollections();
  await seedHost(nowMs);

  const { payload, label } = eodPrintJob({ dateKey: "2026-09-06", dateLabel: "6 Sep 2026" }); // skip kind
  const enq = await enqueuePrintJob({ payload, label, queuedBy: "Staff" });
  if (enq.outcome !== "queued") throw new Error("leg k: enqueue failed");

  const claim = await claimPrintJob({ id: enq.id, deviceId: "IMPOSTER", tabId: "t", dismissedBy: "Staff" });
  check('leg k: an imposter device is refused with reason:"not-host"', !claim.claimed && claim.reason === "not-host");

  const stored = await PrintJob.findById(enq.id).select("status claimedAt").lean();
  check('leg k: the job is still "queued"', stored?.status === "queued");
  check("leg k: claimedAt is absent", stored?.claimedAt === undefined);
}

