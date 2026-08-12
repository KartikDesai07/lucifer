import { test } from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";

import { cafeDateString } from "@pos/shared/utils";
import { runHotAddDbCluster, dismissHotAddTask, type RunHotAddInput, type RunHotAddDeps } from "./hotadd";
import {
  HOTADD_PUMP_BUDGET_MS, HOTADD_REPUMP_HINT_S, HOTADD_RETRY_AFTER_CAP_MS,
  ledgerUriId, type StoredRuntimeRegistryDoc,
} from "./hotadd-plan";
import type {
  HotAddCloseOpts, HotAddTaskPort, HubTenantPort, RuntimeDocApplyUpdate, RuntimeDocPort,
} from "./hotadd-ports";
import { ATLAS_SA, CLUSTER_REGISTRY_ID, dbUriId } from "./provisioner-plan";
import type { VaultPort } from "./provisioner-registry";
import type { RetryDeps } from "./provider-retry";
import type { ITaskPayload, ITaskRun, TaskStatus, TaskType } from "@/models/Task";
import type { IDbCluster } from "@/models/Tenant";

// ─────────────────────────────────────────────────────────────────────────────
// Slice F: DB-free MACHINE tests for the F3.8 hot-add (lib/hotadd.ts +
// lib/hotadd-steps.ts + lib/hotadd-ports.ts). In-memory fake ports that MIRROR
// the real CAS/lease/close semantics (hotadd-ports.ts) drive the machine loop;
// Atlas goes through the REAL createAtlasClient over a fake `fetch` (the
// provisioner.test.ts discipline — a fake that skips real client logic proves
// nothing). lib/hotadd-plan.ts's pure builders are already unit-pinned in
// hotadd-plan.test.ts — this file only exercises the machine's WIRING of them.
// ─────────────────────────────────────────────────────────────────────────────

const FIXED_NOW = 1_754_730_000_000; // frozen clock — every `now()` returns this
const TODAY_IST = cafeDateString(new Date(FIXED_NOW));
const TOMORROW_IST = cafeDateString(new Date(FIXED_NOW + 86_400_000));
const SLUG = "acme";
const ATLAS_CREDS = { clientId: "ci", clientSecret: "cs", orgId: "org1" };
const CORE_SRV = "mongodb+srv://pos_app:corepw@host-pos-core.mongodb.net/pos?retryWrites=true&w=majority";
const OLD_ORDERS_URI = "mongodb+srv://pos_app:oldpw@host-pos-orders-a.mongodb.net/pos?retryWrites=true&w=majority";
// Mirrors hotadd-steps.ts's private HOTADD_M0_CAPACITY_BYTES (not exported).
const M0_CAPACITY_BYTES = 536_870_912;

function input(taskId: string, actorId: string, claimAllowed: boolean): RunHotAddInput {
  return { taskId, actor: { actorId, ip: "1.2.3.4" }, claimAllowed };
}

// ── Fake Task (mirrors HotAddTaskPort's CAS/lease/close/dismiss semantics) ───
interface FakeTask {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  tenantSlug: string;
  type: TaskType;
  status: TaskStatus;
  payload?: ITaskPayload;
  openKey?: string;
  run?: ITaskRun;
}

function makeOpenMintTask(): FakeTask {
  return {
    _id: new Types.ObjectId(),
    tenantId: new Types.ObjectId(),
    tenantSlug: SLUG,
    type: "ADD_DB_CLUSTER",
    status: "open",
    openKey: `${SLUG}|ADD_DB_CLUSTER`,
  };
}

function cloneRun(run?: ITaskRun): ITaskRun | undefined {
  if (!run) return undefined;
  return { ...run, target: run.target ? { ...run.target } : undefined };
}
function cloneTask(t: FakeTask): FakeTask {
  return { ...t, payload: t.payload ? { ...t.payload } : undefined, run: cloneRun(t.run) };
}

function makeTaskPort(initial: FakeTask) {
  const t: FakeTask = cloneTask(initial);
  const saveStepFalseOnce = new Set<string>();
  let saveErrorCalls = 0;
  let raceCloseAfterStep: string | null = null;

  const port: HotAddTaskPort = {
    async load(_taskId) {
      return cloneTask(t);
    },
    async claim(_taskId, target, approvedBy, now) {
      if (t.status !== "open" || t.run?.target) return false;
      t.status = "in-progress";
      t.run = { ...(t.run ?? {}), target, approvedBy, approvedAt: now };
      return true;
    },
    async acquireLease(_taskId, runId, until, now) {
      if (t.status !== "in-progress") return false;
      const leaseUntil = t.run?.leaseUntil;
      const free = !leaseUntil || leaseUntil.getTime() < now.getTime() || t.run?.leaseToken === runId;
      if (!free) return false;
      t.run = { ...(t.run ?? {}), leaseToken: runId, leaseUntil: until };
      return true;
    },
    async renewLease(_taskId, runId, until) {
      if (t.run?.leaseToken === runId && t.run) t.run.leaseUntil = until;
    },
    async releaseLease(_taskId, runId) {
      if (t.run?.leaseToken === runId) {
        delete t.run.leaseToken;
        delete t.run.leaseUntil;
      }
    },
    async saveStep(_taskId, runId, step) {
      if (t.run?.leaseToken !== runId || !t.run) return false;
      if (saveStepFalseOnce.has(step)) {
        saveStepFalseOnce.delete(step);
        return false;
      }
      t.run.step = step;
      delete t.run.lastError;
      if (raceCloseAfterStep === step) {
        raceCloseAfterStep = null;
        // Simulates a DIFFERENT (successor) run — e.g. ours lost its lease and a
        // fresh pump fully re-ran and closed — winning the close race first.
        t.status = "done";
        delete t.openKey;
      }
      return true;
    },
    async stampProjectId(_taskId, runId, projectId) {
      if (t.run?.leaseToken !== runId || !t.run?.target) return false;
      t.run.target = { ...t.run.target, projectId };
      return true;
    },
    async stampM0Created(_taskId, runId) {
      if (t.run?.leaseToken !== runId || !t.run?.target) return false;
      t.run.target = { ...t.run.target, m0Created: true };
      return true;
    },
    async saveError(_taskId, runId, message) {
      saveErrorCalls += 1;
      if (t.run?.leaseToken !== runId || !t.run) return false;
      t.run.lastError = message;
      return true;
    },
    async saveErrorUnclaimed(_taskId, message) {
      if (t.status !== "open") return false;
      t.run = { ...(t.run ?? {}), lastError: message };
      return true;
    },
    async close(_taskId, opts: HotAddCloseOpts) {
      const matches =
        opts.kind === "claimed"
          ? t.status === "in-progress" && t.run?.leaseToken === opts.runId
          : t.status === "open";
      if (!matches) return false;
      t.status = "done";
      t.run = { ...(t.run ?? {}), step: "done" };
      delete t.openKey;
      return true;
    },
    async dismiss(_taskId, now) {
      const liveLease = t.run?.leaseUntil !== undefined && t.run.leaseUntil.getTime() >= now.getTime();
      if ((t.status === "open" || t.status === "in-progress") && !liveLease) {
        t.status = "dismissed";
        delete t.openKey;
        return "dismissed";
      }
      const stillOpen = t.status === "open" || t.status === "in-progress";
      return stillOpen && liveLease ? "run-in-flight" : "not-open";
    },
  };

  return {
    port,
    get task() {
      return cloneTask(t);
    },
    get saveErrorCallCount() {
      return saveErrorCalls;
    },
    failSaveStepFalseOnce: (step: string) => saveStepFalseOnce.add(step),
    raceCloseAfterStepOnce: (step: string) => {
      raceCloseAfterStep = step;
    },
  };
}

