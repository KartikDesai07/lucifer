import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  buildHeartbeat,
  imageUsageFromCloudinary,
  statsTokenMatches,
  __setHeartbeatDepsForTests,
  __setHeartbeatProbeTimeoutForTests,
} from "./heartbeat";
import type { HeartbeatImageUsage } from "@pos/shared/heartbeat";
import { M0_QUOTA_BYTES, type LedgerFillStats } from "./ledger-scale-plan";
import {
  setUriDecryptor,
  __resetRouterForTests,
  type StoredClusterRegistry,
} from "./cluster-router";

// F2 Step F2.9 — the runtime heartbeat source, proven DB-FREE. The injected
// deps record which cluster each probe dialed (id + URI), so the tests pin:
// every owned cluster is gauged (CORE env-dialed, doc URIs through the vault
// decryptor), the conservative usedPct math, the F2.7 caveat (a failed probe
// yields `state:"error"` and the raw driver message NEVER appears in the
// payload), best-effort conns, the bootstrap single-row era, and that a
// registry READ ERROR propagates instead of emitting a bootstrap-shaped lie
// (#19). The live gauge runs in F2's seeded-M0 integration pass.

const FIXTURE_CORE_URI = "mongodb://core-env/db";

function fixtureDoc(
  overrides: Partial<StoredClusterRegistry> = {},
): StoredClusterRegistry {
  return {
    _id: "cluster-registry",
    core: { id: "core", uri: "enc:mongodb://core-doc-mirror/db", tag: "C" },
    ledgers: [
      { id: "l-a", uri: "enc:mongodb://a/db", tag: "A", from: null, to: "2026-04-01", active: false, paused: true },
      { id: "l-a2", uri: "enc:mongodb://a2/db", tag: "A2", from: "2026-04-01", to: null, active: true, paused: false },
    ],
    standby: [{ id: "l-a3", uri: "enc:mongodb://a3/db", empty: true }],
    ...overrides,
  };
}

interface Recorded {
  statsCalls: { id: string; uri: string }[];
  connsCalls: { id: string; uri: string }[];
}
function installDeps(cfg: {
  doc: StoredClusterRegistry | null | "read-error";
  stats?: Record<string, LedgerFillStats | "hang" | "fail">;
  conns?: Record<string, number> | "fail";
  imageUsage?: HeartbeatImageUsage | null | "hang" | "fail";
}): Recorded {
  const rec: Recorded = { statsCalls: [], connsCalls: [] };
  __setHeartbeatDepsForTests({
    readRegistryDoc: async () => {
      if (cfg.doc === "read-error") throw new Error("registry read refused");
      return cfg.doc ? structuredClone(cfg.doc) : null;
    },
    readStats: async (ref) => {
      rec.statsCalls.push({ id: ref.id, uri: ref.uri });
      const s = cfg.stats?.[ref.id];
      if (s === "hang") return new Promise<never>(() => {});
      if (s === undefined || s === "fail")
        throw new Error(`SECRET-DRIVER-DETAIL stats refused for ${ref.id}`);
      return s;
    },
    readConns: async (ref) => {
      rec.connsCalls.push({ id: ref.id, uri: ref.uri });
      if (cfg.conns === "fail") throw new Error("serverStatus unauthorized");
      return cfg.conns?.[ref.id];
    },
    readImageUsage: async () => {
      if (cfg.imageUsage === "hang") return new Promise<never>(() => {});
      if (cfg.imageUsage === "fail")
        throw new Error("SECRET-CLOUDINARY-DETAIL usage refused");
      return cfg.imageUsage ?? null;
    },
  });
  return rec;
}

const OK_STATS: LedgerFillStats = {
  dataSize: Math.round(M0_QUOTA_BYTES * 0.5),
  indexSize: Math.round(M0_QUOTA_BYTES * 0.21),
};

beforeEach(() => {
  __resetRouterForTests();
  process.env.CORE_MONGODB_URI = FIXTURE_CORE_URI;
  // Fixture URIs are stored `enc:`-prefixed; the vault seam strips it — probes
  // asserting a bare URI prove the doc URI passed the decryptor (F2.7 parity).
  setUriDecryptor((u) => (u.startsWith("enc:") ? u.slice(4) : u));
});
afterEach(() => {
  __setHeartbeatDepsForTests(null);
  __setHeartbeatProbeTimeoutForTests(null);
  __resetRouterForTests();
  delete process.env.CORE_MONGODB_URI;
  delete process.env.TENANT_ID;
});

