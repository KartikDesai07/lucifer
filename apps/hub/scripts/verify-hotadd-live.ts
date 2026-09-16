// Dev verify script — prints pass/fail lines only, never a URI/secret value.
// (The provisioner/hot-add no-console gate covers lib/, not scripts/.)
import assert from "node:assert/strict";

import mongoose, { Types } from "mongoose";

import { cafeDateString } from "@pos/shared/utils";

import { connectDB } from "../lib/db";
import { AuditLog } from "../models/AuditLog";
import { Secret } from "../models/Secret";
import { Task, taskOpenKey } from "../models/Task";
import { Tenant, type IDbCluster } from "../models/Tenant";
import { createVaultPort } from "../lib/provisioner-registry";
import { ATLAS_SA, CLUSTER_REGISTRY_COLLECTION, CLUSTER_REGISTRY_ID, dbUriId } from "../lib/provisioner-plan";
import { dismissHotAddTask, runHotAddDbCluster, type RunHotAddDeps, type RunHotAddInput } from "../lib/hotadd";
import { createHotAddTaskPort, createHubTenantPort, createRuntimeDocPort } from "../lib/hotadd-ports";
import { HOTADD_REPUMP_HINT_S, ledgerUriId, type StoredRuntimeRegistryDoc } from "../lib/hotadd-plan";
import { realIngestPorts } from "../lib/heartbeat-ingest";
import type { TriggerDecision } from "../lib/heartbeat-triggers";
import type { RetryDeps } from "../lib/provider-retry";

// ─────────────────────────────────────────────────────────────────────────────
// LIVE F3.8 hot-add-db-cluster legs on a SCRATCH db (the F3.2–F3.7 precedent):
// proves the DB-TRUTH the DB-free machine tests (lib/hotadd.test.ts) can't —
// real Mongoose CAS filters (claim/lease/fenced writes/exactly-once close/
// partial-unique openKey), the real audited vault (Secret rows + AuditLog),
// and real runtime clusterRegistry doc writes (bootstrap-insert, atomic flip,
// promote). Atlas stays FAKED (a fake `fetch` driving the REAL createAtlasClient
// — the provisioner-live discipline: a fake that skips the real client logic
// proves nothing). Prefix-guarded to `hubreg_verify`; the runtime doc lives in
// the sibling scratch db `hubreg_verify_runtime` on the same server, REUSED
// sequentially across the tenant scenarios below (reset between them) since
// legs run one at a time, never concurrently, and the runtime doc is a single
// fixed-_id singleton per physical cluster. Both scratch dbs are dropped after.
// Run: `npm run verify:hotadd-live` with HUB_MONGODB_URI (→ hubreg_verify) +
// HUB_KEK set.
// ─────────────────────────────────────────────────────────────────────────────

const SCRATCH_DB = "hubreg_verify";
const RUNTIME_DB = "hubreg_verify_runtime";
const M0_CAPACITY_BYTES = 536_870_912;
const AUDIT_IP = "10.0.0.1";

function dummyCluster(clusterName: string, role: IDbCluster["role"], srvUriRef?: Types.ObjectId): IDbCluster {
  return {
    provider: "atlas",
    accountLabel: role === "primary" ? "atlas-1" : `atlas-1/${clusterName}`,
    clusterName,
    role,
    capacityBytes: M0_CAPACITY_BYTES,
    state: "idle",
    ...(srvUriRef ? { srvUriRef } : {}),
  };
}

function runInput(taskId: string, actorId: Types.ObjectId, claimAllowed: boolean): RunHotAddInput {
  return { taskId, actor: { actorId: actorId.toHexString(), ip: AUDIT_IP }, claimAllowed };
}

