import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose, {
  Types,
  type Connection,
  type ConnectOptions,
  type Model,
} from "mongoose";

import {
  recomputeDayRollup,
  setDayRollupFold,
  __setRollupRecomputeDepsForTests,
  type DayRollupFoldOutput,
} from "./rollup-recompute";
import {
  __setRegistryProviderForTests,
  __resetRouterForTests,
  type StoredClusterRegistry,
} from "./cluster-router";
import {
  __setConnectionOpenerForTests,
  disconnectAll,
} from "./cluster-registry";
import { type IOrder } from "@/models/order.ledger";
import {
  type IDailyRollup,
  type IProductDayCounter,
} from "@/models/daily-rollup.ledger";

// F2 Step F2.10 — the recompute AUTHORITY's mechanics, proven DB-FREE (the
// F2.4/F2.6 harness): REAL router + REAL registry dial against a fixture doc +
// fake opener (every test proves WHICH ledgers a recompute touches), injected
// model fakes capturing the exact write ops. The financial FOLD is P2-owned —
// tests inject fixture folds; the default REFUSES (the F2.5 refusal precedent).

// Windows carry the F2.7 FLIP-DAY one-day overlap: 2026-07-01 lives on BOTH
// legs (each leg's row covers only its own orders — the F2.6 daySeries note).
const FIXTURE: StoredClusterRegistry = {
  _id: "cluster-registry",
  core: { id: "core", uri: "mongodb://core/db", tag: "C" },
  ledgers: [
    { id: "l-a2", uri: "mongodb://a2/db", tag: "A2", from: "2026-04-01", to: "2026-07-02", active: false },
    { id: "l-a3", uri: "mongodb://a3/db", tag: "A3", from: "2026-07-01", to: null, active: true },
  ],
};
const A2 = "mongodb://a2/db";
const A3 = "mongodb://a3/db";

function installFakeOpener(): {
  opened: string[];
  uriOf: (conn: Connection) => string;
} {
  const opened: string[] = [];
  const uris = new WeakMap<Connection, string>();
  __setConnectionOpenerForTests((uri, _opts: ConnectOptions) => {
    opened.push(uri);
    const conn = mongoose.createConnection();
    uris.set(conn, uri);
    return conn;
  });
  return { opened, uriOf: (c) => uris.get(c) ?? "unknown" };
}

// ── captured write ops ────────────────────────────────────────────────────────
interface FindCall {
  uri: string;
  query: Record<string, unknown>;
  select?: string;
}
interface Captured {
  finds: FindCall[];
  rollupReplaces: Array<{ uri: string; filter: unknown; doc: unknown; opts: unknown }>;
  rollupDeletes: Array<{ uri: string; filter: unknown }>;
  counterBulks: Array<{ uri: string; ops: unknown[] }>;
  counterDeletes: Array<{ uri: string; filter: Record<string, unknown> }>;
}

function installFakeModels(
  uriOf: (conn: Connection) => string,
  ordersByUri: Record<string, IOrder[] | (() => Promise<IOrder[]>)>,
): Captured {
  const cap: Captured = {
    finds: [],
    rollupReplaces: [],
    rollupDeletes: [],
    counterBulks: [],
    counterDeletes: [],
  };
  __setRollupRecomputeDepsForTests({
    getOrderModel: (conn) => {
      const uri = uriOf(conn);
      return {
        find: (query: Record<string, unknown>) => {
          const call: FindCall = { uri, query };
          cap.finds.push(call);
          const chain = {
            select(sel: string) {
              call.select = sel;
              return chain;
            },
            lean: () => {
              const r = ordersByUri[uri];
              return typeof r === "function" ? r() : Promise.resolve(r ?? []);
            },
          };
          return chain;
        },
      } as unknown as Model<IOrder>;
    },
    getDailyRollupModel: (conn) => {
      const uri = uriOf(conn);
      return {
        replaceOne: async (filter: unknown, doc: unknown, opts: unknown) => {
          cap.rollupReplaces.push({ uri, filter, doc, opts });
          return { matchedCount: 1, modifiedCount: 1 };
        },
        deleteOne: async (filter: unknown) => {
          cap.rollupDeletes.push({ uri, filter });
          return { deletedCount: 0 };
        },
      } as unknown as Model<IDailyRollup>;
    },
    getProductDayCounterModel: (conn) => {
      const uri = uriOf(conn);
      return {
        bulkWrite: async (ops: unknown[]) => {
          cap.counterBulks.push({ uri, ops });
          return {};
        },
        deleteMany: async (filter: Record<string, unknown>) => {
          cap.counterDeletes.push({ uri, filter });
          return { deletedCount: 0 };
        },
      } as unknown as Model<IProductDayCounter>;
    },
  });
  return cap;
}