test("gauges every owned cluster: core (env URI, no decrypt) + ledgers + standby (decrypted)", async () => {
  const rec = installDeps({
    doc: fixtureDoc(),
    stats: { core: OK_STATS, "l-a": OK_STATS, "l-a2": OK_STATS, "l-a3": OK_STATS },
    conns: { "l-a2": 7 },
  });
  const hb = await buildHeartbeat();

  assert.equal(hb.bootstrap, undefined);
  assert.deepEqual(
    hb.clusters.map((c) => [c.name, c.role]),
    [
      ["core", "core"],
      ["l-a", "ledger"],
      ["l-a2", "ledger"],
      ["l-a3", "standby"],
    ],
  );
  // CORE dialed with the ENV uri (never the doc mirror, never the decryptor);
  // doc entries dialed with their DECRYPTED uris.
  assert.deepEqual(
    rec.statsCalls.find((c) => c.id === "core"),
    { id: "core", uri: FIXTURE_CORE_URI },
  );
  assert.deepEqual(
    rec.statsCalls.find((c) => c.id === "l-a2"),
    { id: "l-a2", uri: "mongodb://a2/db" },
  );

  const active = hb.clusters.find((c) => c.name === "l-a2");
  assert.equal(active?.state, "ok");
  assert.equal(active?.active, true);
  assert.equal(active?.tag, "A2");
  assert.equal(active?.conns, 7);
  // The conservative gauge: (dataSize + indexSize) / 512MB, rounded to 4dp —
  // dataSize alone would be 0.5; only WITH indexes does it read 0.71.
  assert.equal(active?.usedPct, 0.71);
  assert.equal(active?.dataSize, OK_STATS.dataSize);
  assert.equal(active?.indexSize, OK_STATS.indexSize);

  const archived = hb.clusters.find((c) => c.name === "l-a");
  assert.equal(archived?.active, false);
  assert.equal(archived?.paused, true); // manifest pass-through
  assert.equal(active?.paused, false); // explicit false passes through too (not omitted)
  const standby = hb.clusters.find((c) => c.name === "l-a3");
  assert.equal(standby?.role, "standby");
  assert.ok(!("tag" in (standby ?? {}))); // tagless manual-paste standby
  assert.ok(!("conns" in (archived ?? {}))); // no conns recorded for it
});

test("a failed probe degrades to state:'error' — the raw driver message NEVER enters the payload (F2.7 caveat)", async () => {
  installDeps({
    doc: fixtureDoc(),
    stats: { core: OK_STATS, "l-a2": OK_STATS, "l-a3": OK_STATS }, // l-a fails
  });
  const hb = await buildHeartbeat();
  const dead = hb.clusters.find((c) => c.name === "l-a");
  assert.equal(dead?.state, "error");
  assert.equal(dead?.usedPct, undefined);
  assert.ok(!JSON.stringify(hb).includes("SECRET-DRIVER-DETAIL"));
  // The other rows are unaffected (per-row isolation, the F2.6 leg semantics).
  assert.equal(hb.clusters.find((c) => c.name === "l-a2")?.state, "ok");
});

test("a hung probe times out to state:'error' instead of hanging the heartbeat", async () => {
  __setHeartbeatProbeTimeoutForTests(20);
  installDeps({
    doc: fixtureDoc(),
    stats: { core: OK_STATS, "l-a": OK_STATS, "l-a2": "hang", "l-a3": OK_STATS },
  });
  const hb = await buildHeartbeat();
  assert.equal(hb.clusters.find((c) => c.name === "l-a2")?.state, "error");
  assert.equal(hb.clusters.find((c) => c.name === "l-a")?.state, "ok");
});

test("a stats-dead row still carries conns when that probe succeeded (independent probes)", async () => {
  installDeps({
    doc: fixtureDoc(),
    stats: { core: OK_STATS, "l-a2": OK_STATS, "l-a3": OK_STATS }, // l-a stats fail
    conns: { "l-a": 3 },
  });
  const hb = await buildHeartbeat();
  const dead = hb.clusters.find((c) => c.name === "l-a");
  assert.equal(dead?.state, "error");
  assert.equal(dead?.conns, 3);
});

test("a hung registry read times out instead of stacking onto the probe budget (≤8s rule)", async () => {
  __setHeartbeatProbeTimeoutForTests(20);
  __setHeartbeatDepsForTests({
    readRegistryDoc: () => new Promise<never>(() => {}),
  });
  await assert.rejects(buildHeartbeat(), /registry read timed out/);
});

