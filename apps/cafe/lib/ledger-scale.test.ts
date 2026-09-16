import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import {
  scaleCheck,
  setStandbyProvisioner,
  __setScaleDepsForTests,
  __setScaleProbeTimeoutForTests,
} from "./ledger-scale";
import {
  isValidLedgerTag,
  mintOrValidateStandbyTag,
  nextLedgerTag,
  M0_QUOTA_BYTES,
  type LedgerFillStats,
  type RegistryUpdate,
  type StoredLedgerEntry,
  type StoredStandbyEntry,
} from "./ledger-scale-plan";
import {
  ledgersForDate,
  ledgerForWrite,
  ledgerFromOrderId,
  setUriDecryptor,
  __setRegistryProviderForTests,
  __resetRouterForTests,
  type StoredClusterRegistry,
} from "./cluster-router";

// F2 Step F2.7 — the auto-scale roll-forward, proven DB-FREE. The injected deps
// record every cluster probe (id + the URI actually dialed) and every registry
// write, so the tests pin: the conservative dataSize+indexSize gauge, the
// ≥70%+standby flip, the FLIP-DAY one-day window overlap (then fed through the
// REAL router to prove `ledgersForDate(D,D)` resolves BOTH legs), the CAS
// guard, validate-before-activate, tag minting, and that the ONLY write a flip
// issues is the single manifest update — no data moves. The live socket
// round-trip runs against a seeded M0 in F2's integration pass (the F2.1–F2.6
// static-now / live-later split).

const QUOTA = M0_QUOTA_BYTES;
const AT_71_DATA = Math.round(QUOTA * 0.5); // below 70% on dataSize ALONE…
const AT_71_INDEX = Math.round(QUOTA * 0.21); // …crosses it only with indexes

function fixtureDoc(
  overrides: Partial<StoredClusterRegistry> = {},
): StoredClusterRegistry {
  return {
    _id: "cluster-registry",
    core: { id: "core", uri: "enc:mongodb://core/db", tag: "C" },
    ledgers: [
      { id: "l-a", uri: "enc:mongodb://a/db", tag: "A", from: null, to: "2026-04-01", active: false },
      { id: "l-a2", uri: "enc:mongodb://a2/db", tag: "A2", from: "2026-04-01", to: null, active: true },
    ],
    standby: [{ id: "l-a3", uri: "enc:mongodb://a3/db", empty: true }],
    ...overrides,
  };
}

interface Recorded {
  statsCalls: { id: string; uri: string }[];
  pingCalls: { id: string; uri: string }[];
  updates: RegistryUpdate[];
}
function installDeps(cfg: {
  doc: StoredClusterRegistry | null;
  stats?: Record<string, LedgerFillStats | "hang" | "fail">;
  pingFails?: string[];
  matchedCount?: number;
  now?: string;
}): Recorded {
  const rec: Recorded = { statsCalls: [], pingCalls: [], updates: [] };
  __setScaleDepsForTests({
    readRegistryDoc: async () => (cfg.doc ? structuredClone(cfg.doc) : null),
    updateRegistryDoc: async (upd) => {
      rec.updates.push(upd);
      return cfg.matchedCount ?? 1;
    },
    readStats: async (ref) => {
      rec.statsCalls.push({ id: ref.id, uri: ref.uri });
      const s = cfg.stats?.[ref.id];
      if (s === "hang") return new Promise<never>(() => {});
      if (s === undefined || s === "fail") throw new Error(`stats refused for ${ref.id}`);
      return s;
    },
    ping: async (ref) => {
      rec.pingCalls.push({ id: ref.id, uri: ref.uri });
      if (cfg.pingFails?.includes(ref.id)) throw new Error(`ping refused for ${ref.id}`);
    },
    now: () => new Date(cfg.now ?? "2026-07-03T04:30:00.000Z"), // IST 2026-07-03 10:00
  });
  return rec;
}

function installProvisioner(behavior?: "throw"): { calls: number } {
  const rec = { calls: 0 };
  setStandbyProvisioner(async () => {
    rec.calls += 1;
    if (behavior === "throw") throw new Error("provision boom");
  });
  return rec;
}

function flipSetOf(upd: RegistryUpdate): {
  ledgers: StoredLedgerEntry[];
  standby: StoredStandbyEntry[];
} {
  return (
    upd.update as {
      $set: { ledgers: StoredLedgerEntry[]; standby: StoredStandbyEntry[] };
    }
  ).$set;
}