const PID_1 = new Types.ObjectId().toHexString();
const PID_2 = new Types.ObjectId().toHexString();

const order = (id: string): IOrder => ({ _id: id, total: 10000 }) as IOrder;

/** A well-formed fixture fold (integers everywhere). */
function fixtureFold(orders: IOrder[]): DayRollupFoldOutput {
  return {
    rollup: {
      orders: orders.length,
      gross: orders.length * 10000,
      payments: [{ mode: "Cash", amount: orders.length * 10000, orders: orders.length }],
      taxBuckets: [{ rate: 5, taxable: orders.length * 9524, gst: orders.length * 476 }],
    },
    counters: [
      { productId: PID_1, sold: orders.length, revenue: orders.length * 10000 },
    ],
  };
}

let loggedErrors: unknown[][] = [];
const origConsoleError = console.error;
let savedCoreUri: string | undefined;
let savedMongoUri: string | undefined;

beforeEach(async () => {
  await disconnectAll();
  __resetRouterForTests();
  __setRollupRecomputeDepsForTests(null);
  setDayRollupFold(null);
  __setRegistryProviderForTests(async () => structuredClone(FIXTURE));
  loggedErrors = [];
  console.error = (...a: unknown[]) => {
    loggedErrors.push(a);
  };
  savedCoreUri = process.env.CORE_MONGODB_URI;
  savedMongoUri = process.env.MONGODB_URI;
  delete process.env.CORE_MONGODB_URI;
  process.env.MONGODB_URI = "mongodb://bootstrap/db";
});

