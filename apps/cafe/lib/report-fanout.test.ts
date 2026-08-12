import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose, {
  Types,
  type Connection,
  type ConnectOptions,
  type FilterQuery,
  type Model,
  type PipelineStage,
} from "mongoose";

import {
  reportFanout,
  readOrdersInDayRangeMerged,
  __setReportFanoutDepsForTests,
  __setFanoutTimeoutForTests,
} from "./report-fanout";
import {
  recomputeCustomer,
  setReportFanout,
  setDuesPaidTotalFetcher,
  __setCustomerRollupDepsForTests,
} from "./customer-rollup";
import { __setOrderReadDepsForTests } from "./order-read";
import {
  __setRegistryProviderForTests,
  __resetRouterForTests,
  type LedgerRef,
  type StoredClusterRegistry,
} from "./cluster-router";
import { __setConnectionOpenerForTests, disconnectAll } from "./cluster-registry";
import { type IOrder } from "@/models/order.ledger";
import { type IDailyRollup } from "@/models/daily-rollup.ledger";

// F2 Step F2.6 — the cross-shard fan-out, proven DB-FREE (the F2.4 harness): the
// REAL router (date-window resolution) + the REAL registry dial run against a
// fixture registry doc + a fake opener, so every test proves WHICH clusters a
// fan-out landed on; only the model/collection readers are injected fakes. The
// live socket round-trip runs against a seeded M0 in F2's integration pass.

const FIXTURE: StoredClusterRegistry = {
  _id: "cluster-registry",
  core: { id: "core", uri: "mongodb://core/db", tag: "C" },
  ledgers: [
    { id: "l-a2", uri: "mongodb://a2/db", tag: "A2", from: "2026-04-01", to: "2026-07-01", active: false },
    { id: "l-a3", uri: "mongodb://a3/db", tag: "A3", from: "2026-07-01", to: null, active: true },
  ],
};
const A2 = "mongodb://a2/db";
const A3 = "mongodb://a3/db";

function useFixture(): void {
  __setRegistryProviderForTests(async () => structuredClone(FIXTURE));
}

// Fake opener: records dialed URIs AND maps each fake connection back to its
// URI so the injected readers can behave per-leg.
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

// Injected fake Order model: per-URI aggregate results (a value, or a thunk for
// rejection/hang), plus find-chain capture for the plain-find merge.
type AggResult = unknown[] | (() => Promise<unknown[]>);
interface AggCall {
  uri: string;
  pipeline: PipelineStage[];
}
interface FindCall {
  uri: string;
  query: FilterQuery<IOrder>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
}
function installFakeOrderModel(
  uriOf: (conn: Connection) => string,
  fixtures: {
    aggregateByUri?: Record<string, AggResult>;
    foundByUri?: Record<string, IOrder[] | (() => Promise<IOrder[]>)>;
  } = {},
): { aggCalls: AggCall[]; findCalls: FindCall[] } {
  const aggCalls: AggCall[] = [];
  const findCalls: FindCall[] = [];
  __setReportFanoutDepsForTests({
    getOrderModel: (conn) => {
      const uri = uriOf(conn);
      return {
        aggregate: (pipeline: PipelineStage[]) => {
          aggCalls.push({ uri, pipeline });
          const r = fixtures.aggregateByUri?.[uri];
          return { exec: () => (typeof r === "function" ? r() : Promise.resolve(r ?? [])) };
        },
        find: (query: FilterQuery<IOrder>) => {
          const captured: FindCall = { uri, query };
          findCalls.push(captured);
          const chain = {
            sort(s: Record<string, 1 | -1>) {
              captured.sort = s;
              return chain;
            },
            limit(n: number) {
              captured.limit = n;
              return chain;
            },
            lean: () => {
              const r = fixtures.foundByUri?.[uri];
              return typeof r === "function" ? r() : Promise.resolve(r ?? []);
            },
          };
          return chain;
        },
      } as unknown as Model<IOrder>;
    },
  });
  return { aggCalls, findCalls };
}