beforeEach(() => {
  __resetRouterForTests();
  __setScaleDepsForTests(null);
  __setScaleProbeTimeoutForTests(50);
  setStandbyProvisioner(async () => {});
});
afterEach(() => {
  __resetRouterForTests();
  __setScaleDepsForTests(null);
  __setScaleProbeTimeoutForTests(null);
  setStandbyProvisioner(null);
});

// ── The forced-0.71 flip (the phase-F2 §4 F2.7 verify case) ───────────────────

test("active at 0.71 (dataSize+indexSize — dataSize ALONE is under 70%) + standby → flips with the one-day overlap, moving no data", async () => {
  const nudges = installProvisioner();
  const rec = installDeps({
    doc: fixtureDoc(),
    stats: {
      "l-a2": { dataSize: AT_71_DATA, indexSize: AT_71_INDEX },
      "l-a": { dataSize: Math.round(QUOTA * 0.3), indexSize: Math.round(QUOTA * 0.05) },
    },
  });

  const res = await scaleCheck();
  assert.equal(res.status, "flipped");
  assert.equal(res.bootstrap, false);
  assert.deepEqual(res.flip, {
    fromTag: "A2",
    toTag: "A3",
    oldTo: "2026-07-04", // startOfTomorrow — the retiring window KEEPS flip day
    newFrom: "2026-07-03", // startOfToday — the new window also covers flip day
  });
  assert.equal(res.standbyCount, 0); // consumed
  assert.equal(nudges.calls, 1); // ensureNextStandby nudged ahead

  // The ONLY write a flip issues is the single manifest update — no data moved.
  assert.equal(rec.updates.length, 1);
  const upd = rec.updates[0];
  assert.deepEqual(upd.filter, {
    _id: "cluster-registry",
    ledgers: { $elemMatch: { id: "l-a2", active: true } },
    "standby.0.id": "l-a3",
    standby: { $size: 1 },
  });
  assert.equal(upd.arrayFilters, undefined);

  const set = flipSetOf(upd);
  assert.deepEqual(set.standby, []);
  assert.equal(set.ledgers.length, 3);
  const [a, a2, a3] = set.ledgers;
  // Archive untouched except fresh stats.
  assert.deepEqual(a, {
    id: "l-a", uri: "enc:mongodb://a/db", tag: "A", from: null, to: "2026-04-01",
    active: false, fillPct: 0.35, sizeBytes: Math.round(QUOTA * 0.3) + Math.round(QUOTA * 0.05),
  });
  // Retiring active: demoted, window closed at startOfTomorrow, stats stamped.
  assert.deepEqual(a2, {
    id: "l-a2", uri: "enc:mongodb://a2/db", tag: "A2", from: "2026-04-01", to: "2026-07-04",
    active: false, fillPct: 0.71, sizeBytes: AT_71_DATA + AT_71_INDEX,
  });
  // Promoted standby: ENCRYPTED uri verbatim, minted tag, `empty` flag dropped.
  assert.deepEqual(a3, {
    id: "l-a3", uri: "enc:mongodb://a3/db", tag: "A3", from: "2026-07-03", to: null, active: true,
  });

  // Validate-before-activate pinged exactly the standby.
  assert.deepEqual(rec.pingCalls.map((p) => p.id), ["l-a3"]);
});

test("the persisted overlap windows resolve BOTH legs on flip day through the REAL router (the FLIP-DAY acceptance)", async () => {
  installProvisioner();
  const rec = installDeps({
    doc: fixtureDoc(),
    stats: { "l-a2": { dataSize: AT_71_DATA, indexSize: AT_71_INDEX } },
  });
  const res = await scaleCheck();
  assert.equal(res.status, "flipped");

  const set = flipSetOf(rec.updates[0]);
  const postFlip: StoredClusterRegistry = {
    ...fixtureDoc(),
    ledgers: set.ledgers,
    standby: set.standby,
  };
  __setRegistryProviderForTests(async () => structuredClone(postFlip));

  // Flip day D resolves BOTH legs → F2.4 defers → the F2.6 merge (not a hidden morning).
  const flipDay = await ledgersForDate("2026-07-03", "2026-07-03");
  assert.deepEqual(flipDay.map((l) => l.tag).sort(), ["A2", "A3"]);
  // D+1 resolves the new active alone; D−1 the retired one alone.
  assert.deepEqual((await ledgersForDate("2026-07-04", "2026-07-04")).map((l) => l.tag), ["A3"]);
  assert.deepEqual((await ledgersForDate("2026-07-02", "2026-07-02")).map((l) => l.tag), ["A2"]);
  // New orders place on the promoted ledger; old tag-targeted point reads stand.
  assert.equal((await ledgerForWrite()).tag, "A3");
  assert.equal((await ledgerFromOrderId("ORD-A2-20260703-042"))?.id, "l-a2");
});