// ── Fake RuntimeDocPort (honors the flip filter guards for real matched-0/1) ─
function matchesFilter(doc: StoredRuntimeRegistryDoc, filter: Record<string, unknown>): boolean {
  for (const [key, condRaw] of Object.entries(filter)) {
    if (key === "_id") {
      if ((doc._id ?? CLUSTER_REGISTRY_ID) !== condRaw) return false;
    } else if (key === "ledgers") {
      const cond = condRaw as { $elemMatch: { id: string; active: boolean } };
      if (!doc.ledgers.some((l) => l.id === cond.$elemMatch.id && l.active === cond.$elemMatch.active)) return false;
    } else if (key === "standby.0.id") {
      if ((doc.standby ?? [])[0]?.id !== condRaw) return false;
    } else if (key === "standby") {
      const cond = condRaw as { $size: number };
      if ((doc.standby ?? []).length !== cond.$size) return false;
    } else {
      throw new Error(`fake RuntimeDocPort.applyUpdate: unhandled filter key "${key}"`);
    }
  }
  return true;
}

function makeDocPort(initialDoc: StoredRuntimeRegistryDoc | null) {
  let doc: StoredRuntimeRegistryDoc | null = initialDoc ? JSON.parse(JSON.stringify(initialDoc)) : null;
  let failReadAtCall: number | null = null;
  let pendingConcurrentDoc: StoredRuntimeRegistryDoc | null = null;
  const calls = { readDoc: 0, insertDoc: 0, applyUpdate: 0, pings: [] as string[] };

  const port: RuntimeDocPort = {
    async readDoc(_uri) {
      calls.readDoc += 1;
      if (failReadAtCall === calls.readDoc) {
        failReadAtCall = null;
        throw new Error(
          "connect ECONNREFUSED mongodb+srv://baduser:badpass@ghost-runtime.mongodb.net:27017 - runtime dial failed",
        );
      }
      return doc ? (JSON.parse(JSON.stringify(doc)) as StoredRuntimeRegistryDoc) : null;
    },
    async insertDoc(_uri, newDoc) {
      calls.insertDoc += 1;
      if (pendingConcurrentDoc) {
        doc = JSON.parse(JSON.stringify(pendingConcurrentDoc));
        pendingConcurrentDoc = null;
        return "exists";
      }
      if (doc !== null) return "exists";
      doc = JSON.parse(JSON.stringify(newDoc));
      return "inserted";
    },
    async applyUpdate(_uri, op: RuntimeDocApplyUpdate) {
      calls.applyUpdate += 1;
      if (doc === null) return 0;
      if (!matchesFilter(doc, op.filter)) return 0;
      const set = op.update.$set as Partial<StoredRuntimeRegistryDoc>;
      doc = { ...doc, ...set };
      return 1;
    },
    async ping(uri) {
      calls.pings.push(uri);
    },
  };

  return {
    port,
    calls,
    getDoc: () => (doc ? (JSON.parse(JSON.stringify(doc)) as StoredRuntimeRegistryDoc) : null),
    setDoc: (d: StoredRuntimeRegistryDoc | null) => {
      doc = d ? JSON.parse(JSON.stringify(d)) : null;
    },
    failReadAt: (n: number) => {
      failReadAtCall = n;
    },
    armConcurrentInsert: (d: StoredRuntimeRegistryDoc) => {
      pendingConcurrentDoc = d;
    },
  };
}

// ── Fake HubTenantPort ────────────────────────────────────────────────────────
function makeTenantPort(opts: { status?: string; dbPool?: IDbCluster[] } = {}) {
  const status = opts.status ?? "active";
  const dbPool: IDbCluster[] = (opts.dbPool ?? []).map((c) => ({ ...c }));
  const upsertCalls: { slug: string; entry: IDbCluster }[] = [];
  const roleCalls: { slug: string; clusterName: string; role: IDbCluster["role"] }[] = [];
  let routing: import("./provisioner-registry").TenantRouting | undefined;
  const _id = new Types.ObjectId();

  const port: HubTenantPort = {
    async findTenant(_slug) {
      return { _id, status, dbPool: dbPool.map((c) => ({ clusterName: c.clusterName, role: c.role })) };
    },
    async upsertDbCluster(slug, entry) {
      upsertCalls.push({ slug, entry: { ...entry } });
      const i = dbPool.findIndex((c) => c.clusterName === entry.clusterName);
      if (i >= 0) dbPool[i] = { ...entry };
      else dbPool.push({ ...entry });
    },
    async setRouting(_slug, r) {
      routing = r;
    },
    async setDbClusterRole(slug, clusterName, role) {
      roleCalls.push({ slug, clusterName, role });
      const c = dbPool.find((x) => x.clusterName === clusterName);
      if (c) c.role = role;
    },
  };

  return {
    port,
    get dbPool() {
      return dbPool.map((c) => ({ ...c }));
    },
    upsertCalls,
    roleCalls,
    get routing() {
      return routing;
    },
  };
}

// ── Fake VaultPort (the provisioner.test.ts makeVault precedent) ────────────
interface SecretRow {
  id: Types.ObjectId;
  provider: string;
  accountLabel: string;
  classification: string;
  plaintext: string;
  status: string;
  seq: number;
}
function makeVault() {
  const rows: SecretRow[] = [];
  let seq = 0;
  const revokeCalls: { key: string }[] = [];
  const key = (id: { provider: string; accountLabel: string; classification: string }) =>
    `${id.provider}|${id.accountLabel}|${id.classification}`;
  const vault: VaultPort = {
    async store(_t, id, plaintext) {
      const _id = new Types.ObjectId();
      rows.push({ id: _id, provider: id.provider, accountLabel: id.accountLabel, classification: id.classification, plaintext, status: "active", seq: seq++ });
      return _id;
    },
    async findActiveSecretId(_t, id) {
      const active = rows.filter((r) => key(r) === key(id) && r.status !== "revoked").sort((a, b) => b.seq - a.seq);
      return active[0]?.id ?? null;
    },
    async reveal(_t, id) {
      const active = rows.filter((r) => key(r) === key(id) && r.status !== "revoked").sort((a, b) => b.seq - a.seq);
      if (!active[0]) throw new Error(`no active ${key(id)}`);
      return active[0].plaintext;
    },
    async revokeOthers(_t, id, exceptId) {
      revokeCalls.push({ key: key(id) });
      let n = 0;
      for (const r of rows) {
        if (key(r) === key(id) && r.status !== "revoked" && !r.id.equals(exceptId)) {
          r.status = "revoked";
          n++;
        }
      }
      return n;
    },
  };
  return {
    vault,
    rows,
    revokeCalls,
    seed(id: { provider: string; accountLabel: string; classification: string }, plaintext: string): Types.ObjectId {
      const _id = new Types.ObjectId();
      rows.push({ id: _id, provider: id.provider, accountLabel: id.accountLabel, classification: id.classification, plaintext, status: "active", seq: seq++ });
      return _id;
    },
  };
}

function makeSeededVault() {
  const v = makeVault();
  v.seed(dbUriId("primary"), CORE_SRV);
  v.seed(ATLAS_SA, JSON.stringify(ATLAS_CREDS));
  return v;
}

