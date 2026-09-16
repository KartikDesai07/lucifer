import { test } from "node:test";
import assert from "node:assert/strict";

import type { HeartbeatCluster, HeartbeatIngest } from "@pos/shared/heartbeat";

import {
  buildMirrorUpdate,
  evaluateTriggers,
  type PriorPing,
  type TriggerInput,
} from "./heartbeat-triggers";
import {
  FAILOVER_CONSECUTIVE_MISSES,
  FAILOVER_WINDOW_MS,
  FILL_TRIP_PCT,
} from "./constants";

const NOW = new Date("2026-07-14T12:00:00.000Z");

function body(overrides: Partial<HeartbeatIngest> = {}): HeartbeatIngest {
  return { tenant: "verify-cafe", hostOk: true, at: NOW.toISOString(), ...overrides };
}

function ledger(overrides: Partial<HeartbeatCluster> = {}): HeartbeatCluster {
  return {
    name: "pos-orders-a",
    tag: "A",
    role: "ledger",
    active: true,
    state: "ok",
    usedPct: 0.5,
    dataSize: 200_000_000,
    indexSize: 50_000_000,
    ...overrides,
  };
}

function evaluate(input: Partial<TriggerInput> & { body: HeartbeatIngest }) {
  return evaluateTriggers({ tenantStatus: "active", priorPings: [], now: NOW, ...input });
}

const types = (ds: ReturnType<typeof evaluateTriggers>) => ds.map((d) => d.type);

// ── ADD_DB_CLUSTER ────────────────────────────────────────────────────────────

test("db: active ledger at 76% trips; 74% does not; 75% exact trips (>=)", () => {
  assert.deepEqual(types(evaluate({ body: body({ clusters: [ledger({ usedPct: 0.76 })] }) })), ["ADD_DB_CLUSTER"]);
  assert.deepEqual(types(evaluate({ body: body({ clusters: [ledger({ usedPct: 0.74 })] }) })), []);
  assert.deepEqual(types(evaluate({ body: body({ clusters: [ledger({ usedPct: FILL_TRIP_PCT })] }) })), ["ADD_DB_CLUSTER"]);
});

test("db: a warm ok standby does NOT suppress the trip (the roll-forward has no self-driver) — it rides the payload as the F3.8 promote hint", () => {
  const ds = evaluate({
    body: body({
      clusters: [
        ledger({ usedPct: 0.8 }),
        { name: "pos-orders-b", role: "standby", state: "ok", usedPct: 0.01 },
      ],
    }),
  });
  assert.deepEqual(types(ds), ["ADD_DB_CLUSTER"]);
  assert.equal(ds[0].payload.standbysOk, 1);
  assert.equal(ds[0].payload.fillingLedger, "pos-orders-a");
  assert.equal(ds[0].payload.usedPct, 0.8);
  assert.equal(ds[0].payload.bootstrap, undefined);
});

test("db: only the ACTIVE write ledger gauges the trip — a full archive or an error-state active never trips", () => {
  // 90% archive (non-active) + healthy active: no trip.
  assert.deepEqual(
    types(evaluate({
      body: body({
        clusters: [ledger({ usedPct: 0.3 }), ledger({ name: "pos-orders-old", tag: "A0", active: false, usedPct: 0.9 })],
      }),
    })),
    [],
  );
  // Error-state active (usedPct absent): cannot gauge, no trip.
  assert.deepEqual(
    types(evaluate({ body: body({ clusters: [ledger({ state: "error", usedPct: undefined })] }) })),
    [],
  );
});

test("db: bootstrap era — the CORE row doubles as the ledger and trips with the bootstrap payload flag", () => {
  const core: HeartbeatCluster = { name: "core", tag: "C", role: "core", state: "ok", usedPct: 0.8 };
  const ds = evaluate({ body: body({ bootstrap: true, clusters: [core] }) });
  assert.deepEqual(types(ds), ["ADD_DB_CLUSTER"]);
  assert.equal(ds[0].payload.fillingLedger, "core");
  assert.equal(ds[0].payload.bootstrap, true);
  // WITHOUT the bootstrap flag a hot core row is NOT the write ledger — no trip.
  assert.deepEqual(types(evaluate({ body: body({ clusters: [core] }) })), []);
});

// ── ADD_CLOUD ─────────────────────────────────────────────────────────────────

test("image: creditsPct 75% trips (the free-plan meter); all below threshold does not; absent does not", () => {
  const ds = evaluate({ body: body({ imageUsage: { creditsPct: 0.75 } }) });
  assert.deepEqual(types(ds), ["ADD_CLOUD"]);
  assert.equal(ds[0].payload.creditsPct, 0.75);
  assert.match(ds[0].reason, /manual-signup-gated/);
  assert.deepEqual(
    types(evaluate({ body: body({ imageUsage: { storagePct: 0.7, bandwidthPct: 0.7, creditsPct: 0.7 } }) })),
    [],
  );
  assert.deepEqual(types(evaluate({ body: body({}) })), []);
});

