import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose, { Types, type ConnectOptions, type Model } from "mongoose";

import {
  applyCustomerRollup,
  customerRollupEnqueuer,
  recomputeCustomer,
  setReportFanout,
  setDuesPaidTotalFetcher,
  __setCustomerRollupDepsForTests,
  APPLIED_ORDERS_MAX,
  ALL_TIME_FROM,
  ALL_TIME_TO,
  type RollupOrder,
  type RecomputeFanoutSpec,
} from "./customer-rollup";
import {
  createOrder,
  setCustomerRollupEnqueuer,
  __setOrderCreateDepsForTests,
  type NewOrderInput,
} from "./order-create";
import {
  __setRegistryProviderForTests,
  __resetRouterForTests,
  type LedgerRef,
  type StoredClusterRegistry,
} from "./cluster-router";
import { __setConnectionOpenerForTests, disconnectAll } from "./cluster-registry";
import { customerSchema } from "@/models/Customer";
import { type IOrder } from "@/models/order.ledger";

// F2 Step F2.5 — the idempotent CRM rollup + recompute authority, proven DB-FREE.
// The op SHAPES (the #60 filter-predicate guard, the bounded $push, the paise→₹
// unit boundary, the recompute $set) are pinned against injected fakes; the CORE
// routing is proven via the registry's fake opener. HONEST SCOPE (the F2.3 split):
// the live guarded-$inc round-trip AND the same-instant concurrent-apply race run
// against a seeded M0 in F2's integration pass — a DB-free fake cannot prove
// engine write-conflict semantics, and asserting them here would be the
// tautology the F2.3 review killed. The retry test below covers the SEQUENTIAL
// re-fire (the predicate no-op); `recomputeCustomer` is the authority regardless.

const ORDER_ID = "ORD-A3-20260715-007";
const CUSTOMER = new Types.ObjectId();

function mkOrder(over: Partial<RollupOrder> = {}): RollupOrder {
  return {
    _id: ORDER_ID,
    customerId: CUSTOMER,
    payment: "Cash",
    total: 55000, // paise (₹550)
    paidAmount: 55000,
    // Derived from the mode the caller asked for, so an override of `payment` alone
    // still yields a coherent order (an "Unpaid" fixture is a held tab, i.e. still
    // Pending). An explicit `status` in `over` still wins — that's how the
    // cancelled-order cases are built.
    status: over.payment === "Unpaid" ? "Pending" : "Completed",
    ...over,
  };
}

type WriterCall = { filter: Record<string, unknown>; update: Record<string, unknown> };
function installFakeWriter(
  results: Array<{ matchedCount: number; modifiedCount: number }> = [
    { matchedCount: 1, modifiedCount: 1 },
  ],
): { calls: WriterCall[]; invalidations: () => number } {
  const calls: WriterCall[] = [];
  let invalidations = 0;
  let i = 0;
  __setCustomerRollupDepsForTests({
    getCustomerWriter: async () => ({
      updateOne: async (filter, update) => {
        calls.push({ filter, update });
        const r = results[Math.min(i, results.length - 1)];
        i += 1;
        return r;
      },
    }),
    invalidateCustomersCache: () => {
      invalidations += 1;
    },
  });
  return { calls, invalidations: () => invalidations };
}

// Fake connection opener (order-create.test pattern) — records dialed URIs.
function installFakeOpener(): { uri: string; opts: ConnectOptions }[] {
  const opened: { uri: string; opts: ConnectOptions }[] = [];
  __setConnectionOpenerForTests((uri, opts) => {
    opened.push({ uri, opts });
    return mongoose.createConnection();
  });
  return opened;
}

const FIXTURE: StoredClusterRegistry = {
  _id: "cluster-registry",
  core: { id: "core", uri: "mongodb://core/db", tag: "C" },
  ledgers: [
    { id: "l-a3", uri: "mongodb://a3/db", tag: "A3", from: "2026-07-01", to: null, active: true },
  ],
};

let savedCoreUri: string | undefined;
let savedMongoUri: string | undefined;

