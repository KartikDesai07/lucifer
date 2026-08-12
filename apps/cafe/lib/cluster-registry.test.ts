import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose, { type ConnectOptions } from "mongoose";
import {
  getConn,
  modelFor,
  disconnectAll,
  FEDERATED_MODELS,
  CLUSTER_POOL_OPTIONS,
  __setConnectionOpenerForTests,
  type ClusterRef,
} from "./cluster-registry";
import { getOrderModel } from "@/models/order.ledger";

// F2 Step F2.1 — registry mechanics, proven DB-FREE on this box. We inject a fake
// opener that returns an UNCONNECTED `mongoose.createConnection()` (no URI → never
// dials a server, `asPromise()` resolves immediately, models still compile offline —
// the exact trick order.ledger.test relies on). What this asserts: lazy one-pool-
// per-cluster, caching/reuse, the bounded pool options, and that `Order` binds
// through F2c's `getOrderModel` (#34). The AUTHORITATIVE live socket-count / on-server
// `$type` assertions run against a seeded M0 in F2's integration pass (F2c §1/§10) —
// they cannot run here, and faking them would be a false green.

let opened: { uri: string; opts: ConnectOptions }[] = [];

function installRecordingOpener(): void {
  opened = [];
  __setConnectionOpenerForTests((uri, opts) => {
    opened.push({ uri, opts });
    return mongoose.createConnection(); // no URI: unconnected, but compiles models
  });
}

const CORE: ClusterRef = { id: "C", uri: "mongodb://core/db" };
const LEDGER: ClusterRef = { id: "A2", uri: "mongodb://ledger/db" };

beforeEach(async () => {
  await disconnectAll(); // start each test from an empty global pool Map
  installRecordingOpener();
});

afterEach(async () => {
  await disconnectAll();
  __setConnectionOpenerForTests(null); // restore the real createConnection
});

test("opens one distinct pool per cluster id, and caches it on reuse", async () => {
  const core = await getConn(CORE);
  const ledger = await getConn(LEDGER);
  assert.notEqual(core, ledger, "distinct cluster ids → distinct connection pools");
  assert.equal(opened.length, 2, "one createConnection per touched cluster");

  const coreAgain = await getConn(CORE);
  assert.equal(coreAgain, core, "same id returns the cached pool (no re-open)");
  assert.equal(opened.length, 2, "a cache hit does not open another socket pool");
});

test("an untouched cluster opens ZERO sockets (lazy connect)", async () => {
  await getConn(CORE);
  assert.equal(opened.length, 1, "only the routed cluster opens; others stay closed");
});

test("forwards the bounded pool options to the opener (live cap asserted on seeded M0)", async () => {
  // This proves the registry HANDS the driver the right caps; that the driver then
  // honors them and Σ-sockets-across-instances < 500 is unobservable DB-free and is
  // asserted against a seeded M0 in F2's integration pass (see the file header).
  await getConn(CORE);
  const { opts } = opened[0];
  assert.equal(opts, CLUSTER_POOL_OPTIONS, "forwards THE exported options object, not a substitute");
  assert.equal(opts.maxPoolSize, 5, "maxPoolSize 5 (v1 used 10 for ONE cluster)");
  assert.equal(opts.minPoolSize, 0, "minPoolSize 0 — idle clusters hold no sockets");
  assert.equal(opts.maxIdleTimeMS, 60_000, "idle pools shrink within 60s");
  assert.equal(opts.bufferCommands, false, "fail fast, never queue on a down cluster");
  assert.equal(opts.serverSelectionTimeoutMS, 5_000);
});