// ── Fake Atlas provider `fetch` (drives the REAL F3.5 atlas client) ─────────
interface FailSpec {
  times: number;
  status: number;
  retryAfter?: string;
}
function makeAtlasSim(opts: { creatingCalls?: number; fail?: Record<string, FailSpec> } = {}) {
  const creatingCalls = opts.creatingCalls ?? 0;
  const fail = opts.fail ?? {};
  const state = { projects: new Set<string>(), clusters: new Set<string>(), users: new Set<string>() };
  let clusterGetCount = 0;
  const calls: { op: string; url: string; body?: string }[] = [];

  const R = (status: number, body: unknown, headers?: Record<string, string>) =>
    new Response(status === 204 ? null : JSON.stringify(body), { status, headers });

  function maybeFail(op: string): Response | null {
    const f = fail[op];
    if (f && f.times > 0) {
      f.times -= 1;
      return R(f.status, { errorCode: "INJECTED" }, f.retryAfter ? { "Retry-After": f.retryAfter } : undefined);
    }
    return null;
  }

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
      calls.push({ op: "atlas.createProject", url: u, body });
      const f = maybeFail("atlas.createProject");
      if (f) return f;
      const name = JSON.parse(body!).name as string;
      if (state.projects.has(name)) return R(409, { errorCode: "GROUP_ALREADY_EXISTS" });
      state.projects.add(name);
      return R(201, { id: `proj-${name}` });
    }
    const clusterPost = /\/api\/atlas\/v2\/groups\/([^/]+)\/clusters$/.exec(u);
    if (method === "POST" && clusterPost) {
      calls.push({ op: "atlas.createM0", url: u, body });
      const f = maybeFail("atlas.createM0");
      if (f) return f;
      const name = JSON.parse(body!).name as string;
      const k = `${clusterPost[1]}/${name}`;
      if (state.clusters.has(k)) return R(409, { errorCode: "DUPLICATE_CLUSTER_NAME" });
      state.clusters.add(k);
      return R(201, {});
    }
    const clusterGet = /\/api\/atlas\/v2\/groups\/([^/]+)\/clusters\/([^/]+)$/.exec(u);
    if (method === "GET" && clusterGet) {
      calls.push({ op: "atlas.getCluster", url: u });
      const f = maybeFail("atlas.getCluster");
      if (f) return f;
      clusterGetCount += 1;
      const name = clusterGet[2];
      const stateName = clusterGetCount <= creatingCalls ? "CREATING" : "IDLE";
      return R(200, { stateName, connectionStrings: { standardSrv: `mongodb+srv://host-${name}.mongodb.net` } });
    }
    const userPost = /\/api\/atlas\/v2\/groups\/([^/]+)\/databaseUsers$/.exec(u);
    if (method === "POST" && userPost) {
      calls.push({ op: "atlas.createDbUser", url: u, body });
      const k = userPost[1];
      if (state.users.has(k)) return R(409, { errorCode: "USER_ALREADY_EXISTS" });
      state.users.add(k);
      return R(201, {});
    }
    if (method === "PATCH" && u.includes("/databaseUsers/admin/")) return R(200, {});
    if (method === "POST" && u.endsWith("/accessList")) {
      calls.push({ op: "atlas.accessList", url: u });
      return R(201, {});
    }
    throw new Error(`unexpected ${method} ${u}`);
  }) as typeof fetch;

  return {
    fetchImpl,
    calls,
    state,
    countOp: (op: string) => calls.filter((c) => c.op === op).length,
  };
}

// ── deps builder ──────────────────────────────────────────────────────────────
function makeDeps(parts: {
  taskPort: HotAddTaskPort;
  docPort: RuntimeDocPort;
  tenants: HubTenantPort;
  vault: VaultPort;
  fetchImpl: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}): Partial<RunHotAddDeps> {
  let n = 0;
  return {
    taskPort: parts.taskPort,
    docPort: parts.docPort,
    tenants: parts.tenants,
    vault: parts.vault,
    mintSecret: () => `mint-${++n}`,
    now: () => FIXED_NOW,
    retryOverrides: { fetchImpl: parts.fetchImpl, sleep: parts.sleep ?? (async () => {}), now: () => FIXED_NOW } as Partial<RetryDeps>,
  };
}

function oldOrdersEntry(srvUriRef?: Types.ObjectId): IDbCluster {
  return {
    provider: "atlas",
    accountLabel: "atlas-1/pos-orders-a",
    clusterName: "pos-orders-a",
    orgId: "org1",
    projectId: "proj-old-a",
    role: "orders-current",
    capacityBytes: M0_CAPACITY_BYTES,
    state: "idle",
    ...(srvUriRef ? { srvUriRef } : {}),
  };
}

function nonBootstrapDoc(): StoredRuntimeRegistryDoc {
  return {
    _id: CLUSTER_REGISTRY_ID,
    ledgers: [{ id: "pos-orders-a", uri: OLD_ORDERS_URI, tag: "A", from: null, to: null, active: true, fillPct: 0.76 }],
    standby: [],
  };
}

// ═══ 1/2: mint scenario shared setup ═════════════════════════════════════════

function setupMintScenario() {
  const task = makeOpenMintTask();
  const taskFake = makeTaskPort(task);
  const docFake = makeDocPort(nonBootstrapDoc());
  const vaultFake = makeSeededVault();
  const oldSrvId = vaultFake.seed(ledgerUriId("pos-orders-a"), OLD_ORDERS_URI);
  const tenantFake = makeTenantPort({ dbPool: [oldOrdersEntry(oldSrvId)] });
  const sim = makeAtlasSim({ creatingCalls: 1 });
  const actorId = new Types.ObjectId().toHexString();
  const deps = makeDeps({ taskPort: taskFake.port, docPort: docFake.port, tenants: tenantFake.port, vault: vaultFake.vault, fetchImpl: sim.fetchImpl });
  return { task, taskFake, docFake, vaultFake, tenantFake, sim, actorId, deps };
}

// ═══ TESTS ═══════════════════════════════════════════════════════════════════

test("1. claim + first pump mints (not IDLE) — target+projectId stamped (A3), step not advanced past target", async () => {
  const s = setupMintScenario();
  const res = await runHotAddDbCluster(input(String(s.task._id), s.actorId, true), s.deps);

  assert.equal(res.status, "creating");
  assert.equal(res.step, "target", "run.step must not advance past 'target' while the cluster is still creating");
  assert.equal(res.repumpAfterS, HOTADD_REPUMP_HINT_S);

  const t = s.taskFake.task;
  assert.equal(t.status, "in-progress");
  assert.equal(t.run?.step, "target");
  assert.ok(t.run?.approvedBy, "approvedBy stamped on claim (A1)");
  assert.equal(t.run?.target?.mode, "mint");
  assert.equal(t.run?.target?.tag, "A2");
  assert.equal(t.run?.target?.clusterId, "pos-orders-a2");
  assert.equal(t.run?.target?.oldActiveId, "pos-orders-a");
  assert.ok(t.run?.target?.projectId, "A3: projectId stamped immediately after createProject even though the pump returned 'creating'");

  assert.equal(s.sim.countOp("atlas.createProject"), 1);
  assert.equal(s.sim.countOp("atlas.createM0"), 1);
  assert.equal(s.sim.countOp("atlas.getCluster"), 1);
});