test("a flip crossing IST midnight derives both window bounds from ONE instant", async () => {
  const rec = installDeps({
    doc: fixtureDoc(),
    stats: { "l-a2": { dataSize: Math.round(QUOTA * 0.8), indexSize: 0 } },
    now: "2026-07-03T18:31:00.000Z", // IST 2026-07-04 00:01
  });
  const res = await scaleCheck();
  assert.equal(res.status, "flipped");
  assert.equal(res.flip?.newFrom, "2026-07-04");
  assert.equal(res.flip?.oldTo, "2026-07-05");
  assert.equal(rec.updates.length, 1);
});

test("fill EXACTLY at the 0.70 threshold counts as full (≥ semantics, not >)", async () => {
  const rec = installDeps({
    doc: fixtureDoc(),
    // QUOTA is 2^29, so QUOTA*0.7 / QUOTA is exact IEEE — fill === the threshold.
    stats: { "l-a2": { dataSize: QUOTA * 0.7, indexSize: 0 } },
  });
  const res = await scaleCheck();
  assert.equal(res.status, "flipped");
  assert.equal(rec.updates.length, 1);
});

// ── Non-flip paths ────────────────────────────────────────────────────────────

test("below 70% → ok; stats persisted per-entry via arrayFilters (never a wholesale array write)", async () => {
  const nudges = installProvisioner();
  const rec = installDeps({
    doc: fixtureDoc(),
    stats: {
      "l-a2": { dataSize: Math.round(QUOTA * 0.69), indexSize: 0 },
      "l-a": { dataSize: 1000, indexSize: 24 },
    },
  });
  const res = await scaleCheck();
  assert.equal(res.status, "ok");
  assert.equal(nudges.calls, 0);
  assert.equal(rec.pingCalls.length, 0);
  assert.equal(rec.updates.length, 1);
  assert.deepEqual(rec.updates[0], {
    filter: { _id: "cluster-registry" },
    update: {
      $set: {
        "ledgers.$[l0].fillPct": 0, // 1024 B rounds to 0.0000 of 512 MB
        "ledgers.$[l0].sizeBytes": 1024,
        "ledgers.$[l1].fillPct": 0.69,
        "ledgers.$[l1].sizeBytes": Math.round(QUOTA * 0.69),
      },
    },
    arrayFilters: [{ "l0.id": "l-a" }, { "l1.id": "l-a2" }],
  });
});

test("≥70% with NO standby → prompt-no-standby + a provisioner nudge; ≥85% → critical-no-standby", async () => {
  for (const [pct, status] of [
    [0.75, "prompt-no-standby"],
    [0.86, "critical-no-standby"],
  ] as const) {
    const nudges = installProvisioner();
    const rec = installDeps({
      doc: fixtureDoc({ standby: [] }),
      stats: { "l-a2": { dataSize: Math.round(QUOTA * pct), indexSize: 0 } },
    });
    const res = await scaleCheck();
    assert.equal(res.status, status);
    assert.equal(nudges.calls, 1);
    assert.equal(rec.updates.length, 1); // stats-only heartbeat still lands
    assert.ok(rec.updates[0].arrayFilters);
  }
});

test("standby failing validate-before-activate → standby-invalid, the filling active KEEPS writes, nudge fired", async () => {
  const nudges = installProvisioner();
  const rec = installDeps({
    doc: fixtureDoc(),
    stats: { "l-a2": { dataSize: Math.round(QUOTA * 0.75), indexSize: 0 } },
    pingFails: ["l-a3"],
  });
  const res = await scaleCheck();
  assert.equal(res.status, "standby-invalid");
  assert.equal(nudges.calls, 1);
  assert.equal(rec.updates.length, 1);
  assert.ok(rec.updates[0].arrayFilters, "only the stats heartbeat — never the flip $set");
});

