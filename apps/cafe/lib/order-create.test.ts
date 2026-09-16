import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose, { type ConnectOptions, type Model } from "mongoose";
import {
  createOrder,
  setCustomerRollupEnqueuer,
  __setOrderCreateDepsForTests,
  type NewOrderInput,
} from "./order-create";
import {
  ledgerFromOrderId,
  __setRegistryProviderForTests,
  __resetRouterForTests,
  type StoredClusterRegistry,
} from "./cluster-router";
import { __setConnectionOpenerForTests, disconnectAll } from "./cluster-registry";
import { type IOrder } from "@/models/order.ledger";

// F2 Step F2.3 — the cluster-scoped order-create service, proven DB-FREE. We drive
// the REAL router (active-ledger resolution + the registry's lazy connection dial,
// via a fixture registry doc + a fake connection opener) so the test proves the
// create routes to exactly the ACTIVE ledger's pool; the DB-touching collaborators
// (sequence allocator + Order model) are injected fakes (the live atomic-$inc race
// + socket round-trip run vs a seeded M0 in F2's integration pass).

// Two contiguous ledgers; A3 is the open-ended active one (A2 is a closed archive).
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

// Fake connection opener — records the URIs the registry dials (proving the create
// landed on the ACTIVE ledger's pool, not CORE/bootstrap) and returns an unconnected
// connection (the injected fakes ignore it).
function installFakeOpener(): { uri: string; opts: ConnectOptions }[] {
  const opened: { uri: string; opts: ConnectOptions }[] = [];
  __setConnectionOpenerForTests((uri, opts) => {
    opened.push({ uri, opts });
    return mongoose.createConnection();
  });
  return opened;
}

// Inject the DB-touching collaborators: a fixed clock (deterministic cafe-day), a
// monotonic sequence allocator (no DB), and an Order model that captures created
// docs. `now` = 2026-07-15 10:00 UTC → 15:30 IST → cafe-day 20260715.
const FIXED_DAY = "20260715";
function installFakeDeps(): {
  createdDocs: Array<Record<string, unknown>>;
  seqCallCount: () => number;
} {
  const createdDocs: Array<Record<string, unknown>> = [];
  let seq = 0;
  let seqCalls = 0;
  __setOrderCreateDepsForTests({
    now: () => new Date("2026-07-15T10:00:00Z"),
    nextOrderSequence: async () => {
      seqCalls += 1;
      seq += 1;
      return seq;
    },
    getOrderModel: () =>
      ({
        create: async (doc: Record<string, unknown>) => {
          createdDocs.push(doc);
          return { toObject: () => doc };
        },
      }) as unknown as Model<IOrder>,
  });
  return { createdDocs, seqCallCount: () => seqCalls };
}

function sampleInput(over: Partial<NewOrderInput> = {}): NewOrderInput {
  return {
    customerName: "Walk-in",
    items: [
      {
        productId: new mongoose.Types.ObjectId(),
        name: "Cold Coffee",
        price: 12000, // paise — money is server-authoritative, supplied by the caller (P2)
        qty: 1,
        kotRound: 1,
      },
    ],
    subtotal: 12000,
    total: 12000,
    paidAmount: 12000,
    payment: "Cash",
    status: "Completed",
    receiver: "Rahul",
    kotRounds: 1,
    ...over,
  };
}

let savedCoreUri: string | undefined;
let savedMongoUri: string | undefined;

beforeEach(async () => {
  await disconnectAll();
  __resetRouterForTests();
  __setOrderCreateDepsForTests(null);
  // Explicit no-op for isolation — since F2.5, `null` restores the REAL
  // production enqueuer (customer-rollup.test.ts covers that path).
  setCustomerRollupEnqueuer(() => {});
  savedCoreUri = process.env.CORE_MONGODB_URI;
  savedMongoUri = process.env.MONGODB_URI;
  delete process.env.CORE_MONGODB_URI;
  process.env.MONGODB_URI = "mongodb://bootstrap/db";
});