test("2. second pump completes — createProject exactly once total, doc flips atomically, dbPool demote+add, routing, task closed", async () => {
  const s = setupMintScenario();
  const pump1 = await runHotAddDbCluster(input(String(s.task._id), s.actorId, true), s.deps);
  assert.equal(pump1.status, "creating", "pre-condition: pump 1 stops at creating");

  const pump2 = await runHotAddDbCluster(input(String(s.task._id), s.actorId, false), s.deps);
  assert.equal(pump2.status, "done");
  assert.equal(pump2.step, "done");
  assert.equal(s.sim.countOp("atlas.createProject"), 1, "A3: createProject happened exactly once across both pumps");

  const t = s.taskFake.task;
  assert.equal(t.status, "done");
  assert.equal(t.openKey, undefined, "openKey gone");
  assert.equal(t.run?.step, "done");

  const doc = s.docFake.getDoc()!;
  const actives = doc.ledgers.filter((l) => l.active === true);
  assert.equal(actives.length, 1, "exactly one active:true row");
  const retiring = doc.ledgers.find((l) => l.id === "pos-orders-a")!;
  assert.deepEqual(retiring, { id: "pos-orders-a", uri: OLD_ORDERS_URI, tag: "A", from: null, to: TOMORROW_IST, active: false, fillPct: 0.76 }, "retiring row: other fields verbatim");
  const fresh = doc.ledgers.find((l) => l.id === "pos-orders-a2")!;
  assert.equal(fresh.tag, "A2");
  assert.equal(fresh.from, TODAY_IST);
  assert.equal(fresh.to, null);
  assert.equal(fresh.active, true);

  const mintedSrv = await s.vaultFake.vault.reveal(new Types.ObjectId(), ledgerUriId("pos-orders-a2"), { actorId: s.actorId, ip: "1.2.3.4" });
  assert.equal(fresh.uri, mintedSrv, "doc row uri tracks the vault-stored minted SRV (sealDocUri is identity)");
  assert.ok(mintedSrv.startsWith("mongodb+srv://pos_app:"), "reveal returns the minted-password SRV");

  assert.equal(s.tenantFake.upsertCalls.some((c) => c.entry.clusterName === "pos-orders-a"), false, "old entry NEVER upserted (whole-element replace) — demote is role-only");
  assert.ok(s.tenantFake.roleCalls.some((c) => c.clusterName === "pos-orders-a" && c.role === "orders-archive"), "old entry demoted via setDbClusterRole");
  const newEntry = s.tenantFake.dbPool.find((c) => c.clusterName === "pos-orders-a2")!;
  assert.equal(newEntry.provider, "atlas");
  assert.equal(newEntry.accountLabel, "atlas-1");
  assert.equal(newEntry.role, "orders-current");
  assert.equal(newEntry.state, "idle");
  assert.equal(newEntry.capacityBytes, M0_CAPACITY_BYTES);
  assert.ok(newEntry.srvUriRef, "srvUriRef set");
  assert.equal(newEntry.orgId, "org1");
  assert.ok(newEntry.projectId);

  assert.deepEqual(s.tenantFake.routing, {
    reference: "primary",
    counters: "primary",
    orders: "orders-current",
    orderWindows: [
      { clusterName: "pos-orders-a", fromDate: new Date(0), toDate: new Date(TOMORROW_IST) },
      { clusterName: "pos-orders-a2", fromDate: new Date(TODAY_IST), toDate: null },
    ],
  });
});

test("3. kill-mid-add (readDoc throws at flip) — resume with zero duplicate cluster creates, zero duplicate ledger rows", async () => {
  const task = makeOpenMintTask();
  const taskFake = makeTaskPort(task);
  const docFake = makeDocPort(nonBootstrapDoc());
  const vaultFake = makeSeededVault();
  const oldSrvId = vaultFake.seed(ledgerUriId("pos-orders-a"), OLD_ORDERS_URI);
  const tenantFake = makeTenantPort({ dbPool: [oldOrdersEntry(oldSrvId)] });
  const sim = makeAtlasSim({ creatingCalls: 0 });
  const actorId = new Types.ObjectId().toHexString();
  const deps = makeDeps({ taskPort: taskFake.port, docPort: docFake.port, tenants: tenantFake.port, vault: vaultFake.vault, fetchImpl: sim.fetchImpl });

  // Call #1 = claim-time plan read; call #2 = the flip step's own read.
  docFake.failReadAt(2);

  await assert.rejects(() => runHotAddDbCluster(input(String(task._id), actorId, true), deps));

  const t1 = taskFake.task;
  assert.equal(t1.status, "in-progress", "never closed");
  assert.equal(t1.run?.step, "cluster", "flip never completed — step stays at cluster");
  assert.ok(t1.run?.lastError, "lastError persisted");
  assert.ok(!t1.run!.lastError!.includes("baduser:badpass"), "raw credential redacted");
  assert.ok(t1.run!.lastError!.includes("***:***@"), "safeMessage's redaction marker present");

  const createM0After1 = sim.countOp("atlas.createM0");
  const createProjectAfter1 = sim.countOp("atlas.createProject");

  const res2 = await runHotAddDbCluster(input(String(task._id), actorId, false), deps);
  assert.equal(res2.status, "done");
  assert.equal(sim.countOp("atlas.createM0"), createM0After1, "resume did not recreate the cluster");
  assert.equal(sim.countOp("atlas.createProject"), createProjectAfter1, "resume did not recreate the project");
  const doc = docFake.getDoc()!;
  assert.equal(doc.ledgers.length, 2, "no duplicate ledger rows");
});

test("4. kill-after-flip-before-saveStep — resume detects alreadyFlipped, skips flip, exactly one target row", async () => {
  const task = makeOpenMintTask();
  const taskFake = makeTaskPort(task);
  const docFake = makeDocPort(nonBootstrapDoc());
  const vaultFake = makeSeededVault();
  const oldSrvId = vaultFake.seed(ledgerUriId("pos-orders-a"), OLD_ORDERS_URI);
  const tenantFake = makeTenantPort({ dbPool: [oldOrdersEntry(oldSrvId)] });
  const sim = makeAtlasSim({ creatingCalls: 0 });
  const actorId = new Types.ObjectId().toHexString();
  const deps = makeDeps({ taskPort: taskFake.port, docPort: docFake.port, tenants: tenantFake.port, vault: vaultFake.vault, fetchImpl: sim.fetchImpl });

  taskFake.failSaveStepFalseOnce("flip");

  const res1 = await runHotAddDbCluster(input(String(task._id), actorId, true), deps);
  assert.equal(res1.status, "lost-lease", "the fenced saveStep('flip') fired AFTER applyUpdate already succeeded");
  const t1 = taskFake.task;
  assert.equal(t1.status, "in-progress");
  assert.equal(t1.run?.step, "cluster", "the flip bookkeeping never recorded, even though the write landed");
  assert.equal(docFake.calls.applyUpdate, 1, "the flip write DID happen this pump");

  const res2 = await runHotAddDbCluster(input(String(task._id), actorId, false), deps);
  assert.equal(res2.status, "done");
  assert.equal(docFake.calls.applyUpdate, 1, "resume's flip re-run detected alreadyFlipped and skipped the write");
  const doc = docFake.getDoc()!;
  assert.equal(doc.ledgers.filter((l) => l.id === "pos-orders-a2").length, 1, "never two rows for the target");
});

test("5a. promote path — zero Atlas calls, standby consumed verbatim, no revokeOthers, pasted-standby role", async () => {
  const task = makeOpenMintTask();
  const taskFake = makeTaskPort(task);
  const STANDBY_URI = "mongodb+srv://pos_app:standbypw@host-pos-orders-b.mongodb.net/pos?retryWrites=true&w=majority";
  const docFake = makeDocPort({
    _id: CLUSTER_REGISTRY_ID,
    ledgers: [{ id: "pos-orders-a", uri: OLD_ORDERS_URI, tag: "A", from: null, to: null, active: true }],
    standby: [{ id: "pos-orders-b", uri: STANDBY_URI, tag: "B5" }],
  });
  const vaultFake = makeSeededVault();
  const oldSrvId = vaultFake.seed(ledgerUriId("pos-orders-a"), OLD_ORDERS_URI);
  const tenantFake = makeTenantPort({ dbPool: [oldOrdersEntry(oldSrvId)] });
  const sim = makeAtlasSim();
  const actorId = new Types.ObjectId().toHexString();
  const deps = makeDeps({ taskPort: taskFake.port, docPort: docFake.port, tenants: tenantFake.port, vault: vaultFake.vault, fetchImpl: sim.fetchImpl });

  const res = await runHotAddDbCluster(input(String(task._id), actorId, true), deps);
  assert.equal(res.status, "done");
  assert.equal(sim.calls.length, 0, "promote path makes ZERO Atlas HTTP calls");
  assert.deepEqual(docFake.calls.pings, [STANDBY_URI], "ping called on the standby uri");

  const doc = docFake.getDoc()!;
  assert.deepEqual(doc.standby, [], "flip consumed standby[0]");
  const fresh = doc.ledgers.find((l) => l.id === "pos-orders-b")!;
  assert.equal(fresh.uri, STANDBY_URI, "the standby's stored uri is kept VERBATIM");
  assert.equal(fresh.tag, "B5");
  assert.equal(fresh.active, true);

  const revokeForStandby = vaultFake.revokeCalls.filter((c) => c.key === "atlas|atlas-1/pos-orders-b|dbUri");
  assert.equal(revokeForStandby.length, 0, "promote store happens WITHOUT revokeOthers (A7b)");

  const newEntry = tenantFake.dbPool.find((c) => c.clusterName === "pos-orders-b")!;
  assert.equal(newEntry.accountLabel, "pasted-standby");
  assert.equal(newEntry.role, "orders-current");
});