beforeEach(async () => {
  await disconnectAll();
  __resetRouterForTests();
  __setCustomerRollupDepsForTests(null);
  __setOrderCreateDepsForTests(null);
  setCustomerRollupEnqueuer(null); // production default (the real F2.5 enqueuer)
  setReportFanout(null);
  setDuesPaidTotalFetcher(null);
  savedCoreUri = process.env.CORE_MONGODB_URI;
  savedMongoUri = process.env.MONGODB_URI;
  delete process.env.CORE_MONGODB_URI;
  process.env.MONGODB_URI = "mongodb://bootstrap/db";
});

afterEach(async () => {
  await disconnectAll();
  __resetRouterForTests();
  __setCustomerRollupDepsForTests(null);
  __setOrderCreateDepsForTests(null);
  setCustomerRollupEnqueuer(null);
  setReportFanout(null);
  setDuesPaidTotalFetcher(null);
  __setConnectionOpenerForTests(null);
  if (savedCoreUri === undefined) delete process.env.CORE_MONGODB_URI;
  else process.env.CORE_MONGODB_URI = savedCoreUri;
  if (savedMongoUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = savedMongoUri;
});

// ── the Customer.appliedOrders schema addition (landed by F2.5) ────────────────
test("appliedOrders is omit-empty (#8), select:false, and adds NO index", () => {
  const path = customerSchema.path("appliedOrders") as unknown as {
    instance: string;
    defaultValue?: unknown;
    options: { select?: boolean };
  };
  assert.equal(path.instance, "Array");
  assert.equal(path.defaultValue, undefined, "default: undefined — no auto-[] materialization");
  assert.equal(path.options.select, false, "internal marker array never leaves the server");
  for (const [keys] of customerSchema.indexes()) {
    assert.ok(!("appliedOrders" in keys), "no appliedOrders index (never queried standalone)");
  }
  // An untouched customer stores NO field at all (0 bytes, not []).
  const M = mongoose.createConnection().model("CustomerOmitEmpty", customerSchema);
  const doc = new M({ name: "Asha", mobile: "9999999999" }).toObject() as unknown as Record<
    string,
    unknown
  >;
  assert.ok(!("appliedOrders" in doc) || doc.appliedOrders === undefined);
});

// ── applyCustomerRollup: the #60 op shape ──────────────────────────────────────
test("the guard is a FILTER predicate gating the $inc, with a bounded $push marker (#60)", async () => {
  const { calls, invalidations } = installFakeWriter();

  const res = await applyCustomerRollup(mkOrder());

  assert.deepEqual(res, { applied: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].filter._id, CUSTOMER);
  assert.deepEqual(
    calls[0].filter.appliedOrders,
    { $ne: ORDER_ID },
    "idempotency lives in the update FILTER — matchedCount===0 is the no-op",
  );
  assert.deepEqual(calls[0].update, {
    $inc: { visits: 1, totalSpend: 550, totalDue: 0 },
    $push: { appliedOrders: { $each: [ORDER_ID], $slice: -APPLIED_ORDERS_MAX } },
  });
  assert.equal(invalidations(), 1, "customers list cache invalidated on a real apply");
});

test("contributions convert paise→v1 rupees at the CORE boundary (the 100× landmine)", async () => {
  const { calls } = installFakeWriter();

  // A Due order: nothing collected — full total becomes spend AND due.
  await applyCustomerRollup(mkOrder({ payment: "Due", total: 12345, paidAmount: 0 }));

  assert.deepEqual(
    (calls[0].update as { $inc: unknown }).$inc,
    { visits: 1, totalSpend: 123.45, totalDue: 123.45 },
    "12345 paise lands as ₹123.45 on the rupee-shaped v1 Customer (P5 v:2 flips this)",
  );
});

test("a held Unpaid tab contributes NOTHING and is NOT marked (settle must not be swallowed)", async () => {
  const { calls, invalidations } = installFakeWriter();

  const res = await applyCustomerRollup(mkOrder({ payment: "Unpaid", paidAmount: 0 }));

  assert.deepEqual(res, { applied: false, reason: "zero-contribution" });
  assert.equal(calls.length, 0, "no write, no marker — the full contribution lands once at settlement");
  assert.equal(invalidations(), 0);
});

test("a walk-in order (no customerId) is a no-op", async () => {
  const { calls } = installFakeWriter();
  const res = await applyCustomerRollup(mkOrder({ customerId: undefined }));
  assert.deepEqual(res, { applied: false, reason: "no-customer" });
  assert.equal(calls.length, 0);
});

test("a retry (predicate no-match) applies NOTHING and does not invalidate the cache", async () => {
  const { calls, invalidations } = installFakeWriter([
    { matchedCount: 1, modifiedCount: 1 },
    { matchedCount: 0, modifiedCount: 0 },
  ]);

  const first = await applyCustomerRollup(mkOrder());
  const second = await applyCustomerRollup(mkOrder());

  assert.deepEqual(first, { applied: true });
  assert.deepEqual(second, { applied: false, reason: "already-applied-or-missing" });
  assert.equal(calls.length, 2, "the retry still issues the guarded update — the FILTER no-ops it");
  assert.equal(invalidations(), 1);
});

test("the rollup dials ONLY the CORE cluster — never a ledger", async () => {
  __setRegistryProviderForTests(async () => structuredClone(FIXTURE));
  const opened = installFakeOpener();
  // Real deps: the writer binds via coreModel('Customer') on the fake (unconnected)
  // CORE pool, so the updateOne itself times out buffering — the DIAL is the assert.
  mongoose.set("bufferTimeoutMS", 25);
  try {
    await assert.rejects(applyCustomerRollup(mkOrder()), /buffering timed out/);
  } finally {
    mongoose.set("bufferTimeoutMS", 10000);
  }
  assert.deepEqual(
    opened.map((o) => o.uri),
    ["mongodb://bootstrap/db"],
    "the CORE bootstrap URI, not mongodb://a3/db",
  );
});

// ── the fire-and-forget enqueuer (best-effort, §2.6) ──────────────────────────
test("customerRollupEnqueuer swallows an async failure (logged, never propagated)", async () => {
  __setCustomerRollupDepsForTests({
    getCustomerWriter: async () => {
      throw new Error("CORE down");
    },
  });
  const logged: unknown[][] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => {
    logged.push(a);
  };
  try {
    customerRollupEnqueuer(mkOrder() as IOrder);
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    console.error = orig;
  }
  assert.equal(logged.length, 1);
  assert.match(String(logged[0][0]), /best-effort apply failed/);
});

// ── createOrder → rollup wiring (the F2.3 seam, now defaulted to F2.5) ─────────
function mkInput(over: Partial<NewOrderInput> = {}): NewOrderInput {
  return {
    customerName: "Asha",
    items: [
      { productId: new Types.ObjectId(), name: "Cold Coffee", price: 12000, qty: 1, kotRound: 1 },
    ],
    subtotal: 30000,
    total: 30000,
    paidAmount: 0,
    payment: "Due",
    status: "Completed",
    receiver: "Rahul",
    kotRounds: 1,
    ...over,
  };
}

test("createOrder's DEFAULT enqueuer applies the guarded rollup with the minted orderId", async () => {
  __setRegistryProviderForTests(async () => structuredClone(FIXTURE));
  const opened = installFakeOpener();
  __setOrderCreateDepsForTests({
    now: () => new Date("2026-07-15T10:00:00Z"),
    nextOrderSequence: async () => 1,
    getOrderModel: () =>
      ({
        create: async (doc: Record<string, unknown>) => ({ toObject: () => doc }),
      }) as unknown as Model<IOrder>,
  });
  const { calls } = installFakeWriter();

  const order = await createOrder(mkInput({ customerId: CUSTOMER }));

  // Fire-and-forget: wait for the async apply to land on the fake writer.
  for (let i = 0; calls.length === 0 && i < 100; i += 1) {
    await new Promise((r) => setImmediate(r));
  }
  assert.equal(calls.length, 1, "the production default enqueuer ran without explicit wiring");
  assert.equal(calls[0].filter._id, CUSTOMER);
  assert.deepEqual(calls[0].filter.appliedOrders, { $ne: order._id });
  assert.deepEqual(
    (calls[0].update as { $inc: unknown }).$inc,
    { visits: 1, totalSpend: 300, totalDue: 300 },
  );
  assert.deepEqual(
    opened.map((o) => o.uri),
    ["mongodb://a3/db"],
    "the create itself still dialed only the active ledger (rollup writer was injected)",
  );
});

// ── recomputeCustomer: the AUTHORITY behind the F2.6 seam ──────────────────────
const FAKE_LEG: LedgerRef = {
  id: "l-x",
  uri: "mongodb://x/db",
  tag: "X",
  from: null,
  to: null,
  active: true,
};

// The F2.5-era "refuses to run before F2.6 wires the fan-out" guard is GONE by
// design: F2.6 landed 2026-07-03 and the REAL `reportFanout` is now the seam's
// DEFAULT (`setReportFanout(null)` restores it, mirroring the enqueuer flip).
// The default-wiring end-to-end proof — recompute through the real fan-out with
// NO override — lives in report-fanout.test.ts, next to the harness it needs.

test("recomputeCustomer rejects a malformed customerId", async () => {
  setReportFanout(async () => ({ data: {}, partial: false }));
  await assert.rejects(recomputeCustomer("not-an-objectid"), /invalid customerId/);
});

test("recompute fans out an all-time, all-ledger 'sum' spec mirroring ledgerContribution", async () => {
  let captured: { spec: RecomputeFanoutSpec; from: Date | string; to: Date | string } | null = null;
  setReportFanout(async (spec, from, to) => {
    captured = { spec, from, to };
    return { data: { visits: 3, spendPaise: 100000, duePaise: 0 }, partial: false };
  });
  // CR1.4: recomputeCustomer now fetches duesPaidTotal before its $set — a
  // DB-free fake (house rule #1), since no DuePayment exists in THIS scenario.
  // The dedicated dues-subtraction test below covers the non-zero case.
  setDuesPaidTotalFetcher(async () => 0);
  const { calls, invalidations } = installFakeWriter();

  const res = await recomputeCustomer(String(CUSTOMER));

  assert.ok(captured);
  const { spec, from, to } = captured as {
    spec: RecomputeFanoutSpec;
    from: Date | string;
    to: Date | string;
  };
  assert.equal(from, ALL_TIME_FROM);
  assert.equal(to, ALL_TIME_TO);
  assert.equal(spec.collection, "Order");
  assert.equal(spec.merge, "sum");
  const stages = spec.pipeline(FAKE_LEG) as unknown as Array<Record<string, unknown>>;
  assert.equal(stages.length, 2);
  const match = (stages[0] as { $match: { customerId: unknown } }).$match;
  assert.ok(match.customerId instanceof Types.ObjectId, "matches the stored ObjectId ref (#7)");
  assert.equal(String(match.customerId), String(CUSTOMER));
  // BOTH of ledgerContribution's zero-contribution cases must appear in the mirror:
  // a held "Unpaid" tab and a CANCELLED order (CR1.3). Pinned together because this
  // pipeline is the recompute AUTHORITY — it $sets totals rather than nudging them,
  // so a case it misses would hand a cancelled order's spend/due straight back.
  const zeroRated = {
    $or: [{ $eq: ["$payment", "Unpaid"] }, { $eq: ["$status", "Cancelled"] }],
  };
  assert.deepEqual(stages[1], {
    $group: {
      _id: null,
      visits: { $sum: { $cond: [zeroRated, 0, 1] } },
      spendPaise: { $sum: { $cond: [zeroRated, 0, "$total"] } },
      duePaise: {
        $sum: {
          $cond: [zeroRated, 0, { $max: [0, { $subtract: ["$total", "$paidAmount"] }] }],
        },
      },
    },
  });

  // …and the authoritative $set, converted to v1 rupees.
  assert.deepEqual(res, {
    applied: true,
    totals: { visits: 3, spendPaise: 100000, duePaise: 0 },
  });
  assert.equal(calls.length, 1);
  assert.ok((calls[0].filter._id as Types.ObjectId) instanceof Types.ObjectId);
  assert.equal(String(calls[0].filter._id), String(CUSTOMER));
  assert.deepEqual(calls[0].update, {
    $set: { visits: 3, totalSpend: 1000, totalDue: 0 },
  });
  assert.equal(invalidations(), 1);
});

test("a PARTIAL fan-out never overwrites the authority target", async () => {
  setReportFanout(async () => ({ data: { visits: 1, spendPaise: 100, duePaise: 0 }, partial: true }));
  const { calls } = installFakeWriter();

  const res = await recomputeCustomer(String(CUSTOMER));

  assert.deepEqual(res, { applied: false, reason: "partial" });
  assert.equal(calls.length, 0, "an incomplete sum must not clobber correct totals");
});

test("an all-empty merge honestly recomputes to zeros; negatives clamp at 0 (v1 clampLedger parity)", async () => {
  setReportFanout(async () => ({ data: {}, partial: false }));
  setDuesPaidTotalFetcher(async () => 0); // no DuePayment in this scenario (DB-free fake)
  const zero = installFakeWriter();
  const resZero = await recomputeCustomer(String(CUSTOMER));
  assert.equal(resZero.applied, true);
  assert.deepEqual(zero.calls[0].update, { $set: { visits: 0, totalSpend: 0, totalDue: 0 } });

  setReportFanout(async () => ({
    data: { visits: 2, spendPaise: -500, duePaise: -100 },
    partial: false,
  }));
  const neg = installFakeWriter();
  await recomputeCustomer(String(CUSTOMER));
  assert.deepEqual(neg.calls[0].update, { $set: { visits: 2, totalSpend: 0, totalDue: 0 } });
});

test("a garbage merge payload throws before any write", async () => {
  setReportFanout(async () => ({ data: { visits: 1, spendPaise: "x", duePaise: 0 }, partial: false }));
  const { calls } = installFakeWriter();
  await assert.rejects(recomputeCustomer(String(CUSTOMER)), /not a finite number/);
  assert.equal(calls.length, 0);
});

test("recompute on a deleted customer reports customer-missing without cache churn", async () => {
  setReportFanout(async () => ({ data: { visits: 1, spendPaise: 100, duePaise: 0 }, partial: false }));
  setDuesPaidTotalFetcher(async () => 0); // no DuePayment in this scenario (DB-free fake)
  const { invalidations } = installFakeWriter([{ matchedCount: 0, modifiedCount: 0 }]);
  const res = await recomputeCustomer(String(CUSTOMER));
  assert.deepEqual(res, { applied: false, reason: "customer-missing" });
  assert.equal(invalidations(), 0);
});

// ── CR1.4 §1: recomputeCustomer subtracts duesPaidTotal before its $set ───────
// The §1 DUES RESURRECTION hazard applied to the AUTHORITY itself: a customer
// who paid down their balance via a DuePayment (a write OUTSIDE the Order
// collection the fan-out reads) must not have that money silently restored by
// a recompute run. Faked via setDuesPaidTotalFetcher — the DB-free seam house
// rule #1 requires for an orchestrator's DB-touching collaborator.
test("recomputeCustomer subtracts duesPaidTotal (rupees) from the ledger due (paise/100) — the CR1.3 reciprocal-guard lesson applied to the authority", async () => {
  setReportFanout(async () => ({
    data: { visits: 2, spendPaise: 50000, duePaise: 30000 }, // ₹500 spend, ₹300 ledger due
    partial: false,
  }));
  setDuesPaidTotalFetcher(async () => 300); // the customer already paid the full ₹300 via a DuePayment
  const { calls } = installFakeWriter();

  const res = await recomputeCustomer(String(CUSTOMER));

  assert.equal(res.applied, true);
  assert.deepEqual(
    calls[0].update,
    { $set: { visits: 2, totalSpend: 500, totalDue: 0 } },
    "totalDue must be the ledger due (300) minus duesPaidTotal (300) = 0, not the resurrected ledger due",
  );
});

test("recomputeCustomer clamps totalDue at 0 when duesPaidTotal exceeds the ledger-derived due, never goes negative", async () => {
  setReportFanout(async () => ({
    data: { visits: 1, spendPaise: 50000, duePaise: 10000 }, // ₹500 spend, ₹100 ledger due
    partial: false,
  }));
  // More was collected (₹500, e.g. an overpayment settled earlier) than the
  // ledger currently says is due — Math.max(0, …) must floor at 0, mirroring
  // v1's clampLedger, never persist a negative ledger.
  setDuesPaidTotalFetcher(async () => 500);
  const { calls } = installFakeWriter();

  await recomputeCustomer(String(CUSTOMER));

  assert.deepEqual(calls[0].update, { $set: { visits: 1, totalSpend: 500, totalDue: 0 } });
});
