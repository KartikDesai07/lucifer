// Dev verify script — prints pass/fail lines only, never a URI/KEK/secret value.
// (The provisioner no-console gate covers lib/, not scripts/.)
import assert from "node:assert/strict";

import mongoose, { Types } from "mongoose";

import { connectDB } from "../lib/db";
import { AuditLog } from "../models/AuditLog";
import { Secret } from "../models/Secret";
import { Tenant } from "../models/Tenant";
import { createMongooseRegistry, createVaultPort } from "../lib/provisioner-registry";
import { provisionTenant, type ProvisionDeps } from "../lib/provisioner";
import { dbUriId } from "../lib/provisioner-plan";
import type { ProvisionHooks } from "../lib/provisioner-steps";
import type { RetryDeps } from "../lib/provider-retry";

// ─────────────────────────────────────────────────────────────────────────────
// LIVE F3.6 provisioner legs on a SCRATCH db (the F3.2/F3.4 live-leg precedent).
// Proves the DB-TRUTH layer the DB-free tests can't: real Mongoose Tenant upserts
// (guarded $push / positional $set), the real acquireLease CAS, the real
// writeRuntimeClusterRegistry RECONCILE against a real collection, and the real
// audited vault (Secret rows + AuditLog). Providers are FAKED (the live-PROVIDER
// legs stay owner-blocked — no real Atlas SA / Vercel token). Prefix-guarded to
// `hubreg_verify`; the runtime doc is written to a sibling scratch db that is
// dropped afterwards. Run: `npm run verify:provisioner-live` with HUB_MONGODB_URI
// (→ hubreg_verify) + HUB_KEK set.
// ─────────────────────────────────────────────────────────────────────────────

const SCRATCH_DB = "hubreg_verify";
const RUNTIME_DB = "hubreg_verify_runtime";

const CREDS = {
  atlas: { clientId: "ci", clientSecret: "cs", orgId: "org1" },
  vercelActive: "vt-active",
  vercelStandby: "vt-standby",
  image: { store: "r2" as const, accountId: "acc", accessKeyId: "ak", secretAccessKey: "sk", bucket: "bkt", publicBaseUrl: "https://pub.r2.dev" },
};
const CONFIG = { rootDomain: "pos.example", deploySource: { repoId: 1, ref: "main", repo: "o/r", rootDirectory: "apps/cafe" } };
const HOOKS: ProvisionHooks = { runSeed: async () => {}, sendInvite: async () => {} };
const FIXED_NOW = 1_770_000_000_000;