test("conns is best-effort: an unauthorized serverStatus omits conns, state stays ok", async () => {
  installDeps({
    doc: fixtureDoc(),
    stats: { core: OK_STATS, "l-a": OK_STATS, "l-a2": OK_STATS, "l-a3": OK_STATS },
    conns: "fail",
  });
  const hb = await buildHeartbeat();
  const active = hb.clusters.find((c) => c.name === "l-a2");
  assert.equal(active?.state, "ok");
  assert.ok(!("conns" in (active ?? {})));
});

test("bootstrap era (no registry doc): the lone core row + bootstrap:true", async () => {
  process.env.TENANT_ID = "cafe-42";
  const rec = installDeps({ doc: null, stats: { core: OK_STATS } });
  const hb = await buildHeartbeat();
  assert.equal(hb.bootstrap, true);
  assert.equal(hb.tenant, "cafe-42");
  assert.deepEqual(
    hb.clusters.map((c) => [c.name, c.tag, c.role, c.state]),
    [["core", "C", "core", "ok"]],
  );
  assert.equal(rec.statsCalls.length, 1);
});

test("a registry READ ERROR propagates — never a bootstrap-shaped heartbeat off a failed read (#19)", async () => {
  installDeps({ doc: "read-error", stats: { core: OK_STATS } });
  await assert.rejects(buildHeartbeat(), /registry read refused/);
});

// ── F3.7 — the §3.3 imageUsage leg ───────────────────────────────────────────

test("imageUsage rides the payload when the probe returns fractions; absent when null (R2 tenants)", async () => {
  installDeps({ doc: null, stats: { core: OK_STATS }, imageUsage: { creditsPct: 0.42 } });
  const withUsage = await buildHeartbeat();
  assert.deepEqual(withUsage.imageUsage, { creditsPct: 0.42 });

  installDeps({ doc: null, stats: { core: OK_STATS }, imageUsage: null });
  const without = await buildHeartbeat();
  assert.ok(!("imageUsage" in without), "no imageUsage key when there is nothing to gauge");
});

test("a failed/hung usage probe degrades to omission — never a fake 0, never in the payload (F2.7 caveat)", async () => {
  installDeps({ doc: null, stats: { core: OK_STATS }, imageUsage: "fail" });
  const failed = await buildHeartbeat();
  assert.ok(!("imageUsage" in failed));
  assert.ok(!JSON.stringify(failed).includes("SECRET-CLOUDINARY-DETAIL"));
  // The cluster gauges are unaffected by the image leg dying.
  assert.equal(failed.clusters[0].state, "ok");

  __setHeartbeatProbeTimeoutForTests(20);
  installDeps({ doc: null, stats: { core: OK_STATS }, imageUsage: "hang" });
  const hung = await buildHeartbeat();
  assert.ok(!("imageUsage" in hung), "a hung probe times out to omission");
});

test("imageUsageFromCloudinary: free plan (credits.used_percent) and paid plan (per-metric) both map to fractions", () => {
  // Free plan: credits is THE meter; per-metric used_percent doesn't exist.
  assert.deepEqual(
    imageUsageFromCloudinary({ plan: "Free", credits: { usage: 18.75, limit: 25, used_percent: 75.0 } }),
    { creditsPct: 0.75 },
  );
  // Paid plan: per-metric used_percent.
  assert.deepEqual(
    imageUsageFromCloudinary({
      credits: { used_percent: 12.34 },
      storage: { used_percent: 80 },
      bandwidth: { used_percent: 5.5 },
    }),
    { creditsPct: 0.1234, storagePct: 0.8, bandwidthPct: 0.055 },
  );
});

test("imageUsageFromCloudinary: percent-less/garbage responses yield null (honest omission, never 0)", () => {
  assert.equal(imageUsageFromCloudinary({}), null);
  assert.equal(imageUsageFromCloudinary(null), null);
  assert.equal(imageUsageFromCloudinary({ credits: { usage: 3 } }), null);
  assert.equal(imageUsageFromCloudinary({ credits: { used_percent: "n/a" } }), null);
  assert.equal(imageUsageFromCloudinary({ credits: { used_percent: -1 } }), null);
});

test("statsTokenMatches: open when unconfigured, constant-time match when configured", () => {
  assert.equal(statsTokenMatches(null, undefined), true);
  assert.equal(statsTokenMatches("anything", undefined), true);
  assert.equal(statsTokenMatches("s3cret", "s3cret"), true);
  assert.equal(statsTokenMatches("wrong", "s3cret"), false);
  assert.equal(statsTokenMatches(null, "s3cret"), false);
  assert.equal(statsTokenMatches("", "s3cret"), false);
  assert.equal(statsTokenMatches("s3cret-but-longer", "s3cret"), false);
});
