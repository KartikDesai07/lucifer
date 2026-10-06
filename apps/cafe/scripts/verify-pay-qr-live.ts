/**
 * Print customization S3b live leg (pay QR first-print stamp + settings) — proves DB-truth the DB-free tests cannot:
 * that the bill's first-print stamp (lib/bill-first-print.ts) is a real CAS on a real MongoDB (two racing callers
 * converge on ONE stored value, a reprint or a later settle of the SAME total moves nothing and writes nothing, a
 * CHANGED total starts a new window that racing callers also converge on, a cancelled or missing order is never
 * stamped, an invalid id never reaches the DB), that the strict Order model keeps the field, that the
 * print-jobs enqueue shape (printOrderSnapshot -> printJobPayloadSchema -> billPayloadWithFirstPrint) injects the
 * SERVER's value over a forged client one, and that payQrMode / payQrValidMinutes survive the settings PUT's REAL
 * code path (updateSettingsSchema, settingsUpdateOf, the route's four options) with 0 ("No limit") neither dropped nor
 * defaulted, fall back to the documented defaults when absent, and are refused by BOTH Zod and the Mongoose validator.
 *
 *   node --import tsx scripts/verify-pay-qr-live.ts            (defaults to the local stand-in)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_pay_qr node --import tsx scripts/verify-pay-qr-live.ts
 *
 * SAFETY: refuses to run against any database whose name does not carry the scratch prefix, and drops that whole
 * scratch database in `finally` (importing the models also creates their empty, indexed collections).
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import mongoose from "mongoose";

import { connectDB } from "@/lib/db";
import { Order } from "@/models/Order";
import { Settings } from "@/models/Settings";
import { invalidateSettingsCache, settingsUpdateOf } from "@/lib/settings";
import {
  billPayloadWithFirstPrint,
  firstBillPrintInsertFields,
  stampFirstBillPrint,
  withFirstBillPrint,
} from "@/lib/bill-first-print";
import { settingsFormDefaults } from "@/lib/settings-form-defaults";
import { pickSectionValues, settingsSectionBySlug } from "@/lib/settings-sections";
import { stripComments } from "@/lib/source-pin-utils";
import { updateSettingsSchema } from "@/schemas";
import { printJobPayloadSchema } from "@pos/shared/schemas/print-job.schema";
import { printOrderSnapshot } from "@pos/shared/print-job";
import { PAY_QR_MINUTES_DEFAULT, PAY_QR_MODE_DEFAULT } from "@pos/shared/print-qr";
import type { PrintJobPayload } from "@pos/shared/schemas/print-job.schema";
import type { Order as SharedOrder } from "@pos/shared/types";
import type { Settings as SettingsView } from "@/types";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}pay_qr`;
const API_DIR = path.join(process.cwd(), "app", "api");
const RACE_TRIALS = 10;
const MS_PER_SECOND = 1000;
const T1 = Date.UTC(2026, 9, 4, 10, 0, 0);
const T2 = T1 + 90 * MS_PER_SECOND;
const T3 = T2 + 90 * MS_PER_SECOND;
const T4 = T3 + 90 * MS_PER_SECOND;
const T5 = T4 + 90 * MS_PER_SECOND;
// The total every scratch order is made with, and one it is moved to (a round added) / a smaller one (a discount).
const ORDER_TOTAL = 80;
const GROWN_TOTAL = 130;
const DISCOUNTED_TOTAL = 70;
const FORGED_ISO = "2099-01-01T00:00:00.000Z";
const NO_LIMIT = 0;

type Rec = Record<string, unknown>;

let passed = 0;
let failed = 0;

async function scenario(id: string, name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  PASS ${id}. ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${id}. ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ── Orders ────────────────────────────────────────────────────────────────────
let orderSeq = 0;
// The least a real, valid Order needs (strict model: every key here is a declared path).
function orderInput(extra: Rec = {}): Rec {
  orderSeq += 1;
  return {
    orderId: `ORD-SCRATCH-${orderSeq}`,
    customerName: "Walk-in",
    items: [{ productId: new mongoose.Types.ObjectId(), name: "Tea", price: 40, qty: 2, modifiers: [], instructions: "", kotRound: 1 }],
    subtotal: ORDER_TOTAL,
    total: ORDER_TOTAL,
    paidAmount: ORDER_TOTAL,
    payment: "Cash",
    status: "Completed",
    receiver: "Live leg",
    kotRounds: 1,
    ...extra,
  };
}
async function makeOrder(extra: Rec = {}): Promise<string> {
  const doc = await Order.create(orderInput(extra));
  return String(doc._id);
}
const oid = (id: string): mongoose.Types.ObjectId => new mongoose.Types.ObjectId(id);
async function rawOrder(id: string): Promise<Rec> {
  const doc = (await Order.collection.findOne({ _id: oid(id) })) as Rec | null;
  assert.ok(doc, "the order document exists");
  return doc;
}
const stampOf = (doc: Rec): unknown => doc.billFirstPrintedAt;
// A raw write that moves the order's total the way an added round / a void / a discount does (no Mongoose, no updatedAt bump).
async function setTotal(id: string, total: number): Promise<void> {
  await Order.collection.updateOne({ _id: oid(id) }, { $set: { total } });
}
const msOf = (d: Date | null): number | null => (d === null ? null : d.getTime());

// ── Settings ──────────────────────────────────────────────────────────────────
async function resetSettings(): Promise<void> {
  await Settings.collection.deleteMany({});
  invalidateSettingsCache();
}

// PUT /api/settings, minus auth and HTTP: the same validator, the same update document builder, the same options.
async function put(body: unknown): Promise<{ ok: true } | { ok: false; paths: string[] }> {
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) return { ok: false, paths: parsed.error.issues.map((i) => i.path.join(".")) };
  await Settings.findOneAndUpdate({}, settingsUpdateOf(parsed.data), {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
    runValidators: true,
  }).lean();
  invalidateSettingsCache();
  return { ok: true };
}
async function mustPut(body: unknown): Promise<void> {
  const r = await put(body);
  assert.ok(r.ok, `the body must pass the write gate: ${r.ok ? "" : r.paths.join(", ")}`);
}
async function rawSettings(): Promise<Rec> {
  const doc = (await Settings.collection.findOne({})) as Rec | null;
  assert.ok(doc, "a Settings document exists");
  return doc;
}
// What the settings page seeds its form from: the lean doc (no Mongoose defaults), typed as the client Settings.
async function leanSettings(): Promise<SettingsView> {
  const doc = await Settings.findOne({}).lean();
  assert.ok(doc, "a lean Settings document exists");
  return doc as unknown as SettingsView;
}
async function rejects(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return false;
  } catch {
    return true;
  }
}

// ── Route sources ─────────────────────────────────────────────────────────────
// Comments stripped with the shared scanner (never a re-rolled regex); a landmark proves the strip kept real code.
function routeCode(...segments: string[]): string {
  const code = stripComments(readFileSync(path.join(API_DIR, ...segments), "utf8"));
  assert.ok(code.includes("export async function"), `${segments.join("/")}: landmark - the stripped source still holds its handler`);
  return code;
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`);
  }

  process.env.MONGODB_URI = uri;
  await connectDB();

  try {
    await scenario("a", `${RACE_TRIALS} races of two concurrent stamps (different nowMs): ONE stored value, both callers get it`, async () => {
      for (let trial = 0; trial < RACE_TRIALS; trial += 1) {
        const id = await makeOrder();
        assert.ok(!("billFirstPrintedAt" in (await rawOrder(id))), "landmark: the order starts unstamped");
        const [x, y] = await Promise.all([stampFirstBillPrint(id, T1), stampFirstBillPrint(id, T2)]);
        assert.ok(x instanceof Date && y instanceof Date, `trial ${trial}: both callers got a Date`);
        assert.equal(x.getTime(), y.getTime(), `trial ${trial}: both callers returned the same value`);
        const stored = stampOf(await rawOrder(id));
        assert.ok(stored instanceof Date, "exactly one stored Date");
        assert.equal(stored.getTime(), x.getTime(), `trial ${trial}: the stored value is what both callers returned`);
        assert.ok([T1, T2].includes(x.getTime()), "and it is one of the two offered moments");
        assert.equal((await rawOrder(id)).billFirstPrintedTotal, ORDER_TOTAL, "the stamp recorded the total it was made for");
      }
    });

    await scenario("b", "a reprint of the same total returns the same value and WRITES NOTHING (stamp, stored total, updatedAt unchanged)", async () => {
      const id = await makeOrder();
      const first = await stampFirstBillPrint(id, T1);
      assert.equal(msOf(first), T1, "landmark: the first call stamped its own moment");
      const before = await rawOrder(id);
      assert.equal(before.billFirstPrintedTotal, ORDER_TOTAL, "landmark: the stamp carries the total it was made for");
      const again = await stampFirstBillPrint(id, T2);
      assert.equal(msOf(again), T1, "the reprint returns the FIRST value");
      const after = await rawOrder(id);
      assert.equal((stampOf(after) as Date).getTime(), T1, "the stored value is unchanged");
      assert.equal(after.billFirstPrintedTotal, ORDER_TOTAL, "the stored total is unchanged");
      assert.deepEqual(after.updatedAt, before.updatedAt, "updatedAt is unchanged");
      assert.deepEqual(after, before, "the whole raw document is byte-for-byte the same: no write happened");
    });

    await scenario("c", "a Cancelled order gets no stamp (null) and nothing is written; an already-stamped one that is cancelled reads null with no write", async () => {
      const id = await makeOrder({ status: "Cancelled" });
      assert.equal(await stampFirstBillPrint(id, T1), null);
      const rawCancelled = await rawOrder(id);
      assert.ok(!("billFirstPrintedAt" in rawCancelled), "no billFirstPrintedAt key was written");
      assert.ok(!("billFirstPrintedTotal" in rawCancelled), "no billFirstPrintedTotal key was written");
      // Stamped while open, then cancelled: the read excludes cancelled bills, and nothing is written.
      const live = await makeOrder();
      assert.equal(msOf(await stampFirstBillPrint(live, T1)), T1, "landmark: an open order stamps");
      await Order.collection.updateOne({ _id: oid(live) }, { $set: { status: "Cancelled" } });
      const before = await rawOrder(live);
      assert.equal(await stampFirstBillPrint(live, T2), null, "a cancelled bill has no deadline");
      assert.deepEqual(await rawOrder(live), before, "the document is untouched (stamp, total and updatedAt as they were)");
      assert.equal((stampOf(before) as Date).getTime(), T1, "landmark: the earlier stamp is still the stored one");
      // A total change on a cancelled bill is also not a reason to write.
      await setTotal(live, GROWN_TOTAL);
      const moved = await rawOrder(live);
      assert.equal(await stampFirstBillPrint(live, T3), null, "still null after a total change");
      assert.deepEqual(await rawOrder(live), moved, "and still no write");
    });

    await scenario("d", "a missing (valid) id and an invalid id both return null; no document is created", async () => {
      const before = await Order.collection.countDocuments({});
      assert.ok(before > 0, "landmark: the collection holds the orders made above");
      const missing = new mongoose.Types.ObjectId().toHexString();
      assert.equal(await stampFirstBillPrint(missing, T1), null);
      assert.equal(await Order.collection.countDocuments({ _id: oid(missing) }), 0, "the missing id was not upserted");
      assert.equal(await Order.collection.countDocuments({}), before, "the collection is the same size");
      assert.equal(await stampFirstBillPrint("not-an-object-id", T1), null);
      assert.equal(await stampFirstBillPrint("", T1), null);
      assert.equal(await Order.collection.countDocuments({}), before, "still the same size after the invalid ids");
    });

    await scenario("e", "Order.create keeps BOTH fields of firstBillPrintInsertFields(true, t, total) (strict model); (false, ...) leaves neither key", async () => {
      const on = await makeOrder(firstBillPrintInsertFields(true, T1, ORDER_TOTAL));
      const rawOn = await rawOrder(on);
      assert.ok(stampOf(rawOn) instanceof Date, "the stamp is stored as a BSON date");
      assert.equal((stampOf(rawOn) as Date).getTime(), T1);
      assert.equal(rawOn.billFirstPrintedTotal, ORDER_TOTAL, "the stamped total is stored too");
      const off = await makeOrder(firstBillPrintInsertFields(false, T1, ORDER_TOTAL));
      const rawOff = await rawOrder(off);
      assert.equal(rawOff.orderId !== undefined, true, "landmark: the unstamped order itself was stored");
      assert.ok(!("billFirstPrintedAt" in rawOff), "no billFirstPrintedAt key (not null, not undefined)");
      assert.ok(!("billFirstPrintedTotal" in rawOff), "no billFirstPrintedTotal key (not null, not undefined)");
      assert.equal(await Order.collection.countDocuments({ _id: oid(off), billFirstPrintedAt: { $exists: false }, billFirstPrintedTotal: { $exists: false } }), 1, "$exists:false matches both");
      // An insert-stamped bill (same total) is then never re-stamped by a later print, and that read writes nothing.
      assert.equal(msOf(await stampFirstBillPrint(on, T2)), T1, "a later print adopts the insert-time stamp");
      assert.deepEqual(await rawOrder(on), rawOn, "and wrote nothing");
    });

    await scenario("f", "bill payload (printOrderSnapshot of a real order, forged client stamp): server ISO injected, schema parses; kot unchanged", async () => {
      const id = await makeOrder();
      const lean = await Order.findById(id).lean();
      assert.ok(lean, "the order reads back");
      const order = JSON.parse(JSON.stringify(lean)) as SharedOrder;
      order.billFirstPrintedAt = FORGED_ISO;
      const snapshot = printOrderSnapshot(order);
      assert.equal(snapshot.billFirstPrintedAt, FORGED_ISO, "landmark: the forged stamp rides the snapshot into the payload");
      // The route's exact validator on a JSON round trip (what the wire does).
      const wire = JSON.parse(JSON.stringify({ kind: "bill", snapshot })) as unknown;
      const inbound = printJobPayloadSchema.safeParse(wire);
      assert.ok(inbound.success, "the inbound bill payload passes printJobPayloadSchema");
      const out = await billPayloadWithFirstPrint(inbound.data, T1);
      assert.equal(out.kind, "bill");
      if (out.kind !== "bill") return;
      const stored = stampOf(await rawOrder(id));
      assert.ok(stored instanceof Date, "the server stamped the order");
      assert.equal(out.snapshot.billFirstPrintedAt, stored.toISOString(), "the injected value is the raw doc's stored value");
      assert.equal(out.snapshot.billFirstPrintedAt, new Date(T1).toISOString(), "which is this first print's own moment");
      assert.notEqual(out.snapshot.billFirstPrintedAt, FORGED_ISO, "the forged client value is gone");
      assert.ok(printJobPayloadSchema.safeParse(out).success, "the stored payload still passes printJobPayloadSchema");
      // A reprint with another forged value and a later clock: still the first stamp.
      const reprint = await billPayloadWithFirstPrint(inbound.data, T2);
      assert.equal(reprint.kind === "bill" ? reprint.snapshot.billFirstPrintedAt : null, new Date(T1).toISOString(), "a reprint carries the SAME stored ISO");

      // A KOT is returned untouched and stamps nothing.
      const other = await makeOrder();
      const otherLean = await Order.findById(other).lean();
      const otherOrder = JSON.parse(JSON.stringify(otherLean)) as SharedOrder;
      otherOrder.billFirstPrintedAt = FORGED_ISO;
      const kot = printJobPayloadSchema.parse({ kind: "kot", snapshot: printOrderSnapshot(otherOrder), round: null });
      const kotOut = await billPayloadWithFirstPrint(kot, T1);
      assert.equal(kotOut, kot, "the kot payload is the same object");
      assert.equal(kotOut.kind === "kot" ? kotOut.snapshot.billFirstPrintedAt : null, FORGED_ISO, "and unchanged (not this function's job to strip it)");
      assert.ok(!("billFirstPrintedAt" in (await rawOrder(other))), "a kot enqueue wrote no stamp");
    });

    await scenario("g", "settle-shaped sequence: stamp at t1 (pre-bill Check); settle with the SAME total keeps t1; settle that changed the total stamps anew", async () => {
      assert.ok(T2 > T1, "landmark: t2 is later than t1");
      const id = await makeOrder({ status: "Pending", paidAmount: 0, payment: "Unpaid" });
      const check = await stampFirstBillPrint(id, T1);
      assert.equal(msOf(check), T1, "the Check print stamped t1");
      // The settle lands (paid + Completed, total unchanged), then stamps at t2.
      await Order.collection.updateOne({ _id: oid(id) }, { $set: { status: "Completed", paidAmount: ORDER_TOTAL, payment: "Cash" } });
      const settle = await stampFirstBillPrint(id, T2);
      assert.equal(msOf(settle), T1, "the settle's stamp converges on t1");
      assert.equal((stampOf(await rawOrder(id)) as Date).getTime(), T1, "stored t1");
      const lean = await Order.findById(id).lean();
      assert.ok(lean);
      const carried = withFirstBillPrint(lean, check);
      assert.equal(carried.billFirstPrintedAt?.getTime(), T1, "withFirstBillPrint(order, t1) carries t1");
      const unstamped = await makeOrder();
      const unstampedLean = await Order.findById(unstamped).lean();
      assert.ok(unstampedLean);
      assert.equal(withFirstBillPrint(unstampedLean, null), unstampedLean, "no stamp and none stored -> the same object");

      // Variant: the settle itself changed the total (a discount applied at payment) -> a new bill, a new window.
      const changed = await makeOrder({ status: "Pending", paidAmount: 0, payment: "Unpaid" });
      assert.equal(msOf(await stampFirstBillPrint(changed, T1)), T1, "landmark: the Check print stamped t1");
      await Order.collection.updateOne({ _id: oid(changed) }, { $set: { status: "Completed", paidAmount: DISCOUNTED_TOTAL, payment: "Cash", total: DISCOUNTED_TOTAL } });
      const settled = await stampFirstBillPrint(changed, T2);
      assert.equal(msOf(settled), T2, "the settle's stamp starts a new window at t2");
      const rawChanged = await rawOrder(changed);
      assert.equal((stampOf(rawChanged) as Date).getTime(), T2, "stored t2");
      assert.equal(rawChanged.billFirstPrintedTotal, DISCOUNTED_TOTAL, "for the settled total");
    });

    await scenario("n", "total change: a changed total starts a new window; a reprint of the new total writes nothing; changing back is ANOTHER new window", async () => {
      const id = await makeOrder();
      assert.equal(msOf(await stampFirstBillPrint(id, T1)), T1, "landmark: stamped at t1 for the original total");
      assert.equal((await rawOrder(id)).billFirstPrintedTotal, ORDER_TOTAL);
      // A round is added: the total grows (raw write, as a route's $set would).
      await setTotal(id, GROWN_TOTAL);
      assert.equal(msOf(await stampFirstBillPrint(id, T2)), T2, "the print after the total changed returns t2");
      const afterT2 = await rawOrder(id);
      assert.equal((stampOf(afterT2) as Date).getTime(), T2, "the raw doc holds t2");
      assert.equal(afterT2.billFirstPrintedTotal, GROWN_TOTAL, "and the new total");
      // A reprint of the new total keeps t2 and writes nothing.
      assert.equal(msOf(await stampFirstBillPrint(id, T3)), T2, "the reprint returns t2");
      assert.deepEqual(await rawOrder(id), afterT2, "no write on the reprint");
      // The total goes back to the ORIGINAL: the stored total (grown) no longer matches, so the stamp is stale again.
      await setTotal(id, ORDER_TOTAL);
      assert.equal(msOf(await stampFirstBillPrint(id, T4)), T4, "back to the original total is a new window (t4), not a revival of t1");
      const afterT4 = await rawOrder(id);
      assert.equal((stampOf(afterT4) as Date).getTime(), T4, "the raw doc holds t4");
      assert.equal(afterT4.billFirstPrintedTotal, ORDER_TOTAL, "for the original total");
      assert.equal(msOf(await stampFirstBillPrint(id, T5)), T4, "and its reprint keeps t4");
      assert.deepEqual(await rawOrder(id), afterT4, "without a write");
      // The same on the enqueue shape: the injected ISO follows the NEW window.
      await setTotal(id, GROWN_TOTAL);
      const lean = await Order.findById(id).lean();
      const order = JSON.parse(JSON.stringify(lean)) as SharedOrder;
      const payload = printJobPayloadSchema.parse({ kind: "bill", snapshot: printOrderSnapshot(order) });
      const out = await billPayloadWithFirstPrint(payload, T5);
      assert.equal(out.kind === "bill" ? out.snapshot.billFirstPrintedAt : null, new Date(T5).toISOString(), "billPayloadWithFirstPrint injects the new window's ISO");
    });

    await scenario("o", `${RACE_TRIALS} concurrent restamp races after a total change: ONE stored value, both callers get it`, async () => {
      for (let trial = 0; trial < RACE_TRIALS; trial += 1) {
        const id = await makeOrder();
        assert.equal(msOf(await stampFirstBillPrint(id, T1)), T1, "landmark: stamped at t1");
        await setTotal(id, GROWN_TOTAL);
        const [x, y] = await Promise.all([stampFirstBillPrint(id, T2), stampFirstBillPrint(id, T3)]);
        assert.ok(x instanceof Date && y instanceof Date, `trial ${trial}: both callers got a Date`);
        assert.equal(x.getTime(), y.getTime(), `trial ${trial}: both callers returned the same value`);
        assert.ok([T2, T3].includes(x.getTime()), `trial ${trial}: a NEW window value, not the stale t1`);
        const doc = await rawOrder(id);
        assert.equal((stampOf(doc) as Date).getTime(), x.getTime(), `trial ${trial}: the stored value is what both callers returned`);
        assert.equal(doc.billFirstPrintedTotal, GROWN_TOTAL, "stored for the new total");
      }
    });

    // A bill payload for `id` as a (possibly stale) client view would send it: the real snapshot, with the total it SHOWS.
    async function billPayloadShowing(id: string, shownTotal: number): Promise<ReturnType<typeof printJobPayloadSchema.parse>> {
      const lean = await Order.findById(id).lean();
      assert.ok(lean, "the order reads back");
      const order = JSON.parse(JSON.stringify(lean)) as SharedOrder;
      order.total = shownTotal;
      return printJobPayloadSchema.parse(JSON.parse(JSON.stringify({ kind: "bill", snapshot: printOrderSnapshot(order) })));
    }
    const injected = (p: PrintJobPayload): unknown => (p.kind === "bill" ? p.snapshot.billFirstPrintedAt : "not a bill");

    await scenario("p", "stale view via billPayloadWithFirstPrint: old-total slip gets the old stamp, no write; a 700 slip starts a window; an old-total slip then gets NO key", async () => {
      const STALE = 500;
      const NOW = 700;
      const id = await makeOrder({ total: STALE, subtotal: STALE, paidAmount: STALE });
      assert.equal(msOf(await stampFirstBillPrint(id, T1)), T1, "landmark: stamped at t1 for total 500");
      await setTotal(id, NOW);
      const stored = await rawOrder(id);
      assert.equal(stored.billFirstPrintedTotal, STALE, "landmark: the stored stamp is for 500 while the order is now 700");

      const old = await billPayloadWithFirstPrint(await billPayloadShowing(id, STALE), T2);
      assert.equal(injected(old), new Date(T1).toISOString(), "a slip showing 500 gets t1 injected");
      assert.deepEqual(await rawOrder(id), stored, "and nothing was written");

      const fresh = await billPayloadWithFirstPrint(await billPayloadShowing(id, NOW), T3);
      assert.equal(injected(fresh), new Date(T3).toISOString(), "a slip showing 700 starts a new window at t3");
      const afterT3 = await rawOrder(id);
      assert.equal((stampOf(afterT3) as Date).getTime(), T3, "the raw doc holds t3");
      assert.equal(afterT3.billFirstPrintedTotal, NOW, "for 700");

      const late = await billPayloadWithFirstPrint(await billPayloadShowing(id, STALE), T4);
      assert.equal(late.kind, "bill");
      assert.ok(late.kind === "bill" && !("billFirstPrintedAt" in late.snapshot), "a slip showing 500 now gets NO billFirstPrintedAt key");
      assert.equal(injected(await billPayloadWithFirstPrint(await billPayloadShowing(id, NOW), T4)), new Date(T3).toISOString(), "landmark: a 700 slip still gets t3 (the key's absence above is the stale total, not a broken path)");
      assert.deepEqual(await rawOrder(id), afterT3, "nothing was written by either");
    });

    await scenario("q", "a never-stamped order (DB total 700) and a slip showing 500: no key, no write", async () => {
      const id = await makeOrder({ total: 700, subtotal: 700, paidAmount: 700 });
      const before = await rawOrder(id);
      assert.ok(!("billFirstPrintedAt" in before), "landmark: never stamped");
      const out = await billPayloadWithFirstPrint(await billPayloadShowing(id, 500), T1);
      assert.ok(out.kind === "bill" && !("billFirstPrintedAt" in out.snapshot), "no key on the stale slip");
      assert.deepEqual(await rawOrder(id), before, "no write");
      assert.equal(injected(await billPayloadWithFirstPrint(await billPayloadShowing(id, 700), T2)), new Date(T2).toISOString(), "landmark: a slip showing 700 does stamp the same order");
    });

    await scenario("r", "withFirstBillPrint(lean doc with a stale stamp, null) has no billFirstPrintedAt; the input is unchanged", async () => {
      const id = await makeOrder();
      assert.equal(msOf(await stampFirstBillPrint(id, T1)), T1, "landmark: stamped");
      await setTotal(id, GROWN_TOTAL);
      const lean = await Order.findById(id).lean();
      assert.ok(lean && lean.billFirstPrintedAt instanceof Date, "landmark: the lean doc carries the (now stale) stamp");
      const snapshotBefore = { ...lean }; // shallow: same value references, so any in-place delete or reassign shows
      const out = withFirstBillPrint(lean, null);
      assert.ok(!("billFirstPrintedAt" in out), "the copy has no billFirstPrintedAt key");
      assert.notEqual(out, lean, "it is a copy");
      assert.deepEqual(lean, snapshotBefore, "the input object is unchanged");
      assert.equal(out.total, GROWN_TOTAL, "landmark: the rest of the order is carried");
    });

    await scenario("h", "settings PUT shape: { payQrMode: owed, payQrValidMinutes: 0 } is stored as \"owed\" and 0 (0 not dropped or defaulted)", async () => {
      await resetSettings();
      await mustPut({ payQrMode: "owed", payQrValidMinutes: NO_LIMIT });
      const doc = await rawSettings();
      assert.equal(doc.payQrMode, "owed");
      assert.ok("payQrValidMinutes" in doc, "the 0 key is present, not dropped");
      assert.equal(doc.payQrValidMinutes, 0);
      assert.notEqual(doc.payQrValidMinutes, PAY_QR_MINUTES_DEFAULT, "and not defaulted to 60");
      assert.equal(doc.gstRate, 5, "landmark: the upsert did apply other schema defaults (setDefaultsOnInsert ran)");
      // And on an UPDATE of the existing document (not just the upsert insert).
      await mustPut({ payQrMode: "never", payQrValidMinutes: 15 });
      assert.deepEqual([(await rawSettings()).payQrMode, (await rawSettings()).payQrValidMinutes], ["never", 15]);
      await mustPut({ payQrValidMinutes: NO_LIMIT });
      assert.equal((await rawSettings()).payQrValidMinutes, 0, "an update back to 0 is stored too");
    });

    await scenario("i", "a Business section save built like the page (form defaults -> pick business -> gate -> PUT) keeps owed / 0", async () => {
      await resetSettings();
      await mustPut({ payQrMode: "owed", payQrValidMinutes: NO_LIMIT });
      const seeded = settingsFormDefaults(await leanSettings());
      assert.equal(seeded.payQrMode, "owed", "landmark: the form seeds the stored mode");
      assert.equal(seeded.payQrValidMinutes, 0, "landmark: the form seeds the stored 0, not the default");
      const business = settingsSectionBySlug("business");
      const body = { ...pickSectionValues(seeded, business), restaurantName: "Scratch Cafe" };
      assert.ok("payQrMode" in body && "payQrValidMinutes" in body, "the business section owns both fields");
      await mustPut(body);
      const doc = await rawSettings();
      assert.equal(doc.restaurantName, "Scratch Cafe", "landmark: the section save wrote the edited field");
      assert.equal(doc.payQrMode, "owed");
      assert.equal(doc.payQrValidMinutes, 0);
      // The owner changes the pay QR fields on that same page.
      await mustPut({ ...pickSectionValues(settingsFormDefaults(await leanSettings()), business), payQrMode: "never", payQrValidMinutes: 30 });
      assert.deepEqual([(await rawSettings()).payQrMode, (await rawSettings()).payQrValidMinutes], ["never", 30]);
    });

    await scenario("j", "$unset both fields on the raw doc -> settingsFormDefaults(lean doc) gives always / 60", async () => {
      await resetSettings();
      await mustPut({ payQrMode: "owed", payQrValidMinutes: NO_LIMIT });
      assert.equal((await rawSettings()).payQrMode, "owed", "landmark: they were set first");
      await Settings.collection.updateOne({}, { $unset: { payQrMode: 1, payQrValidMinutes: 1 } });
      const doc = await rawSettings();
      assert.ok(!("payQrMode" in doc) && !("payQrValidMinutes" in doc), "both keys are gone from the raw doc");
      const seeded = settingsFormDefaults(await leanSettings());
      assert.equal(seeded.payQrMode, PAY_QR_MODE_DEFAULT);
      assert.equal(seeded.payQrMode, "always");
      assert.equal(seeded.payQrValidMinutes, PAY_QR_MINUTES_DEFAULT);
      assert.equal(seeded.payQrValidMinutes, 60);
    });

    await scenario("k", "invalid values: Zod refuses 3 / 1441 / \"sometimes\"; the Mongoose validator rejects 3 and \"sometimes\" under runValidators", async () => {
      await resetSettings();
      await mustPut({ payQrMode: "owed", payQrValidMinutes: 45 });
      const before = await rawSettings();
      // Positive landmark: the same gate accepts the legal ends, so the refusals below are the range, not a broken gate.
      for (const ok of [0, 5, 1440]) assert.ok(updateSettingsSchema.safeParse({ payQrValidMinutes: ok }).success, `Zod accepts ${ok}`);
      assert.ok(updateSettingsSchema.safeParse({ payQrMode: "never" }).success, "Zod accepts a real mode");
      for (const bad of [3, 1441]) assert.ok(!updateSettingsSchema.safeParse({ payQrValidMinutes: bad }).success, `Zod refuses ${bad}`);
      assert.ok(!updateSettingsSchema.safeParse({ payQrMode: "sometimes" }).success, "Zod refuses an unknown mode");
      assert.ok(await rejects(() => Settings.findOneAndUpdate({}, { $set: { payQrValidMinutes: 3 } }, { runValidators: true })), "Mongoose rejects minutes 3");
      assert.ok(await rejects(() => Settings.findOneAndUpdate({}, { $set: { payQrValidMinutes: 1441 } }, { runValidators: true })), "Mongoose rejects minutes 1441");
      assert.ok(await rejects(() => Settings.findOneAndUpdate({}, { $set: { payQrMode: "sometimes" } }, { runValidators: true })), "Mongoose rejects an unknown mode");
      assert.ok(!(await rejects(() => Settings.findOneAndUpdate({}, { $set: { payQrValidMinutes: 0 } }, { runValidators: true }))), "landmark: the validator accepts 0");
      const after = await rawSettings();
      assert.equal(after.payQrMode, before.payQrMode, "a rejected write left the mode alone");
      assert.equal(after.payQrValidMinutes, 0, "and only the accepted 0 write changed the minutes");
    });

    await scenario("l", "route needles (source): print-jobs stamps before enqueue; settle + orders call the stamp; settings keeps runValidators", async () => {
      const jobs = routeCode("print-jobs", "route.ts");
      const stampAt = jobs.indexOf("await billPayloadWithFirstPrint(parsed.data.payload, nowMs)");
      const enqueueAt = jobs.indexOf("await enqueuePrintJob(");
      assert.ok(stampAt > 0, "print-jobs route calls billPayloadWithFirstPrint(parsed.data.payload, nowMs)");
      assert.ok(enqueueAt > 0, "landmark: the enqueuePrintJob call is found");
      assert.ok(stampAt < enqueueAt, "billPayloadWithFirstPrint comes before enqueuePrintJob");
      assert.match(jobs.slice(enqueueAt, enqueueAt + 80), /payload,/, "and enqueuePrintJob is handed that stamped payload");
      assert.ok(jobs.includes("await enqueueOwnPrintJob(") && /enqueueOwnPrintJob\(\{\s*payload,/.test(jobs), "the own-print fallback reuses the same stamped payload");

      const settle = routeCode("orders", "[id]", "settle", "route.ts");
      assert.ok(settle.includes("stampFirstBillPrint("), "settle route calls stampFirstBillPrint(");
      assert.ok(settle.includes("intent?.bill === true"), "landmark: it is gated on the print intent's bill flag");
      assert.ok(settle.includes("!billFirstPrintFresh(updated)"), "and on the stamp NOT being fresh for the settled total");

      const orders = routeCode("orders", "route.ts");
      assert.ok(orders.includes("firstBillPrintInsertFields(printsBillNow, Date.now(), totals.total)"), "orders route stamps at insert via firstBillPrintInsertFields(printsBillNow, Date.now(), totals.total)");
      assert.ok(orders.includes("printsBillNow ="), "landmark: printsBillNow is defined in the route");

      const settings = routeCode("settings", "route.ts");
      for (const needle of ["settingsUpdateOf(parsed.data)", "new: true", "upsert: true", "setDefaultsOnInsert: true", "runValidators: true"]) {
        assert.ok(settings.includes(needle), `settings route no longer contains ${JSON.stringify(needle)} — this leg's call shape has drifted`);
      }
    });

    await scenario("m", "without runValidators an out-of-range write IS stored (why the route's runValidators: true needle matters)", async () => {
      await resetSettings();
      await mustPut({ payQrValidMinutes: 45 });
      await Settings.findOneAndUpdate({}, { $set: { payQrValidMinutes: 3 } }, { new: true });
      assert.equal((await rawSettings()).payQrValidMinutes, 3, "the bad value landed when validators were off");
      assert.ok(await rejects(() => Settings.findOneAndUpdate({}, { $set: { payQrValidMinutes: 3 } }, { runValidators: true })), "the same write is refused with them on");
    });
  } finally {
    // The name was checked against SCRATCH_PREFIX above; re-checked on the live connection before the drop.
    if (mongoose.connection.name.startsWith(SCRATCH_PREFIX)) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
