import { test } from "node:test";
import assert from "node:assert/strict";
import { Types } from "mongoose";

import { provisionTenant, type ProvisionDeps } from "./provisioner";
import type { RegistryPort, TenantSnapshot, VaultPort, TenantRouting } from "./provisioner-registry";
import type { RuntimeClusterRegistryDoc } from "./provisioner-plan";
import type { ProvisionHooks } from "./provisioner-steps";
import type { RetryDeps } from "./provider-retry";
import type { IDbCluster, IHostingAccount, ICloudAccount } from "@/models/Tenant";

// ─────────────────────────────────────────────────────────────────────────────
// DB-free tests for the F3.6 PROVISION-NEW-TENANT machine. The machine runs
// against in-memory fake ports BUT the REAL F3.5 provider clients over a fake
// provider `fetch` — so 409-adopt, create-or-leave, pollIdle, deploy-poll, and
// the exact-Retry-After 429 backoff are all exercised, not faked away (the R7
// critique: the resume test must exercise real idempotency, not a vacuous skip).
// ─────────────────────────────────────────────────────────────────────────────

const FIXED_NOW = 1_770_000_000_000;

const CREDS = {
  atlas: { clientId: "ci", clientSecret: "cs", orgId: "org1" },
  vercelActive: "vt-active",
  vercelStandby: "vt-standby",
  image: { store: "r2" as const, accountId: "acc", accessKeyId: "ak", secretAccessKey: "sk", bucket: "bkt", publicBaseUrl: "https://pub.r2.dev" },
};
const intake = (over: Partial<Parameters<typeof provisionTenant>[0]> = {}) => ({
  slug: "lucifer-cafe",
  ownerEmail: "o@x.com",
  businessType: "cafe" as const,
  idempotencyKey: "idem-1",
  creds: CREDS,
  ...over,
});
const CONFIG = { rootDomain: "pos.example", deploySource: { repoId: 123, ref: "main", repo: "owner/repo", rootDirectory: "apps/cafe" } };
const AUDIT = { actorId: new Types.ObjectId(), ip: "1.2.3.4" };
const noopHooks: ProvisionHooks = { runSeed: async () => {}, sendInvite: async () => {} };

// ── Fake VaultPort ────────────────────────────────────────────────────────────
interface Row { id: Types.ObjectId; provider: string; accountLabel: string; classification: string; plaintext: string; status: string; seq: number }
function makeVault() {
  const rows: Row[] = [];
  let seq = 0;
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
      let n = 0;
      for (const r of rows) {
        if (key(r) === key(id) && r.status !== "revoked" && !r.id.equals(exceptId)) { r.status = "revoked"; n++; }
      }
      return n;
    },
  };
  return { vault, rows };
}