afterEach(async () => {
  await disconnectAll();
  __resetRouterForTests();
  __setOrderCreateDepsForTests(null);
  setCustomerRollupEnqueuer(null);
  __setConnectionOpenerForTests(null);
  if (savedCoreUri === undefined) delete process.env.CORE_MONGODB_URI;
  else process.env.CORE_MONGODB_URI = savedCoreUri;
  if (savedMongoUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = savedMongoUri;
});

// ── orderId stamping + single-cluster placement ───────────────────────────────
test("createOrder stamps ORD-<activeTag>-YYYYMMDD-NNN and lands on the active ledger pool only", async () => {
  useFixture();
  const opened = installFakeOpener();
  const { createdDocs } = installFakeDeps();

  const order = await createOrder(sampleInput());

  assert.equal(order._id, `ORD-A3-${FIXED_DAY}-001`, "active tag A3 + cafe-day + zero-padded seq");
  assert.equal(createdDocs.length, 1);
  assert.equal(createdDocs[0]._id, `ORD-A3-${FIXED_DAY}-001`, "created with orderId AS the _id (#5)");
  // Atomic on EXACTLY ONE cluster — the active ledger A3, never CORE/bootstrap.
  assert.deepEqual(
    opened.map((o) => o.uri),
    ["mongodb://a3/db"],
    "the create dialed only the active ledger's pool",
  );
});

test("the persisted doc preserves the caller's paise/omit-empty payload verbatim (F2.3 adds only _id)", async () => {
  useFixture();
  installFakeOpener();
  const { createdDocs } = installFakeDeps();

  const input = sampleInput({ customerName: "Asha", total: 45050, subtotal: 45050, paidAmount: 45050 });
  await createOrder(input);

  const doc = createdDocs[0];
  assert.equal(doc.customerName, "Asha");
  assert.equal(doc.total, 45050, "paise passed through untouched — F2.3 does not compute money (held to P2)");
  assert.equal(doc.payment, "Cash");
  assert.equal(doc.v, undefined, "schema-version v is defaulted by the model, not stamped here (#10)");
});

// ── concurrency: each create independently allocates + stamps its own seq ─────
// HONEST SCOPE: the in-memory fake allocator is monotonic BY CONSTRUCTION, so a bare
// "distinct sequential NNN" assertion would be tautological — it would prove the fake,
// not production. What this DB-free test genuinely gates is that createOrder calls the
// allocator EXACTLY ONCE PER CREATE (so it can never reuse/cache a stale seq) and flows
// each returned seq into an orderId under the active tag. The true atomic-$inc race
// under real concurrency is exercised against a seeded M0 in F2's integration pass;
// the $inc op SHAPE is proven in Counter.test.ts.
test("each concurrent create allocates its OWN sequence exactly once and stamps it under the active tag", async () => {
  useFixture();
  installFakeOpener();
  const { seqCallCount } = installFakeDeps();

  const [a, b] = await Promise.all([createOrder(sampleInput()), createOrder(sampleInput())]);

  assert.equal(seqCallCount(), 2, "the sequence allocator is called once per create — no reuse of a stale seq");
  assert.notEqual(a._id, b._id, "two creates never collide on an orderId");
  assert.deepEqual(
    [a._id, b._id].sort(),
    [`ORD-A3-${FIXED_DAY}-001`, `ORD-A3-${FIXED_DAY}-002`],
    "each allocated seq flows into its own orderId under the active ledger tag A3",
  );
});

// ── targeted read-by-id (no scatter-gather) ───────────────────────────────────
test("read-by-id targets exactly the one ledger named by the created orderId tag", async () => {
  useFixture();
  installFakeOpener();
  installFakeDeps();

  const order = await createOrder(sampleInput());
  const target = await ledgerFromOrderId(order._id);

  assert.equal(target?.tag, "A3", "the created order's id resolves back to its writing ledger");
  assert.equal(target?.active, true);
  assert.equal(target?.to, null, "…the open-ended active ledger");
  // A different tag resolves elsewhere — proves the routing is by tag, not a constant.
  assert.equal((await ledgerFromOrderId("ORD-A2-20260501-009"))?.tag, "A2");
});

// ── CRM rollup seam (F2.5) ─────────────────────────────────────────────────────
test("the CRM rollup is enqueued with the persisted order after the create (F2.5 seam)", async () => {
  useFixture();
  installFakeOpener();
  installFakeDeps();

  const seen: IOrder[] = [];
  setCustomerRollupEnqueuer((o) => seen.push(o));

  const order = await createOrder(sampleInput({ customerName: "Asha" }));

  assert.equal(seen.length, 1);
  assert.equal(seen[0]._id, order._id, "enqueued with the persisted order, carrying its minted id");
  assert.equal(seen[0].customerName, "Asha");
});

test("a throwing rollup enqueuer never fails the already-committed create (best-effort, §2.6)", async () => {
  useFixture();
  installFakeOpener();
  installFakeDeps();
  setCustomerRollupEnqueuer(() => {
    throw new Error("CORE unreachable");
  });

  // Must RESOLVE to the created order, not reject — the order is the source of truth.
  const order = await createOrder(sampleInput());
  assert.equal(order._id, `ORD-A3-${FIXED_DAY}-001`);
});

// ── corrupt manifest → refuse to place a write (no mis-route) ─────────────────
test("createOrder propagates the no-active-ledger error rather than guessing a target", async () => {
  __setRegistryProviderForTests(async () => ({
    ...FIXTURE,
    ledgers: FIXTURE.ledgers.map((l) => ({ ...l, active: false })),
  }));
  installFakeOpener();
  installFakeDeps();
  await assert.rejects(createOrder(sampleInput()), /exactly one active ledger, found 0/);
});
