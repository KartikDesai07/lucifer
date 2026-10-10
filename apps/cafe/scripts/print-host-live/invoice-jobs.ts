/**
 * Print customization S10 live leg (bg) - the GST invoice serial on a bill job, against a REAL MongoDB. It
 * replicates POST /api/print-jobs' exact body validation and payload chain (the route needs a signed-in session,
 * which this script does not stand up - precedent: legs m and n): parse the body with the same schema, then
 * billPayloadWithFirstPrint(...).then(billPayloadWithInvoice), then enqueuePrintJob. The route-source pin
 * (lib/invoice-number-paths.test.ts) holds the chain's text, so this leg cannot drift from the route unseen.
 * Run by scripts/verify-print-host-live.ts after leg ay. (console output is intentional - ops CLI script.)
 */
import mongoose from "mongoose";
import { z } from "zod";
import { printJobPayloadSchema } from "@pos/shared/schemas/print-job.schema";
import { printOrderSnapshot, PRINT_JOB_LABEL_MAX_CHARS } from "@pos/shared/print-job";
import { PrintJob } from "@/models/PrintJob";
import { Order } from "@/models/Order";
import { enqueuePrintJob } from "@/lib/print-queue";
import { billPayloadWithFirstPrint } from "@/lib/bill-first-print";
import { billPayloadWithInvoice } from "@/lib/slip-numbers";
import type { Order as OrderShape } from "@/types";
import { check, seedRealOrder } from "./harness";
import { STAFF, freshHost } from "./lifecycle";

// The route's own body schema (app/api/print-jobs/route.ts), restated with the same parts.
const enqueueBodySchema = z.object({ payload: printJobPayloadSchema, label: z.string().trim().min(1).max(PRINT_JOB_LABEL_MAX_CHARS) }).strict();

const STORED_FY = 2026;
const GST_FIELDS = { gstMode: "exclusive", gstRate: 5, gstAmount: 5, total: 105, paidAmount: 105 };
const FORGED_NUMBER = 999;
const FORGED_FY = 2031;

type Pair = { invoiceNumber?: number; invoiceFy?: number };

async function orderOf(set: Record<string, unknown>): Promise<OrderShape & { _id: string }> {
  const id = await seedRealOrder({ status: "Completed", kotRound: 1 });
  await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: set });
  const doc = await Order.findById(id).lean();
  if (doc === null) throw new Error("seeded order missing");
  return JSON.parse(JSON.stringify(doc)) as OrderShape & { _id: string };
}

/** What a tab sends: a bill snapshot built from the order it holds, optionally carrying a pair of its own. */
function clientBody(order: OrderShape, clientPair: Pair | null): unknown {
  const { invoiceNumber: _n, invoiceFy: _y, ...held } = order as OrderShape & Pair;
  const snapshot = printOrderSnapshot({ ...held, ...(clientPair ?? {}) } as OrderShape);
  return { payload: { kind: "bill", snapshot }, label: `Bill ${order.orderId}` };
}

/** The route's own steps: validate the body, chain the payload, enqueue. Returns the stored job's snapshot pair. */
async function throughRoute(body: unknown, nowMs: number): Promise<{ outcome: string; pair: Pair | null; hasKeys: [boolean, boolean] }> {
  const parsed = enqueueBodySchema.safeParse(body);
  if (!parsed.success) throw new Error("the leg's own body does not pass the route schema");
  const payload = await billPayloadWithFirstPrint(parsed.data.payload, nowMs).then(billPayloadWithInvoice);
  const res = await enqueuePrintJob({ payload, label: parsed.data.label, queuedBy: STAFF, nowMs });
  if (res.outcome !== "queued") return { outcome: res.outcome, pair: null, hasKeys: [false, false] };
  const row = await PrintJob.findById(res.id).lean();
  const stored = JSON.parse(row?.payload ?? "{}") as { snapshot?: Pair };
  const snapshot = stored.snapshot ?? {};
  return { outcome: res.outcome, pair: snapshot, hasKeys: ["invoiceNumber" in snapshot, "invoiceFy" in snapshot] };
}

export async function legBG(nowMs: number): Promise<void> {
  console.log("\n(bg) the GST invoice serial on a bill job: injected from the stored order, a forged value replaced, a cancelled bill keeps it");
  await freshHost(nowMs);

  const held = await orderOf({ ...GST_FIELDS, invoiceNumber: 23, invoiceFy: STORED_FY });
  const bare = await throughRoute(clientBody(held, null), nowMs);
  check("(bg) an old tab's bill payload WITHOUT the invoice keys is stored with the order's serial (23 / 2026)", bare.outcome === "queued" && bare.pair?.invoiceNumber === 23 && bare.pair?.invoiceFy === STORED_FY);

  const forgedOrder = await orderOf({ ...GST_FIELDS, invoiceNumber: 24, invoiceFy: STORED_FY });
  const forgedBody = clientBody(forgedOrder, { invoiceNumber: FORGED_NUMBER, invoiceFy: FORGED_FY });
  const sent = (forgedBody as { payload: { snapshot: Pair } }).payload.snapshot;
  check("(bg) landmark: the forged body really carries the forged pair into the route", sent.invoiceNumber === FORGED_NUMBER && sent.invoiceFy === FORGED_FY);
  const forged = await throughRoute(forgedBody, nowMs);
  check("(bg) a FORGED pair is replaced by the stored one (24 / 2026), never stored as sent", forged.pair?.invoiceNumber === 24 && forged.pair?.invoiceFy === STORED_FY);

  const cancelled = await orderOf({ ...GST_FIELDS, status: "Cancelled", cancelReason: "customer left", invoiceNumber: 25, invoiceFy: STORED_FY });
  const kept = await throughRoute(clientBody(cancelled, null), nowMs);
  const cancelledRow = await Order.findById(cancelled._id).lean();
  check("(bg) a bill cancelled AFTER payment keeps its serial on the slip (25 / 2026)", cancelledRow?.status === "Cancelled" && kept.pair?.invoiceNumber === 25 && kept.pair?.invoiceFy === STORED_FY);

  const plain = await orderOf({});
  const unnumbered = await throughRoute(clientBody(plain, { invoiceNumber: FORGED_NUMBER, invoiceFy: FORGED_FY }), nowMs);
  check("(bg) an order holding NO serial drops a forged pair: neither key is stored", unnumbered.outcome === "queued" && unnumbered.hasKeys[0] === false && unnumbered.hasKeys[1] === false);

  const jobs = await PrintJob.countDocuments({ kind: "bill" });
  check("(bg) landmark: all four bill jobs were really queued", jobs === 4);
}