test("a lost CAS (concurrent manifest writer) → raced: no crash, no nudge, next run completes", async () => {
  const nudges = installProvisioner();
  const rec = installDeps({
    doc: fixtureDoc(),
    stats: { "l-a2": { dataSize: Math.round(QUOTA * 0.75), indexSize: 0 } },
    matchedCount: 0,
  });
  const res = await scaleCheck();
  assert.equal(res.status, "raced");
  assert.equal(nudges.calls, 0);
  assert.equal(rec.updates.length, 1); // the flip attempt whose guard lost
  assert.equal(rec.updates[0].arrayFilters, undefined);
});

test("unreadable ACTIVE stats → stats-unavailable: never flip on a guess, even with a standby ready", async () => {
  const rec = installDeps({
    doc: fixtureDoc(),
    stats: { "l-a2": "fail", "l-a": { dataSize: 1000, indexSize: 24 } },
  });
  const res = await scaleCheck();
  assert.equal(res.status, "stats-unavailable");
  assert.equal(rec.pingCalls.length, 0);
  assert.equal(rec.updates.length, 1); // the archive's stats still persist
  assert.deepEqual(rec.updates[0].arrayFilters, [{ "l0.id": "l-a" }]);
  const row = res.ledgers.find((l) => l.id === "l-a2");
  assert.match(row?.statsError ?? "", /stats refused/);
});

test("a HUNG stats probe times out into a statsError (a paused M0 must never hang the check)", async () => {
  __setScaleProbeTimeoutForTests(20);
  installDeps({ doc: fixtureDoc(), stats: { "l-a2": "hang" } });
  const res = await scaleCheck();
  assert.equal(res.status, "stats-unavailable");
  const row = res.ledgers.find((l) => l.id === "l-a2");
  assert.match(row?.statsError ?? "", /timed out after 20ms/);
});

test("a corrupt manifest (≠1 active) is REFUSED loudly, mirroring the router", async () => {
  const doc = fixtureDoc();
  doc.ledgers[0].active = true; // two actives
  installDeps({ doc });
  await assert.rejects(scaleCheck(), /exactly one active ledger, found 2/);
});

// ── Vault seam ────────────────────────────────────────────────────────────────

test("probes dial DECRYPTED uris while the persisted manifest keeps them ENCRYPTED verbatim", async () => {
  setUriDecryptor((u) => u.replace(/^enc:/, ""));
  const rec = installDeps({
    doc: fixtureDoc(),
    stats: {
      "l-a2": { dataSize: AT_71_DATA, indexSize: AT_71_INDEX },
      "l-a": { dataSize: 0, indexSize: 0 },
    },
  });
  const res = await scaleCheck();
  assert.equal(res.status, "flipped");
  assert.deepEqual(
    rec.statsCalls.map((c) => c.uri).sort(),
    ["mongodb://a/db", "mongodb://a2/db"],
  );
  assert.deepEqual(rec.pingCalls[0], { id: "l-a3", uri: "mongodb://a3/db" });
  const set = flipSetOf(rec.updates[0]);
  assert.equal(set.ledgers[2].uri, "enc:mongodb://a3/db"); // never decrypted into the doc
});

// ── Bootstrap era (no registry doc) ───────────────────────────────────────────

test("bootstrap (no doc): gauges CORE-as-ledger, prompts at ≥70%, and persists NOTHING (F3 owns doc creation)", async () => {
  const prevCore = process.env.CORE_MONGODB_URI;
  process.env.CORE_MONGODB_URI = "mongodb://core-env/db";
  try {
    const nudges = installProvisioner();
    const rec = installDeps({
      doc: null,
      stats: { core: { dataSize: Math.round(QUOTA * 0.72), indexSize: 0 } },
    });
    const res = await scaleCheck();
    assert.equal(res.status, "prompt-no-standby");
    assert.equal(res.bootstrap, true);
    assert.equal(res.standbyCount, 0);
    assert.deepEqual(res.ledgers.map((l) => ({ id: l.id, tag: l.tag, active: l.active })), [
      { id: "core", tag: "A", active: true },
    ]);
    assert.equal(nudges.calls, 1);
    assert.equal(rec.updates.length, 0);
    // The bootstrap probe rides the env URI directly (never the doc decryptor).
    assert.deepEqual(rec.statsCalls, [{ id: "core", uri: "mongodb://core-env/db" }]);
  } finally {
    if (prevCore === undefined) delete process.env.CORE_MONGODB_URI;
    else process.env.CORE_MONGODB_URI = prevCore;
  }
});