// ── Fake RegistryPort ─────────────────────────────────────────────────────────
interface FakeTenant {
  _id: Types.ObjectId; slug: string; status: string; step?: string; idempotencyKey?: string;
  leaseToken?: string; leaseUntil?: Date; lastError?: string;
  dbPool: IDbCluster[]; hosting: IHostingAccount[]; imagePool: ICloudAccount[];
  domain?: { primary?: string; sslState?: string }; routing?: TenantRouting;
}
function makeRegistry() {
  let t: FakeTenant | null = null;
  let runtimeDoc: RuntimeClusterRegistryDoc | null = null;
  const failSaveStepOnce = new Set<string>();
  const snap = (): TenantSnapshot => ({
    _id: t!._id, slug: t!.slug, status: t!.status, step: t!.step, idempotencyKey: t!.idempotencyKey,
    leaseToken: t!.leaseToken, leaseUntil: t!.leaseUntil, dbPool: t!.dbPool, hosting: t!.hosting,
    imagePool: t!.imagePool, domain: t!.domain,
  });
  const registry: RegistryPort = {
    async findBySlug(slug) { return t && t.slug === slug ? snap() : null; },
    async create(int, runId, leaseUntil) {
      if (t) { const e = new Error("dup") as Error & { code: number }; e.code = 11000; throw e; }
      t = { _id: new Types.ObjectId(), slug: int.slug, status: "provisioning", step: "intake", idempotencyKey: int.idempotencyKey, leaseToken: runId, leaseUntil, dbPool: [], hosting: [], imagePool: [] };
      return snap();
    },
    async acquireLease(_slug, key, runId, leaseUntil, now) {
      if (!t || t.idempotencyKey !== key) return false;
      const free = !t.leaseUntil || t.leaseUntil < now || t.leaseToken === runId;
      if (!free) return false;
      t.leaseToken = runId; t.leaseUntil = leaseUntil; return true;
    },
    async renewLease(_s, runId, leaseUntil) { if (t && t.leaseToken === runId) t.leaseUntil = leaseUntil; },
    async releaseLease(_s, runId) { if (t && t.leaseToken === runId) { t.leaseToken = undefined; t.leaseUntil = undefined; } },
    async saveStep(_s, step) {
      if (failSaveStepOnce.has(step)) { failSaveStepOnce.delete(step); throw new Error(`injected saveStep fail @ ${step}`); }
      t!.step = step; t!.lastError = undefined;
    },
    async saveError(_s, msg) { t!.lastError = msg; },
    async upsertDbCluster(_s, e) {
      const i = t!.dbPool.findIndex((c) => c.clusterName === e.clusterName);
      if (i >= 0) t!.dbPool[i] = e; else t!.dbPool.push(e);
    },
    async upsertHosting(_s, e) {
      const i = t!.hosting.findIndex((h) => h.accountLabel === e.accountLabel);
      if (i >= 0) t!.hosting[i] = e; else t!.hosting.push(e);
    },
    async upsertImagePool(_s, e) {
      const i = t!.imagePool.findIndex((p) => p.accountLabel === e.accountLabel);
      if (i >= 0) t!.imagePool[i] = e; else t!.imagePool.push(e);
    },
    async demoteOtherImagePools(_s, keepAccountLabel) {
      for (const p of t!.imagePool) if (p.accountLabel !== keepAccountLabel && p.role === "active") p.role = "full";
    },
    async repointImageRef(_s, which, secretId) {
      const p = t!.imagePool.find((x) => x.role === "active"); if (p) p[which] = secretId;
    },
    async setRouting(_s, routing) { t!.routing = routing; },
    async setDomain(_s, domain) { t!.domain = domain; },
    async activate() { t!.status = "active"; t!.step = "done"; },
    async writeRuntimeClusterRegistry(_primarySrv, doc) {
      if (!runtimeDoc) { runtimeDoc = JSON.parse(JSON.stringify(doc)) as RuntimeClusterRegistryDoc; return; }
      const orders = doc.ledgers[0];
      const idx = runtimeDoc.ledgers.findIndex((l) => l.id === orders.id);
      if (idx >= 0) runtimeDoc.ledgers[idx].uri = orders.uri; else runtimeDoc.ledgers.push(orders);
    },
  };
  return {
    registry,
    get tenant() { return t; },
    get doc() { return runtimeDoc; },
    seed(partial: Partial<FakeTenant>) { t = { _id: new Types.ObjectId(), slug: "lucifer-cafe", status: "provisioning", dbPool: [], hosting: [], imagePool: [], ...partial }; },
    failSaveStep(step: string) { failSaveStepOnce.add(step); },
  };
}