interface FailSpec { times: number; status: number; retryAfter?: string }
function makeSim(opts: { domainVerified?: boolean; fail?: Record<string, FailSpec> } = {}) {
  const domainVerified = opts.domainVerified ?? true;
  const fail = opts.fail ?? {};
  const state = { projects: new Set<string>(), clusters: new Set<string>(), users: new Set<string>(), deployN: 0 };
  const calls: string[] = [];
  const R = (status: number, body: unknown, headers?: Record<string, string>) =>
    new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
  const maybeFail = (op: string): Response | null => {
    const f = fail[op];
    if (f && f.times > 0) { f.times -= 1; return R(f.status, { errorCode: "INJECTED", error: { code: "INJECTED" } }, f.retryAfter ? { "Retry-After": f.retryAfter } : undefined); }
    return null;
  };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = String(url); const m = init?.method ?? "GET"; const b = typeof init?.body === "string" ? init.body : undefined;
    if (u.endsWith("/api/oauth/token")) return R(200, { access_token: "tok", expires_in: 3600 });
    if (u.includes("/groups/byName/")) return R(200, { id: `proj-${decodeURIComponent(u.split("/byName/")[1])}` });
    if (m === "POST" && u.endsWith("/api/atlas/v2/groups")) { calls.push("atlas.createProject"); const n = JSON.parse(b!).name as string; if (state.projects.has(n)) return R(409, { errorCode: "DUP" }); state.projects.add(n); return R(201, { id: `proj-${n}` }); }
    const cp = /\/groups\/([^/]+)\/clusters$/.exec(u); if (m === "POST" && cp) { calls.push("atlas.createM0"); const n = JSON.parse(b!).name as string; const f = maybeFail("atlas.createM0"); if (f) return f; const k = `${cp[1]}/${n}`; if (state.clusters.has(k)) return R(409, { errorCode: "DUP" }); state.clusters.add(k); return R(201, {}); }
    const cg = /\/groups\/([^/]+)\/clusters\/([^/]+)$/.exec(u); if (m === "GET" && cg) { const f = maybeFail("atlas.getCluster"); if (f) return f; return R(200, { stateName: "IDLE", connectionStrings: { standardSrv: `mongodb+srv://host-${cg[2]}.mongodb.net` } }); }
    const up = /\/groups\/([^/]+)\/databaseUsers$/.exec(u); if (m === "POST" && up) { const k = up[1]; if (state.users.has(k)) return R(409, { errorCode: "DUP" }); state.users.add(k); return R(201, {}); }
    if (m === "PATCH" && u.includes("/databaseUsers/admin/")) return R(200, {});
    if (m === "POST" && u.endsWith("/accessList")) return R(201, {});
    const pg = /\/v11\/projects\/([^/?]+)(\?|$)/.exec(u); if (m === "GET" && pg) { const n = decodeURIComponent(pg[1]); return state.projects.has(`vp:${n}`) ? R(200, { id: `vp-${n}`, name: n }) : R(404, { error: { code: "nf" } }); }
    if (m === "POST" && u.includes("/v11/projects")) { const n = JSON.parse(b!).name as string; state.projects.add(`vp:${n}`); return R(200, { id: `vp-${n}`, name: n }); }
    if (m === "POST" && u.includes("/env")) return R(201, { created: JSON.parse(b!) });
    if (m === "POST" && u.includes("/v13/deployments")) { state.deployN += 1; return R(200, { id: `dep-${state.deployN}`, readyState: "READY", url: `pos-x-${state.deployN}.vercel.app` }); }
    if (m === "GET" && u.includes("/v13/deployments/")) return R(200, { id: "dep", readyState: "READY", url: "pos-x.vercel.app" });
    if (m === "POST" && u.includes("/domains") && !u.includes("/verify")) return R(200, { name: "d", verified: domainVerified, verification: [{ type: "TXT", domain: "d", value: "c" }] });
    if (m === "POST" && u.includes("/verify")) return R(200, { name: "d", verified: domainVerified, verification: [{ type: "TXT", domain: "d", value: "c" }] });
    if (u.includes("r2.cloudflarestorage.com")) { const f = maybeFail("image.r2"); if (f) return new Response("<Error><Code>AccessDenied</Code></Error>", { status: f.status }); return R(200, "", {}); }
    if (u.includes("api.cloudinary.com")) return R(200, { credits: { usage: 1, limit: 25, used_percent: 4 } });
    throw new Error(`unexpected ${m} ${u}`);
  }) as typeof fetch;
  const sleeps: number[] = [];
  const overrides: Partial<RetryDeps> = { fetchImpl, sleep: async (ms) => { sleeps.push(ms); }, now: () => FIXED_NOW };
  return { overrides, calls, state, sleeps };
}

