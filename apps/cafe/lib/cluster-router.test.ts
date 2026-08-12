import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import mongoose, { type ConnectOptions } from "mongoose";
import {
  core,
  ledgerForWrite,
  ledgersForDate,
  ledgerFromOrderId,
  coreModel,
  ledgerModel,
  setUriDecryptor,
  CORE_MODELS,
  LEDGER_MODELS,
  CORE_CLUSTER_ID,
  REGISTRY_TTL_MS,
  __setRegistryProviderForTests,
  __setClockForTests,
  __resetRouterForTests,
  type StoredClusterRegistry,
  type LedgerRef,
} from "./cluster-router";
import {
  getConn,
  __setConnectionOpenerForTests,
  disconnectAll,
  FEDERATED_MODELS,
} from "./cluster-registry";
import { getConnection } from "@/lib/db";
import { getOrderModel } from "@/models/order.ledger";

// F2 Step F2.2 — placement-router logic, proven DB-FREE. The live CORE registry-doc
// read + on-server `$type` assertions run against a seeded M0 in F2's integration
// pass (the same split order.ledger.test / cluster-registry.test use). Here we inject
// a fixture registry doc via `__setRegistryProviderForTests` (bypassing the CORE read)
// and a fake unconnected connection opener (so `coreModel`/`ledgerModel` compile models
// offline) — exercising the FULL resolve/overlap/tag-target/decrypt/TTL logic, just
// not the socket round-trip.

// Three contiguous quarter ledgers; A3 is the open-ended active one. URIs carry an
// "enc:" marker so the decryptor seam is observable.
const FIXTURE: StoredClusterRegistry = {
  _id: "cluster-registry",
  core: { id: "core", uri: "enc:mongodb://core/db", tag: "C" },
  ledgers: [
    { id: "l-a", uri: "enc:mongodb://a/db", tag: "A", from: "2026-01-01", to: "2026-04-01", active: false },
    { id: "l-a2", uri: "enc:mongodb://a2/db", tag: "A2", from: "2026-04-01", to: "2026-07-01", active: false },
    { id: "l-a3", uri: "enc:mongodb://a3/db", tag: "A3", from: "2026-07-01", to: null, active: true },
  ],
  standby: [{ id: "l-a4", uri: "enc:mongodb://a4/db", tag: "A4", empty: true }],
};

function useFixture(): void {
  __setRegistryProviderForTests(async () => structuredClone(FIXTURE));
}

let savedCoreUri: string | undefined;
let savedMongoUri: string | undefined;

beforeEach(async () => {
  await disconnectAll();
  __resetRouterForTests();
  savedCoreUri = process.env.CORE_MONGODB_URI;
  savedMongoUri = process.env.MONGODB_URI;
  delete process.env.CORE_MONGODB_URI;
  process.env.MONGODB_URI = "mongodb://bootstrap/db";
});

afterEach(async () => {
  await disconnectAll();
  __resetRouterForTests();
  __setConnectionOpenerForTests(null);
  if (savedCoreUri === undefined) delete process.env.CORE_MONGODB_URI;
  else process.env.CORE_MONGODB_URI = savedCoreUri;
  if (savedMongoUri === undefined) delete process.env.MONGODB_URI;
  else process.env.MONGODB_URI = savedMongoUri;
});

// ── core() — env-bootstrapped, never the doc ──────────────────────────────────
test("core() resolves from env (CORE_MONGODB_URI ?? MONGODB_URI), tag C", () => {
  assert.deepEqual(core(), {
    id: CORE_CLUSTER_ID,
    uri: "mongodb://bootstrap/db",
    tag: "C",
  });
  process.env.CORE_MONGODB_URI = "mongodb://explicit-core/db";
  assert.equal(core().uri, "mongodb://explicit-core/db", "CORE_MONGODB_URI wins over MONGODB_URI");
});

test("core() throws a clear error when no bootstrap URI is set", () => {
  delete process.env.MONGODB_URI;
  assert.throws(() => core(), /CORE_MONGODB_URI \/ MONGODB_URI is not set/);
});

// ── ledgerForWrite() — the single active ledger ───────────────────────────────
test("ledgerForWrite returns the single active ledger (A3)", async () => {
  useFixture();
  const L = await ledgerForWrite();
  assert.equal(L.tag, "A3");
  assert.equal(L.active, true);
  assert.equal(L.to, null, "the active ledger is open-ended");
});

