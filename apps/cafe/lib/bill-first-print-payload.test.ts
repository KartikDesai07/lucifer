import { test } from "node:test";
import assert from "node:assert/strict";

import { billPayloadWithFirstPrint, type BillFirstPrintDeps } from "@/lib/bill-first-print";
import { printOrderSnapshot } from "@pos/shared/print-job";
import { printJobPayloadSchema, type PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import type { Order } from "@/types";
import { ID, NOW_MS, STORED, TOTAL, fakeDb } from "./bill-first-print.fixtures";

// Print customization S3b: the bill job payload carries the stamp the SERVER holds (never the client's), for the
// total on the slip. The stamping rules themselves are pinned in bill-first-print.test.ts.

// ── billPayloadWithFirstPrint ────────────────────────────────────────────────

const FORGED = "2099-01-01T00:00:00.000Z";
function liveOrder(over: Partial<Order> = {}): Order {
  return {
    _id: ID, orderId: "ORD-20261004-001", customerName: "Walk-In",
    items: [{ productId: "p1", name: "Cold Coffee", price: 120, qty: 2, modifiers: [], instructions: "", kotRound: 1 }],
    subtotal: 240, discount: 0, total: TOTAL, paidAmount: 240, payment: "Cash", status: "Completed", receiver: "Staff A",
    kotRounds: 1, createdAt: "2026-10-04T08:00:00.000Z", updatedAt: "2026-10-04T08:00:00.000Z", ...over,
  };
}
const billPayload = (over: Partial<Order> = {}): PrintJobPayload => ({ kind: "bill", snapshot: printOrderSnapshot(liveOrder(over)) });
const snapshotOf = (p: PrintJobPayload): { billFirstPrintedAt?: string } => {
  assert.equal(p.kind, "bill");
  return (p as { snapshot: { billFirstPrintedAt?: string } }).snapshot;
};

test("billPayloadWithFirstPrint: a forged client stamp is replaced by the server's stored one, as an ISO string, with no write on a reprint", async () => {
  const forged = billPayload({ billFirstPrintedAt: FORGED });
  assert.equal(snapshotOf(forged).billFirstPrintedAt, FORGED, "landmark: the forged value really is in the input");
  const { deps, calls } = fakeDb({ total: TOTAL, billFirstPrintedAt: STORED, billFirstPrintedTotal: TOTAL });
  const out = await billPayloadWithFirstPrint(forged, NOW_MS, deps);
  assert.equal(snapshotOf(out).billFirstPrintedAt, STORED.toISOString());
  assert.equal(calls.cas.length, 0);
  // No stamp from the client at all, first print: the server's NOW is added.
  const fresh = await billPayloadWithFirstPrint(billPayload(), NOW_MS, fakeDb({ total: TOTAL }).deps);
  assert.equal(snapshotOf(fresh).billFirstPrintedAt, new Date(NOW_MS).toISOString());
  // The total changed since the stored stamp: the payload carries the NEW window's start.
  const changed = await billPayloadWithFirstPrint(billPayload({ total: 300 }), NOW_MS, fakeDb({ total: 300, billFirstPrintedAt: STORED, billFirstPrintedTotal: TOTAL }).deps);
  assert.equal(snapshotOf(changed).billFirstPrintedAt, new Date(NOW_MS).toISOString());
});

test("billPayloadWithFirstPrint: a stale-view slip keeps the stamp made for ITS total; a never-stamped order from a stale view gets none", async () => {
  // The slip shows 500; the order has since grown to 700, and its stamp T1 was made for 500.
  const stale = billPayload({ total: 500, billFirstPrintedAt: FORGED });
  const held = fakeDb({ total: 700, billFirstPrintedAt: STORED, billFirstPrintedTotal: 500 });
  const out = await billPayloadWithFirstPrint(stale, NOW_MS, held.deps);
  assert.equal(snapshotOf(out).billFirstPrintedAt, STORED.toISOString(), "T1, not the forged value and not now");
  assert.equal(held.calls.cas.length, 0);
  // Never stamped, slip total differs from the DB: no key, no write.
  const never = fakeDb({ total: 700 });
  const none = await billPayloadWithFirstPrint(billPayload({ total: 500, billFirstPrintedAt: FORGED }), NOW_MS, never.deps);
  assert.equal("billFirstPrintedAt" in snapshotOf(none), false);
  assert.deepEqual([never.calls.read.length, never.calls.cas.length], [1, 0], "landmark: the server looked and declined to write");
  // Landmark: the same order printed from an up-to-date slip does stamp.
  const current = await billPayloadWithFirstPrint(billPayload({ total: 700 }), NOW_MS, never.deps);
  assert.equal(snapshotOf(current).billFirstPrintedAt, new Date(NOW_MS).toISOString());
});

test("billPayloadWithFirstPrint: a forged stamp with no server stamp (cancelled, missing or failed) is REMOVED, not kept", async () => {
  const forged = billPayload({ billFirstPrintedAt: FORGED });
  const { deps, calls } = fakeDb({ total: TOTAL, cancelled: true });
  const out = await billPayloadWithFirstPrint(forged, NOW_MS, deps);
  assert.equal("billFirstPrintedAt" in snapshotOf(out), false);
  assert.equal(calls.read.length, 1, "landmark: the server did look, and found a cancelled bill");
  const boom: BillFirstPrintDeps = { readBill: async () => { throw new Error("x"); }, casStamp: async () => null };
  assert.equal("billFirstPrintedAt" in snapshotOf(await billPayloadWithFirstPrint(forged, NOW_MS, boom)), false);
});

test("billPayloadWithFirstPrint: the input payload and its snapshot are not mutated", async () => {
  const forged = billPayload({ billFirstPrintedAt: FORGED });
  const before = JSON.stringify(forged);
  const out = await billPayloadWithFirstPrint(forged, NOW_MS, fakeDb({ total: TOTAL }).deps);
  assert.equal(JSON.stringify(forged), before);
  assert.notEqual(out, forged);
  assert.notEqual((out as { snapshot: object }).snapshot, (forged as { snapshot: object }).snapshot);
  assert.notEqual(JSON.stringify(out), before, "landmark: the output did change");
});

test("billPayloadWithFirstPrint: a kot and an eod payload come back unchanged with zero deps calls", async () => {
  const snapshot = printOrderSnapshot(liveOrder({ billFirstPrintedAt: FORGED }));
  const payloads: PrintJobPayload[] = [
    { kind: "kot", snapshot, round: 1 },
    { kind: "eod", dateKey: "2026-10-04", dateLabel: "04 Oct 2026" },
  ];
  const { deps, calls } = fakeDb({ total: TOTAL });
  for (const p of payloads) assert.equal(await billPayloadWithFirstPrint(p, NOW_MS, deps), p, p.kind);
  assert.deepEqual([calls.read.length, calls.cas.length], [0, 0]);
  await billPayloadWithFirstPrint(billPayload(), NOW_MS, deps);
  assert.equal(calls.read.length, 1, "landmark: a bill payload does reach the deps");
});

test("billPayloadWithFirstPrint: the stored payload still passes the strict printJobPayloadSchema, stamped or not", async () => {
  const stamped = await billPayloadWithFirstPrint(billPayload({ billFirstPrintedAt: FORGED }), NOW_MS, fakeDb({ total: TOTAL }).deps);
  const parsed = printJobPayloadSchema.safeParse(stamped);
  assert.equal(parsed.success, true, parsed.success ? "" : JSON.stringify(parsed.error.issues));
  assert.equal(snapshotOf(stamped).billFirstPrintedAt, new Date(NOW_MS).toISOString());
  const unstamped = await billPayloadWithFirstPrint(billPayload({ billFirstPrintedAt: FORGED }), NOW_MS, fakeDb(null).deps);
  assert.equal(printJobPayloadSchema.safeParse(unstamped).success, true);
});