// ── Fake Atlas provider `fetch` (drives the REAL F3.5 atlas client) ─────────
function makeAtlasSim(opts: { creatingCalls?: number } = {}) {
  const creatingCalls = opts.creatingCalls ?? 0;
  const state = { projects: new Set<string>(), clusters: new Set<string>() };
  let clusterGetCount = 0;
  const calls: { op: string }[] = [];
  const R = (status: number, body: unknown) => new Response(status === 204 ? null : JSON.stringify(body), { status });

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;

    if (u.endsWith("/api/oauth/token")) return R(200, { access_token: "tok", expires_in: 3600 });
    if (u.includes("/api/atlas/v2/groups/byName/")) {
      const name = decodeURIComponent(u.split("/byName/")[1]);
      return R(200, { id: `proj-${name}` });
    }
    if (method === "POST" && u.endsWith("/api/atlas/v2/groups")) {
      calls.push({ op: "atlas.createProject" });
      const name = JSON.parse(body!).name as string;
      if (state.projects.has(name)) return R(409, { errorCode: "GROUP_ALREADY_EXISTS" });
      state.projects.add(name);
      return R(201, { id: `proj-${name}` });
    }
    const clusterPost = /\/api\/atlas\/v2\/groups\/([^/]+)\/clusters$/.exec(u);
    if (method === "POST" && clusterPost) {
      calls.push({ op: "atlas.createM0" });
      const name = JSON.parse(body!).name as string;
      const k = `${clusterPost[1]}/${name}`;
      if (state.clusters.has(k)) return R(409, { errorCode: "DUPLICATE_CLUSTER_NAME" });
      state.clusters.add(k);
      return R(201, {});
    }
    const clusterGet = /\/api\/atlas\/v2\/groups\/([^/]+)\/clusters\/([^/]+)$/.exec(u);
    if (method === "GET" && clusterGet) {
      calls.push({ op: "atlas.getCluster" });
      clusterGetCount += 1;
      const name = clusterGet[2];
      const stateName = clusterGetCount <= creatingCalls ? "CREATING" : "IDLE";
      return R(200, { stateName, connectionStrings: { standardSrv: `mongodb+srv://host-${name}.mongodb.net` } });
    }
    const userPost = /\/api\/atlas\/v2\/groups\/([^/]+)\/databaseUsers$/.exec(u);
    if (method === "POST" && userPost) {
      calls.push({ op: "atlas.createDbUser" });
      return R(201, {});
    }
    if (method === "POST" && u.endsWith("/accessList")) {
      calls.push({ op: "atlas.accessList" });
      return R(201, {});
    }
    throw new Error(`unexpected ${method} ${u}`);
  }) as typeof fetch;

  return { fetchImpl, calls, countOp: (op: string) => calls.filter((c) => c.op === op).length };
}

function makeDeps(parts: {
  taskPort: ReturnType<typeof createHotAddTaskPort>;
  docPort: ReturnType<typeof createRuntimeDocPort>;
  tenants: ReturnType<typeof createHubTenantPort>;
  vault: ReturnType<typeof createVaultPort>;
  sim: ReturnType<typeof makeAtlasSim>;
}): Partial<RunHotAddDeps> {
  return {
    taskPort: parts.taskPort,
    docPort: parts.docPort,
    tenants: parts.tenants,
    vault: parts.vault,
    retryOverrides: { fetchImpl: parts.sim.fetchImpl, sleep: async () => {} } as Partial<RetryDeps>,
  };
}

