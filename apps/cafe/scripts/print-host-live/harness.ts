/**
 * PH-10 Slice F — shared harness for the print-host live legs. Mirrors
 * scripts/verify-self-order-alert-live.ts's own check()/counters convention;
 * read that file's header first. Split out so each lane file (jobs/feeds/
 * prune/host) stays under the ~300-line cap.
 *
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { PrintJob } from "@/models/PrintJob";
import { PrintHost } from "@/models/PrintHost";
import { Order } from "@/models/Order";
import { PRINT_HOST_KEY } from "@pos/shared/print-job";
import type { Order as OrderShape } from "@pos/shared/types";

export const SCRATCH_PREFIX = "pos_scratch_";
export const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}print_host`;

let passed = 0;
let failed = 0;

export function check(label: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
  }
}

export function counts(): { passed: number; failed: number } {
  return { passed, failed };
}

/** Backdates createdAt via the RAW driver — PrintJob has `timestamps:true`
 *  (models/PrintJob.ts:67), so a Mongoose save/update would re-stamp it. Same
 *  technique as verify-self-order-alert-live.ts's stampTimestamps. */
export async function backdatePrintJob(id: string, createdAt: Date): Promise<void> {
  await PrintJob.collection.updateOne(
    { _id: new mongoose.Types.ObjectId(id) },
    { $set: { createdAt } },
  );
}

/** Designates a host directly via the raw model (bypassing designatePrintHost's
 *  own CAS/retry) — used by legs that need a host present as pure SETUP, not
 *  as the thing under test. */
export async function seedPrintHost(input: { deviceId: string; label: string; setBy: string; nowMs: number }): Promise<void> {
  await PrintHost.create({
    key: PRINT_HOST_KEY,
    deviceId: input.deviceId,
    label: input.label,
    setBy: input.setBy,
    setAt: new Date(input.nowMs),
    lastSeenAt: new Date(input.nowMs),
  });
}

/** Minimal valid PrintJobPayload snapshot fields shared by every seeded Order
 *  fixture below — kept in one place so every kind-builder starts from the
 *  same base and only overrides what its kind needs.
 *  INVARIANT (review LOW, PH-10): the default `_id` is an OPAQUE string, not
 *  an ObjectId — fine for kinds whose claim never reads the live Order (void,
 *  moved, cancel-notice, eod, kot with round null). Any fixture whose claim
 *  DOES read the Order (every bill, kot with a numeric round —
 *  print-queue-claim.ts printJobNeedsOrderRead) MUST override `_id` with a
 *  real seedRealOrder() id, or the claim is dismissed as invalid-payload at
 *  the isValidObjectId gate and the leg proves nothing. */
export function baseOrderFields(overrides: Partial<OrderShape> = {}): OrderShape {
  const now = new Date().toISOString();
  return {
    _id: "seed-order-id",
    orderId: "ORD-20260101-001",
    customerName: "Walk-in",
    items: [
      { productId: "00000000000000000000aaa1", name: "Tea", price: 100, qty: 1, modifiers: [], instructions: "", kotRound: 1 },
    ],
    subtotal: 100,
    discount: 0,
    total: 100,
    paidAmount: 100,
    payment: "Cash",
    status: "Completed",
    receiver: "Staff",
    kotRounds: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as OrderShape;
}

/** Seeds a REAL Order document (models/Order.ts) for the kinds whose claim
 *  path reads the live Order — kot with round !== null, and a first-time bill
 *  (reprint absent). Returns the created Order's own _id as a string so the
 *  caller's snapshot._id can be set to match it (claimPrintJob resolves the
 *  order by `Order.findById(job.orderId)`, so the two MUST agree). */
export async function seedRealOrder(input: {
  status: "Completed" | "Open";
  kotRound: number;
}): Promise<string> {
  const doc = await Order.create({
    orderId: `ORD-SEED-${new mongoose.Types.ObjectId().toHexString()}`,
    customerName: "Walk-in",
    items: [
      { productId: "00000000000000000000aaa1", name: "Tea", price: 100, qty: 1, modifiers: [], instructions: "", kotRound: input.kotRound },
    ],
    subtotal: 100,
    discount: 0,
    total: 100,
    paidAmount: input.status === "Completed" ? 100 : 0,
    payment: "Cash",
    status: input.status,
    receiver: "Staff",
    kotRounds: input.kotRound,
  });
  return String(doc._id);
}

/** Fresh-slate wipe between legs — PrintJob/PrintHost only (Order fixtures are
 *  each leg's own, and legs that seed an Order do so freshly every time). */
export async function resetCollections(): Promise<void> {
  await Promise.all([PrintJob.deleteMany({}), PrintHost.deleteMany({})]);
}
