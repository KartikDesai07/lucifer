import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose, { type ConnectOptions, type FilterQuery, type Model } from "mongoose";
import {
  readOrderById,
  readOrdersInDayRange,
  __setOrderReadDepsForTests,
} from "./order-read";
import {
  __setRegistryProviderForTests,
  __resetRouterForTests,
  type StoredClusterRegistry,
} from "./cluster-router";
import { __setConnectionOpenerForTests, disconnectAll } from "./cluster-registry";
import { type IOrder } from "@/models/order.ledger";

// F2 Step F2.4 — the cluster-scoped order READ service, proven DB-FREE. The REAL
// router (tag targeting + date-window resolution) and the REAL registry dial run
// against a fixture registry doc + a fake connection opener, so every test proves
// WHICH cluster a read landed on (via the opener's recorded URIs); the Order model
// — the one DB-touching collaborator — is an injected fake that captures the
// query/sort/limit shape. The live socket round-trip runs against a seeded M0 in
// F2's integration pass (the same static-now / live-later split as F2.1–F2.3).

// Two contiguous ledgers; A3 is the open-ended active one (A2 a closed archive).
const FIXTURE: StoredClusterRegistry = {
  _id: "cluster-registry",
  core: { id: "core", uri: "mongodb://core/db", tag: "C" },
  ledgers: [
    { id: "l-a2", uri: "mongodb://a2/db", tag: "A2", from: "2026-04-01", to: "2026-07-01", active: false },
    { id: "l-a3", uri: "mongodb://a3/db", tag: "A3", from: "2026-07-01", to: null, active: true },
  ],
};

function useFixture(): void {
  __setRegistryProviderForTests(async () => structuredClone(FIXTURE));
}

// Fake connection opener — records the URIs the registry dials (proving a read
// targeted exactly one, correct cluster) and returns an unconnected connection
// (the injected fake model ignores it).
function installFakeOpener(): { uri: string; opts: ConnectOptions }[] {
  const opened: { uri: string; opts: ConnectOptions }[] = [];
  __setConnectionOpenerForTests((uri, opts) => {
    opened.push({ uri, opts });
    return mongoose.createConnection();
  });
  return opened;
}

// Injected fake Order model: captures findById ids and find(query)+sort+limit
// chains, resolving to canned results. Chain shape mirrors the service's real
// usage (`find().sort()[.limit()].lean()` / `findById().lean()`).
interface CapturedFind {
  query: FilterQuery<IOrder>;
  sort?: Record<string, 1 | -1>;
  limit?: number;
}
function installFakeModel(
  fixtures: { byId?: Record<string, IOrder>; found?: IOrder[] } = {},
): { findByIdCalls: string[]; findCalls: CapturedFind[] } {
  const findByIdCalls: string[] = [];
  const findCalls: CapturedFind[] = [];
  __setOrderReadDepsForTests({
    getOrderModel: () =>
      ({
        findById: (id: string) => {
          findByIdCalls.push(id);
          return { lean: async () => fixtures.byId?.[id] ?? null };
        },
        find: (query: FilterQuery<IOrder>) => {
          const captured: CapturedFind = { query };
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
            lean: async () => fixtures.found ?? [],
          };
          return chain;
        },
      }) as unknown as Model<IOrder>,
  });
  return { findByIdCalls, findCalls };
}

const sampleOrder = (id: string): IOrder =>
  ({ _id: id, customerName: "Asha", total: 45050 }) as IOrder;

let savedCoreUri: string | undefined;
let savedMongoUri: string | undefined;

beforeEach(async () => {
  await disconnectAll();
  __resetRouterForTests();
  __setOrderReadDepsForTests(null);
  savedCoreUri = process.env.CORE_MONGODB_URI;
  savedMongoUri = process.env.MONGODB_URI;
  delete process.env.CORE_MONGODB_URI;
  process.env.MONGODB_URI = "mongodb://bootstrap/db";
});