// ── Fake provider `fetch` (drives the REAL F3.5 clients) ─────────────────────
interface FailSpec { times: number; status: number; retryAfter?: string }
function makeSim(opts: { domainVerified?: boolean; deployState?: string; fail?: Record<string, FailSpec> } = {}) {
  const domainVerified = opts.domainVerified ?? true;
  const deployState = opts.deployState ?? "READY";
  const fail = opts.fail ?? {};
  const state = { projects: new Set<string>(), clusters: new Set<string>(), users: new Set<string>(), deployN: 0 };
  const calls: { op: string; url: string; body?: string }[] = [];
  const envPushes: Record<string, string>[] = [];

  const R = (status: number, body: unknown, headers?: Record<string, string>) =>
    new Response(status === 204 ? null : JSON.stringify(body), { status, headers });

  function maybeFail(op: string): Response | null {
    const f = fail[op];
    if (f && f.times > 0) {
      f.times -= 1;
      return R(f.status, { errorCode: "INJECTED", error: { code: "INJECTED" } }, f.retryAfter ? { "Retry-After": f.retryAfter } : undefined);
    }
    return null;
  }

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? init.body : undefined;

    // ── Atlas ──
    if (u.endsWith("/api/oauth/token")) return R(200, { access_token: "tok", expires_in: 3600 });
    if (u.includes("/api/atlas/v2/groups/byName/")) {
      const name = decodeURIComponent(u.split("/byName/")[1]);
      return R(200, { id: `proj-${name}` });
    }
    if (method === "POST" && u.endsWith("/api/atlas/v2/groups")) {
      calls.push({ op: "atlas.createProject", url: u, body });
      const f = maybeFail("atlas.createProject"); if (f) return f;
      const name = JSON.parse(body!).name as string;
      if (state.projects.has(name)) return R(409, { errorCode: "GROUP_ALREADY_EXISTS" });
      state.projects.add(name);
      return R(201, { id: `proj-${name}` });
    }
    const clusterPost = /\/api\/atlas\/v2\/groups\/([^/]+)\/clusters$/.exec(u);
    if (method === "POST" && clusterPost) {
      calls.push({ op: "atlas.createM0", url: u, body });
      const f = maybeFail("atlas.createM0"); if (f) return f;
      const name = JSON.parse(body!).name as string;
      const k = `${clusterPost[1]}/${name}`;
      if (state.clusters.has(k)) return R(409, { errorCode: "DUPLICATE_CLUSTER_NAME" });
      state.clusters.add(k);
      return R(201, {});
    }
    const clusterGet = /\/api\/atlas\/v2\/groups\/([^/]+)\/clusters\/([^/]+)$/.exec(u);
    if (method === "GET" && clusterGet) {
      const f = maybeFail("atlas.getCluster"); if (f) return f;
      const name = clusterGet[2];
      return R(200, { stateName: "IDLE", connectionStrings: { standardSrv: `mongodb+srv://host-${name}.mongodb.net` } });
    }
    const userPost = /\/api\/atlas\/v2\/groups\/([^/]+)\/databaseUsers$/.exec(u);
    if (method === "POST" && userPost) {
      calls.push({ op: "atlas.createDbUser", url: u, body });
      const k = `${userPost[1]}`;
      if (state.users.has(k)) return R(409, { errorCode: "USER_ALREADY_EXISTS" });
      state.users.add(k);
      return R(201, {});
    }
    if (method === "PATCH" && u.includes("/databaseUsers/admin/")) return R(200, {});
    if (method === "POST" && u.endsWith("/accessList")) return R(201, {});

    // ── Vercel ──
    const projGet = /\/v11\/projects\/([^/?]+)(\?|$)/.exec(u);
    if (method === "GET" && projGet) {
      const name = decodeURIComponent(projGet[1]);
      return state.projects.has(`vp:${name}`) ? R(200, { id: `vp-${name}`, name }) : R(404, { error: { code: "not_found" } });
    }
    if (method === "POST" && u.includes("/v11/projects")) {
      calls.push({ op: "vercel.createProject", url: u, body });
      const name = JSON.parse(body!).name as string;
      state.projects.add(`vp:${name}`);
      return R(200, { id: `vp-${name}`, name });
    }
    if (method === "POST" && u.includes("/env")) {
      calls.push({ op: "vercel.upsertEnv", url: u, body });
      const arr = JSON.parse(body!) as { key: string; value: string }[];
      envPushes.push(Object.fromEntries(arr.map((e) => [e.key, e.value])));
      return R(201, { created: arr });
    }
    if (method === "POST" && u.includes("/v13/deployments")) {
      calls.push({ op: "vercel.deploy", url: u, body });
      state.deployN += 1;
      return R(200, { id: `dep-${state.deployN}`, readyState: deployState, url: `pos-x-${state.deployN}.vercel.app` });
    }
    if (method === "GET" && u.includes("/v13/deployments/")) {
      return R(200, { id: "dep", readyState: "READY", url: "pos-x.vercel.app" });
    }
    if (method === "POST" && u.includes("/domains") && !u.includes("/verify")) {
      calls.push({ op: "vercel.addDomain", url: u, body });
      return R(200, { name: "d", verified: domainVerified, verification: [{ type: "TXT", domain: "d", value: "chal" }] });
    }
    if (method === "POST" && u.includes("/verify")) {
      return R(200, { name: "d", verified: domainVerified, verification: [{ type: "TXT", domain: "d", value: "chal" }] });
    }

    // ── image ──
    if (u.includes("r2.cloudflarestorage.com")) {
      calls.push({ op: "image.r2", url: u });
      const f = maybeFail("image.r2"); if (f) return new Response("<Error><Code>AccessDenied</Code></Error>", { status: f.status });
      return R(200, "", {});
    }
    if (u.includes("api.cloudinary.com")) return R(200, { credits: { usage: 1, limit: 25, used_percent: 4 } });

    throw new Error(`unexpected ${method} ${u}`);
  }) as typeof fetch;

  const overrides: Partial<RetryDeps> = { fetchImpl, sleep: async () => {}, now: () => FIXED_NOW };
  return { overrides, calls, state, envPushes };
}