test("image: storage or bandwidth at 80% trips too (paid-plan meters)", () => {
  assert.deepEqual(types(evaluate({ body: body({ imageUsage: { storagePct: 0.8 } }) })), ["ADD_CLOUD"]);
  assert.deepEqual(types(evaluate({ body: body({ imageUsage: { bandwidthPct: 0.8 } }) })), ["ADD_CLOUD"]);
});

// ── FAILOVER ──────────────────────────────────────────────────────────────────

const miss = (agoMs: number): PriorPing => ({ hostOk: false, ts: new Date(NOW.getTime() - agoMs) });
const okPing = (agoMs: number): PriorPing => ({ hostOk: true, ts: new Date(NOW.getTime() - agoMs) });

test("failover via swap: servedOrigin 'standby' trips immediately, even with hostOk:true", () => {
  const ds = evaluate({ body: body({ servedOrigin: "standby", hostOk: true }) });
  assert.deepEqual(types(ds), ["FAILOVER"]);
  assert.equal(ds[0].payload.via, "swap");
});

test("failover via pings: trips only on the Nth consecutive recent miss", () => {
  const down = body({ hostOk: false });
  // 3rd consecutive (current + 2 recent priors) → trip.
  const ds = evaluate({ body: down, priorPings: [miss(15 * 60_000), miss(30 * 60_000)] });
  assert.deepEqual(types(ds), ["FAILOVER"]);
  assert.deepEqual(ds[0].payload, { via: "pings", missedPings: FAILOVER_CONSECUTIVE_MISSES });
  // Only 1 prior miss → no trip. A hostOk prior breaks the streak → no trip.
  assert.deepEqual(types(evaluate({ body: down, priorPings: [miss(15 * 60_000)] })), []);
  assert.deepEqual(types(evaluate({ body: down, priorPings: [okPing(15 * 60_000), miss(30 * 60_000)] })), []);
  // Current ping healthy → never a pings trip.
  assert.deepEqual(types(evaluate({ body: body(), priorPings: [miss(15 * 60_000), miss(30 * 60_000)] })), []);
});

test("failover via pings: misses outside the window don't count (a suspension gap can't straddle into a streak)", () => {
  const down = body({ hostOk: false });
  const stale = miss(FAILOVER_WINDOW_MS + 60_000);
  assert.deepEqual(types(evaluate({ body: down, priorPings: [miss(15 * 60_000), stale] })), []);
});

// ── Status gate + composition ────────────────────────────────────────────────

test("triggers evaluate ONLY for status 'active' — a suspended tenant's dark host is expected", () => {
  const hot = body({ clusters: [ledger({ usedPct: 0.9 })], imageUsage: { creditsPct: 0.9 }, hostOk: false, servedOrigin: "standby" });
  for (const status of ["provisioning", "suspended", "failover", "archived"]) {
    assert.deepEqual(types(evaluate({ body: hot, tenantStatus: status })), [], status);
  }
});

test("one heartbeat can trip all three triggers", () => {
  const ds = evaluate({
    body: body({
      clusters: [ledger({ usedPct: 0.8 })],
      imageUsage: { creditsPct: 0.8 },
      servedOrigin: "standby",
    }),
  });
  assert.deepEqual(types(ds), ["ADD_DB_CLUSTER", "ADD_CLOUD", "FAILOVER"]);
});

// ── buildMirrorUpdate ─────────────────────────────────────────────────────────

test("mirror: hosting health stamps on every heartbeat; up/down follows hostOk", () => {
  const up = buildMirrorUpdate(body(), NOW);
  assert.deepEqual(up.set["hosting.$[h].health"], { state: "up", lastPingAt: NOW });
  assert.deepEqual(up.arrayFilters, [{ "h.role": "active" }]);
  const down = buildMirrorUpdate(body({ hostOk: false }), NOW);
  assert.deepEqual(down.set["hosting.$[h].health"], { state: "down", lastPingAt: NOW });
});

test("mirror: hostOk gauges the SERVED origin — a standby-served beat stamps the standby entry, never 'active' (review fix)", () => {
  const swapped = buildMirrorUpdate(body({ servedOrigin: "standby" }), NOW);
  assert.deepEqual(swapped.arrayFilters[0], { "h.role": "standby" });
  assert.deepEqual(swapped.set["hosting.$[h].health"], { state: "up", lastPingAt: NOW });
  // Explicit 'active' and absent both stamp the active entry (older Worker).
  assert.deepEqual(buildMirrorUpdate(body({ servedOrigin: "active" }), NOW).arrayFilters[0], { "h.role": "active" });
  assert.deepEqual(buildMirrorUpdate(body(), NOW).arrayFilters[0], { "h.role": "active" });
});