async function main() {
  const uri = process.env.HUB_MONGODB_URI ?? "";
  const dbInUri = uri.split("?")[0].split("/").pop();
  assert.equal(dbInUri, SCRATCH_DB, `refusing: URI db must be '${SCRATCH_DB}'`);
  assert.ok(process.env.HUB_KEK, "HUB_KEK must be set (a throwaway 32-byte base64/hex key)");

  await connectDB();
  assert.equal(mongoose.connection.name, SCRATCH_DB, "connected to the scratch db");
  console.log(`✓ connected to scratch db '${SCRATCH_DB}'`);

  const RUNTIME_URI = uri.replace(`/${SCRATCH_DB}`, `/${RUNTIME_DB}`);
  // A persistent connection for read-back assertions + raw seed inserts + the
  // final drop; the docPort instances below open their OWN short-lived
  // connections per call (matching the real production port).
  const assertConn = await mongoose.createConnection(RUNTIME_URI).asPromise();
  const runtimeColl = () => assertConn.collection<StoredRuntimeRegistryDoc>(CLUSTER_REGISTRY_COLLECTION);
  const defaultOpenConn = () => mongoose.createConnection(RUNTIME_URI).asPromise();

  const vault = createVaultPort();
  const ingest = realIngestPorts();
  const ownerActorId = new Types.ObjectId();

  try {
    await Promise.all([Tenant.deleteMany({}), Task.deleteMany({}), Secret.deleteMany({}), AuditLog.deleteMany({})]);
    await runtimeColl().deleteMany({});
    // Force index builds so the partial-unique openKey dedupe runs against the
    // real server (the F3.7 verify-heartbeat-live precedent).
    await Promise.all([Task.init(), Tenant.init(), Secret.init(), AuditLog.init()]);

    // ═══ Leg 1: seed + enqueue (tenant1) ═══════════════════════════════════
    const dummySrvRef1 = new Types.ObjectId();
    const t1 = await Tenant.create({
      slug: "verify-hotadd-1",
      status: "active",
      ownerEmail: "o1@verify.local",
      businessType: "cafe",
      dbPool: [dummyCluster("pos-core", "primary"), dummyCluster("pos-orders-a", "orders-current", dummySrvRef1)],
    });
    const OLD_ORDERS_SRV1 = "mongodb+srv://pos_app:oldpw1@host-pos-orders-a.mongodb.net/pos?retryWrites=true&w=majority";
    await vault.store(t1._id, dbUriId("primary"), RUNTIME_URI);
    await vault.store(t1._id, dbUriId("orders"), OLD_ORDERS_SRV1);
    await vault.store(t1._id, ATLAS_SA, JSON.stringify({ clientId: "ci1", clientSecret: "cs1", orgId: "org1" }));

    await runtimeColl().insertOne({
      _id: CLUSTER_REGISTRY_ID,
      ledgers: [{ id: "pos-orders-a", uri: OLD_ORDERS_SRV1, tag: "A", from: null, to: null, active: true, fillPct: 0.76 }],
      standby: [],
    });

    const decision1: TriggerDecision = {
      type: "ADD_DB_CLUSTER",
      reason: "ledger pos-orders-a at 76% — no room",
      payload: { fillingLedger: "pos-orders-a", usedPct: 0.76 },
    };
    const enq1 = await ingest.openTask(t1._id, t1.slug, decision1);
    assert.equal(enq1, "enqueued");
    const task1 = await Task.findOne({ tenantId: t1._id, type: "ADD_DB_CLUSTER" });
    assert.ok(task1);
    assert.equal(task1!.openKey, taskOpenKey(t1._id, "ADD_DB_CLUSTER"));
    const dupe1 = await ingest.openTask(t1._id, t1.slug, decision1);
    assert.equal(dupe1, "already-open", "partial-unique openKey dedupes a concurrent re-trip");
    console.log("✓ leg 1: seed active tenant + vault SRVs + runtime doc + ADD_DB_CLUSTER task enqueued (openKey partial-unique)");

    // ═══ Leg 2: pump 1 — CREATING ═══════════════════════════════════════════
    const sim1 = makeAtlasSim({ creatingCalls: 1 });
    const docPort1 = createRuntimeDocPort({ openConn: defaultOpenConn });
    const runDeps1 = makeDeps({ taskPort: createHotAddTaskPort(), docPort: docPort1, tenants: createHubTenantPort(), vault, sim: sim1 });

    const pump1 = await runHotAddDbCluster(runInput(String(task1!._id), ownerActorId, true), runDeps1);
    assert.equal(pump1.status, "creating");
    assert.equal(pump1.repumpAfterS, HOTADD_REPUMP_HINT_S);

    const taskAfterPump1 = await Task.findById(task1!._id).lean();
    assert.equal(taskAfterPump1?.status, "in-progress");
    assert.ok(taskAfterPump1?.run?.target, "run.target stamped (D2)");
    assert.equal(taskAfterPump1?.run?.target?.mode, "mint");
    assert.ok(taskAfterPump1?.run?.target?.projectId, "A3: projectId stamped immediately after createProject");
    assert.ok(taskAfterPump1?.run?.approvedBy, "approvedBy stamped on claim (A1)");
    assert.ok(taskAfterPump1?.openKey, "openKey still present — only close() unsets it");

    const auditCount1a = await AuditLog.countDocuments({ action: "tenant.hotAddDbCluster", targetTenantId: t1._id });
    assert.equal(auditCount1a, 1, "exactly ONE real audit row at claim time (A1/A10)");
    console.log("✓ leg 2: pump 1 (CREATING) — claim CAS stamps target+projectId+approvedBy, ONE audit row, openKey retained");

    // ═══ Leg 3: pump 2 — IDLE ═══════════════════════════════════════════════
    const pump2 = await runHotAddDbCluster(runInput(String(task1!._id), ownerActorId, false), runDeps1);
    assert.equal(pump2.status, "done");

    const doc1After = await runtimeColl().findOne({});
    const actives1 = doc1After!.ledgers.filter((l) => l.active === true);
    assert.equal(actives1.length, 1, "exactly one active:true ledger — the router invariant");
    assert.equal(actives1[0].id, "pos-orders-a2");
    assert.equal(actives1[0].tag, "A2");
    const today = cafeDateString(new Date());
    const tomorrow = cafeDateString(new Date(Date.now() + 86_400_000));
    assert.equal(actives1[0].from, today);
    assert.equal(actives1[0].to, null);
    const retired1 = doc1After!.ledgers.find((l) => l.id === "pos-orders-a")!;
    assert.equal(retired1.active, false);
    assert.equal(retired1.to, tomorrow);

    const mintedSrv = await vault.reveal(t1._id, ledgerUriId("pos-orders-a2"), { actorId: ownerActorId, ip: AUDIT_IP });
    assert.equal(actives1[0].uri, mintedSrv, "sealDocUri is identity — doc row uri === the vault-stored minted SRV");
    assert.ok(mintedSrv.startsWith("mongodb+srv://pos_app:"), "reveal decrypts to the minted-password SRV");

    const t1After = await Tenant.findById(t1._id).lean();
    const oldEntry1 = t1After!.dbPool.find((c) => c.clusterName === "pos-orders-a")!;
    assert.equal(oldEntry1.role, "orders-archive");
    assert.deepEqual(oldEntry1.srvUriRef, dummySrvRef1, "A6: role-only demote — ORIGINAL srvUriRef preserved, never stripped");
    const newEntry1 = t1After!.dbPool.find((c) => c.clusterName === "pos-orders-a2")!;
    assert.equal(newEntry1.role, "orders-current");
    assert.equal(newEntry1.accountLabel, "atlas-1");
    assert.equal(newEntry1.state, "idle");
    assert.ok(newEntry1.srvUriRef, "srvUriRef stamped");
    assert.ok(newEntry1.orgId);
    assert.ok(newEntry1.projectId);

    const windows1 = t1After!.routing?.orderWindows ?? [];
    const oldWindow1 = windows1.find((w) => w.clusterName === "pos-orders-a")!;
    const newWindow1 = windows1.find((w) => w.clusterName === "pos-orders-a2")!;
    assert.equal(oldWindow1.fromDate.getTime(), new Date(0).getTime());
    assert.equal(oldWindow1.toDate?.getTime(), new Date(tomorrow).getTime());
    assert.equal(newWindow1.fromDate.getTime(), new Date(today).getTime());
    assert.equal(newWindow1.toDate, null);

    const task1After = await Task.findById(task1!._id).lean();
    assert.equal(task1After?.status, "done");
    assert.equal(task1After?.openKey, undefined, "task closed exactly once — openKey gone");

    const reopened1 = await ingest.openTask(t1._id, t1.slug, decision1);
    assert.equal(reopened1, "enqueued", "partial index freed the key after close — a genuinely-new fill can re-enqueue");
    await Task.deleteMany({ tenantId: t1._id, status: "open" }); // clean up the probe task
    console.log("✓ leg 3: pump 2 (IDLE) — atomic flip, dbPool demote+add (A6 role-only), routing rebuilt, closed exactly once, openKey freed");

    // ═══ Leg 4: exactly-once ════════════════════════════════════════════════
    const pump3 = await runHotAddDbCluster(runInput(String(task1!._id), ownerActorId, false), runDeps1);
    assert.equal(pump3.status, "closed-by-other");
    const auditCount1b = await AuditLog.countDocuments({ action: "tenant.hotAddDbCluster", targetTenantId: t1._id });
    assert.equal(auditCount1b, 1, "re-running the machine on a done task never writes a second audit row");
    console.log("✓ leg 4: re-run on a done task → closed-by-other, still exactly ONE tenant.hotAddDbCluster row");

    // ═══ Leg 5: kill-mid-add (tenant2, its own runtime doc) ════════════════
    const dummySrvRef2 = new Types.ObjectId();
    const t2 = await Tenant.create({
      slug: "verify-hotadd-2",
      status: "active",
      ownerEmail: "o2@verify.local",
      businessType: "cafe",
      dbPool: [dummyCluster("pos-core", "primary"), dummyCluster("pos-orders-a", "orders-current", dummySrvRef2)],
    });
    const OLD_ORDERS_SRV2 = "mongodb+srv://pos_app:oldpw2@host-pos-orders-a.mongodb.net/pos?retryWrites=true&w=majority";
    await vault.store(t2._id, dbUriId("primary"), RUNTIME_URI);
    await vault.store(t2._id, ATLAS_SA, JSON.stringify({ clientId: "ci2", clientSecret: "cs2", orgId: "org2" }));

    // Reset the (shared, sibling) runtime scratch collection for tenant2's own
    // scenario — legs run sequentially, never concurrently.
    await runtimeColl().deleteMany({});
    await runtimeColl().insertOne({
      _id: CLUSTER_REGISTRY_ID,
      ledgers: [{ id: "pos-orders-a", uri: OLD_ORDERS_SRV2, tag: "A", from: null, to: null, active: true, fillPct: 0.8 }],
      standby: [],
    });

    const decision2: TriggerDecision = {
      type: "ADD_DB_CLUSTER",
      reason: "ledger pos-orders-a at 80% — kill-mid-add drill",
      payload: { fillingLedger: "pos-orders-a", usedPct: 0.8 },
    };
    const enq2 = await ingest.openTask(t2._id, t2.slug, decision2);
    assert.equal(enq2, "enqueued");
    const task2 = await Task.findOne({ tenantId: t2._id, type: "ADD_DB_CLUSTER" });

    // Deterministic injection point: the 2nd open-connection call. Call #1 is
    // the claim-time plan read (revealPrimarySrv + docPort.readDoc); call #2 is
    // the flip step's OWN read (runClusterStep never touches docPort on the
    // mint path) — mirrors lib/hotadd.test.ts's "kill-mid-add" docFake.failReadAt(2).
    let openCalls2 = 0;
    const docPort2 = createRuntimeDocPort({
      // Ignore the fake per-cluster SRV docPort.ping() gets called with (like
      // defaultOpenConn above) — always redirect to the real runtime scratch
      // db — except the 2nd overall open (the flip step's OWN readDoc), which
      // is the deterministic kill-mid-add injection point.
      openConn: async () => {
        openCalls2 += 1;
        if (openCalls2 === 2) throw new Error("connect ECONNREFUSED - injected kill-mid-add failure");
        return mongoose.createConnection(RUNTIME_URI).asPromise();
      },
    });
    const sim2 = makeAtlasSim({ creatingCalls: 0 });
    const runDeps2 = makeDeps({ taskPort: createHotAddTaskPort(), docPort: docPort2, tenants: createHubTenantPort(), vault, sim: sim2 });

    await assert.rejects(() => runHotAddDbCluster(runInput(String(task2!._id), ownerActorId, true), runDeps2));

    const task2Mid = await Task.findById(task2!._id).lean();
    assert.equal(task2Mid?.status, "in-progress", "never closed");
    assert.equal(task2Mid?.run?.step, "cluster", "flip never completed — step stays at cluster");
    assert.ok(task2Mid?.run?.lastError, "lastError persisted");
    assert.ok(!task2Mid!.run!.lastError!.includes("://"), "no raw connection string in lastError (A8 redaction)");
    assert.ok(!task2Mid!.run!.lastError!.includes("oldpw2"), "no password substring in lastError");

    const createM0After1 = sim2.countOp("atlas.createM0");
    const createProjectAfter1 = sim2.countOp("atlas.createProject");
    assert.equal(createM0After1, 1);
    assert.equal(createProjectAfter1, 1);

    const pump2b = await runHotAddDbCluster(runInput(String(task2!._id), ownerActorId, false), runDeps2);
    assert.equal(pump2b.status, "done");
    assert.equal(sim2.countOp("atlas.createM0"), createM0After1, "resume did not recreate the cluster");
    assert.equal(sim2.countOp("atlas.createProject"), createProjectAfter1, "resume did not recreate the project");

    const doc2After = await runtimeColl().findOne({});
    assert.equal(doc2After!.ledgers.length, 2, "no duplicate ledger rows");
    console.log("✓ leg 5: kill-mid-add (injected runtime-dial failure at the flip read) — redacted lastError; resume completes with zero duplicate Atlas creates");

    // ═══ Leg 6: bootstrap (tenant3, NO runtime doc) ════════════════════════
    const t3 = await Tenant.create({
      slug: "verify-hotadd-3",
      status: "active",
      ownerEmail: "o3@verify.local",
      businessType: "cafe",
      dbPool: [dummyCluster("pos-core", "primary")],
    });
    await vault.store(t3._id, dbUriId("primary"), RUNTIME_URI);
    await vault.store(t3._id, ATLAS_SA, JSON.stringify({ clientId: "ci3", clientSecret: "cs3", orgId: "org3" }));

    await runtimeColl().deleteMany({}); // bootstrap era: doc absent
    assert.equal(await runtimeColl().findOne({}), null, "precondition: runtime doc absent");

    const decision3: TriggerDecision = {
      type: "ADD_DB_CLUSTER",
      reason: "core at 80% — bootstrap trip",
      payload: { fillingLedger: "core", usedPct: 0.8, bootstrap: true },
    };
    const enq3 = await ingest.openTask(t3._id, t3.slug, decision3);
    assert.equal(enq3, "enqueued");
    const task3 = await Task.findOne({ tenantId: t3._id, type: "ADD_DB_CLUSTER" });

    const sim3 = makeAtlasSim();
    const runDeps3 = makeDeps({
      taskPort: createHotAddTaskPort(),
      docPort: createRuntimeDocPort({ openConn: defaultOpenConn }),
      tenants: createHubTenantPort(),
      vault,
      sim: sim3,
    });
    const res3 = await runHotAddDbCluster(runInput(String(task3!._id), ownerActorId, true), runDeps3);
    assert.equal(res3.status, "done");

    const doc3 = await runtimeColl().findOne({});
    assert.equal(doc3!._id, "cluster-registry");
    const coreRow3 = doc3!.ledgers.find((l) => l.id === "core")!;
    assert.equal(coreRow3.tag, "A");
    assert.equal(coreRow3.from, null);
    assert.equal(coreRow3.active, false);
    assert.equal(coreRow3.to, cafeDateString(new Date(Date.now() + 86_400_000)));
    const newRow3 = doc3!.ledgers.find((l) => l.tag === "A2")!;
    assert.equal(newRow3.active, true);

    const t3After = await Tenant.findById(t3._id).lean();
    const coreEntry3 = t3After!.dbPool.find((c) => c.clusterName === "pos-core")!;
    assert.equal(coreEntry3.role, "primary", "core never demoted");
    console.log("✓ leg 6: bootstrap (no runtime doc) — doc CREATED with a core-archived row; core dbPool role stays 'primary'");

    // ═══ Leg 7: promote (tenant4, doc with a warm standby row) ═════════════
    const dummySrvRef4 = new Types.ObjectId();
    const t4 = await Tenant.create({
      slug: "verify-hotadd-4",
      status: "active",
      ownerEmail: "o4@verify.local",
      businessType: "cafe",
      dbPool: [dummyCluster("pos-core", "primary"), dummyCluster("pos-orders-a", "orders-current", dummySrvRef4)],
    });
    const OLD_ORDERS_SRV4 = "mongodb+srv://pos_app:oldpw4@host-pos-orders-a.mongodb.net/pos?retryWrites=true&w=majority";
    const STANDBY_URI4 = "mongodb+srv://pos_app:standbypw4@host-pos-orders-b.mongodb.net/pos?retryWrites=true&w=majority";
    await vault.store(t4._id, dbUriId("primary"), RUNTIME_URI);

    await runtimeColl().deleteMany({});
    await runtimeColl().insertOne({
      _id: CLUSTER_REGISTRY_ID,
      ledgers: [{ id: "pos-orders-a", uri: OLD_ORDERS_SRV4, tag: "A", from: null, to: null, active: true }],
      standby: [{ id: "pos-orders-b", uri: STANDBY_URI4, tag: "B" }],
    });

    const decision4: TriggerDecision = {
      type: "ADD_DB_CLUSTER",
      reason: "ledger pos-orders-a at 76% — warm standby available",
      payload: { fillingLedger: "pos-orders-a", usedPct: 0.76, standbysOk: 1 },
    };
    const enq4 = await ingest.openTask(t4._id, t4.slug, decision4);
    assert.equal(enq4, "enqueued");
    const task4 = await Task.findOne({ tenantId: t4._id, type: "ADD_DB_CLUSTER" });

    const sim4 = makeAtlasSim();
    const runDeps4 = makeDeps({
      taskPort: createHotAddTaskPort(),
      docPort: createRuntimeDocPort({ openConn: defaultOpenConn }),
      tenants: createHubTenantPort(),
      vault,
      sim: sim4,
    });
    const res4 = await runHotAddDbCluster(runInput(String(task4!._id), ownerActorId, true), runDeps4);
    assert.equal(res4.status, "done");
    assert.equal(sim4.calls.length, 0, "promote path makes ZERO Atlas HTTP calls");

    const doc4 = await runtimeColl().findOne({});
    const promoted4 = doc4!.ledgers.find((l) => l.id === "pos-orders-b")!;
    assert.equal(promoted4.uri, STANDBY_URI4, "byte-identical — the standby's stored uri, kept VERBATIM");
    assert.deepEqual(doc4!.standby, [], "standby consumed");

    const secretRows4 = await Secret.find({ tenantId: t4._id, provider: "atlas", accountLabel: "atlas-1/pos-orders-b", classification: "dbUri" }).lean();
    assert.equal(secretRows4.length, 1, "no revoked siblings — a fresh identity, single row (A7b: no revokeOthers on promote)");
    assert.equal(secretRows4[0].status, "active");
    const revealed4 = await vault.reveal(t4._id, ledgerUriId("pos-orders-b"), { actorId: ownerActorId, ip: AUDIT_IP });
    assert.equal(revealed4, STANDBY_URI4);

    const t4After = await Tenant.findById(t4._id).lean();
    const promotedEntry4 = t4After!.dbPool.find((c) => c.clusterName === "pos-orders-b")!;
    assert.equal(promotedEntry4.accountLabel, "pasted-standby");
    assert.equal(promotedEntry4.role, "orders-current");
    console.log("✓ leg 7: promote (warm standby) — zero Atlas calls, verbatim uri, single active Secret row, dbPool accountLabel 'pasted-standby'");

    // ═══ Leg 8: dismiss + snooze visibility (tenant5, open task) ═══════════
    const t5 = await Tenant.create({
      slug: "verify-hotadd-5",
      status: "active",
      ownerEmail: "o5@verify.local",
      businessType: "cafe",
      dbPool: [dummyCluster("pos-core", "primary")],
    });
    const decision5: TriggerDecision = {
      type: "ADD_DB_CLUSTER",
      reason: "dismiss + snooze drill",
      payload: { fillingLedger: "core", usedPct: 0.9 },
    };
    const enq5 = await ingest.openTask(t5._id, t5.slug, decision5);
    assert.equal(enq5, "enqueued");
    const task5 = await Task.findOne({ tenantId: t5._id, type: "ADD_DB_CLUSTER" });

    const out5 = await dismissHotAddTask(String(task5!._id));
    assert.equal(out5, "dismissed");
    const task5After = await Task.findById(task5!._id).lean();
    assert.equal(task5After?.status, "dismissed");
    assert.equal(task5After?.openKey, undefined);

    const snoozeSeen = await ingest.recentlyClosedTask(t5._id, "ADD_DB_CLUSTER", new Date(Date.now() - 60_000));
    assert.equal(snoozeSeen, true, "the 24h reopen-snooze window sees the just-closed task");
    console.log("✓ leg 8: dismiss → dismissed + openKey freed; recentlyClosedTask sees it inside the reopen-snooze window");

    console.log("\nALL HOTADD LIVE LEGS PASSED ✓");
  } finally {
    await mongoose.connection.dropDatabase();
    await assertConn.dropDatabase();
    await assertConn.close();
    await mongoose.disconnect();
    console.log(`✓ dropped scratch dbs '${SCRATCH_DB}' + '${RUNTIME_DB}'`);
  }
}

main().catch((err) => {
  console.error("verify-hotadd-live FAILED:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