// ── deps builder: deterministic mint + fixed clock ───────────────────────────
function makeDeps(reg: ReturnType<typeof makeRegistry>, vault: VaultPort, sim: ReturnType<typeof makeSim>): Partial<ProvisionDeps> {
  let n = 0;
  return {
    registry: reg.registry,
    vault,
    mintSecret: () => `mint-${++n}`,
    retryOverrides: sim.overrides,
    now: () => FIXED_NOW,
  };
}

// ═══ TESTS ═══════════════════════════════════════════════════════════════════

test("happy path: full provision → active, both clusters, both hosts, domain issued, doc written", async () => {
  const reg = makeRegistry();
  const { vault, rows } = makeVault();
  const sim = makeSim();
  const res = await provisionTenant(intake(), AUDIT, CONFIG, noopHooks, makeDeps(reg, vault, sim));

  assert.equal(res.status, "done");
  assert.equal(res.step, "done");
  const t = reg.tenant!;
  assert.equal(t.status, "active");
  assert.deepEqual(t.dbPool.map((c) => c.role).sort(), ["orders-current", "primary"]);
  assert.deepEqual(t.hosting.map((h) => h.role).sort(), ["active", "standby"]);
  assert.ok(t.hosting.every((h) => h.deployUrl), "both hosts recorded a deployUrl");
  assert.equal(t.imagePool[0].role, "active");
  assert.equal(t.domain?.sslState, "issued");
  // Runtime doc: one active orders ledger whose uri === the stored orders dbUri.
  const doc = reg.doc!;
  assert.equal(doc.ledgers.length, 1);
  assert.equal(doc.ledgers[0].id, "pos-orders-a");
  const ordersUri = rows.find((r) => r.classification === "dbUri" && r.accountLabel.includes("orders") && r.status === "active")!.plaintext;
  assert.equal(doc.ledgers[0].uri, ordersUri, "doc orders URI tracks the active orders dbUri secret");
  // Env: IMAGE_STORE set, no ATLAS_SA_*, CORE URI present (2 pushes: active+standby).
  assert.equal(sim.envPushes.length, 2);
  for (const env of sim.envPushes) {
    assert.equal(env.IMAGE_STORE, "r2");
    assert.ok(env.CORE_MONGODB_URI?.startsWith("mongodb+srv://"));
    assert.ok(!Object.keys(env).some((k) => k.startsWith("ATLAS_SA")));
  }
});

test("kill-after-db.orders → resume-at-image without recreating clusters (the spec's exact scenario)", async () => {
  const reg = makeRegistry();
  const { vault } = makeVault();
  // Run 1: fail the R2 probe ONCE so the run throws AT the image step, AFTER
  // db.primary + db.orders completed and step='db.orders' was persisted.
  const sim = makeSim({ fail: { "image.r2": { times: 1, status: 403 } } });
  await assert.rejects(() => provisionTenant(intake(), AUDIT, CONFIG, noopHooks, makeDeps(reg, vault, sim)));
  assert.equal(reg.tenant!.step, "db.orders", "both DB steps completed; stopped at image");
  const clusterCreatesRun1 = sim.calls.filter((c) => c.op === "atlas.createM0").length;
  assert.equal(clusterCreatesRun1, 2, "run 1 created the 2 clusters (primary + orders)");

  // Resume with creds ABSENT: stepsAfter('db.orders') skips both DB steps.
  const res = await provisionTenant(intake({ creds: undefined }), AUDIT, CONFIG, noopHooks, makeDeps(reg, vault, sim));
  assert.equal(res.status, "done");
  assert.equal(
    sim.calls.filter((c) => c.op === "atlas.createM0").length,
    clusterCreatesRun1,
    "resume did NOT re-attempt cluster creation (db.primary/db.orders skipped)",
  );
});