afterEach(async () => {
  await disconnectAll();
  __resetRouterForTests();
  __setOrderReadDepsForTests(null);
  __setConnectionOpenerForTests(null);
  if (savedCoreUri === undefined) delete process.env.CORE_MONGODB_URI;
  else process.env.CORE_MONGODB_URI = savedCoreUri;
  if (savedMongoUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = savedMongoUri;
});

// ── Targeted point read: ONE cluster, parsed from the tag ─────────────────────
test("readOrderById dials ONLY the archive ledger its tag names — never active/CORE", async () => {
  useFixture();
  const opened = installFakeOpener();
  const id = "ORD-A2-20260501-009";
  const { findByIdCalls } = installFakeModel({ byId: { [id]: sampleOrder(id) } });

  const order = await readOrderById(id);

  assert.equal(order?._id, id, "returns the stored doc from the tagged ledger");
  assert.deepEqual(findByIdCalls, [id], "point lookup by the full orderId (= _id, #5)");
  assert.deepEqual(
    opened.map((o) => o.uri),
    ["mongodb://a2/db"],
    "exactly one cluster dialed — the A2 archive, not A3/CORE (no scatter-gather)",
  );
});

test("readOrderById on an active-tag id dials only the active ledger", async () => {
  useFixture();
  const opened = installFakeOpener();
  const id = "ORD-A3-20260715-004";
  installFakeModel({ byId: { [id]: sampleOrder(id) } });

  const order = await readOrderById(id);

  assert.equal(order?._id, id);
  assert.deepEqual(opened.map((o) => o.uri), ["mongodb://a3/db"]);
});

test("a malformed orderId resolves null WITHOUT dialing any cluster (caller 404s)", async () => {
  useFixture();
  const opened = installFakeOpener();
  const { findByIdCalls } = installFakeModel();

  // Not an orderId at all, and the tagless v1 format — both fail the F2c regex.
  assert.equal(await readOrderById("not-an-order-id"), null);
  assert.equal(await readOrderById("ORD-20260501-009"), null);

  assert.equal(opened.length, 0, "no connection opened for an unroutable id");
  assert.equal(findByIdCalls.length, 0);
});

test("a well-formed id whose tag is NOT in the registry resolves null, no dial", async () => {
  useFixture();
  const opened = installFakeOpener();
  const { findByIdCalls } = installFakeModel();

  assert.equal(await readOrderById("ORD-ZZ-20260501-001"), null);

  assert.equal(opened.length, 0);
  assert.equal(findByIdCalls.length, 0);
});

test("a routable id with no matching doc resolves null (dialed, looked up, missing)", async () => {
  useFixture();
  const opened = installFakeOpener();
  const { findByIdCalls } = installFakeModel(); // no byId fixtures → every lookup misses

  assert.equal(await readOrderById("ORD-A2-20260501-777"), null);

  assert.deepEqual(opened.map((o) => o.uri), ["mongodb://a2/db"]);
  assert.deepEqual(findByIdCalls, ["ORD-A2-20260501-777"]);
});

// ── Date-routed list: a today-scoped read touches ONLY the active ledger ──────
test("a today-scoped list dials ONLY the active ledger and scans its tag's _id day range", async () => {
  useFixture();
  const opened = installFakeOpener();
  const doc = sampleOrder("ORD-A3-20260715-001");
  const { findCalls } = installFakeModel({ found: [doc] });

  const res = await readOrdersInDayRange("2026-07-15", "2026-07-15", {
    filter: { status: "Pending" },
    limit: 50,
  });

  assert.equal(res.kind, "direct", "one overlapping ledger → executed directly");
  assert.equal(res.ledgers.length, 1);
  assert.equal(res.ledgers[0].tag, "A3");
  if (res.kind !== "direct") return; // narrow for TS — asserted above
  assert.deepEqual(res.orders, [doc]);
  assert.deepEqual(
    opened.map((o) => o.uri),
    ["mongodb://a3/db"],
    "ONLY the active ledger touched — never the A2 archive or CORE",
  );
  assert.equal(findCalls.length, 1);
  assert.deepEqual(
    findCalls[0].query._id,
    { $gte: "ORD-A3-20260715-000", $lt: "ORD-A3-20260715-999~" },
    "per-tag _id prefix range for the day (P7-R4 bound shape; ~ covers seq ≥ 1000)",
  );
  assert.equal(findCalls[0].query.status, "Pending", "caller filter merged in");
  assert.deepEqual(findCalls[0].sort, { _id: -1 }, "default sort: day+seq, newest first");
  assert.equal(findCalls[0].limit, 50);
});

test("a multi-day range inside one ledger stays direct, bounds spanning the days", async () => {
  useFixture();
  const opened = installFakeOpener();
  const { findCalls } = installFakeModel();

  const res = await readOrdersInDayRange("2026-07-10", "2026-07-15");

  assert.equal(res.kind, "direct");
  assert.deepEqual(opened.map((o) => o.uri), ["mongodb://a3/db"]);
  assert.deepEqual(findCalls[0].query._id, {
    $gte: "ORD-A3-20260710-000",
    $lt: "ORD-A3-20260715-999~",
  });
  assert.equal(findCalls[0].limit, undefined, "no cap unless the caller sets one");
});

// ── Multi-ledger range: DEFER to F2.6 — no query, no merge, no dial ───────────
test("a range spanning two ledgers returns a fanout deferral without touching any cluster", async () => {
  useFixture();
  const opened = installFakeOpener();
  const { findCalls } = installFakeModel();

  const res = await readOrdersInDayRange("2026-05-01", "2026-07-15");

  assert.equal(res.kind, "fanout", "≥2 legs → F2.6's reportFanout owns the merge");
  assert.deepEqual(
    res.ledgers.map((l) => l.tag),
    ["A2", "A3"],
    "the resolved legs are handed off for the fan-out",
  );
  assert.equal(opened.length, 0, "deferral resolves routing only — zero clusters dialed");
  assert.equal(findCalls.length, 0, "…and runs no query here");
});

test("a range predating every ledger window is an honest empty direct result", async () => {
  useFixture();
  const opened = installFakeOpener();
  const { findCalls } = installFakeModel();

  const res = await readOrdersInDayRange("2026-01-01", "2026-01-31");

  assert.equal(res.kind, "direct");
  if (res.kind !== "direct") return;
  assert.deepEqual(res.ledgers, []);
  assert.deepEqual(res.orders, [], "no ledger holds the range → empty list, not an error");
  assert.equal(opened.length, 0);
  assert.equal(findCalls.length, 0);
});

// ── Range normalization: the leg resolution and the _id bounds agree ──────────
test("a swapped range and mixed date formats normalize to the same day-range query", async () => {
  useFixture();
  installFakeOpener();
  const { findCalls } = installFakeModel();

  await readOrdersInDayRange("2026-07-15", "2026-07-10"); // swapped
  await readOrdersInDayRange("20260710", "20260715"); // YYYYMMDD strings
  // Date instants: 10:00 UTC → 15:30 IST, safely inside the same cafe day (an
  // instant past 18:30 UTC would roll to the NEXT IST day — cafe-day, not UTC).
  await readOrdersInDayRange(
    new Date("2026-07-10T10:00:00Z"),
    new Date("2026-07-15T10:00:00Z"),
  );

  const expected = { $gte: "ORD-A3-20260710-000", $lt: "ORD-A3-20260715-999~" };
  assert.equal(findCalls.length, 3);
  for (const call of findCalls) assert.deepEqual(call.query._id, expected);
});

test("a caller filter touching _id or a root $-operator is rejected loudly (the range owns _id)", async () => {
  useFixture();
  const opened = installFakeOpener();
  const { findCalls } = installFakeModel();

  // A top-level _id would be clobbered ambiguously…
  await assert.rejects(
    readOrdersInDayRange("2026-07-15", "2026-07-15", {
      filter: { _id: "ORD-A3-20260101-001" } as unknown as FilterQuery<IOrder>,
    }),
    /filter key '_id' is not composable/,
  );
  // …and a root $or can smuggle a nested _id that ANDs with the range and
  // silently narrows the result to empty (the review-confirmed hardening).
  await assert.rejects(
    readOrdersInDayRange("2026-07-15", "2026-07-15", {
      filter: {
        $or: [{ _id: { $lt: "ORD-A3-20260715-000" } }],
      } as unknown as FilterQuery<IOrder>,
    }),
    /filter key '\$or' is not composable/,
  );

  assert.equal(opened.length, 0, "rejected at the door — no cluster dialed");
  assert.equal(findCalls.length, 0, "…and no query run");
});

// ── Bootstrap era (no registry doc): reads ride the single bootstrap cluster ──
test("with no registry doc, a today list dials the bootstrap cluster under tag A", async () => {
  __setRegistryProviderForTests(async () => null); // F3 hasn't written the doc yet
  const opened = installFakeOpener();
  const { findCalls } = installFakeModel();

  const res = await readOrdersInDayRange("2026-07-15", "2026-07-15");

  assert.equal(res.kind, "direct");
  assert.deepEqual(
    opened.map((o) => o.uri),
    ["mongodb://bootstrap/db"],
    "CORE doubles as the one ledger in the single-cluster bridge era",
  );
  assert.deepEqual(findCalls[0].query._id, {
    $gte: "ORD-A-20260715-000",
    $lt: "ORD-A-20260715-999~",
  });
});
