import type { HeartbeatIngest } from "@pos/shared/heartbeat";
import type { ITaskPayload, TaskType } from "@/models/Task";
import {
  FAILOVER_CONSECUTIVE_MISSES,
  FAILOVER_WINDOW_MS,
  FILL_TRIP_PCT,
  IMAGE_TRIP_PCT,
} from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────────────────
// F3.7 — trigger evaluation + the Tenant mirror-update builder. PURE (no IO):
// lib/heartbeat-ingest.ts feeds it the envelope + tenant status + prior pings
// and executes what it returns.
//
// The 75% hard-trip is the SECOND half of the staged scale event (F2 §2.7 /
// F2c §7): the runtime's scaleCheck prompts/rolls at ~70% — but its entry point
// is HUB-DRIVEN and not yet wired (apps/cafe/lib/ledger-scale.ts header), so
// the trip must NOT be suppressed by a warm standby (the pre-code critique's
// deadlock: runtime never rolls on its own, Hub never trips → the ledger sails
// into the 85% critical zone). The spec's "no sibling orders-current with room"
// clause is vacuous runtime-side — there is exactly ONE active write ledger —
// so any active ledger at ≥75% trips; the task payload carries the ok-standby
// count so F3.8 can PROMOTE a warm standby instead of minting an M0.
// ─────────────────────────────────────────────────────────────────────────────

export interface TriggerDecision {
  type: TaskType;
  reason: string;
  payload: ITaskPayload;
}

/** A prior stored heartbeat's ping verdict (newest-first at the call site). */
export interface PriorPing {
  hostOk: boolean;
  ts: Date;
}

export interface TriggerInput {
  body: HeartbeatIngest;
  /** Registry Tenant.status — triggers evaluate ONLY for 'active' (a suspended/
   *  archived tenant's dark host is expected; provisioning tenants have no
   *  Worker poll yet). Samples are still STORED regardless (monitoring truth). */
  tenantStatus: string;
  /** The FAILOVER_CONSECUTIVE_MISSES−1 most recent PRIOR heartbeats. */
  priorPings: PriorPing[];
  now: Date;
}

const pctLabel = (v: number) => `${Math.round(v * 100)}%`;

function dbTrigger(body: HeartbeatIngest): TriggerDecision | null {
  const rows = body.clusters ?? [];
  // The single write target: the active ledger — or CORE in the bootstrap era
  // (no registry doc yet: CORE doubles as the one ledger, so its fill IS the
  // order-ledger fill; F2c's conservative dataSize+indexSize gauge either way).
  const writeLedger = body.bootstrap
    ? rows.find((r) => r.role === "core")
    : rows.find((r) => r.role === "ledger" && r.active === true);
  if (!writeLedger || writeLedger.state !== "ok") return null;
  const usedPct = writeLedger.usedPct;
  if (typeof usedPct !== "number" || !Number.isFinite(usedPct) || usedPct < FILL_TRIP_PCT) {
    return null;
  }
  const standbysOk = rows.filter((r) => r.role === "standby" && r.state === "ok").length;
  return {
    type: "ADD_DB_CLUSTER",
    reason:
      `write ledger '${writeLedger.name}' at ${pctLabel(usedPct)} (trip ${pctLabel(FILL_TRIP_PCT)})` +
      (body.bootstrap ? " — bootstrap era (CORE doubles as the ledger)" : "") +
      (standbysOk > 0 ? ` — ${standbysOk} warm standby available to promote` : " — no warm standby"),
    payload: {
      fillingLedger: writeLedger.name,
      usedPct,
      ...(body.bootstrap ? { bootstrap: true } : {}),
      standbysOk,
    },
  };
}

function imageTrigger(body: HeartbeatIngest): TriggerDecision | null {
  const iu = body.imageUsage;
  if (!iu) return null;
  const over = (["storagePct", "bandwidthPct", "creditsPct"] as const).filter((k) => {
    const v = iu[k];
    return typeof v === "number" && Number.isFinite(v) && v >= IMAGE_TRIP_PCT;
  });
  if (over.length === 0) return null;
  return {
    type: "ADD_CLOUD",
    reason:
      `image store ${over.map((k) => `${k} ${pctLabel(iu[k]!)}`).join(", ")} ` +
      `(trip ${pctLabel(IMAGE_TRIP_PCT)}) — manual-signup-gated (F3.9 checklist + paste)`,
    payload: {
      ...(iu.storagePct === undefined ? {} : { storagePct: iu.storagePct }),
      ...(iu.bandwidthPct === undefined ? {} : { bandwidthPct: iu.bandwidthPct }),
      ...(iu.creditsPct === undefined ? {} : { creditsPct: iu.creditsPct }),
    },
  };
}