test("mirror: duplicate-target rows dedupe (first wins) — two identifiers may never aim at one dbPool element (review fix)", () => {
  const up = buildMirrorUpdate(
    body({
      clusters: [
        ledger({ usedPct: 0.41 }),
        ledger({ usedPct: 0.99, active: false }), // same name — MongoDB would reject the conflicting paths
        { name: "core", role: "core", state: "ok", usedPct: 0.1, dataSize: 1, indexSize: 1 },
        { name: "core", role: "core", state: "ok", usedPct: 0.9, dataSize: 9, indexSize: 9 }, // duplicate core target
      ],
    }),
    NOW,
  );
  assert.equal(up.set["dbPool.$[c0].usedPct"], 0.41, "first same-name row wins");
  assert.ok(!("dbPool.$[c1].usedPct" in up.set), "duplicate-name row dropped");
  assert.equal(up.set["dbPool.$[c2].usedPct"], 0.1, "first core row wins");
  assert.ok(!("dbPool.$[c3].usedPct" in up.set), "duplicate core row dropped");
  assert.equal(up.arrayFilters.length, 3, "hosting + one ledger + one core");
});

test("mirror: each ok cluster row gets its OWN arrayFilter identifier with its OWN values", () => {
  const up = buildMirrorUpdate(
    body({
      clusters: [
        ledger({ usedPct: 0.41, dataSize: 100, indexSize: 10 }),
        ledger({ name: "pos-orders-b", tag: "B", active: false, usedPct: 0.62, dataSize: 200, indexSize: 20 }),
      ],
    }),
    NOW,
  );
  assert.equal(up.set["dbPool.$[c0].usedPct"], 0.41);
  assert.equal(up.set["dbPool.$[c0].usedBytes"], 110);
  assert.equal(up.set["dbPool.$[c1].usedPct"], 0.62);
  assert.equal(up.set["dbPool.$[c1].usedBytes"], 220);
  assert.deepEqual(up.arrayFilters[1], { "c0.clusterName": "pos-orders-a" });
  assert.deepEqual(up.arrayFilters[2], { "c1.clusterName": "pos-orders-b" });
});

test("mirror: the core row maps to the role:'primary' entry (runtime id 'core' ≠ Atlas clusterName)", () => {
  const up = buildMirrorUpdate(
    body({ clusters: [{ name: "core", role: "core", state: "ok", usedPct: 0.2, dataSize: 5, indexSize: 5 }] }),
    NOW,
  );
  assert.deepEqual(up.arrayFilters[1], { "c0.role": "primary" });
  assert.equal(up.set["dbPool.$[c0].usedPct"], 0.2);
});

test("mirror: error rows and standby rows are skipped; paused maps to state 'paused'", () => {
  const up = buildMirrorUpdate(
    body({
      clusters: [
        ledger({ state: "error", usedPct: undefined }),
        { name: "pos-orders-b", role: "standby", state: "ok", usedPct: 0.01 },
        ledger({ name: "pos-orders-old", active: false, paused: true, usedPct: 0.9 }),
      ],
    }),
    NOW,
  );
  // Only the paused archive row (index 2) survives — identified as c2.
  const dbKeys = Object.keys(up.set).filter((k) => k.startsWith("dbPool"));
  assert.ok(dbKeys.every((k) => k.includes("$[c2]")), `only c2 synced: ${dbKeys.join(", ")}`);
  assert.equal(up.set["dbPool.$[c2].state"], "paused");
  assert.equal(up.arrayFilters.length, 2, "hosting + c2 only");
});

test("mirror: imageUsage syncs the active image entry; every declared arrayFilter identifier is referenced", () => {
  const up = buildMirrorUpdate(
    body({ clusters: [ledger()], imageUsage: { creditsPct: 0.4 } }),
    NOW,
  );
  assert.deepEqual(up.set["imagePool.$[img].usage"], { creditsPct: 0.4 });
  assert.equal(up.set["imagePool.$[img].lastUsageAt"], NOW);
  // MongoDB REJECTS an update declaring an arrayFilter it never references —
  // prove structurally that can't happen.
  const setKeys = Object.keys(up.set).join(" ");
  for (const filter of up.arrayFilters) {
    const id = Object.keys(filter)[0].split(".")[0];
    assert.ok(setKeys.includes(`$[${id}]`), `identifier ${id} is referenced`);
  }
});