test("ledgerForWrite throws on a manifest with no active ledger", async () => {
  __setRegistryProviderForTests(async () => ({
    ...FIXTURE,
    ledgers: FIXTURE.ledgers.map((l) => ({ ...l, active: false })),
  }));
  await assert.rejects(ledgerForWrite(), /exactly one active ledger, found 0/);
});

test("ledgerForWrite throws on a manifest with multiple active ledgers", async () => {
  __setRegistryProviderForTests(async () => ({
    ...FIXTURE,
    ledgers: FIXTURE.ledgers.map((l) => ({ ...l, active: true })),
  }));
  await assert.rejects(ledgerForWrite(), /exactly one active ledger, found 3/);
});

// ── ledgersForDate() — half-open window overlap ───────────────────────────────
const tags = (ls: LedgerRef[]) => ls.map((l) => l.tag);

test("ledgersForDate returns only the overlapping windows", async () => {
  useFixture();
  assert.deepEqual(tags(await ledgersForDate("2026-02-01", "2026-02-15")), ["A"], "wholly inside Q1");
  assert.deepEqual(tags(await ledgersForDate("2026-05-01", "2026-05-10")), ["A2"], "wholly inside Q2");
  assert.deepEqual(tags(await ledgersForDate("2026-08-01", "2026-08-10")), ["A3"], "wholly inside the open active window");
  assert.deepEqual(tags(await ledgersForDate("2026-03-15", "2026-04-15")), ["A", "A2"], "spans the Q1/Q2 boundary");
  assert.deepEqual(tags(await ledgersForDate("2026-01-01", "2026-12-31")), ["A", "A2", "A3"], "spans all three");
});

test("ledgersForDate respects the half-open [from,to) boundary (exclusive `to`)", async () => {
  useFixture();
  // 2026-04-01 belongs to A2 (its inclusive `from`), NOT A (its exclusive `to`).
  assert.deepEqual(tags(await ledgersForDate("2026-04-01", "2026-04-01")), ["A2"]);
});

test("ledgersForDate accepts YYYYMMDD strings and Date objects too", async () => {
  useFixture();
  assert.deepEqual(tags(await ledgersForDate("20260201", "20260215")), ["A"], "dash-less day keys");
  assert.deepEqual(
    tags(await ledgersForDate(new Date("2026-05-05T12:00:00Z"), new Date("2026-05-06T12:00:00Z"))),
    ["A2"],
    "Date inputs normalize to the cafe day",
  );
});

test("ledgersForDate tolerates a swapped range", async () => {
  useFixture();
  assert.deepEqual(tags(await ledgersForDate("2026-02-15", "2026-02-01")), ["A"]);
});

// ── ledgerFromOrderId() — tag targeting via F2c ───────────────────────────────
test("ledgerFromOrderId targets the one ledger named by the orderId tag", async () => {
  useFixture();
  assert.equal((await ledgerFromOrderId("ORD-A2-20260501-001"))?.tag, "A2");
  assert.equal((await ledgerFromOrderId("ORD-A3-20260801-007"))?.tag, "A3");
  assert.equal((await ledgerFromOrderId("ORD-A-20260115-042"))?.tag, "A");
});

test("ledgerFromOrderId returns null for an unknown tag or a malformed id", async () => {
  useFixture();
  assert.equal(await ledgerFromOrderId("ORD-ZZ-20260101-001"), null, "tag absent from the registry");
  assert.equal(await ledgerFromOrderId("not-an-order-id"), null, "malformed");
  assert.equal(await ledgerFromOrderId("ORD-20260101-001"), null, "v1-format (no ledger tag) is not tag-routable");
});

// ── decrypt seam + TTL cache ──────────────────────────────────────────────────
test("registry URIs pass through the injected decryptor (F3 vault seam)", async () => {
  useFixture();
  setUriDecryptor((u) => u.replace(/^enc:/, ""));
  const L = await ledgerFromOrderId("ORD-A2-20260501-001");
  assert.equal(L?.uri, "mongodb://a2/db", "the 'enc:' marker was stripped by the decryptor");
});