test("getConn attaches exactly one crash-guard 'error' listener", async () => {
  // An EventEmitter with no 'error' listener throws and crashes the process on an
  // initial-connect error — getConn must add the guard. Compare against the freshly
  // created connection's own baseline so this holds regardless of mongoose internals.
  let baseErrorListeners = 0;
  __setConnectionOpenerForTests(() => {
    const c = mongoose.createConnection();
    baseErrorListeners = c.listenerCount("error");
    return c;
  });
  const conn = await getConn(CORE);
  assert.equal(
    conn.listenerCount("error"),
    baseErrorListeners + 1,
    "getConn adds exactly one error listener so an 'error' event cannot crash the process",
  );
});

test("concurrent getConn(sameId) coalesce onto a single pool", async () => {
  // Two simultaneous first-touches must NOT each open a pool (socket leak vs the
  // 500-conn cap). The await-free get→create→set region in getConn guarantees this.
  const [a, b] = await Promise.all([getConn(CORE), getConn(CORE)]);
  assert.equal(a, b, "both callers share the one connection");
  assert.equal(opened.length, 1, "exactly one pool opened for simultaneous first-touches");
});

test("a failed INITIAL connect is evicted so the next getConn re-dials a fresh pool", async () => {
  // The eviction path (the v1 db.ts 'null the cached promise on failure' analogue)
  // runs during a real M0 incident — exercise it DB-free by failing asPromise() once.
  let attempts = 0;
  __setConnectionOpenerForTests(() => {
    attempts += 1;
    const c = mongoose.createConnection();
    if (attempts === 1) c.asPromise = () => Promise.reject(new Error("connect refused"));
    return c;
  });
  await assert.rejects(getConn(CORE), /connect refused/);
  const conn = await getConn(CORE); // dead handle must have been evicted
  assert.equal(attempts, 2, "the failed pool was evicted; the retry re-dialed a new one");
  assert.ok(conn, "the retry returns a live connection");
});

test("no CORE schema declares an invalid partialFilterExpression ($ne / $exists:false)", async () => {
  // The DB-free registry test can't build indexes (Model.init blocks on a live
  // connection), so an invalid partial filter on a CORE schema would only fail at
  // index creation on the no-backup M0. Mirror order.ledger.test's static guard here.
  for (const name of FEDERATED_MODELS) {
    if (name === "Order") continue; // Order's guard lives in order.ledger.test
    const model = await modelFor(CORE, name);
    const json = JSON.stringify(model.schema.indexes());
    assert.ok(!json.includes("$ne"), `${name}: partialFilterExpression must not use $ne`);
    assert.ok(
      !json.includes('"$exists":false'),
      `${name}: partialFilterExpression must not use $exists:false`,
    );
  }
});

test("modelFor binds and REUSES a model on the cluster's pool (no recompile)", async () => {
  const order1 = await modelFor(LEDGER, "Order");
  const order2 = await modelFor(LEDGER, "Order");
  assert.equal(order1, order2, "second modelFor returns the cached compiled model");
  assert.equal(order1.modelName, "Order");

  const customer = await modelFor(CORE, "Customer");
  assert.equal(customer.modelName, "Customer");
  assert.equal(opened.length, 2, "two clusters touched → two pools, nothing extra");
});

test("Order binds through F2c's getOrderModel accessor — no second Order schema (#34)", async () => {
  const viaRegistry = await modelFor(LEDGER, "Order");
  const viaAccessor = getOrderModel(await getConn(LEDGER));
  assert.equal(
    viaRegistry,
    viaAccessor,
    "the registry must reuse F2c's canonical Order binding, never re-register it",
  );
});

test("every federated model name has a registered binding (no gaps in SCHEMAS)", async () => {
  for (const name of FEDERATED_MODELS) {
    const model = await modelFor(CORE, name);
    assert.equal(model.modelName, name, `${name} must bind on the pool`);
  }
});

test("disconnectAll evicts every pool so the next getConn re-opens", async () => {
  await getConn(CORE);
  assert.equal(opened.length, 1);
  await disconnectAll();
  await getConn(CORE);
  assert.equal(opened.length, 2, "after disconnectAll the cluster re-dials a fresh pool");
});