test("5b. A7(b) promote collision — an identity already holding a DIFFERENT active plaintext refuses, nothing flipped", async () => {
  const task = makeOpenMintTask();
  const taskFake = makeTaskPort(task);
  const STANDBY_URI = "mongodb+srv://pos_app:standbypw@host-pos-orders-b.mongodb.net/pos?retryWrites=true&w=majority";
  const docFake = makeDocPort({
    _id: CLUSTER_REGISTRY_ID,
    ledgers: [{ id: "pos-orders-a", uri: OLD_ORDERS_URI, tag: "A", from: null, to: null, active: true }],
    standby: [{ id: "pos-orders-b", uri: STANDBY_URI, tag: "B5" }],
  });
  const vaultFake = makeSeededVault();
  vaultFake.seed(ledgerUriId("pos-orders-a"), OLD_ORDERS_URI);
  vaultFake.seed(ledgerUriId("pos-orders-b"), "mongodb+srv://pos_app:someoneElse@host-hijacked.mongodb.net/pos");
  const tenantFake = makeTenantPort({ dbPool: [] });
  const sim = makeAtlasSim();
  const actorId = new Types.ObjectId().toHexString();
  const deps = makeDeps({ taskPort: taskFake.port, docPort: docFake.port, tenants: tenantFake.port, vault: vaultFake.vault, fetchImpl: sim.fetchImpl });

  await assert.rejects(
    () => runHotAddDbCluster(input(String(task._id), actorId, true), deps),
    /secret identity collision/,
  );

  const t = taskFake.task;
  assert.equal(t.status, "in-progress", "never closed");
  assert.ok(t.run?.lastError?.includes("secret identity collision"));
  const doc = docFake.getDoc()!;
  assert.deepEqual(doc.standby, [{ id: "pos-orders-b", uri: STANDBY_URI, tag: "B5" }], "nothing flipped");
  assert.equal(doc.ledgers.length, 1, "nothing flipped");
});

test("6a. bootstrap — core-archived row inserted, core never demoted, done + closed", async () => {
  const task = makeOpenMintTask();
  const taskFake = makeTaskPort(task);
  const docFake = makeDocPort(null); // doc absent — bootstrap era
  const vaultFake = makeSeededVault();
  const tenantFake = makeTenantPort({ dbPool: [] });
  const sim = makeAtlasSim();
  const actorId = new Types.ObjectId().toHexString();
  const deps = makeDeps({ taskPort: taskFake.port, docPort: docFake.port, tenants: tenantFake.port, vault: vaultFake.vault, fetchImpl: sim.fetchImpl });

  const res = await runHotAddDbCluster(input(String(task._id), actorId, true), deps);
  assert.equal(res.status, "done");

  const t = taskFake.task;
  assert.equal(t.run?.target?.bootstrap, true);
  assert.equal(t.run?.target?.oldActiveId, "core");
  assert.equal(t.run?.target?.tag, "A2");

  const doc = docFake.getDoc()!;
  assert.equal(doc._id, "cluster-registry");
  assert.deepEqual(doc.core, { id: "pos-core", uri: CORE_SRV, tag: "C" });
  assert.equal(doc.ledgers.length, 2);
  const coreRow = doc.ledgers.find((l) => l.id === "core")!;
  assert.deepEqual(coreRow, { id: "core", uri: CORE_SRV, tag: "A", from: null, to: TOMORROW_IST, active: false });
  const newRow = doc.ledgers.find((l) => l.id === "pos-orders-a2")!;
  assert.equal(newRow.tag, "A2");
  assert.equal(newRow.from, TODAY_IST);
  assert.equal(newRow.to, null);
  assert.equal(newRow.active, true);
  assert.deepEqual(doc.standby, []);

  const windows = tenantFake.routing?.orderWindows ?? [];
  assert.ok(windows.some((w) => w.clusterName === "core"), "windows include the core entry");
  assert.equal(tenantFake.roleCalls.length, 0, "setDbClusterRole NEVER called — nothing demoted");

  const closed = taskFake.task;
  assert.equal(closed.status, "done");
  assert.equal(closed.openKey, undefined);
});

test("6b. bootstrap insertDoc→'exists' race — re-reads and completes via the existing-doc CAS flip, not an error", async () => {
  const task = makeOpenMintTask();
  const taskFake = makeTaskPort(task);
  const docFake = makeDocPort(null);
  const vaultFake = makeSeededVault();
  const tenantFake = makeTenantPort({ dbPool: [] });
  const sim = makeAtlasSim();
  const actorId = new Types.ObjectId().toHexString();
  const deps = makeDeps({ taskPort: taskFake.port, docPort: docFake.port, tenants: tenantFake.port, vault: vaultFake.vault, fetchImpl: sim.fetchImpl });

  // A concurrent actor's doc materializes exactly when OUR insertOne E11000s —
  // core as the sole active ledger (a plausible pre-hot-add legacy shape).
  docFake.armConcurrentInsert({
    _id: CLUSTER_REGISTRY_ID,
    ledgers: [{ id: "core", uri: CORE_SRV, tag: "A", from: null, to: null, active: true }],
    standby: [],
  });

  const res = await runHotAddDbCluster(input(String(task._id), actorId, true), deps);
  assert.equal(res.status, "done", "the 'exists' race resolved via the CAS path, not an error");
  assert.equal(docFake.calls.insertDoc, 1);
  assert.equal(docFake.calls.applyUpdate, 1, "fell through to the real CAS $set, not the alreadyFlipped shortcut");

  const doc = docFake.getDoc()!;
  const actives = doc.ledgers.filter((l) => l.active === true);
  assert.equal(actives.length, 1);
  assert.equal(actives[0].id, "pos-orders-a2");
  const coreRow = doc.ledgers.find((l) => l.id === "core")!;
  assert.equal(coreRow.active, false);
  assert.equal(coreRow.to, TOMORROW_IST);
});

test("7. already-rolled — reconciles dbPool from the doc, closes via the unclaimed CAS, zero Atlas calls", async () => {
  const task = makeOpenMintTask();
  task.payload = { fillingLedger: "pos-orders-zzz" }; // stale — the fill already rolled elsewhere
  const taskFake = makeTaskPort(task);
  const bUri = "mongodb+srv://pos_app:bpw@host-pos-orders-b.mongodb.net/pos?retryWrites=true&w=majority";
  const docFake = makeDocPort({
    _id: CLUSTER_REGISTRY_ID,
    ledgers: [
      { id: "pos-orders-a", uri: OLD_ORDERS_URI, tag: "A", from: null, to: TODAY_IST, active: false },
      { id: "pos-orders-b", uri: bUri, tag: "B", from: TODAY_IST, to: null, active: true },
    ],
    standby: [],
  });
  const vaultFake = makeSeededVault();
  const oldSrvId = vaultFake.seed(ledgerUriId("pos-orders-a"), OLD_ORDERS_URI);
  vaultFake.seed(ledgerUriId("pos-orders-b"), bUri);
  const tenantFake = makeTenantPort({ dbPool: [oldOrdersEntry(oldSrvId)] });
  const sim = makeAtlasSim();
  const actorId = new Types.ObjectId().toHexString();
  const deps = makeDeps({ taskPort: taskFake.port, docPort: docFake.port, tenants: tenantFake.port, vault: vaultFake.vault, fetchImpl: sim.fetchImpl });

  const res = await runHotAddDbCluster(input(String(task._id), actorId, true), deps);
  assert.equal(res.status, "already-rolled");
  assert.equal(sim.calls.length, 0, "zero Atlas calls");

  assert.ok(tenantFake.roleCalls.some((c) => c.clusterName === "pos-orders-a" && c.role === "orders-archive"), "the stale role was synced to the doc");
  const newEntry = tenantFake.dbPool.find((c) => c.clusterName === "pos-orders-b")!;
  assert.equal(newEntry.accountLabel, "runtime-doc", "the missing row was created with accountLabel 'runtime-doc'");
  assert.equal(newEntry.role, "orders-current");

  const t = taskFake.task;
  assert.equal(t.status, "done");
  assert.equal(t.openKey, undefined);
  assert.equal(t.run?.target, undefined, "never claimed — no target stamped");
  assert.equal(t.run?.step, "done", "close() sets run.step:'done' even on the unclaimed CAS path");
});

