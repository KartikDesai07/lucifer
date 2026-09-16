// Dev verify script — prints pass/fail lines only, NEVER the ingest secret.
// (The no-console gate covers lib/, not scripts/.) Run via
// `npm run verify:heartbeat-live` with HUB_MONGODB_URI → the scratch db and
// HUB_INGEST_SECRET set to any throwaway value (the script sets one if absent).
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

import mongoose, { Types } from "mongoose";

import {
  HEARTBEAT_TTL_SECONDS,
  INGEST_SIG_HEADER,
  INGEST_TS_HEADER,
  type HeartbeatIngest,
} from "@pos/shared/heartbeat";

import { connectDB } from "../lib/db";
import { signIngest } from "../lib/heartbeat-hmac";
import { Heartbeat } from "../models/Heartbeat";
import { Task } from "../models/Task";
import { Tenant } from "../models/Tenant";
import { POST } from "../app/api/ingest/heartbeat/route";

// ─────────────────────────────────────────────────────────────────────────────
// LIVE F3.7 round-trip on a SCRATCH db (the F3.2–F3.6 precedent): the exact
// step-spec verify — a synthetic 76% heartbeat enqueues ADD_DB_CLUSTER; 3×
// hostOk:false enqueues FAILOVER; a bad signature is rejected with nothing
// written — plus the TTL index materializing on the real server, the openKey
// partial-unique dedupe, the reopen-snooze, the Tenant mirror-sync (core row →
// primary entry), the servedOrigin swap path, and the unknown-tenant refusal.
// Prefix-guarded (refuses unless the db is exactly `hubreg_verify`), dropped after.
// ─────────────────────────────────────────────────────────────────────────────

const SCRATCH_DB = "hubreg_verify";
const SLUG = "verify-cafe";

function requestFor(body: unknown, opts: { sig?: string; tsOffsetS?: number } = {}): Request {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000) + (opts.tsOffsetS ?? 0));
  const sig = opts.sig ?? signIngest(process.env.HUB_INGEST_SECRET!, ts, raw);
  return new Request("http://hub.local/api/ingest/heartbeat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [INGEST_TS_HEADER]: ts,
      [INGEST_SIG_HEADER]: sig,
    },
    body: raw,
  });
}

function beat(overrides: Partial<HeartbeatIngest> = {}): HeartbeatIngest {
  return { tenant: SLUG, hostOk: true, at: new Date().toISOString(), ...overrides };
}

const HOT_LEDGER = {
  name: "pos-orders-a",
  role: "ledger" as const,
  active: true,
  state: "ok" as const,
  usedPct: 0.76,
  dataSize: 380_000_000,
  indexSize: 30_000_000,
};

async function post(body: unknown, opts?: { sig?: string; tsOffsetS?: number }) {
  const res = await POST(requestFor(body, opts));
  return { status: res.status, json: (await res.json()) as { success: boolean; data?: { triggers: Array<{ type: string; outcome: string }> } } };
}