afterEach(async () => {
  console.error = origConsoleError;
  await disconnectAll();
  __resetRouterForTests();
  __setRollupRecomputeDepsForTests(null);
  setDayRollupFold(null);
  __setRegistryProviderForTests(null);
  __setConnectionOpenerForTests(null);
  if (savedCoreUri === undefined) delete process.env.CORE_MONGODB_URI;
  else process.env.CORE_MONGODB_URI = savedCoreUri;
  if (savedMongoUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = savedMongoUri;
});

// ── refusal + vacuous paths ───────────────────────────────────────────────────

test("an invalid day key throws (never a silent no-op)", async () => {
  await assert.rejects(() => recomputeDayRollup("2026-07-01"), /invalid day key/);
  await assert.rejects(() => recomputeDayRollup("nonsense"), /invalid day key/);
});

test("REFUSES with fold-unbuilt until P2 wires the financial fold — no dial, no write", async () => {
  const { opened } = installFakeOpener();
  const res = await recomputeDayRollup("20260630");
  assert.equal(res.applied, false);
  assert.deepEqual(
    res.legs.map((l) => (l.applied ? "applied" : l.reason)),
    ["fold-unbuilt"],
  );
  assert.deepEqual(opened, [], "refusal must not open a single connection");
});

test("a day predating every window is a vacuous success (zero legs)", async () => {
  const { opened } = installFakeOpener();
  const res = await recomputeDayRollup("20260301");
  assert.deepEqual(res, { day: "20260301", applied: true, legs: [] });
  assert.deepEqual(opened, []);
});

// ── the apply path ────────────────────────────────────────────────────────────

test("single-leg day: bounded per-tag read + idempotent replace + counter reconcile", async () => {
  const { opened, uriOf } = installFakeOpener();
  const cap = installFakeModels(uriOf, {
    [A2]: [order("ORD-A2-20260630-001"), order("ORD-A2-20260630-002")],
  });
  setDayRollupFold({ projection: "total items status", fold: fixtureFold });

  const res = await recomputeDayRollup("20260630");

  assert.deepEqual(opened, [A2], "20260630 lives on the A2 leg only");
  // The read is bounded by THAT leg's own tag (#74) and carries the fold's projection.
  assert.equal(cap.finds.length, 1);
  assert.deepEqual(cap.finds[0].query, {
    _id: { $gte: "ORD-A2-20260630-000", $lt: "ORD-A2-20260630-999~" },
  });
  assert.equal(cap.finds[0].select, "total items status");

  // Idempotent full replace, versioned, upserted.
  assert.equal(cap.rollupReplaces.length, 1);
  const r = cap.rollupReplaces[0];
  assert.deepEqual(r.filter, { _id: "20260630" });
  assert.deepEqual(r.opts, { upsert: true });
  assert.deepEqual(r.doc, {
    orders: 2,
    gross: 20000,
    payments: [{ mode: "Cash", amount: 20000, orders: 2 }],
    taxBuckets: [{ rate: 5, taxable: 19048, gst: 952 }],
    v: 1,
  });

  // Counters: keyed replace-upserts + the stale sweep EXCLUDING the kept ids.
  assert.equal(cap.counterBulks.length, 1);
  const ops = cap.counterBulks[0].ops as Array<{
    replaceOne: { filter: { _id: string }; replacement: unknown; upsert: boolean };
  }>;
  assert.equal(ops.length, 1);
  assert.deepEqual(ops[0].replaceOne.filter, { _id: `${PID_1}-20260630` });
  // `_id` rides IN the replacement: bulkWrite validates it as a full document
  // (required `_id` included) — proven against the seeded M0, 2026-07-05.
  assert.deepEqual(ops[0].replaceOne.replacement, {
    _id: `${PID_1}-20260630`,
    sold: 2,
    revenue: 20000,
    v: 1,
  });
  assert.equal(ops[0].replaceOne.upsert, true);

  assert.equal(cap.counterDeletes.length, 1);
  const del = cap.counterDeletes[0].filter._id as { $regex: RegExp; $nin: string[] };
  assert.deepEqual(del.$nin, [`${PID_1}-20260630`]);
  assert.ok(del.$regex.test(`${PID_2}-20260630`), "a stale same-day counter matches the sweep");
  assert.ok(!del.$regex.test(`${PID_2}-20260629`), "another day's counter must NOT match");

  assert.deepEqual(res.legs, [
    { leg: res.legs[0].leg, applied: true, orders: 2, counters: 1 },
  ]);
  assert.equal(res.applied, true);
});

test("FLIP-DAY: both overlapping legs recompute independently, each with ITS OWN tag range", async () => {
  const { opened, uriOf } = installFakeOpener();
  const cap = installFakeModels(uriOf, {
    [A2]: [order("ORD-A2-20260701-001")],
    [A3]: [order("ORD-A3-20260701-001"), order("ORD-A3-20260701-002")],
  });
  setDayRollupFold({ fold: fixtureFold });

  const res = await recomputeDayRollup("20260701");

  assert.deepEqual(opened.sort(), [A2, A3].sort());
  const rangesByUri = Object.fromEntries(
    cap.finds.map((f) => [f.uri, (f.query._id as { $gte: string }).$gte]),
  );
  assert.equal(rangesByUri[A2], "ORD-A2-20260701-000");
  assert.equal(rangesByUri[A3], "ORD-A3-20260701-000");
  assert.equal(cap.finds.find((f) => f.uri === A2)?.select, undefined, "no projection → full docs");

  // One rollup row PER LEG (each covers only its own orders — daySeries sums on collision).
  assert.equal(cap.rollupReplaces.length, 2);
  const docsByUri = Object.fromEntries(
    cap.rollupReplaces.map((r) => [r.uri, (r.doc as { orders: number }).orders]),
  );
  assert.deepEqual(docsByUri, { [A2]: 1, [A3]: 2 });
  assert.equal(res.applied, true);
});

test("an EMPTY day recomputes to ABSENCE (row + counters removed), fold never invoked", async () => {
  const { uriOf } = installFakeOpener();
  const cap = installFakeModels(uriOf, { [A2]: [] });
  let foldCalls = 0;
  setDayRollupFold({
    fold: (orders) => {
      foldCalls += 1;
      return fixtureFold(orders);
    },
  });

  const res = await recomputeDayRollup("20260630");

  assert.equal(foldCalls, 0, "an empty order set needs no financial fold");
  assert.deepEqual(cap.rollupReplaces, []);
  assert.deepEqual(cap.rollupDeletes.map((d) => d.filter), [{ _id: "20260630" }]);
  assert.equal(cap.counterDeletes.length, 1);
  assert.equal(cap.counterDeletes[0].filter._id instanceof RegExp, true);
  assert.deepEqual(res.legs, [
    { leg: res.legs[0].leg, applied: true, orders: 0, counters: 0 },
  ]);
});

test("garbage fold output (float paise) is REJECTED — nothing written, reason fold-invalid", async () => {
  const { uriOf } = installFakeOpener();
  const cap = installFakeModels(uriOf, { [A2]: [order("ORD-A2-20260630-001")] });
  setDayRollupFold({
    fold: () => ({
      rollup: { orders: 1, gross: 120.5 }, // a rupee float slipped through
      counters: [],
    }),
  });

  const res = await recomputeDayRollup("20260630");

  assert.deepEqual(cap.rollupReplaces, []);
  assert.deepEqual(cap.counterBulks, []);
  assert.deepEqual(cap.counterDeletes, []);
  assert.deepEqual(
    res.legs.map((l) => (l.applied ? "applied" : l.reason)),
    ["fold-invalid"],
  );
  assert.ok(
    loggedErrors.some((a) => String(a[0]).includes("fold output rejected")),
    "the rejection is logged with its reason",
  );
});

test("a bad counter productId is REJECTED before any write", async () => {
  const { uriOf } = installFakeOpener();
  const cap = installFakeModels(uriOf, { [A2]: [order("ORD-A2-20260630-001")] });
  setDayRollupFold({
    fold: () => ({
      rollup: { orders: 1, gross: 10000 },
      counters: [{ productId: "not-hex", sold: 1, revenue: 10000 }],
    }),
  });

  const res = await recomputeDayRollup("20260630");
  assert.deepEqual(cap.rollupReplaces, []);
  assert.deepEqual(
    res.legs.map((l) => (l.applied ? "applied" : l.reason)),
    ["fold-invalid"],
  );
});

test("legs are INDEPENDENT: a dead leg fails alone, the survivor still applies (no cross-leg atomicity, #14)", async () => {
  const { uriOf } = installFakeOpener();
  const cap = installFakeModels(uriOf, {
    [A2]: () => Promise.reject(new Error("paused M0")),
    [A3]: [order("ORD-A3-20260701-001")],
  });
  setDayRollupFold({ fold: fixtureFold });

  const res = await recomputeDayRollup("20260701");

  const byTag = Object.fromEntries(res.legs.map((l) => [l.leg.tag, l]));
  const a2 = byTag.A2;
  assert.equal(a2.applied, false);
  assert.equal(a2.applied ? "unexpected" : a2.reason, "leg-failed");
  assert.equal(byTag.A3.applied, true);
  assert.equal(res.applied, false, "one failed leg = the day is NOT fully applied");
  assert.equal(cap.rollupReplaces.length, 1);
  assert.equal(cap.rollupReplaces[0].uri, A3, "the dead leg never dirtied a write");
  assert.ok(loggedErrors.some((a) => String(a[0]).includes("failed for 20260701")));
});

test("a fold emitting ZERO counters still sweeps the day's stale counters (bulkWrite skipped)", async () => {
  const { uriOf } = installFakeOpener();
  const cap = installFakeModels(uriOf, { [A2]: [order("ORD-A2-20260630-001")] });
  setDayRollupFold({
    fold: () => ({ rollup: { orders: 1, gross: 10000 }, counters: [] }),
  });

  const res = await recomputeDayRollup("20260630");

  assert.deepEqual(cap.counterBulks, [], "no ops → no bulkWrite round-trip");
  assert.equal(cap.counterDeletes.length, 1);
  // The sweep must still carry BOTH operators: the day-scoped regex (so only
  // THIS day's stale counters die) and the (empty) keep-list.
  const del = cap.counterDeletes[0].filter._id as { $regex: RegExp; $nin: string[] };
  assert.deepEqual(del.$nin, []);
  assert.ok(del.$regex instanceof RegExp);
  assert.ok(del.$regex.test(`${PID_2}-20260630`), "same-day stale counters are swept");
  assert.ok(!del.$regex.test(`${PID_2}-20260629`), "other days are untouched");
  assert.equal(res.applied, true);
});

test("out-of-Int32-range fold output is REJECTED before any write (replaceOne would silently STRIP it)", async () => {
  // Empirical (Mongo 8.0 + mongoose 8, the F2.10 arbitration probe): an
  // uncastable Int32 in a replaceOne replacement raises NO error — mongoose
  // strips the path and upserts the doc with the field ABSENT. The pre-write
  // range gate is therefore the ONLY guard on this path.
  const { uriOf } = installFakeOpener();
  const cap = installFakeModels(uriOf, { [A2]: [order("ORD-A2-20260630-001")] });
  setDayRollupFold({
    fold: () => ({
      rollup: { orders: 1, gross: 3_000_000_000 }, // > INT32_MAX (₹3 Cr in paise)
      counters: [],
    }),
  });

  const res = await recomputeDayRollup("20260630");

  assert.deepEqual(cap.rollupReplaces, [], "nothing may be written");
  assert.deepEqual(
    res.legs.map((l) => (l.applied ? "applied" : l.reason)),
    ["fold-invalid"],
  );
  assert.ok(
    loggedErrors.some((a) => String(a[1] ?? a[0]).includes("out-of-Int32-range")),
    "the rejection names the range violation",
  );
});