test("8. lease/refusal matrix", async () => {
  const actorId = new Types.ObjectId().toHexString();

  // a) in-progress task with a live foreign lease → 'in-progress'
  {
    const task = makeOpenMintTask();
    task.status = "in-progress";
    task.run = {
      target: { mode: "mint", tag: "A2", clusterId: "pos-orders-a2", projectName: "pos-acme-orders-a2", oldActiveId: "pos-orders-a" },
      approvedBy: new Types.ObjectId(),
      approvedAt: new Date(FIXED_NOW),
      leaseToken: "other-runner",
      leaseUntil: new Date(FIXED_NOW + 60_000),
    };
    const taskFake = makeTaskPort(task);
    const deps = makeDeps({ taskPort: taskFake.port, docPort: makeDocPort(null).port, tenants: makeTenantPort().port, vault: makeSeededVault().vault, fetchImpl: makeAtlasSim().fetchImpl });
    const res = await runHotAddDbCluster(input(String(task._id), actorId, false), deps);
    assert.equal(res.status, "in-progress");
  }

  // b) fenced saveStep returning false mid-run → 'lost-lease', no subsequent port writes
  {
    const task = makeOpenMintTask();
    const taskFake = makeTaskPort(task);
    const docFake = makeDocPort(nonBootstrapDoc());
    const vaultFake = makeSeededVault();
    vaultFake.seed(ledgerUriId("pos-orders-a"), OLD_ORDERS_URI);
    const tenantFake = makeTenantPort({ dbPool: [oldOrdersEntry()] });
    const sim = makeAtlasSim();
    const deps = makeDeps({ taskPort: taskFake.port, docPort: docFake.port, tenants: tenantFake.port, vault: vaultFake.vault, fetchImpl: sim.fetchImpl });
    taskFake.failSaveStepFalseOnce("cluster");
    const res = await runHotAddDbCluster(input(String(task._id), actorId, true), deps);
    assert.equal(res.status, "lost-lease");
    assert.equal(taskFake.task.status, "in-progress");
    assert.equal(taskFake.saveErrorCallCount, 0, "LostLease never persists lastError");
    assert.equal(docFake.calls.applyUpdate, 0, "flip never ran");
    assert.equal(tenantFake.upsertCalls.length, 0);
    assert.equal(tenantFake.roleCalls.length, 0);
  }

  // c) claimAllowed:false on an open task → 'refused' with a step-up note
  {
    const task = makeOpenMintTask();
    const taskFake = makeTaskPort(task);
    const deps = makeDeps({ taskPort: taskFake.port, docPort: makeDocPort(null).port, tenants: makeTenantPort().port, vault: makeSeededVault().vault, fetchImpl: makeAtlasSim().fetchImpl });
    const res = await runHotAddDbCluster(input(String(task._id), actorId, false), deps);
    assert.equal(res.status, "refused");
    assert.match(res.note ?? "", /step-up/);
  }

  // d) tenant status 'suspended' → 'refused'
  {
    const task = makeOpenMintTask();
    const taskFake = makeTaskPort(task);
    const tenantFake = makeTenantPort({ status: "suspended" });
    const deps = makeDeps({ taskPort: taskFake.port, docPort: makeDocPort(null).port, tenants: tenantFake.port, vault: makeSeededVault().vault, fetchImpl: makeAtlasSim().fetchImpl });
    const res = await runHotAddDbCluster(input(String(task._id), actorId, true), deps);
    assert.equal(res.status, "refused");
    assert.match(res.note ?? "", /suspended/);
  }

  // e) type ADD_CLOUD → 'refused'
  {
    const task = makeOpenMintTask();
    task.type = "ADD_CLOUD";
    const taskFake = makeTaskPort(task);
    const deps = makeDeps({ taskPort: taskFake.port, docPort: makeDocPort(null).port, tenants: makeTenantPort().port, vault: makeSeededVault().vault, fetchImpl: makeAtlasSim().fetchImpl });
    const res = await runHotAddDbCluster(input(String(task._id), actorId, true), deps);
    assert.equal(res.status, "refused");
    assert.match(res.note ?? "", /ADD_DB_CLUSTER/);
  }

  // f) status done → 'closed-by-other'
  {
    const task = makeOpenMintTask();
    task.status = "done";
    task.run = { step: "done" };
    const taskFake = makeTaskPort(task);
    const deps = makeDeps({ taskPort: taskFake.port, docPort: makeDocPort(null).port, tenants: makeTenantPort().port, vault: makeSeededVault().vault, fetchImpl: makeAtlasSim().fetchImpl });
    const res = await runHotAddDbCluster(input(String(task._id), actorId, false), deps);
    assert.equal(res.status, "closed-by-other");
    assert.equal(res.step, "done");
  }
});

test("9. A2 budget — a 429 Retry-After beyond the cap returns 'busy' without sleeping the long wait", async () => {
  const task = makeOpenMintTask();
  const taskFake = makeTaskPort(task);
  const docFake = makeDocPort(nonBootstrapDoc());
  const vaultFake = makeSeededVault();
  vaultFake.seed(ledgerUriId("pos-orders-a"), OLD_ORDERS_URI);
  const tenantFake = makeTenantPort({ dbPool: [oldOrdersEntry()] });
  const sim = makeAtlasSim({ fail: { "atlas.createM0": { times: 1, status: 429, retryAfter: "30" } } });
  const actorId = new Types.ObjectId().toHexString();
  const sleeps: number[] = [];
  const deps = makeDeps({
    taskPort: taskFake.port, docPort: docFake.port, tenants: tenantFake.port, vault: vaultFake.vault,
    fetchImpl: sim.fetchImpl, sleep: async (ms) => { sleeps.push(ms); },
  });

  const res = await runHotAddDbCluster(input(String(task._id), actorId, true), deps);
  assert.equal(res.status, "busy");
  assert.equal(res.repumpAfterS, HOTADD_REPUMP_HINT_S);
  assert.ok(!sleeps.some((ms) => ms >= HOTADD_RETRY_AFTER_CAP_MS), `the 30s Retry-After was converted to 'busy', never slept (got ${JSON.stringify(sleeps)})`);
});