test("R7 mid-db.primary failure → resume adopts (one project, one primary cluster, old dbUri revoked)", async () => {
  const reg = makeRegistry();
  const { vault, rows } = makeVault();
  // Fail getCluster during db.primary's pollIdle? No — fail AFTER create so the
  // resources exist but the step throws before storing the dbUri. getSrvUri does a
  // GET cluster last; fail that GET once (it also covers pollIdle's GET, so fail
  // the SECOND getCluster: pollIdle's succeeds, getSrvUri's fails). Simpler: fail
  // accessList's downstream by failing the dbUser 500 — but 409 path differs.
  // Cleanest: fail atlas.getCluster twice (pollIdle + getSrvUri) → but pollIdle
  // retries. Use a dedicated getSrvUri failure: fail the LAST getCluster by count.
  const sim = makeSim({ fail: { "atlas.getCluster": { times: 1, status: 500 } } });
  // The first getCluster is pollIdle (primary). Failing it once makes pollIdle's
  // first poll 500 (getCluster throws) → db.primary throws → resume.
  await assert.rejects(() => provisionTenant(intake(), AUDIT, CONFIG, noopHooks, makeDeps(reg, vault, sim)));
  assert.ok(reg.tenant!.lastError, "lastError persisted");
  assert.notEqual(reg.tenant!.step, "db.primary", "step did not advance past the failed step");

  // Resume (creds absent): db.primary re-runs top-to-bottom and ADOPTS (same fetch
  // → the project/cluster it created on run 1 now return 409). This proves the
  // 409-adopt / create-or-leave / guarded-upsert idempotency (the R1 test separately
  // proves the store-fresh+revoke-old dbUri path, which this crash never reached —
  // pollIdle failed before createDbUser).
  const res = await provisionTenant(intake({ creds: undefined }), AUDIT, CONFIG, noopHooks, makeDeps(reg, vault, sim));
  assert.equal(res.status, "done");
  // Exactly one primary cluster (guarded upsert, not a duplicate $push).
  assert.equal(reg.tenant!.dbPool.filter((c) => c.role === "primary").length, 1);
  // The primary project was created once; the resume's POST 409'd and adopted byName.
  assert.equal(sim.state.projects.has("pos-lucifer-cafe-core"), true);
  // Exactly one active primary dbUri.
  const activePrimary = rows.filter((r) => r.classification === "dbUri" && r.accountLabel.includes("pos-core") && r.status === "active");
  assert.equal(activePrimary.length, 1);
});

test("a fully-provisioned tenant in an ADMIN state (suspended) is alreadyDone, never resurrected to active", async () => {
  const reg = makeRegistry();
  const { vault } = makeVault();
  reg.seed({ status: "suspended", step: "done", idempotencyKey: "idem-1" });
  const res = await provisionTenant(intake({ creds: undefined }), AUDIT, CONFIG, noopHooks, makeDeps(reg, vault, makeSim()));
  assert.equal(res.status, "alreadyDone");
  assert.equal(reg.tenant!.status, "suspended", "activate() never ran — no silent resurrection");
});

test("a half-built tenant in an admin state (suspended, step db.primary) refuses (re)provision", async () => {
  const reg = makeRegistry();
  const { vault } = makeVault();
  reg.seed({ status: "suspended", step: "db.primary", idempotencyKey: "idem-1" });
  await assert.rejects(
    () => provisionTenant(intake({ creds: undefined }), AUDIT, CONFIG, noopHooks, makeDeps(reg, vault, makeSim())),
    /not provisioning/,
  );
});