async function main() {
  const uri = process.env.HUB_MONGODB_URI ?? "";
  const dbInUri = uri.split("?")[0].split("/").pop();
  assert.equal(dbInUri, SCRATCH_DB, `refusing: URI db must be '${SCRATCH_DB}'`);
  if (!process.env.HUB_INGEST_SECRET) {
    process.env.HUB_INGEST_SECRET = randomBytes(32).toString("base64");
  }

  await connectDB();
  assert.equal(mongoose.connection.name, SCRATCH_DB, "connected db is the scratch db");
  console.log(`✓ connected to scratch db '${SCRATCH_DB}'`);

  try {
    // Force index builds so the TTL + partial-unique legs run against the server.
    await Promise.all([Heartbeat.init(), Task.init(), Tenant.init()]);

    // Seed an ACTIVE tenant with the F3.6-shaped pools.
    await Tenant.create({
      slug: SLUG,
      status: "active",
      ownerEmail: "owner@verify.local",
      businessType: "cafe",
      hosting: [
        { accountLabel: "vercel-1", role: "active" },
        { accountLabel: "vercel-2", role: "standby" },
      ],
      dbPool: [
        { accountLabel: "atlas-1", clusterName: "pos-core", role: "primary" },
        { accountLabel: "atlas-1", clusterName: "pos-orders-a", role: "orders-current" },
      ],
      imagePool: [{ provider: "cloudinary", accountLabel: "cloudinary-1", cloudName: "verify", role: "active" }],
    });

    // ── TTL index materialized on the real server, exactly the shared spec ──
    const hbIndexes = await Heartbeat.collection.indexes();
    const ttl = hbIndexes.find((ix) => ix.expireAfterSeconds !== undefined);
    assert.ok(ttl, "a TTL index exists on heartbeats");
    assert.deepEqual(ttl!.key, { ts: 1 });
    assert.equal(ttl!.expireAfterSeconds, HEARTBEAT_TTL_SECONDS);
    console.log("✓ heartbeats TTL index live: {ts:1} 7d (the ONLY registry TTL)");

    // ── Bad signature / stale ts / unknown tenant: rejected, NOTHING written ──
    const badSig = await post(beat(), { sig: "0".repeat(64) });
    assert.equal(badSig.status, 401);
    const staleTs = await post(beat(), { tsOffsetS: -3600 });
    assert.equal(staleTs.status, 401);
    const unknown = await post(beat({ tenant: "nobody-here" }));
    assert.equal(unknown.status, 404);
    assert.equal(await Heartbeat.countDocuments(), 0, "no sample stored by any refusal");
    assert.equal(await Task.countDocuments(), 0, "no task minted by any refusal");
    console.log("✓ bad signature 401 / stale ts 401 / unknown tenant 404 — nothing written");

    // ── The SPEC leg: a synthetic 76% heartbeat enqueues ADD_DB_CLUSTER ──────
    const trip = await post(
      beat({
        stats: "ok",
        servedOrigin: "active",
        clusters: [
          { name: "core", role: "core", state: "ok", usedPct: 0.11, dataSize: 50_000_000, indexSize: 9_000_000 },
          HOT_LEDGER,
        ],
      }),
    );
    assert.equal(trip.status, 200);
    assert.deepEqual(trip.json.data!.triggers, [{ type: "ADD_DB_CLUSTER", outcome: "enqueued" }]);
    const task1 = await Task.findOne({ type: "ADD_DB_CLUSTER" }).lean();
    assert.equal(task1!.status, "open");
    assert.equal(task1!.tenantSlug, SLUG);
    assert.equal(task1!.payload!.fillingLedger, "pos-orders-a");
    assert.equal(task1!.payload!.usedPct, 0.76);
    const sample = await Heartbeat.findOne({ tenant: SLUG }).lean();
    assert.deepEqual(sample!.triggered, ["ADD_DB_CLUSTER"]);
    assert.ok(sample!.ts instanceof Date, "Hub-stamped ts");
    console.log("✓ SPEC: synthetic 76% heartbeat → ADD_DB_CLUSTER open task + stored sample");

    // ── Mirror-sync: ledger row by clusterName; CORE row → the primary entry ──
    const t1 = await Tenant.findOne({ slug: SLUG }).lean();
    const orders = t1!.dbPool.find((c) => c.clusterName === "pos-orders-a")!;
    assert.equal(orders.usedPct, 0.76);
    assert.equal(orders.usedBytes, 410_000_000);
    assert.equal(orders.state, "idle");
    assert.ok(orders.lastStatAt instanceof Date);
    const primary = t1!.dbPool.find((c) => c.role === "primary")!;
    assert.equal(primary.usedPct, 0.11, "core row synced onto the primary entry");
    const activeHost = t1!.hosting.find((h) => h.role === "active")!;
    assert.equal(activeHost.health!.state, "up");
    console.log("✓ mirror-sync: ledger by clusterName + core→primary + hosting health");

    // ── Dedupe: a second 76% beat is already-open; exactly ONE open task ─────
    const again = await post(beat({ clusters: [HOT_LEDGER] }));
    assert.deepEqual(again.json.data!.triggers, [{ type: "ADD_DB_CLUSTER", outcome: "already-open" }]);
    assert.equal(await Task.countDocuments({ type: "ADD_DB_CLUSTER" }), 1);
    console.log("✓ dedupe: re-trip → already-open, still exactly one task");

    // ── Reopen-snooze: closing the task suppresses a fresh mint for 24h ──────
    await Task.updateOne({ _id: task1!._id }, { $set: { status: "dismissed" }, $unset: { openKey: "" } });
    const snoozed = await post(beat({ clusters: [HOT_LEDGER] }));
    assert.deepEqual(snoozed.json.data!.triggers, [{ type: "ADD_DB_CLUSTER", outcome: "snoozed" }]);
    assert.equal(await Task.countDocuments({ type: "ADD_DB_CLUSTER" }), 1, "no re-mint inside the snooze");
    console.log("✓ reopen-snooze: dismissed task suppresses the re-mint");

    // ── Partial-unique proof: TWO closed tasks coexist (openKey absent twice) ──
    await Task.create({
      tenantId: task1!.tenantId as Types.ObjectId,
      tenantSlug: SLUG,
      type: "ADD_DB_CLUSTER",
      status: "done",
      reason: "second closed row — partial unique ignores openKey-less docs",
    });
    assert.equal(await Task.countDocuments({ type: "ADD_DB_CLUSTER" }), 2);
    console.log("✓ partial unique: two closed same-type tasks coexist (index only guards open ones)");

    // ── SPEC leg: 3× hostOk:false → FAILOVER on the 3rd only ─────────────────
    const down1 = await post(beat({ hostOk: false }));
    assert.deepEqual(down1.json.data!.triggers, [], "1st miss — no trip");
    const down2 = await post(beat({ hostOk: false }));
    assert.deepEqual(down2.json.data!.triggers, [], "2nd miss — no trip");
    const down3 = await post(beat({ hostOk: false }));
    assert.deepEqual(down3.json.data!.triggers, [{ type: "FAILOVER", outcome: "enqueued" }]);
    const fo = await Task.findOne({ type: "FAILOVER", status: "open" }).lean();
    assert.deepEqual(fo!.payload, { via: "pings", missedPings: 3 });
    console.log("✓ SPEC: 3× hostOk:false → FAILOVER enqueued on the 3rd ping only");

    // ── The swap path: servedOrigin 'standby' trips FAILOVER immediately ─────
    await Task.deleteMany({ type: "FAILOVER" }); // clear so the snooze doesn't mask the swap leg
    const swapped = await post(beat({ servedOrigin: "standby" }));
    assert.deepEqual(swapped.json.data!.triggers, [{ type: "FAILOVER", outcome: "enqueued" }]);
    const foSwap = await Task.findOne({ type: "FAILOVER", status: "open" }).lean();
    assert.deepEqual(foSwap!.payload, { via: "swap" });
    // The served-origin verdict lands on the STANDBY hosting entry; the active
    // entry keeps its pre-swap 'down' stamp (the 3 down-pings above) — truth.
    const tSwap = await Tenant.findOne({ slug: SLUG }).lean();
    assert.equal(tSwap!.hosting.find((h) => h.role === "standby")!.health!.state, "up");
    assert.equal(tSwap!.hosting.find((h) => h.role === "active")!.health!.state, "down");
    console.log("✓ swap signal: immediate FAILOVER (via 'swap') + health stamped on the STANDBY entry");

    // ── Image trip: creditsPct 80% → ADD_CLOUD + imagePool usage mirrored ────
    const img = await post(beat({ imageUsage: { creditsPct: 0.8 } }));
    assert.deepEqual(img.json.data!.triggers, [{ type: "ADD_CLOUD", outcome: "enqueued" }]);
    const t2 = await Tenant.findOne({ slug: SLUG }).lean();
    const cloud = t2!.imagePool.find((c) => c.role === "active")!;
    assert.equal(cloud.usage!.creditsPct, 0.8);
    assert.ok(cloud.lastUsageAt instanceof Date);
    console.log("✓ image: 80% credits → ADD_CLOUD + imagePool usage mirrored");

    // ── Per-tenant flood bound: the 8 posts above used the whole 15-min window;
    // a 9th valid-signature beat is refused AND stores nothing (M0-fill guard) ──
    const flooded = await post(beat());
    assert.equal(flooded.status, 429);
    assert.equal(await Heartbeat.countDocuments({ tenant: SLUG }), 8, "8 stored samples, the 9th refused");
    console.log("✓ per-tenant rate limit: 9th beat in the window → 429, nothing stored");

    console.log("\nALL HEARTBEAT LIVE LEGS GREEN");
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    console.log(`✓ scratch db '${SCRATCH_DB}' dropped`);
  }
}

main().catch((err) => {
  console.error("VERIFY FAILED:", err);
  process.exitCode = 1;
});