test("10. flipBlocked — a concurrent roll's stolen tag throws and persists; restoring the doc lets the resume complete", async () => {
  const task = makeOpenMintTask();
  const taskFake = makeTaskPort(task);
  const docFake = makeDocPort(nonBootstrapDoc());
  const vaultFake = makeSeededVault();
  const oldSrvId = vaultFake.seed(ledgerUriId("pos-orders-a"), OLD_ORDERS_URI);
  const tenantFake = makeTenantPort({ dbPool: [oldOrdersEntry(oldSrvId)] });
  const sim = makeAtlasSim({ creatingCalls: 1 });
  const actorId = new Types.ObjectId().toHexString();
  const deps = makeDeps({ taskPort: taskFake.port, docPort: docFake.port, tenants: tenantFake.port, vault: vaultFake.vault, fetchImpl: sim.fetchImpl });

  const pump1 = await runHotAddDbCluster(input(String(task._id), actorId, true), deps);
  assert.equal(pump1.status, "creating", "pre-condition: stopped before flip");

  const original = docFake.getDoc()!;
  docFake.setDoc({
    ...original,
    ledgers: [...original.ledgers, { id: "pos-orders-hijack", uri: "mongodb+srv://hijack", tag: "A2", from: null, to: null, active: false }],
  });

  await assert.rejects(() => runHotAddDbCluster(input(String(task._id), actorId, false), deps), /concurrent roll won/);
  const t = taskFake.task;
  assert.equal(t.status, "in-progress", "resumable");
  assert.equal(t.run?.step, "cluster");
  assert.ok(t.run?.lastError?.includes("concurrent roll won"));

  docFake.setDoc(original);
  const res3 = await runHotAddDbCluster(input(String(task._id), actorId, false), deps);
  assert.equal(res3.status, "done");
});

test("11. close exactly-once — a done task returns closed-by-other; a losing close CAS never double-writes done", async () => {
  // a) after 'done', a further run returns 'closed-by-other'
  {
    const task = makeOpenMintTask();
    const taskFake = makeTaskPort(task);
    const docFake = makeDocPort(nonBootstrapDoc());
    const vaultFake = makeSeededVault();
    vaultFake.seed(ledgerUriId("pos-orders-a"), OLD_ORDERS_URI);
    const tenantFake = makeTenantPort({ dbPool: [oldOrdersEntry()] });
    const sim = makeAtlasSim();
    const actorId = new Types.ObjectId().toHexString();
    const deps = makeDeps({ taskPort: taskFake.port, docPort: docFake.port, tenants: tenantFake.port, vault: vaultFake.vault, fetchImpl: sim.fetchImpl });
    const res1 = await runHotAddDbCluster(input(String(task._id), actorId, true), deps);
    assert.equal(res1.status, "done");
    const res2 = await runHotAddDbCluster(input(String(task._id), actorId, false), deps);
    assert.equal(res2.status, "closed-by-other");
  }

  // b) the close CAS returns false (a stale-lease pump loses the race to a successor
  //    that already fully re-ran and closed) → 'closed-by-other', never a second done write.
  {
    const task = makeOpenMintTask();
    const taskFake = makeTaskPort(task);
    const docFake = makeDocPort(nonBootstrapDoc());
    const vaultFake = makeSeededVault();
    vaultFake.seed(ledgerUriId("pos-orders-a"), OLD_ORDERS_URI);
    const tenantFake = makeTenantPort({ dbPool: [oldOrdersEntry()] });
    const sim = makeAtlasSim();
    const actorId = new Types.ObjectId().toHexString();
    const deps = makeDeps({ taskPort: taskFake.port, docPort: docFake.port, tenants: tenantFake.port, vault: vaultFake.vault, fetchImpl: sim.fetchImpl });
    taskFake.raceCloseAfterStepOnce("registry");
    const res = await runHotAddDbCluster(input(String(task._id), actorId, true), deps);
    assert.equal(res.status, "closed-by-other", "our own close CAS lost — status was already done");
    assert.equal(taskFake.task.status, "done", "exactly one done write happened (the simulated successor's)");
  }
});

test("12. dismissHotAddTask: open→dismissed, in-progress+live lease→run-in-flight, done→not-open", async () => {
  {
    const task = makeOpenMintTask();
    const taskFake = makeTaskPort(task);
    const out = await dismissHotAddTask(String(task._id), { taskPort: taskFake.port, now: () => FIXED_NOW });
    assert.equal(out, "dismissed");
    assert.equal(taskFake.task.status, "dismissed");
    assert.equal(taskFake.task.openKey, undefined);
  }
  {
    const task = makeOpenMintTask();
    task.status = "in-progress";
    task.run = { leaseToken: "runner-1", leaseUntil: new Date(FIXED_NOW + 60_000) };
    const taskFake = makeTaskPort(task);
    const out = await dismissHotAddTask(String(task._id), { taskPort: taskFake.port, now: () => FIXED_NOW });
    assert.equal(out, "run-in-flight");
    assert.equal(taskFake.task.status, "in-progress", "never dismissed while a run is in flight");
  }
  {
    const task = makeOpenMintTask();
    task.status = "done";
    const taskFake = makeTaskPort(task);
    const out = await dismissHotAddTask(String(task._id), { taskPort: taskFake.port, now: () => FIXED_NOW });
    assert.equal(out, "not-open");
  }
});

// ═══ Post-review fix wave regression pins (R1–R10, f38-hotadd-design.md) ════

/** R1: an ADVANCEABLE fake clock — now() returns a mutable value the test can
 *  push forward mid-pump, to pin budget-boundary behavior deterministically. */