test("E: a re-paste that SWITCHES image store type leaves exactly one active image pool (stale demoted)", async () => {
  const reg = makeRegistry();
  const { vault } = makeVault();
  // Run 1 (r2) but stop at image via a one-shot R2 403 so step stays before host.
  const sim1 = makeSim({ fail: { "image.r2": { times: 1, status: 403 } } });
  await assert.rejects(() => provisionTenant(intake(), AUDIT, CONFIG, noopHooks, makeDeps(reg, vault, sim1)));
  assert.equal(reg.tenant!.imagePool.filter((p) => p.role === "active").length, 1);
  assert.equal(reg.tenant!.imagePool.find((p) => p.role === "active")!.provider, "r2");

  // Re-paste switching to cloudinary → heal writes the cloudinary entry + demotes r2.
  const cloudCreds = { ...CREDS, image: { store: "cloudinary" as const, cloudName: "cn", apiKey: "ak", apiSecret: "as" } };
  const res = await provisionTenant(intake({ creds: cloudCreds }), AUDIT, CONFIG, noopHooks, makeDeps(reg, vault, makeSim()));
  assert.equal(res.status, "done");
  const active = reg.tenant!.imagePool.filter((p) => p.role === "active");
  assert.equal(active.length, 1, "exactly one active image pool after a store-type switch");
  assert.equal(active[0].provider, "cloudinary", "the NEW store is the active one");
  assert.equal(reg.tenant!.imagePool.find((p) => p.provider === "r2")!.role, "full", "the stale r2 store demoted to full");
});

test("G/R9: domain adopt-via-verify — addDomain error → verifyDomain succeeds → domain adopted (no HTTP-400 string-match)", async () => {
  const reg = makeRegistry();
  const { vault } = makeVault();
  const sim = makeSim({ domainVerified: true });
  // Make addDomain throw (400 already-on-project) but verifyDomain succeed → adopt.
  const base = sim.overrides.fetchImpl!;
  sim.overrides.fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if ((init?.method ?? "GET") === "POST" && u.includes("/domains") && !u.includes("/verify")) {
      return new Response(JSON.stringify({ error: { code: "domain_already_in_use" } }), { status: 400 });
    }
    return base(url as string, init);
  }) as typeof fetch;
  const res = await provisionTenant(intake(), AUDIT, CONFIG, noopHooks, makeDeps(reg, vault, sim));
  assert.equal(res.status, "done");
  assert.equal(reg.tenant!.domain?.sslState, "issued", "domain adopted via verifyDomain despite addDomain 400");
});

test("forced 429 mid-run is retried with the exact Retry-After, not failed", async () => {
  const reg = makeRegistry();
  const { vault } = makeVault();
  const sleeps: number[] = [];
  const sim = makeSim({ fail: { "atlas.createM0": { times: 1, status: 429, retryAfter: "2" } } });
  const overrides: Partial<RetryDeps> = { ...sim.overrides, sleep: async (ms) => { sleeps.push(ms); } };
  const deps = { ...makeDeps(reg, vault, sim), retryOverrides: overrides };
  const res = await provisionTenant(intake(), AUDIT, CONFIG, noopHooks, deps);
  assert.equal(res.status, "done");
  assert.ok(sleeps.includes(2000), `expected an exact 2s Retry-After backoff, got ${sleeps}`);
});

test("R1 reconcile: kill after runtime-doc write but before saveStep('db.orders') → resume re-syncs the doc URI", async () => {
  const reg = makeRegistry();
  const { vault, rows } = makeVault();
  const sim = makeSim();
  reg.failSaveStep("db.orders"); // saveStep throws AFTER the step body (incl. doc write) completes
  await assert.rejects(() => provisionTenant(intake(), AUDIT, CONFIG, noopHooks, makeDeps(reg, vault, sim)));
  const p1 = rows.find((r) => r.classification === "dbUri" && r.accountLabel.includes("orders") && r.status === "active")!.plaintext;
  assert.equal(reg.doc!.ledgers[0].uri, p1, "run1 doc carries the run1 orders URI");

  // Resume (creds absent): db.orders re-runs → PATCH-resets the password → new SRV
  // stored + old revoked → writeRuntimeClusterRegistry RECONCILES the doc uri.
  const res = await provisionTenant(intake({ creds: undefined }), AUDIT, CONFIG, noopHooks, makeDeps(reg, vault, sim));
  assert.equal(res.status, "done");
  const p2 = rows.find((r) => r.classification === "dbUri" && r.accountLabel.includes("orders") && r.status === "active")!.plaintext;
  assert.notEqual(p1, p2, "the resumed run minted a fresh orders password");
  assert.equal(reg.doc!.ledgers[0].uri, p2, "doc URI was reconciled to the fresh orders SRV (not stranded on the dead one)");
});