function failoverTrigger(input: TriggerInput): TriggerDecision | null {
  const { body, priorPings, now } = input;
  // Path 1 — the Worker ALREADY swapped (F1.7's origin flip): the accurate,
  // immediate signal. The task is F3.10's bookkeeping: registry role swap +
  // alert — the swap itself was the Worker's job and has happened.
  if (body.servedOrigin === "standby") {
    return {
      type: "FAILOVER",
      reason: "worker is serving the STANDBY origin — reconcile registry roles + alert (F3.10)",
      payload: { via: "swap" },
    };
  }
  // Path 2 — ping-counting (the spec's N-miss trip): with the Worker swapping
  // on its own, N consecutive misses at the forward cadence means BOTH origins
  // are dark — the everything-is-down alarm. Time-bounded so stale misses from
  // a suspension gap or a long Worker outage never straddle into a fresh streak.
  if (body.hostOk) return null;
  const cutoff = now.getTime() - FAILOVER_WINDOW_MS;
  const recentMisses = priorPings.filter((p) => !p.hostOk && p.ts.getTime() >= cutoff).length;
  if (recentMisses + 1 < FAILOVER_CONSECUTIVE_MISSES) return null;
  return {
    type: "FAILOVER",
    reason:
      `${FAILOVER_CONSECUTIVE_MISSES} consecutive failed host pings — ` +
      "currently-served origin dark (dual-outage alarm)",
    payload: { via: "pings", missedPings: FAILOVER_CONSECUTIVE_MISSES },
  };
}

/** Evaluate every trigger for one ingested heartbeat. Pure; the caller stores
 *  the sample, applies the mirror, and enqueues the decisions. */
export function evaluateTriggers(input: TriggerInput): TriggerDecision[] {
  if (input.tenantStatus !== "active") return [];
  const decisions: TriggerDecision[] = [];
  const db = dbTrigger(input.body);
  if (db) decisions.push(db);
  const img = imageTrigger(input.body);
  if (img) decisions.push(img);
  const fo = failoverTrigger(input);
  if (fo) decisions.push(fo);
  return decisions;
}

// ── The Tenant mirror update (pure builder; ingest executes it) ──────────────

export interface MirrorUpdate {
  set: Record<string, unknown>;
  arrayFilters: Record<string, unknown>[];
}

/**
 * Build the ONE updateOne that syncs the registry Tenant doc's gauges from a
 * heartbeat: per-cluster dbPool fill (each row gets its OWN arrayFilter
 * identifier — a shared `$[elem]` would write one value to every match), the
 * SERVED hosting entry's health, and the active image entry's usage.
 *
 * Hosting target: `hostOk` gauges the CURRENTLY-SERVED origin (the shared
 * envelope contract), so during a standby-served window the stamp lands on the
 * `role:'standby'` entry — stamping 'active' would mark the dead active origin
 * 'up' for the whole window (review fix). The active entry then keeps its last
 * pre-swap 'down' stamp, which is the truth.
 *
 * Row → dbPool matching: a `core` row maps to the `role:'primary'` entry (the
 * runtime's CORE id is the literal 'core' — env-fixed CORE_CLUSTER_ID — while
 * the registry stores the Atlas clusterName 'pos-core'; matching by name would
 * silently never sync the primary). Ledger rows match `clusterName` (the
 * provisioner uses the Atlas clusterName as the runtime ledger id). Standby
 * rows are SKIPPED — dbPool has no standby role today (F3.8 adds entries when
 * it promotes/mints). Only `state:'ok'` rows sync: an error row leaves the
 * mirror untouched, and its staleness stays visible via lastStatAt.
 *
 * Duplicate targets are deduped (first row wins): two rows resolving to the
 * same dbPool element would make MongoDB reject the whole update as a path
 * conflict. Dedupe is by RESOLVED FILTER, so a hostile-but-signed payload
 * pairing a core row with a ledger row NAMED like the primary's clusterName
 * can still conflict — accepted (trusted-Worker payloads never do this; the
 * failure is an honest 500 with the sample already stored).
 */
export function buildMirrorUpdate(body: HeartbeatIngest, ts: Date): MirrorUpdate {
  const hostRole = body.servedOrigin === "standby" ? "standby" : "active";
  const set: Record<string, unknown> = {
    "hosting.$[h].health": { state: body.hostOk ? "up" : "down", lastPingAt: ts },
  };
  const arrayFilters: Record<string, unknown>[] = [{ "h.role": hostRole }];

  const seenTargets = new Set<string>();
  (body.clusters ?? []).forEach((row, i) => {
    if (row.state !== "ok" || row.role === "standby") return;
    const target = row.role === "core" ? "role:primary" : `name:${row.name}`;
    if (seenTargets.has(target)) return;
    seenTargets.add(target);
    const id = `c${i}`;
    arrayFilters.push(
      row.role === "core" ? { [`${id}.role`]: "primary" } : { [`${id}.clusterName`]: row.name },
    );
    if (typeof row.usedPct === "number") set[`dbPool.$[${id}].usedPct`] = row.usedPct;
    if (typeof row.dataSize === "number" && typeof row.indexSize === "number") {
      set[`dbPool.$[${id}].usedBytes`] = row.dataSize + row.indexSize;
    }
    set[`dbPool.$[${id}].state`] = row.paused === true ? "paused" : "idle";
    set[`dbPool.$[${id}].lastStatAt`] = ts;
  });

  if (body.imageUsage) {
    set["imagePool.$[img].usage"] = body.imageUsage;
    set["imagePool.$[img].lastUsageAt"] = ts;
    arrayFilters.push({ "img.role": "active" });
  }

  return { set, arrayFilters };
}
