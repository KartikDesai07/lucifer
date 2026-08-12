/**
 * CR1.4 live leg — proves the dues-collection write shapes against a REAL
 * MongoDB, which the DB-free unit tests (lib/due-payment.test.ts) cannot: that
 * the CAS `totalDue: { $gte: }` decrement really serializes two concurrent
 * full-balance payments into exactly one winner (not a fake port pretending to
 * be atomic), that the `clientRef` unique index really raises a duplicate-key
 * error a retry can recover from, and that the reconcile aggregation really
 * does not resurrect a due once it is run against real Order/DuePayment
 * documents. Exercises the REAL `receiveDuePayment` / `duesPaidTotal` server
 * core (lib/due-payment.ts) and the REAL `Customer`/`DuePayment`/`Order`
 * models — nothing here is a fake standing in for the write logic itself.
 *
 *   npm run verify:dues:live            (defaults to the local stand-in)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_dues npm run verify:dues:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops only the three collections it creates (Customer,
 * DuePayment, Order) — modelled on verify-tables-live.ts, the safer of the two
 * existing live legs (verify-order-integrity-live.ts drops the whole scratch
 * database instead).
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import { connectDB } from "@/lib/db";
import { Customer } from "@/models/Customer";
import { DuePayment } from "@/models/DuePayment";
import { Order } from "@/models/Order";
import { receiveDuePayment, duesPaidTotal } from "@/lib/due-payment";
import type { PaymentMode, OrderStatus } from "@/lib/constants";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}dues`;
const DUPLICATE_KEY_CODE = 11000;
const VERIFIER_NAME = "Verifier";

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
  }
}

let mobileSeq = 0;
async function makeCustomer(totalDue: number): Promise<string> {
  mobileSeq += 1;
  const customer = await Customer.create({
    name: `Scratch Customer ${mobileSeq}`,
    mobile: `999000${String(mobileSeq).padStart(4, "0")}`,
    totalDue,
  });
  return String(customer._id);
}

// A minimal, real Order fixture — only the fields the reconcile aggregate and
// ledgerContribution actually read matter for this leg's assertions.
function buildScratchOrder(opts: {
  orderId: string;
  customerId: string;
  payment: PaymentMode;
  total: number;
  paidAmount: number;
  status: OrderStatus;
}) {
  return {
    orderId: opts.orderId,
    customerId: opts.customerId,
    customerName: "Scratch Customer",
    items: [
      {
        productId: "p1",
        name: "Scratch Item",
        price: opts.total,
        qty: 1,
        modifiers: [],
        instructions: "",
        kotRound: 1,
      },
    ],
    subtotal: opts.total,
    discount: 0,
    gstAmount: 0,
    total: opts.total,
    paidAmount: opts.paidAmount,
    payment: opts.payment,
    status: opts.status,
    receiver: VERIFIER_NAME,
    kotRounds: 1,
  };
}

// Mirrors app/api/customers/[id]/reconcile/route.ts's totalDue computation
// EXACTLY (visits/totalSpend omitted — this leg only asserts totalDue), using
// the REAL duesPaidTotal export rather than a re-derived stand-in. Executed as
// a REAL Mongo aggregate: the DB-free mirror in due-payment.test.ts cannot
// prove the pipeline actually runs against a live server; this can. Source
// drift is pinned separately by due-payment.test.ts's grep-pin (§6).
async function runReconcileAggregate(customerId: string): Promise<number> {
  const unlessZeroRated = (expr: unknown) => ({
    $cond: [
      { $or: [{ $eq: ["$payment", "Unpaid"] }, { $eq: ["$status", "Cancelled"] }] },
      0,
      expr,
    ],
  });
  const [agg] = await Order.aggregate<{ totalDue: number }>([
    { $match: { customerId, status: { $ne: "Cancelled" } } },
    {
      $group: {
        _id: null,
        totalDue: {
          $sum: unlessZeroRated({ $max: [0, { $subtract: ["$total", "$paidAmount"] }] }),
        },
      },
    },
  ]);
  const paidDues = await duesPaidTotal(customerId);
  return Math.max(0, (agg?.totalDue ?? 0) - paidDues);
}

// ── leg 1 — a partial payment decrements totalDue by exactly the amount ─────
async function leg1(): Promise<void> {
  const customerId = await makeCustomer(500);
  const result = await receiveDuePayment({
    customerId,
    amount: 200,
    mode: "Cash",
    clientRef: randomUUID(),
    receivedBy: VERIFIER_NAME,
  });
  check("a partial payment decrements totalDue by exactly the amount", result.ok && result.customer.totalDue === 300);
  const count = await DuePayment.countDocuments({ customerId });
  check("a partial payment inserts exactly ONE DuePayment record", count === 1);
}

// ── leg 2 — amount omitted clears the balance to 0 ("pay in full") ─────────
async function leg2(): Promise<void> {
  const customerId = await makeCustomer(450);
  const result = await receiveDuePayment({
    customerId,
    mode: "Online",
    clientRef: randomUUID(),
    receivedBy: VERIFIER_NAME,
  });
  check("an omitted amount (pay in full) clears the balance to 0", result.ok && result.customer.totalDue === 0);
}

// ── leg 3 — concurrent double-collect: exactly one full-balance payment wins,
// the other 409s (no CAS match), totalDue never goes negative ──────────────
async function leg3(): Promise<void> {
  const customerId = await makeCustomer(300);
  const [r1, r2] = await Promise.all([
    receiveDuePayment({ customerId, mode: "Cash", clientRef: randomUUID(), receivedBy: VERIFIER_NAME }),
    receiveDuePayment({ customerId, mode: "Cash", clientRef: randomUUID(), receivedBy: VERIFIER_NAME }),
  ]);
  const results = [r1, r2];
  const winners = results.filter((r) => r.ok);
  const losers = results.filter((r) => !r.ok);
  check("CONCURRENT double-collect: exactly one full-balance payment wins", winners.length === 1);
  check(
    "CONCURRENT double-collect: the other attempt is refused with 409 (the CAS $gte guard, not a race)",
    losers.length === 1 && !losers[0].ok && losers[0].status === 409,
  );
  const after = await Customer.findById(customerId).select("totalDue").lean();
  check("CONCURRENT double-collect: totalDue NEVER goes negative", (after?.totalDue ?? -1) === 0);
  const recordCount = await DuePayment.countDocuments({ customerId });
  check("CONCURRENT double-collect: exactly one DuePayment record was written", recordCount === 1);
}

// ── leg 4 — idempotent retry: the same clientRef twice collects once ───────
async function leg4(): Promise<void> {
  const customerId = await makeCustomer(400);
  const clientRef = randomUUID();
  const first = await receiveDuePayment({
    customerId,
    amount: 150,
    mode: "Cash",
    clientRef,
    receivedBy: VERIFIER_NAME,
  });
  const second = await receiveDuePayment({
    customerId,
    amount: 150,
    mode: "Cash",
    clientRef,
    receivedBy: VERIFIER_NAME,
  });
  check("idempotent retry: both attempts report success (the retry is not an error)", first.ok && second.ok);
  const count = await DuePayment.countDocuments({ clientRef });
  check("idempotent retry: exactly ONE DuePayment record for the shared clientRef", count === 1);
  const after = await Customer.findById(customerId).select("totalDue").lean();
  check("idempotent retry: totalDue decremented exactly ONCE, not twice", (after?.totalDue ?? -1) === 250);
}

// ── leg 5 — RESURRECTION: pay a due, then run the reconcile aggregation ────
async function leg5(): Promise<void> {
  const customerId = await makeCustomer(300); // the ledger-derived due, already applied to the projection
  await Order.create(
    buildScratchOrder({
      orderId: "SCRATCH-DUES-RESURRECTION",
      customerId,
      payment: "Cash",
      total: 500,
      paidAmount: 200,
      status: "Completed",
    }),
  );
  const payment = await receiveDuePayment({
    customerId,
    mode: "Cash",
    clientRef: randomUUID(),
    receivedBy: VERIFIER_NAME,
  });
  check("RESURRECTION setup: the due payment clears totalDue on the Customer doc", payment.ok && payment.customer.totalDue === 0);

  const reconciled = await runReconcileAggregate(customerId);
  check(
    "RESURRECTION: after paying a due, the reconcile aggregation does NOT restore it",
    reconciled === 0,
  );
}

// ── leg 6 — over-payment is refused ─────────────────────────────────────────
async function leg6(): Promise<void> {
  const customerId = await makeCustomer(100);
  const result = await receiveDuePayment({
    customerId,
    amount: 150,
    mode: "Cash",
    clientRef: randomUUID(),
    receivedBy: VERIFIER_NAME,
  });
  check("an over-payment (amount > balance) is refused", !result.ok && result.status === 400);
  const after = await Customer.findById(customerId).select("totalDue").lean();
  check("a refused over-payment leaves totalDue untouched", (after?.totalDue ?? -1) === 100);
  const count = await DuePayment.countDocuments({ customerId });
  check("a refused over-payment inserts NO DuePayment record", count === 0);
}

// ── leg 7 — a held Unpaid tab does not inflate the reconciled due ──────────
async function leg7(): Promise<void> {
  const customerId = await makeCustomer(0);
  await Order.create(
    buildScratchOrder({
      orderId: "SCRATCH-DUES-UNPAID-TAB",
      customerId,
      payment: "Unpaid",
      total: 500,
      paidAmount: 0,
      status: "Pending",
    }),
  );
  await Order.create(
    buildScratchOrder({
      orderId: "SCRATCH-DUES-SETTLED",
      customerId,
      payment: "Cash",
      total: 500,
      paidAmount: 200,
      status: "Completed",
    }),
  );
  const reconciled = await runReconcileAggregate(customerId);
  check(
    "a held Unpaid tab does not inflate the reconciled due — only the settled order's shortfall (300) counts",
    reconciled === 300,
  );
}

// ── leg 8 (F9) — concurrent SAME-clientRef full-balance calls: the idempotency
// contract wins over the CAS race — BOTH report success, exactly one row is
// written, and totalDue lands at 0 (never negative, never decremented twice) ─
async function leg8(): Promise<void> {
  const customerId = await makeCustomer(300);
  const clientRef = randomUUID();
  const [r1, r2] = await Promise.all([
    receiveDuePayment({ customerId, mode: "Cash", clientRef, receivedBy: VERIFIER_NAME }),
    receiveDuePayment({ customerId, mode: "Cash", clientRef, receivedBy: VERIFIER_NAME }),
  ]);
  check(
    "F9 CONCURRENT same-clientRef: BOTH attempts report success (retried != double-collect, even racing)",
    r1.ok && r2.ok,
  );
  const count = await DuePayment.countDocuments({ clientRef });
  check("F9 CONCURRENT same-clientRef: exactly ONE DuePayment record was written", count === 1);
  const after = await Customer.findById(customerId).select("totalDue").lean();
  check("F9 CONCURRENT same-clientRef: totalDue lands at exactly 0 (decremented once, not twice)", (after?.totalDue ?? -1) === 0);
}

// ── leg 9 (F4) — a replayed clientRef carrying a DIFFERENT amount/mode is
// refused (409), not silently reported as success for a payload that was
// never applied ───────────────────────────────────────────────────────────
async function leg9(): Promise<void> {
  const customerId = await makeCustomer(500);
  const clientRef = randomUUID();
  const first = await receiveDuePayment({
    customerId,
    amount: 300,
    mode: "Cash",
    clientRef,
    receivedBy: VERIFIER_NAME,
  });
  check("F4 setup: the first attempt (amount 300, Cash) succeeds", first.ok);

  const second = await receiveDuePayment({
    customerId,
    amount: 200,
    mode: "Online",
    clientRef,
    receivedBy: VERIFIER_NAME,
  });
  check(
    "F4: a replayed clientRef with a DIFFERENT amount/mode is refused with 409, not reported as false success",
    !second.ok && second.status === 409,
  );
  const count = await DuePayment.countDocuments({ clientRef });
  check("F4: exactly ONE DuePayment record exists for the clientRef (the mismatched replay wrote nothing)", count === 1);
  const after = await Customer.findById(customerId).select("totalDue").lean();
  check("F4: totalDue reflects only the FIRST attempt's amount (300), unchanged by the refused replay", (after?.totalDue ?? -1) === 200);
}

// ── leg 10 (F0) — client asserts the ACTUAL cash counted, not the server's
// own fresher balance: a client-provided `amount` must be honored verbatim
// even when the server's stored balance has since moved out from under a
// stale UI snapshot, and a stale-high assertion (the shrink direction) must
// be refused loudly rather than silently resolved.
async function leg10(): Promise<void> {
  const customerId = await makeCustomer(500);
  // Simulate a second terminal collecting Rs 200 behind this operator's back
  // (their UI still shows the stale Rs 500 balance).
  await Customer.updateOne({ _id: customerId }, { $inc: { totalDue: 300 } });
  const stale = await Customer.findById(customerId).select("totalDue").lean();
  check("leg10 setup: the server's balance is now 800, ahead of the operator's stale 500 snapshot", stale?.totalDue === 800);

  const result = await receiveDuePayment({
    customerId,
    amount: 500, // the cash the operator actually counted — must be honored verbatim
    mode: "Cash",
    clientRef: randomUUID(),
    receivedBy: VERIFIER_NAME,
  });
  check("an explicit amount collects exactly what was counted, not the server's fresher balance", result.ok && result.customer.totalDue === 300);
  if (result.ok) {
    check("the stored DuePayment records the cash actually taken (500), not the server's resolved balance", result.payment.amount === 500);
  }

  // Shrink direction: the operator's snapshot is now stale-HIGH (they assert
  // more than the current balance) — must be refused loudly, not resolved.
  const shrunk = await receiveDuePayment({
    customerId,
    amount: 500,
    mode: "Cash",
    clientRef: randomUUID(),
    receivedBy: VERIFIER_NAME,
  });
  check("a stale-high assertion (amount > current balance) is refused with 400", !shrunk.ok && shrunk.status === 400);
  const after = await Customer.findById(customerId).select("totalDue").lean();
  check("a refused stale-high assertion leaves totalDue untouched", (after?.totalDue ?? -1) === 300);
  const rowCount = await DuePayment.countDocuments({ customerId });
  check("a refused stale-high assertion writes no additional DuePayment row", rowCount === 1);
}

// ── leg (G2) — a cold-start race: two concurrent same-clientRef inserts
// fired with NO up-front createIndexes() call (unlike every other leg in
// this file, which benefits from main()'s own build) must still yield
// exactly ONE row. Deliberately run FIRST, before main()'s createIndexes()
// call, and as close to connectDB() as possible: mongoose's `autoIndex`
// fires the clientRef unique-index build automatically but in the
// BACKGROUND, unawaited by connectDB() — the arbiter's live probe measured
// it completing ~329ms after connect. This leg exercises receiveDuePayment's
// OWN `.init()` await (the G2 fix) rather than this script's convenience
// build, which every other leg quietly relies on.
async function legG2ColdStartRace(): Promise<void> {
  // main() already dropped the collection immediately before calling this
  // leg — no second drop here, since every extra await only widens the gap
  // from connectDB() and gives the background autoIndex build more time to
  // finish before this leg's race actually fires.
  const customerId = await makeCustomer(1000);
  const clientRef = randomUUID();
  await Promise.all([
    receiveDuePayment({ customerId, amount: 300, mode: "Cash", clientRef, receivedBy: VERIFIER_NAME }),
    receiveDuePayment({ customerId, amount: 300, mode: "Cash", clientRef, receivedBy: VERIFIER_NAME }),
  ]);
  const count = await DuePayment.countDocuments({ clientRef });
  check(
    "G2: a cold-start race (no up-front createIndexes()) still yields exactly ONE row for one clientRef",
    count === 1,
  );
}

// ── leg (G1/G8) — an ack-lost insert (the write commits, but create()
// throws) must NOT have its CAS decrement reverted, and a same-clientRef
// retry must see the REAL balance, never a wrongly-reverted one. Reproduced
// by patching DuePayment.create for the duration of this leg only: it
// performs the REAL insert (so the row genuinely lands with receiveDuePayment's
// own pre-minted _id) and then throws a non-duplicate-key error, modelling a
// lost server ack (an election past the pinned serverSelectionTimeoutMS, a
// transient network error) rather than faking the DB write away entirely —
// there is no honest way to fault-inject a real driver ack loss here.
interface CreateOnePort {
  create(doc: Record<string, unknown>): Promise<{ toObject(): unknown }>;
}

async function legG1AckLostInsert(): Promise<void> {
  const customerId = await makeCustomer(500);
  const clientRef = randomUUID();
  const patchTarget = DuePayment as unknown as CreateOnePort;
  const originalCreate = patchTarget.create.bind(patchTarget);
  patchTarget.create = async (doc: Record<string, unknown>) => {
    await originalCreate(doc);
    throw new Error("simulated lost ack — the insert committed but the driver never reported success");
  };

  let first: Awaited<ReturnType<typeof receiveDuePayment>>;
  try {
    first = await receiveDuePayment({
      customerId,
      amount: 200,
      mode: "Cash",
      clientRef,
      receivedBy: VERIFIER_NAME,
    });
  } finally {
    patchTarget.create = originalCreate;
  }
  check(
    "G1/G8: an ack-lost insert (row landed, driver threw) still reports success — not a reverted decrement",
    first.ok && first.customer.totalDue === 300,
  );
  const rows = await DuePayment.countDocuments({ clientRef });
  check("G1/G8: exactly ONE DuePayment row exists for the ack-lost insert (no phantom compensation)", rows === 1);

  const retry = await receiveDuePayment({
    customerId,
    amount: 200,
    mode: "Cash",
    clientRef,
    receivedBy: VERIFIER_NAME,
  });
  check(
    "G1/G8: a same-clientRef retry after an ack-lost insert reports the REAL balance (300), not a reverted 500",
    retry.ok && retry.customer.totalDue === 300,
  );
}

// ── leg (G3) — a clientRef belonging to ANOTHER customer must 409, never be
// silently adopted (the second customer's balance/row count stay untouched).
async function legG3ForeignClientRef(): Promise<void> {
  const customerA = await makeCustomer(500);
  const customerB = await makeCustomer(300);
  const sharedRef = randomUUID();
  const first = await receiveDuePayment({
    customerId: customerA,
    amount: 200,
    mode: "Cash",
    clientRef: sharedRef,
    receivedBy: VERIFIER_NAME,
  });
  check("G3 setup: customer A's payment succeeds", first.ok);

  const second = await receiveDuePayment({
    customerId: customerB,
    amount: 200, // SAME amount/mode as A's row — isolates the customerId gap;
    mode: "Cash", // a differing amount would already 409 via replayMismatch's
    clientRef: sharedRef, // pre-existing amount check, masking this defect.
    receivedBy: VERIFIER_NAME,
  });
  check(
    "G3: a clientRef belonging to ANOTHER customer is refused with 409, not silently adopted",
    !second.ok && second.status === 409,
  );
  const rowsForB = await DuePayment.countDocuments({ customerId: customerB });
  check("G3: zero DuePayment rows were written for customer B", rowsForB === 0);
  const afterB = await Customer.findById(customerB).select("totalDue").lean();
  check("G3: customer B's balance is untouched", (afterB?.totalDue ?? -1) === 300);
}

// ── leg (G3, concurrent) — the same guard at the OTHER adopt site: two
// customers racing on the SAME clientRef, where the dup-key WINNER belongs
// to the other customer, must still 409 the loser rather than silently
// adopting a foreign row.
async function legG3ForeignClientRefConcurrent(): Promise<void> {
  const customerA = await makeCustomer(500);
  const customerB = await makeCustomer(300);
  const sharedRef = randomUUID();
  const [rA, rB] = await Promise.all([
    receiveDuePayment({ customerId: customerA, amount: 200, mode: "Cash", clientRef: sharedRef, receivedBy: VERIFIER_NAME }),
    receiveDuePayment({ customerId: customerB, amount: 100, mode: "Cash", clientRef: sharedRef, receivedBy: VERIFIER_NAME }),
  ]);
  const results = [rA, rB] as const;
  const winners = results.filter((r) => r.ok);
  const losers = results.filter((r) => !r.ok);
  check("G3 CONCURRENT: exactly one of the two foreign-customer racers wins", winners.length === 1);
  check(
    "G3 CONCURRENT: the loser is refused with 409 (a foreign clientRef's dup-key winner is never silently adopted)",
    losers.length === 1 && !losers[0].ok && losers[0].status === 409,
  );
  const loserIsA = losers[0] === rA;
  const loserId = loserIsA ? customerA : customerB;
  const loserOriginalBalance = loserIsA ? 500 : 300;
  const rows = await DuePayment.countDocuments({ customerId: loserId });
  check("G3 CONCURRENT: the losing customer has zero DuePayment rows", rows === 0);
  const after = await Customer.findById(loserId).select("totalDue").lean();
  check("G3 CONCURRENT: the losing customer's balance is untouched", (after?.totalDue ?? -1) === loserOriginalBalance);
}

// ── leg (G4) — an omitted-amount replay (the settle route's "pay in full"
// shape) against a NON-ZERO balance must 409, never report false success.
async function legG4OmittedAmountReplay(): Promise<void> {
  const customerId = await makeCustomer(900);
  const clientRef = randomUUID();
  // Simulate the exact hazard: a row already exists under this clientRef
  // (e.g. an earlier partial payment) that never actually cleared the full
  // balance — written out-of-band so totalDue stays at 900, unsynced from it.
  await DuePayment.create({
    customerId,
    amount: 200,
    mode: "Cash",
    receivedBy: VERIFIER_NAME,
    clientRef,
  });
  const result = await receiveDuePayment({
    customerId,
    mode: "Cash",
    clientRef, // same clientRef, amount omitted — the settle route's shape
    receivedBy: VERIFIER_NAME,
  });
  check(
    "G4: an omitted-amount replay against a NON-ZERO balance is refused with 409, not reported as false success",
    !result.ok && result.status === 409,
  );
  const after = await Customer.findById(customerId).select("totalDue").lean();
  check("G4: the refused replay leaves totalDue untouched (900)", (after?.totalDue ?? -1) === 900);
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(
      `Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`,
    );
  }

  process.env.MONGODB_URI = uri;
  await connectDB();
  // Drop only what this script creates (the safer verify-tables-live.ts
  // precedent) — never the whole scratch database.
  await Promise.all([
    Customer.collection.drop().catch(() => undefined),
    DuePayment.collection.drop().catch(() => undefined),
    Order.collection.drop().catch(() => undefined),
  ]);

  // G2: must run BEFORE createIndexes() below — every OTHER leg in this file
  // benefits from that up-front build and would never exercise the
  // cold-start race the G2 fix actually closes (see the leg's own comment).
  await legG2ColdStartRace();

  await Promise.all([Customer.createIndexes(), DuePayment.createIndexes(), Order.createIndexes()]);

  console.log(`\nCR1.4 dues live — live against ${dbName}\n`);

  try {
    await leg1();
    await leg2();
    await leg3();
    await leg4();
    await leg5();
    await leg6();
    await leg7();
    await leg8();
    await leg9();
    await leg10();
    await legG1AckLostInsert();
    await legG3ForeignClientRef();
    await legG3ForeignClientRefConcurrent();
    await legG4OmittedAmountReplay();

    // The clientRef unique index really exists (not just declared) — a raw
    // duplicate insert must raise 11000, independent of receiveDuePayment's
    // own compensating catch (leg4 already proves the compensating PATH; this
    // proves the INDEX the compensation depends on is real).
    const dupRef = randomUUID();
    const customerId = await makeCustomer(100);
    await DuePayment.create({ customerId, amount: 50, mode: "Cash", clientRef: dupRef, receivedBy: VERIFIER_NAME });
    let duplicateCode = 0;
    try {
      await DuePayment.create({ customerId, amount: 50, mode: "Cash", clientRef: dupRef, receivedBy: VERIFIER_NAME });
    } catch (e) {
      duplicateCode = (e as { code?: number }).code ?? 0;
    }
    check("the clientRef unique index really raises a duplicate-key error", duplicateCode === DUPLICATE_KEY_CODE);
  } finally {
    await Promise.all([
      Customer.collection.drop().catch(() => undefined),
      DuePayment.collection.drop().catch(() => undefined),
      Order.collection.drop().catch(() => undefined),
    ]);
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