const order = (id: string): IOrder => ({ _id: id, total: 10000 }) as IOrder;

// Keep runLegs' partial-leg console.error out of the test output (and available
// for assertion) — the customer-rollup.test enqueuer pattern, file-wide.
let loggedErrors: unknown[][] = [];
const origConsoleError = console.error;

let savedCoreUri: string | undefined;
let savedMongoUri: string | undefined;

beforeEach(async () => {
  await disconnectAll();
  __resetRouterForTests();
  __setReportFanoutDepsForTests(null);
  __setOrderReadDepsForTests(null);
  __setFanoutTimeoutForTests(null);
  __setCustomerRollupDepsForTests(null);
  setReportFanout(null); // the REAL F2.6 default (this file proves that wiring)
  setDuesPaidTotalFetcher(null);
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
  __setReportFanoutDepsForTests(null);
  __setOrderReadDepsForTests(null);
  __setFanoutTimeoutForTests(null);
  __setCustomerRollupDepsForTests(null);
  setReportFanout(null);
  setDuesPaidTotalFetcher(null);
  __setConnectionOpenerForTests(null);
  if (savedCoreUri === undefined) delete process.env.CORE_MONGODB_URI;
  else process.env.CORE_MONGODB_URI = savedCoreUri;
  if (savedMongoUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = savedMongoUri;
});

// ── the aggregate fan-out: per-leg closures, honest merge ─────────────────────
test("reportFanout dials EVERY overlapping ledger and hands each closure ITS OWN leg (#74)", async () => {
  useFixture();
  const { opened, uriOf } = installFakeOpener();
  const { aggCalls } = installFakeOrderModel(uriOf, {
    aggregateByUri: {
      [A2]: [{ _id: null, gross: 10000, orders: 2 }],
      [A3]: [{ _id: null, gross: 5000, orders: 1 }],
    },
  });
  const legTags: string[] = [];

  const res = await reportFanout(
    {
      collection: "Order",
      merge: "sum",
      pipeline: (L: LedgerRef) => {
        legTags.push(L.tag); // the tag is known only INSIDE the closure
        return [
          { $match: { _id: { $gte: `ORD-${L.tag}-20260501-000`, $lt: `ORD-${L.tag}-20260715-999~` } } },
        ];
      },
    },
    "2026-05-01",
    "2026-07-15",
  );

  assert.deepEqual(opened.sort(), [A2, A3].sort(), "both overlapping legs dialed — never CORE");
  assert.deepEqual(legTags.sort(), ["A2", "A3"], "one closure invocation per leg, with that leg");
  assert.equal(aggCalls.length, 2);
  for (const call of aggCalls) {
    const tag = call.uri === A2 ? "A2" : "A3";
    const match = (call.pipeline[0] as { $match: { _id: { $gte: string } } }).$match;
    assert.ok(
      match._id.$gte.startsWith(`ORD-${tag}-`),
      "each leg ran the pipeline built with ITS OWN tag (#74 — never one route-level tag)",
    );
  }
  assert.deepEqual(res, { data: { gross: 15000, orders: 3 }, partial: false });
});

test("a single-leg range dials only that ledger; zero legs merge honestly empty with no dials", async () => {
  useFixture();
  const { opened, uriOf } = installFakeOpener();
  installFakeOrderModel(uriOf, { aggregateByUri: { [A3]: [{ _id: null, gross: 100 }] } });
  const spec = { collection: "Order" as const, merge: "sum" as const, pipeline: () => [] };

  const today = await reportFanout(spec, "2026-07-15", "2026-07-15");
  assert.deepEqual(opened, [A3], "the today-range fan-out touches ONLY the active ledger");
  assert.deepEqual(today, { data: { gross: 100 }, partial: false });

  const before = await reportFanout(spec, "2026-01-01", "2026-01-31");
  assert.deepEqual(opened, [A3], "a range predating every window dials nothing new");
  assert.deepEqual(before, { data: {}, partial: false });
});

test("a dead leg degrades to partial:true with the survivors' merge — never a throw (F2.6 Verify)", async () => {
  useFixture();
  const { uriOf } = installFakeOpener();
  installFakeOrderModel(uriOf, {
    aggregateByUri: {
      [A2]: () => Promise.reject(new Error("paused M0")),
      [A3]: [{ _id: null, gross: 5000, orders: 1 }],
    },
  });

  const res = await reportFanout(
    { collection: "Order", merge: "sum", pipeline: () => [] },
    "2026-05-01",
    "2026-07-15",
  );

  assert.equal(res.partial, true, "the dead leg is an HONEST partial, not an error");
  assert.deepEqual(res.data, { gross: 5000, orders: 1 }, "merged totals = the sum of survivors");
  assert.ok(
    loggedErrors.some((a) => String(a[0]).includes("l-a2")),
    "the failed leg is logged, never silent",
  );
});

test("a HUNG leg times out into partial:true — the fan-out never hangs", async () => {
  useFixture();
  const { uriOf } = installFakeOpener();
  __setFanoutTimeoutForTests(30);
  installFakeOrderModel(uriOf, {
    aggregateByUri: {
      [A2]: () => new Promise<unknown[]>(() => {}), // never settles
      [A3]: [{ _id: null, gross: 700 }],
    },
  });

  const res = await reportFanout(
    { collection: "Order", merge: "sum", pipeline: () => [] },
    "2026-05-01",
    "2026-07-15",
  );

  assert.deepEqual(res, { data: { gross: 700 }, partial: true });
  assert.ok(
    loggedErrors.some((a) => String(a.at(-1)).includes("timed out after 30ms")),
    "the timeout is the recorded leg failure",
  );
});

test("ALL legs dead → honest empty merge + partial:true — still no throw, no hang", async () => {
  useFixture();
  const { uriOf } = installFakeOpener();
  installFakeOrderModel(uriOf, {
    aggregateByUri: {
      [A2]: () => Promise.reject(new Error("paused M0")),
      [A3]: () => Promise.reject(new Error("paused M0")),
    },
  });

  const res = await reportFanout(
    { collection: "Order", merge: "sum", pipeline: () => [] },
    "2026-05-01",
    "2026-07-15",
  );

  assert.deepEqual(
    res,
    { data: {}, partial: true },
    "zero survivors merge to the honest empty, flagged partial — a writer (recompute) refuses it, a renderer banners it",
  );
});

test("dailyRollup fans out through the TYPED F2c binding (F2.10) — never the Order model, never raw", async () => {
  useFixture();
  const { opened, uriOf } = installFakeOpener();
  const typedCalls: string[] = [];
  __setReportFanoutDepsForTests({
    getOrderModel: () => {
      throw new Error("dailyRollup must NOT bind the Order model");
    },
    aggregateRaw: async () => {
      throw new Error("dailyRollup must NOT read raw — F2.10 landed its schema");
    },
    getDailyRollupModel: (conn) =>
      ({
        aggregate: () => ({
          exec: async () => {
            typedCalls.push(uriOf(conn));
            return [{ _id: uriOf(conn) === A2 ? "20260630" : "20260701", gross: 100 }];
          },
        }),
      }) as unknown as Model<IDailyRollup>,
  });

  const res = await reportFanout(
    { collection: "dailyRollup", merge: "daySeries", pipeline: () => [] },
    "2026-05-01",
    "2026-07-15",
  );

  assert.deepEqual(opened.sort(), [A2, A3].sort());
  assert.deepEqual(typedCalls.sort(), [A2, A3].sort());
  assert.deepEqual(res.data, [
    { _id: "20260630", gross: 100 },
    { _id: "20260701", gross: 100 },
  ]);
});

test("actionAudit (still schema-less, P6-owned) fans out as a RAW collection read", async () => {
  useFixture();
  const { opened, uriOf } = installFakeOpener();
  const rawCalls: Array<{ uri: string; collection: string }> = [];
  __setReportFanoutDepsForTests({
    getOrderModel: () => {
      throw new Error("actionAudit must NOT bind the Order model");
    },
    aggregateRaw: async (conn, collection) => {
      rawCalls.push({ uri: uriOf(conn), collection });
      return [
        { events: [{ at: uriOf(conn) === A2 ? "2026-06-30T10:00:00Z" : "2026-07-01T10:00:00Z" }] },
      ];
    },
  });

  const res = await reportFanout(
    { collection: "actionAudit", merge: "auditEvents", pipeline: () => [] },
    "2026-05-01",
    "2026-07-15",
  );

  assert.deepEqual(opened.sort(), [A2, A3].sort());
  assert.deepEqual(
    rawCalls.map((c) => c.collection),
    ["actionAudit", "actionAudit"],
  );
  assert.equal((res.data as Array<{ at: string }>).length, 2);
});

// ── the F2.5 consumer: recompute's DEFAULT is the REAL fan-out ────────────────
test("recomputeCustomer runs through the REAL reportFanout by default — all-time hits EVERY ledger", async () => {
  useFixture();
  const customerId = new Types.ObjectId();
  const { opened, uriOf } = installFakeOpener();
  const { aggCalls } = installFakeOrderModel(uriOf, {
    aggregateByUri: {
      [A2]: [{ _id: null, visits: 1, spendPaise: 10000, duePaise: 0 }],
      [A3]: [{ _id: null, visits: 2, spendPaise: 35000, duePaise: 5000 }],
    },
  });
  const writerCalls: Array<{ update: Record<string, unknown> }> = [];
  __setCustomerRollupDepsForTests({
    getCustomerWriter: async () => ({
      updateOne: async (_f, update) => {
        writerCalls.push({ update });
        return { matchedCount: 1, modifiedCount: 1 };
      },
    }),
    invalidateCustomersCache: () => {},
  });
  // CR1.4: recomputeCustomer now also fetches duesPaidTotal before its $set.
  // This test proves the reportFanout WIRING (every ledger dialed, one
  // aggregate per leg) — the dues-subtraction MATH itself is pinned in
  // customer-rollup.test.ts and due-payment.test.ts, so a zero DB-free fake
  // here keeps this test's assertion untouched by that unrelated concern.
  setDuesPaidTotalFetcher(async () => 0);

  const res = await recomputeCustomer(String(customerId)); // NO setReportFanout — the default

  assert.deepEqual(res, {
    applied: true,
    totals: { visits: 3, spendPaise: 45000, duePaise: 5000 },
  });
  assert.deepEqual(
    opened.sort(),
    [A2, A3].sort(),
    "the '00000000'/'99999999' all-time keys resolve BOTH ledgers through the real fan-out",
  );
  assert.equal(aggCalls.length, 2, "one $match+$group aggregate per leg");
  for (const call of aggCalls) {
    const match = (call.pipeline[0] as { $match: { customerId: unknown } }).$match;
    assert.equal(String(match.customerId), String(customerId));
  }
  assert.deepEqual(writerCalls[0].update, {
    $set: { visits: 3, totalSpend: 450, totalDue: 50 },
  });
});

test("recompute through the real fan-out REFUSES a partial (a dead ledger never clobbers CORE)", async () => {
  useFixture();
  const { uriOf } = installFakeOpener();
  installFakeOrderModel(uriOf, {
    aggregateByUri: {
      [A2]: () => Promise.reject(new Error("paused M0")),
      [A3]: [{ _id: null, visits: 2, spendPaise: 35000, duePaise: 5000 }],
    },
  });
  const writerCalls: unknown[] = [];
  __setCustomerRollupDepsForTests({
    getCustomerWriter: async () => ({
      updateOne: async () => {
        writerCalls.push(1);
        return { matchedCount: 1, modifiedCount: 1 };
      },
    }),
    invalidateCustomersCache: () => {},
  });

  const res = await recomputeCustomer(String(new Types.ObjectId()));

  assert.deepEqual(res, { applied: false, reason: "partial" });
  assert.equal(writerCalls.length, 0, "an undercount must never $set the authority target");
});

// ── the F2.4 consumer: the plain-find scatter-gather merge ────────────────────
test("a single-leg range stays the F2.4 direct read (no fan-out machinery, partial:false)", async () => {
  useFixture();
  const { opened } = installFakeOpener();
  const docs = [order("ORD-A3-20260715-002"), order("ORD-A3-20260715-001")];
  // The direct path runs INSIDE order-read (its deps seam), not the fan-out's —
  // fake exactly that collaborator; the fan-out's readers must go untouched.
  let directFinds = 0;
  __setOrderReadDepsForTests({
    getOrderModel: () =>
      ({
        find: () => {
          directFinds += 1;
          const chain = {
            sort: () => chain,
            limit: () => chain,
            lean: async () => docs,
          };
          return chain;
        },
      }) as unknown as Model<IOrder>,
  });

  const res = await readOrdersInDayRangeMerged("2026-07-15", "2026-07-15", { limit: 50 });

  assert.deepEqual(opened, [A3]);
  assert.equal(directFinds, 1, "executed once, by the F2.4 direct read");
  assert.deepEqual(res.orders, docs, "the direct result passes through untouched");
  assert.equal(res.partial, false);
  assert.equal(res.ledgers[0].tag, "A3");
});

test("a multi-leg range runs the find on EVERY leg with EACH leg's OWN _id range, then re-sorts + re-limits", async () => {
  useFixture();
  const { opened, uriOf } = installFakeOpener();
  const a2docs = [order("ORD-A2-20260630-004"), order("ORD-A2-20260615-002")];
  const a3docs = [order("ORD-A3-20260714-003"), order("ORD-A3-20260701-001")];
  const { findCalls } = installFakeOrderModel(uriOf, {
    foundByUri: { [A2]: a2docs, [A3]: a3docs },
  });

  const res = await readOrdersInDayRangeMerged("2026-05-01", "2026-07-15", {
    filter: { status: "Completed" },
    limit: 3,
  });

  assert.deepEqual(opened.sort(), [A2, A3].sort(), "both legs dialed — and never CORE");
  assert.equal(findCalls.length, 2);
  for (const call of findCalls) {
    const tag = call.uri === A2 ? "A2" : "A3";
    assert.deepEqual(
      call.query._id,
      { $gte: `ORD-${tag}-20260501-000`, $lt: `ORD-${tag}-20260715-999~` },
      "the range is built PER LEG with that leg's tag (#74 applies to finds too)",
    );
    assert.equal(call.query.status, "Completed", "the caller filter rides every leg");
    assert.deepEqual(call.sort, { _id: -1 }, "per-leg server-side sort = the merge sort");
    assert.equal(call.limit, 3, "per-leg cap keeps the merged re-limit correct (top-k)");
  }
  assert.deepEqual(
    res.orders.map((o) => o._id),
    ["ORD-A3-20260714-003", "ORD-A3-20260701-001", "ORD-A2-20260630-004"],
    "concat → re-sort {_id:-1} → re-limit 3",
  );
  assert.equal(res.partial, false);
});

test("a dead leg in the find merge yields the survivors + partial:true", async () => {
  useFixture();
  const { uriOf } = installFakeOpener();
  const a3docs = [order("ORD-A3-20260714-003")];
  installFakeOrderModel(uriOf, {
    foundByUri: {
      [A2]: () => Promise.reject(new Error("paused M0")),
      [A3]: a3docs,
    },
  });

  const res = await readOrdersInDayRangeMerged("2026-05-01", "2026-07-15");

  assert.equal(res.partial, true, "the list is honestly marked missing a ledger's rows");
  assert.deepEqual(res.orders, a3docs);
});

test("the merged read rejects an _id / root-$ filter at the door (the F2.4 gate, before any dial)", async () => {
  useFixture();
  const { opened } = installFakeOpener();

  await assert.rejects(
    readOrdersInDayRangeMerged("2026-05-01", "2026-07-15", {
      filter: { $or: [{ _id: "x" }] } as unknown as FilterQuery<IOrder>,
    }),
    /filter key '\$or' is not composable/,
  );
  assert.equal(opened.length, 0);
});