test("bootstrap with unreadable stats → stats-unavailable, still no write", async () => {
  const prevCore = process.env.CORE_MONGODB_URI;
  process.env.CORE_MONGODB_URI = "mongodb://core-env/db";
  try {
    const rec = installDeps({ doc: null, stats: {} });
    const res = await scaleCheck();
    assert.equal(res.status, "stats-unavailable");
    assert.equal(res.bootstrap, true);
    assert.equal(rec.updates.length, 0);
  } finally {
    if (prevCore === undefined) delete process.env.CORE_MONGODB_URI;
    else process.env.CORE_MONGODB_URI = prevCore;
  }
});

// ── Provisioner seam ──────────────────────────────────────────────────────────

test("a throwing provisioner is swallowed — the check still reports honestly (fire-and-forget best-effort)", async () => {
  const nudges = installProvisioner("throw");
  installDeps({
    doc: fixtureDoc({ standby: [] }),
    stats: { "l-a2": { dataSize: Math.round(QUOTA * 0.75), indexSize: 0 } },
  });
  const res = await scaleCheck();
  assert.equal(res.status, "prompt-no-standby");
  assert.equal(nudges.calls, 1);
  await new Promise((r) => setImmediate(r)); // let the swallowed rejection settle
});

// ── Tag minting (the §3.5 A-series; uniqueness is the hard invariant) ─────────

test("nextLedgerTag mints the A-series and only uniqueness is guaranteed past A9", () => {
  assert.equal(nextLedgerTag([]), "A");
  assert.equal(nextLedgerTag(["A"]), "A2");
  assert.equal(nextLedgerTag(["A", "A2"]), "A3");
  assert.equal(nextLedgerTag(["A", "A2", "A9"]), "A10"); // 'A10' < 'A2' lexicographically — documented, nothing sorts by tag
  assert.equal(nextLedgerTag(["B"]), "A"); // non-A-series tags don't advance the counter
});

test("isValidLedgerTag round-trips through F2c's canonical orderId helpers", () => {
  assert.equal(isValidLedgerTag("A2"), true);
  assert.equal(isValidLedgerTag("A2B9"), true);
  assert.equal(isValidLedgerTag("a2"), false);
  assert.equal(isValidLedgerTag(""), false);
  assert.equal(isValidLedgerTag("A-B"), false);
});

test("mintOrValidateStandbyTag: pre-minted tags are used verbatim; corrupt ones refuse the flip; minting skips other standbys' tags", () => {
  const doc = fixtureDoc();
  assert.equal(mintOrValidateStandbyTag({ id: "s", uri: "u", tag: "A9" }, doc), "A9");
  assert.throws(() => mintOrValidateStandbyTag({ id: "s", uri: "u", tag: "A2" }, doc), /unusable pre-minted tag/); // collides with a ledger
  assert.throws(() => mintOrValidateStandbyTag({ id: "s", uri: "u", tag: "C" }, doc), /unusable pre-minted tag/); // reserved CORE tag
  assert.throws(() => mintOrValidateStandbyTag({ id: "s", uri: "u", tag: "a2" }, doc), /unusable pre-minted tag/); // fails the canonical round-trip
  const withTaggedSibling = fixtureDoc({
    standby: [
      { id: "s1", uri: "u1" },
      { id: "s2", uri: "u2", tag: "A3" },
    ],
  });
  assert.equal(
    mintOrValidateStandbyTag({ id: "s1", uri: "u1" }, withTaggedSibling),
    "A4", // skips the sibling's pre-minted A3
  );
});

test("a flip promotes a PRE-MINTED standby tag verbatim", async () => {
  const rec = installDeps({
    doc: fixtureDoc({
      standby: [{ id: "l-next", uri: "enc:mongodb://next/db", tag: "A9", empty: true }],
    }),
    stats: { "l-a2": { dataSize: Math.round(QUOTA * 0.9), indexSize: 0 } },
  });
  const res = await scaleCheck();
  assert.equal(res.status, "flipped");
  assert.equal(res.flip?.toTag, "A9");
  const set = flipSetOf(rec.updates[0]);
  assert.equal(set.ledgers[2].tag, "A9");
});