test("the registry doc is read at most once per TTL window", async () => {
  let reads = 0;
  __setRegistryProviderForTests(async () => {
    reads += 1;
    return structuredClone(FIXTURE);
  });
  await ledgerForWrite();
  await ledgersForDate("2026-02-01", "2026-02-15");
  await ledgerFromOrderId("ORD-A3-20260801-001");
  assert.equal(reads, 1, "three router calls within the TTL share one cached topology read");
});

test("after the TTL elapses the doc is re-read and a hot-added ledger is picked up (#18 no-redeploy)", async () => {
  let reads = 0;
  __setRegistryProviderForTests(async () => {
    reads += 1;
    if (reads === 1) return structuredClone(FIXTURE); // A3 active
    // F3 / roll-forward later writes a NEW topology: A3 closed, A4 now active.
    return {
      _id: "cluster-registry",
      core: FIXTURE.core,
      ledgers: [
        { id: "l-a3", uri: "enc:mongodb://a3/db", tag: "A3", from: "2026-07-01", to: "2026-10-01", active: false },
        { id: "l-a4", uri: "enc:mongodb://a4/db", tag: "A4", from: "2026-10-01", to: null, active: true },
      ],
    };
  });
  __setClockForTests(() => 5_000_000);
  assert.equal((await ledgerForWrite()).tag, "A3", "before the TTL: the originally-active ledger");
  __setClockForTests(() => 5_000_000 + REGISTRY_TTL_MS + 1); // expire the window
  assert.equal((await ledgerForWrite()).tag, "A4", "after the TTL: the re-read picks up the hot-added active ledger");
  assert.equal(reads, 2, "exactly one re-read across the TTL boundary — no redeploy needed");
});

// ── bootstrap fallback (no doc yet — single-cluster era) ──────────────────────
test("an absent registry doc falls back to the single-cluster bootstrap", async () => {
  __setRegistryProviderForTests(async () => null);
  const L = await ledgerForWrite();
  assert.equal(L.tag, "A", "bootstrap ledger tag");
  assert.equal(L.active, true);
  assert.equal(L.id, CORE_CLUSTER_ID, "bootstrap ledger reuses the CORE pool id so getConn coalesces");
  assert.equal(L.uri, "mongodb://bootstrap/db", "bootstrap ledger reuses the CORE bootstrap URI");
  // null windows ⇒ overlaps every range.
  assert.deepEqual(tags(await ledgersForDate("2026-01-01", "2026-12-31")), ["A"]);
});

test("a present-but-empty registry doc fails loudly (does NOT collapse to bootstrap)", async () => {
  __setRegistryProviderForTests(async () => ({ ...FIXTURE, ledgers: [] }));
  await assert.rejects(ledgerForWrite(), /no ledgers/);
});

test("the bootstrap env URI BYPASSES the decryptor (it must stay plaintext to reach CORE)", async () => {
  // A regression that ran an F3 AES-GCM decryptor over the plaintext env URI would
  // corrupt the only anchor that can reach CORE. Trip-wire decryptor proves the
  // bootstrap path never calls it (the doc path does — see the decryptor test above).
  __setRegistryProviderForTests(async () => null); // no doc → bootstrap
  setUriDecryptor(() => "DECRYPTED-GARBAGE");
  assert.equal((await ledgerForWrite()).uri, "mongodb://bootstrap/db", "bootstrap reuses the raw env URI");
  assert.equal(core().uri, "mongodb://bootstrap/db", "core() never decrypts either");
});

// ── read-error safety (#19 — fail-fast over guessing, never misroute a write) ──
test("a read error with NO cached topology THROWS — never guesses a write target (#19)", async () => {
  // The exact mutation the resolveRegistry comment warns against: were a read error
  // swallowed to bootstrap, an order would land on CORE under an unknown topology.
  __setRegistryProviderForTests(async () => {
    throw new Error("CORE unreachable");
  });
  await assert.rejects(ledgerForWrite(), /cannot read CORE registry and have no cached topology/);
  await assert.rejects(ledgersForDate("2026-01-01", "2026-12-31"), /cannot read CORE registry/);
});