async function main() {
  const uri = process.env.HUB_MONGODB_URI ?? "";
  const dbInUri = uri.split("?")[0].split("/").pop();
  assert.equal(dbInUri, SCRATCH_DB, `refusing: URI db must be '${SCRATCH_DB}'`);
  assert.ok(process.env.HUB_KEK, "HUB_KEK must be set (a throwaway 32-byte key)");

  await connectDB();
  assert.equal(mongoose.connection.name, SCRATCH_DB, "connected to the scratch db");
  console.log(`✓ connected to scratch db '${SCRATCH_DB}'`);

  // Runtime clusterRegistry doc goes to a sibling scratch db on the SAME server.
  // openRuntimeConn returns a FRESH independent connection each call (matching the
  // real impl, which closes its per-call connection) so the writer's conn.close()
  // never touches the Hub's main connection. A separate persistent `assertConn`
  // is used for read-back assertions + the final drop.
  const runtimeUri = uri.replace(`/${SCRATCH_DB}`, `/${RUNTIME_DB}`);
  const assertConn = await mongoose.createConnection(runtimeUri).asPromise();
  const registry = createMongooseRegistry({
    // Ignore the fake provider SRV; write the doc to the real runtime scratch db.
    openRuntimeConn: () => mongoose.createConnection(runtimeUri).asPromise(),
  });
  const vault = createVaultPort();
  const audit = { actorId: new Types.ObjectId(), ip: "1.2.3.4" };

  let mintN = 0;
  const deps = (sim: ReturnType<typeof makeSim>): Partial<ProvisionDeps> => ({
    registry, vault, mintSecret: () => `mint-${++mintN}`, retryOverrides: sim.overrides, now: () => FIXED_NOW,
  });
  const intake = (slug: string, over: Record<string, unknown> = {}) => ({
    slug, ownerEmail: "o@x.com", businessType: "cafe" as const, idempotencyKey: `idem-${slug}`, creds: CREDS, ...over,
  });

  try {
    await Tenant.deleteMany({});
    await Secret.deleteMany({});
    await AuditLog.deleteMany({});
    await assertConn.collection("clusterRegistry").deleteMany({});

    // ── Leg 1: full provision → active, real docs written ──
    const r1 = await provisionTenant(intake("live-full"), audit, CONFIG, HOOKS, deps(makeSim()));
    assert.equal(r1.status, "done");
    const t1 = await Tenant.findOne({ slug: "live-full" }).lean();
    assert.equal(t1?.status, "active");
    assert.equal(t1?.dbPool.filter((c) => c.role === "primary").length, 1);
    assert.equal(t1?.dbPool.filter((c) => c.role === "orders-current").length, 1);
    assert.equal(t1?.hosting.length, 2);
    assert.equal(t1?.imagePool[0]?.role, "active");
    assert.equal(t1?.domain?.sslState, "issued");
    const doc1 = await assertConn.collection("clusterRegistry").findOne({});
    assert.equal(doc1?._id, "cluster-registry");
    assert.equal(doc1?.ledgers?.length, 1);
    assert.equal(doc1?.ledgers?.[0]?.id, "pos-orders-a");
    // Every reveal + the provision wrote real audit rows.
    assert.ok((await AuditLog.countDocuments({ action: "tenant.provision" })) >= 1, "tenant.provision audited");
    assert.ok((await AuditLog.countDocuments({ action: "secret.reveal" })) > 0, "reveals audited");
    console.log("✓ leg 1: full provision → active; clusters/hosts/image/domain + runtime doc + audit rows");

    // ── Leg 2: kill-after-db.orders → resume-at-image without recreating clusters ──
    const sim2 = makeSim({ fail: { "image.r2": { times: 1, status: 403 } } });
    await assert.rejects(() => provisionTenant(intake("live-resume"), audit, CONFIG, HOOKS, deps(sim2)));
    const mid = await Tenant.findOne({ slug: "live-resume" }).lean();
    assert.equal(mid?.provisioning?.step, "db.orders", "stopped at image; both DB steps done");
    const clustersAfterRun1 = sim2.calls.filter((c) => c === "atlas.createM0").length;
    assert.equal(clustersAfterRun1, 2);
    const r2 = await provisionTenant(intake("live-resume", { creds: undefined }), audit, CONFIG, HOOKS, deps(sim2));
    assert.equal(r2.status, "done");
    assert.equal(sim2.calls.filter((c) => c === "atlas.createM0").length, 2, "resume did not recreate clusters");
    const t2 = await Tenant.findOne({ slug: "live-resume" }).lean();
    assert.equal(t2?.dbPool.filter((c) => c.role === "primary").length, 1, "no duplicate primary (guarded upsert)");
    console.log("✓ leg 2: kill-after-db.orders → resume-at-image, zero cluster recreation, no duplicate pool rows");

    // ── Leg 3: forced 429 mid-run retries the exact Retry-After ──
    const sim3 = makeSim({ fail: { "atlas.createM0": { times: 1, status: 429, retryAfter: "2" } } });
    const r3 = await provisionTenant(intake("live-429"), audit, CONFIG, HOOKS, deps(sim3));
    assert.equal(r3.status, "done");
    assert.ok(sim3.sleeps.includes(2000), "backed off the exact 2s Retry-After");
    console.log("✓ leg 3: forced 429 mid-run retried (exact Retry-After), provision completed");

    // ── Leg 4: R1 reconcile — crash AFTER the doc write but BEFORE saveStep('db.orders'),
    // resume, and assert the runtime doc URI re-synced to the fresh orders password
    // (not stranded on the dead one). Exercises the REAL positional $set on ledgers.$.uri.
    const slug4 = "live-recon";
    // A registry proxy that fails saveStep('db.orders') exactly once (the crash window).
    let failedOnce = false;
    const crashingRegistry = {
      ...registry,
      saveStep: async (s: string, step: string) => {
        if (step === "db.orders" && !failedOnce) { failedOnce = true; throw new Error("injected saveStep crash @ db.orders"); }
        return registry.saveStep(s, step);
      },
    };
    await assert.rejects(() =>
      provisionTenant(intake(slug4), audit, CONFIG, HOOKS, { ...deps(makeSim()), registry: crashingRegistry }));
    const doc4a = await assertConn.collection("clusterRegistry").findOne({});
    const uri4a = doc4a?.ledgers?.[0]?.uri as string;

    // Re-run (creds absent): db.orders re-runs → PATCH-resets password → fresh SRV
    // stored + old revoked → writeRuntimeClusterRegistry RECONCILES the doc's uri.
    const r4 = await provisionTenant(intake(slug4, { creds: undefined }), audit, CONFIG, HOOKS, deps(makeSim()));
    assert.equal(r4.status, "done");
    const doc4b = await assertConn.collection("clusterRegistry").findOne({});
    const uri4b = doc4b?.ledgers?.[0]?.uri as string;
    assert.notEqual(uri4a, uri4b, "doc orders URI changed on resume (reconciled, not stranded)");
    // The doc's orders URI must equal the CURRENT active orders dbUri (sealed = identity today).
    const t4 = await Tenant.findOne({ slug: slug4 }).lean();
    const liveOrders = await vault.reveal(t4!._id as Types.ObjectId, dbUriId("orders"), audit);
    assert.equal(uri4b, liveOrders, "doc orders URI tracks the live orders credential");
    console.log("✓ leg 4: R1 reconcile — doc orders URI re-synced to the fresh password after a mid-db.orders resume");

    // ── Leg 5: concurrency lease refuses a second live run ──
    const slug5 = "live-lease";
    await Tenant.create({
      slug: slug5, status: "provisioning", ownerEmail: "o@x.com", businessType: "cafe",
      provisioning: { step: "db.primary", idempotencyKey: `idem-${slug5}`, leaseToken: "other", leaseUntil: new Date(FIXED_NOW + 10 * 60 * 1000) },
    });
    const r5 = await provisionTenant(intake(slug5, { creds: undefined }), audit, CONFIG, HOOKS, deps(makeSim()));
    assert.equal(r5.status, "inProgress", "a live lease held by another run is refused");
    console.log("✓ leg 5: single-flight lease refuses a concurrent same-key run (inProgress)");

    console.log("\nALL PROVISIONER LIVE LEGS PASSED ✓");
  } finally {
    await mongoose.connection.dropDatabase();
    await assertConn.dropDatabase();
    await assertConn.close();
    await mongoose.disconnect();
    console.log(`✓ dropped scratch dbs '${SCRATCH_DB}' + '${RUNTIME_DB}'`);
  }
}

main().catch((err) => {
  console.error("verify-provisioner-live FAILED:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