function makeAdvanceableClock(start: number) {
  let t = start;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

test("R1: budget mid-flip — clock crosses the pump budget between 'cluster' and 'flip'; 'busy', step stays 'cluster', NO doc write; a fresh pump then completes", async () => {
  const clock = makeAdvanceableClock(FIXED_NOW);
  const task = makeOpenMintTask();
  const taskFake = makeTaskPort(task);
  const docFake = makeDocPort(nonBootstrapDoc());
  const vaultFake = makeSeededVault();
  const oldSrvId = vaultFake.seed(ledgerUriId("pos-orders-a"), OLD_ORDERS_URI);
  const tenantFake = makeTenantPort({ dbPool: [oldOrdersEntry(oldSrvId)] });
  const sim = makeAtlasSim({ creatingCalls: 0 }); // IDLE immediately — the cluster step completes within pump 1
  const actorId = new Types.ObjectId().toHexString();
  const deps = makeDeps({ taskPort: taskFake.port, docPort: docFake.port, tenants: tenantFake.port, vault: vaultFake.vault, fetchImpl: sim.fetchImpl });
  deps.now = clock.now;
  deps.retryOverrides = { ...deps.retryOverrides, now: clock.now };

  // Push the clock past the budget the instant 'cluster' is recorded as the
  // last-completed step — i.e. AFTER the cluster step body finished but
  // BEFORE the loop's next iteration checks the budget ahead of 'flip'.
  const rawSaveStep = taskFake.port.saveStep.bind(taskFake.port);
  taskFake.port.saveStep = async (taskId, runId, step) => {
    const ok = await rawSaveStep(taskId, runId, step);
    if (step === "cluster") clock.advance(HOTADD_PUMP_BUDGET_MS + 1_000);
    return ok;
  };

  const res = await runHotAddDbCluster(input(String(task._id), actorId, true), deps);
  assert.equal(res.status, "busy");
  assert.equal(res.step, "cluster", "run.step never advances past the last COMPLETED step");
  assert.equal(docFake.calls.applyUpdate, 0, "no doc write happened — the flip step body never ran");
  assert.equal(docFake.calls.insertDoc, 0);
  const t = taskFake.task;
  assert.equal(t.status, "in-progress");
  assert.equal(t.run?.step, "cluster");

  const res2 = await runHotAddDbCluster(input(String(task._id), actorId, false), deps);
  assert.equal(res2.status, "done", "a fresh pump (fresh deadline off the current clock) completes");
});

test("R2a: createM0 called exactly once total across the two-pump creating→done flow", async () => {
  const s = setupMintScenario();
  const pump1 = await runHotAddDbCluster(input(String(s.task._id), s.actorId, true), s.deps);
  assert.equal(pump1.status, "creating", "pre-condition: pump 1 stops at creating");
  const pump2 = await runHotAddDbCluster(input(String(s.task._id), s.actorId, false), s.deps);
  assert.equal(pump2.status, "done");
  assert.equal(s.sim.countOp("atlas.createM0"), 1, "R2: createM0 must never be re-called on resume — a re-call would silently re-create a cluster deleted externally");
});

test("R2b: unmasked 404 after m0Created is stamped — actionable 'deleted externally' error, not eternal 'creating'", async () => {
  const task = makeOpenMintTask();
  const taskFake = makeTaskPort(task);
  const docFake = makeDocPort(nonBootstrapDoc());
  const vaultFake = makeSeededVault();
  const oldSrvId = vaultFake.seed(ledgerUriId("pos-orders-a"), OLD_ORDERS_URI);
  const tenantFake = makeTenantPort({ dbPool: [oldOrdersEntry(oldSrvId)] });
  const sim = makeAtlasSim({ fail: { "atlas.getCluster": { times: 1, status: 404 } } });
  const actorId = new Types.ObjectId().toHexString();
  const deps = makeDeps({ taskPort: taskFake.port, docPort: docFake.port, tenants: tenantFake.port, vault: vaultFake.vault, fetchImpl: sim.fetchImpl });

  await assert.rejects(
    () => runHotAddDbCluster(input(String(task._id), actorId, true), deps),
    /deleted externally/,
  );

  const t = taskFake.task;
  assert.equal(t.status, "in-progress", "never closed");
  assert.equal(t.run?.step, "target", "the cluster step never recorded as completed");
  assert.equal(t.run?.target?.m0Created, true, "R2: m0Created WAS stamped before the 404 read — createM0 fired exactly once");
  assert.ok(t.run?.lastError?.includes("deleted externally"), "actionable error persisted, not a silent 'creating' loop");
  assert.equal(sim.countOp("atlas.createM0"), 1, "createM0 fired exactly once before the 404 was seen");
});

test("R3/A1: continuation pump never needs step-up — claimAllowed:false still advances an in-progress task normally", async () => {
  const s = setupMintScenario();
  const pump1 = await runHotAddDbCluster(input(String(s.task._id), s.actorId, true), s.deps);
  assert.equal(pump1.status, "creating", "pre-condition: claimed, mid-mint");
  const pump2 = await runHotAddDbCluster(input(String(s.task._id), s.actorId, false), s.deps);
  assert.equal(pump2.status, "done", "an in-progress continuation advances to completion with claimAllowed:false — step-up is a claim-only concern (A1)");
});

test("R5: single-pump completeness — IDLE on the very first getCluster completes in ONE invocation; the dbPool row carries BOTH orgId and projectId", async () => {
  const task = makeOpenMintTask();
  const taskFake = makeTaskPort(task);
  const docFake = makeDocPort(nonBootstrapDoc());
  const vaultFake = makeSeededVault();
  const oldSrvId = vaultFake.seed(ledgerUriId("pos-orders-a"), OLD_ORDERS_URI);
  const tenantFake = makeTenantPort({ dbPool: [oldOrdersEntry(oldSrvId)] });
  const sim = makeAtlasSim({ creatingCalls: 0 });
  const actorId = new Types.ObjectId().toHexString();
  const deps = makeDeps({ taskPort: taskFake.port, docPort: docFake.port, tenants: tenantFake.port, vault: vaultFake.vault, fetchImpl: sim.fetchImpl });

  const res = await runHotAddDbCluster(input(String(task._id), actorId, true), deps);
  assert.equal(res.status, "done", "R5: a single pump reaches 'done' when IDLE from the first getCluster");

  const newEntry = tenantFake.dbPool.find((c) => c.clusterName === "pos-orders-a2")!;
  assert.ok(newEntry.orgId, "R5: orgId must be present even in a single-pump run (in-memory target mutation, not a DB re-read)");
  assert.ok(newEntry.projectId, "R5: projectId must be present even in a single-pump run");
});

test("R6a: claim note — a plain mint claim's result.note carries the target summary", async () => {
  const s = setupMintScenario();
  const res = await runHotAddDbCluster(input(String(s.task._id), s.actorId, true), s.deps);
  assert.match(res.note ?? "", /mint pos-orders-a2/, "R6(a): result.note names the minted target");
});

test("R6b: claim note — a promote-guard-fallback (standby id collision) surfaces the planner note in result.note", async () => {
  const task = makeOpenMintTask();
  const taskFake = makeTaskPort(task);
  const STANDBY_URI = "mongodb+srv://pos_app:standbypw@host-pos-orders-b.mongodb.net/pos?retryWrites=true&w=majority";
  const docFake = makeDocPort({
    _id: CLUSTER_REGISTRY_ID,
    ledgers: [{ id: "pos-orders-a", uri: OLD_ORDERS_URI, tag: "A", from: null, to: null, active: true }],
    standby: [{ id: "pos-orders-b", uri: STANDBY_URI, tag: "B5" }],
  });
  const vaultFake = makeSeededVault();
  const oldSrvId = vaultFake.seed(ledgerUriId("pos-orders-a"), OLD_ORDERS_URI);
  // The standby id 'pos-orders-b' already lives in dbPool → A7 guard rejects
  // the promote and falls back to mint, but the planner's reason must survive.
  const tenantFake = makeTenantPort({ dbPool: [oldOrdersEntry(oldSrvId), { ...oldOrdersEntry(), clusterName: "pos-orders-b" }] });
  const sim = makeAtlasSim({ creatingCalls: 1 });
  const actorId = new Types.ObjectId().toHexString();
  const deps = makeDeps({ taskPort: taskFake.port, docPort: docFake.port, tenants: tenantFake.port, vault: vaultFake.vault, fetchImpl: sim.fetchImpl });

  const res = await runHotAddDbCluster(input(String(task._id), actorId, true), deps);
  assert.equal(res.status, "creating");
  const t = taskFake.task;
  assert.equal(t.run?.target?.mode, "mint", "the A7 guard fell back to mint");
  assert.match(res.note ?? "", /standby pos-orders-b ignored/, "R6(a): the promote-guard-fallback planner note reaches the owner via result.note");
});

test("R8: claimAllowed:false on an open task refuses with the machine-readable code 'needs-step-up'", async () => {
  const task = makeOpenMintTask();
  const taskFake = makeTaskPort(task);
  const deps = makeDeps({ taskPort: taskFake.port, docPort: makeDocPort(null).port, tenants: makeTenantPort().port, vault: makeSeededVault().vault, fetchImpl: makeAtlasSim().fetchImpl });
  const res = await runHotAddDbCluster(input(String(task._id), new Types.ObjectId().toHexString(), false), deps);
  assert.equal(res.status, "refused");
  assert.equal(res.code, "needs-step-up", "R8: the route maps 403 off this code, not off note text");
});

test("R4: a pre-claim reveal throw on an OPEN task persists a redacted run.lastError while the task stays 'open' (saveErrorUnclaimed)", async () => {
  const task = makeOpenMintTask();
  const taskFake = makeTaskPort(task);
  const vaultFake = makeSeededVault();
  // Any vault.reveal throw during the claim's primary-SRV reveal — before any
  // lease exists — must still surface, since the lease-fenced saveError can't
  // touch an unclaimed task.
  vaultFake.vault.reveal = async () => {
    throw new Error("connect ECONNREFUSED mongodb+srv://baduser:badpass@ghost-primary.mongodb.net:27017 - primary reveal failed");
  };
  const deps = makeDeps({ taskPort: taskFake.port, docPort: makeDocPort(null).port, tenants: makeTenantPort().port, vault: vaultFake.vault, fetchImpl: makeAtlasSim().fetchImpl });

  await assert.rejects(() => runHotAddDbCluster(input(String(task._id), new Types.ObjectId().toHexString(), true), deps));

  const t = taskFake.task;
  assert.equal(t.status, "open", "R4: a pre-claim throw must not flip the task to in-progress");
  assert.ok(t.run?.lastError, "R4: lastError persisted via saveErrorUnclaimed despite no lease existing yet");
  assert.ok(!t.run!.lastError!.includes("baduser:badpass"), "raw credential redacted");
  assert.ok(t.run!.lastError!.includes("***:***@"), "safeMessage's redaction marker present");
});