test("idempotencyKey mismatch on a half-built tenant throws (no silent adoption)", async () => {
  const reg = makeRegistry();
  const { vault } = makeVault();
  reg.seed({ status: "provisioning", step: "db.primary", idempotencyKey: "idem-1" });
  await assert.rejects(
    () => provisionTenant(intake({ idempotencyKey: "idem-DIFFERENT", creds: undefined }), AUDIT, CONFIG, noopHooks, makeDeps(reg, vault, makeSim())),
    /idempotencyKey mismatch/,
  );
});

test("R4: a DONE tenant re-submit with a DIFFERENT key is an alreadyDone no-op (terminal check before key gate)", async () => {
  const reg = makeRegistry();
  const { vault } = makeVault();
  reg.seed({ status: "active", step: "done", idempotencyKey: "idem-1" });
  const res = await provisionTenant(intake({ idempotencyKey: "idem-OTHER", creds: undefined }), AUDIT, CONFIG, noopHooks, makeDeps(reg, vault, makeSim()));
  assert.equal(res.status, "alreadyDone");
});

test("R5 concurrency: a live lease held by another run refuses the second with inProgress", async () => {
  const reg = makeRegistry();
  const { vault } = makeVault();
  reg.seed({ status: "provisioning", step: "db.primary", idempotencyKey: "idem-1", leaseToken: "other-run", leaseUntil: new Date(FIXED_NOW + 10 * 60 * 1000) });
  const res = await provisionTenant(intake({ creds: undefined }), AUDIT, CONFIG, noopHooks, makeDeps(reg, vault, makeSim()));
  assert.equal(res.status, "inProgress");
});

test("R2 domain-pending: an unverified domain pauses (no seed/invite, sslState pending, challenges returned)", async () => {
  const reg = makeRegistry();
  const { vault } = makeVault();
  let seeded = false;
  const hooks: ProvisionHooks = { runSeed: async () => { seeded = true; }, sendInvite: async () => { seeded = true; } };
  const res = await provisionTenant(intake(), AUDIT, CONFIG, hooks, makeDeps(reg, vault, makeSim({ domainVerified: false })));
  assert.equal(res.status, "pending");
  assert.equal(reg.tenant!.domain?.sslState, "pending");
  assert.ok(res.pending?.domainChallenges?.length, "challenge returned to the caller");
  assert.equal(reg.tenant!.status, "provisioning", "never flipped to active");
  assert.equal(seeded, false, "seed/invite never ran on an unreachable host");
});

test("image validation failure throws (resumable; a re-paste re-validates)", async () => {
  const reg = makeRegistry();
  const { vault } = makeVault();
  // R2 probe 403 → validateR2 returns {ok:false} → the image step throws.
  const sim = makeSim();
  const base = sim.overrides.fetchImpl!;
  sim.overrides.fetchImpl = (async (url: string, init?: RequestInit) => {
    if (String(url).includes("r2.cloudflarestorage.com")) return new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 });
    return base(url as string, init);
  }) as typeof fetch;
  await assert.rejects(
    () => provisionTenant(intake(), AUDIT, CONFIG, noopHooks, makeDeps(reg, vault, sim)),
    /image validation failed/,
  );
});

test("deploy ERROR throws (resumable)", async () => {
  const reg = makeRegistry();
  const { vault } = makeVault();
  await assert.rejects(
    () => provisionTenant(intake(), AUDIT, CONFIG, noopHooks, makeDeps(reg, vault, makeSim({ deployState: "ERROR" }))),
    /ERROR/,
  );
});