test("a transient read error AFTER a warm cache serves the STALE topology, not a throw", async () => {
  let reads = 0;
  __setRegistryProviderForTests(async () => {
    reads += 1;
    if (reads === 1) return structuredClone(FIXTURE);
    throw new Error("CORE blip");
  });
  __setClockForTests(() => 9_000_000);
  assert.equal((await ledgerForWrite()).tag, "A3", "first read warms the cache");
  __setClockForTests(() => 9_000_000 + REGISTRY_TTL_MS + 1); // force a re-read
  assert.equal((await ledgerForWrite()).tag, "A3", "the re-read failed, so the last-good topology is served");
  assert.equal(reads, 2, "the second call did attempt a re-read (and fell back to stale)");
});

// ── typed model accessors (DB-free via the registry's fake opener) ────────────
function installFakeOpener(): { uri: string; opts: ConnectOptions }[] {
  const opened: { uri: string; opts: ConnectOptions }[] = [];
  __setConnectionOpenerForTests((uri, opts) => {
    opened.push({ uri, opts });
    return mongoose.createConnection(); // unconnected: compiles models offline
  });
  return opened;
}

test("coreModel binds a CORE model on the CORE pool (asserts the dialed URI, not just modelName)", async () => {
  useFixture();
  const opened = installFakeOpener();
  const customer = await coreModel("Customer");
  assert.equal(customer.modelName, "Customer");
  // modelName is URI-invariant, so assert the POOL: coreModel must dial CORE, never a ledger.
  assert.equal(opened.length, 1);
  assert.equal(opened[0].uri, "mongodb://bootstrap/db", "coreModel routed to the CORE bootstrap pool");
});

test("ledgerModel('Order') reuses F2c's getOrderModel binding (#34)", async () => {
  useFixture();
  installFakeOpener();
  const L = await ledgerForWrite();
  const viaRouter = await ledgerModel(L, "Order");
  const viaAccessor = getOrderModel(await getConn(L));
  assert.equal(viaRouter, viaAccessor, "Order must bind through the one canonical accessor, never a second schema");
  assert.equal(viaRouter.modelName, "Order");
});

test("ledgerModel binds the Counter on the ledger's OWN pool (asserts the dialed URI)", async () => {
  useFixture();
  const opened = installFakeOpener();
  const L = await ledgerForWrite(); // A3 (provider-resolved; opens no pool)
  const counter = await ledgerModel(L, "Counter");
  assert.equal(counter.modelName, "Counter");
  // The Counter co-locates with orders on the LEDGER — assert it dialed A3, not CORE.
  assert.equal(opened.length, 1);
  assert.equal(opened[0].uri, L.uri, "ledgerModel routed to the resolved ledger pool");
  assert.notEqual(opened[0].uri, "mongodb://bootstrap/db", "and NOT to the CORE pool");
});

// ── db.ts getConnection seam delegation (incremental cutover) ─────────────────
test("db.ts getConnection delegates 'core'→CORE pool and 'ledger'→the active ledger pool", async () => {
  useFixture();
  const opened = installFakeOpener();
  const coreConn = await getConnection("core");
  const ledgerConn = await getConnection("ledger");
  // The dispatch ternary is otherwise unguarded — assert each role dialed the right pool.
  assert.equal(opened.some((o) => o.uri === "mongodb://bootstrap/db"), true, "'core' routed to the CORE pool");
  assert.equal(opened.some((o) => o.uri === "enc:mongodb://a3/db"), true, "'ledger' routed to the active ledger A3");
  assert.notEqual(coreConn, ledgerConn, "distinct role → distinct resolved pool (multi-cluster)");
  assert.equal(coreConn, await getConn(core()), "'core' resolves to the same pool as the router's core()");
  assert.equal(ledgerConn, await getConn(await ledgerForWrite()), "'ledger' resolves to the active-ledger pool");
});

// ── placement split integrity ─────────────────────────────────────────────────
test("CORE_MODELS ∪ LEDGER_MODELS equals the registry's federated model set", () => {
  const placed = [...CORE_MODELS, ...LEDGER_MODELS].sort();
  const federated = [...FEDERATED_MODELS].sort();
  assert.deepEqual(placed, federated, "every federated model is placed exactly once");
  assert.deepEqual(
    [...LEDGER_MODELS].sort(),
    ["Counter", "Order"],
    "only Order + its co-located Counter live on the LEDGER (§3.2)",
  );
});
