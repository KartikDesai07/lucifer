import { type ClusterRef } from "@/lib/cluster-registry";
import {
  core,
  decryptStoredUri,
  BOOTSTRAP_LEDGER_TAG,
  type StoredClusterRegistry,
} from "@/lib/cluster-router";
import {
  applyRegistryUpdate,
  rawDbOf,
  readDbFillStats,
  readStoredRegistryDoc,
} from "@/lib/registry-io";
import { cafeDateString } from "@/lib/utils";
import {
  activeEntryOf,
  buildFlipUpdate,
  buildStatsOnlyUpdate,
  fillPctOf,
  mintOrValidateStandbyTag,
  planFlip,
  rowsFrom,
  SCALE_CRITICAL_FILL_PCT,
  SCALE_PROMPT_FILL_PCT,
  type LedgerFillStats,
  type LedgerScaleRow,
  type RegistryUpdate,
  type StoredLedgerEntry,
} from "@/lib/ledger-scale-plan";

// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.7 — auto-scale: ledger roll-forward + date-window manifest. The
// registry WRITE side (F2.2 only reads the doc): `scaleCheck()` gauges every
// ledger's fill from the conservative `dataSize + indexSize` metric (F2c §2);
// ACTIVE ≥70% full + a warm standby present → flip writes to the standby,
// persisting the manifest with the ONE-DAY window overlap (`L.to =
// startOfTomorrow`, `S.from = startOfToday`) so flip-day reads resolve BOTH
// legs through the F2.6 merge (the FLIP-DAY blockquote, phase-F2 §4). 100%
// automated; NO data migrates (old ledgers become read-only archives).
//
// ENTRY POINT IS HUB-DRIVEN (#26 — NEVER a cafe Vercel cron): F3 wires the Hub
// cron / admin-token route that invokes this; nothing in the cafe app schedules
// it. Warm cafe runtimes pick a flip up within one router TTL (~30s) — the
// additive, NON-REVOKING roll-forward (F2c §7): the retiring ledger stays
// dialable, stale-cache writes still land on it with its tag, and every such
// order remains routable (tag-targeted point reads + the flip-day overlap).
//
// Seams (the F2.3/F2.5 precedent): `setStandbyProvisioner` — F2.8's Atlas
// provisioner is NOT built; the default logs the manual paste-and-Connect
// prompt (the owner-confirmed PRIMARY growth flow, F2 §2.12).
// `__setScaleDepsForTests` — the DB collaborators + clock, so the flip logic is
// provable DB-free; the live round-trip runs on a seeded M0 (F2 integration).
// ─────────────────────────────────────────────────────────────────────────────

/** Per-cluster budget for a stats/ping probe (dial + command) — a hung dial
 *  would otherwise ride `serverSelectionTimeoutMS` (5s); the F2.6 rationale. */
export const SCALE_PROBE_TIMEOUT_MS = 4_000;

export type ScaleStatus =
  | "ok" // active below the 70% prompt threshold
  | "flipped" // rolled forward — manifest persisted with the one-day overlap
  | "prompt-no-standby" // ≥70%, nothing to flip to — owner must paste/provision
  | "critical-no-standby" // ≥85%, nothing to flip to — alarm (M0 rejects at 512MB)
  | "standby-invalid" // ≥70% + standby present but failed validate-before-activate
  | "raced" // CAS lost to a concurrent writer — next Hub run completes
  | "stats-unavailable"; // active ledger's stats unreadable — cannot evaluate, no flip

export interface ScaleCheckResult {
  status: ScaleStatus;
  /** True = no registry doc yet (CORE doubles as the ledger, F2.2's bridge).
   *  Nothing to flip and nothing is persisted — F3 owns doc creation. */
  bootstrap: boolean;
  ledgers: LedgerScaleRow[];
  standbyCount: number;
  flip?: { fromTag: string; toTag: string; oldTo: string; newFrom: string };
}

// ── Injectable DB collaborators + clock ───────────────────────────────────────
interface ScaleDeps {
  readRegistryDoc: () => Promise<StoredClusterRegistry | null>;
  /** Returns matchedCount — 0 means the CAS guard lost (see `buildFlipUpdate`). */
  updateRegistryDoc: (upd: RegistryUpdate) => Promise<number>;
  readStats: (ref: ClusterRef) => Promise<LedgerFillStats>;
  ping: (ref: ClusterRef) => Promise<void>;
  now: () => Date;
}

const realDeps: ScaleDeps = {
  // The shared raw-singleton doc IO (`lib/registry-io.ts`) — single-homed with
  // F2.8's provisioner so the doc-read/-write glue is never forked.
  readRegistryDoc: readStoredRegistryDoc,
  updateRegistryDoc: applyRegistryUpdate,
  // The shared conservative gauge (registry-io, F2.9): garbage stats throw —
  // they must never drive (or suppress) a flip decision.
  readStats: readDbFillStats,
  ping: async (ref) => {
    await (await rawDbOf(ref)).command({ ping: 1 });
  },
  now: () => new Date(),
};
let deps: ScaleDeps = realDeps;
/** TEST SEAM — override the DB-touching collaborators/clock; `null` restores. */
export function __setScaleDepsForTests(
  overrides: Partial<ScaleDeps> | null,
): void {
  deps = overrides ? { ...realDeps, ...overrides } : realDeps;
}

let probeTimeoutMs = SCALE_PROBE_TIMEOUT_MS;
/** TEST SEAM — shrink the probe timeout so hang tests run in ms; `null` restores. */
export function __setScaleProbeTimeoutForTests(ms: number | null): void {
  probeTimeoutMs = ms ?? SCALE_PROBE_TIMEOUT_MS;
}

// ── ensureNextStandby seam (F2.8; manual paste-and-Connect is PRIMARY) ────────
export type StandbyProvisioner = () => Promise<void>;
const defaultProvisioner: StandbyProvisioner = async () => {
  console.warn(
    "[ledger-scale] ensureNextStandby not wired (F2.8/F3) — pre-arm the next standby M0 via the Hub's manual paste-and-Connect flow",
  );
};
let provisioner: StandbyProvisioner = defaultProvisioner;
/** F2.8/F3 wires the Atlas provisioner here; `null` restores the manual prompt. */
export function setStandbyProvisioner(fn: StandbyProvisioner | null): void {
  provisioner = fn ?? defaultProvisioner;
}
function nudgeProvisioner(): void {
  // Fire-and-forget best-effort: provisioning ahead must never block or fail the
  // check (the real F2.8 flow polls cluster creation for minutes; F2.3 precedent).
  void (async () => provisioner())().catch((err) => {
    console.error("[ledger-scale] ensureNextStandby failed (best-effort):", err);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

async function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const bomb = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`[ledger-scale] ${label} timed out after ${probeTimeoutMs}ms`));
    }, probeTimeoutMs);
  });
  try {
    return await Promise.race([p, bomb]);
  } finally {
    clearTimeout(timer);
  }
}

// ── The check (spec: phase-F2 §4 Step F2.7 + the FLIP-DAY blockquote) ─────────
export async function scaleCheck(): Promise<ScaleCheckResult> {
  const doc = await deps.readRegistryDoc();
  if (!doc) return bootstrapCheck();
  const active = activeEntryOf(doc); // ≠1 active → throws (corrupt manifest)

  // Gauge every ledger in parallel (per-probe timeout; a paused archive M0 must
  // degrade to a statsError row, never hang the check — the F2.6 leg semantics).
  const statsById = new Map<string, LedgerFillStats>();
  const statsErrors = new Map<string, string>();
  await Promise.all(
    doc.ledgers.map(async (l) => {
      try {
        const ref = { id: l.id, uri: decryptStoredUri(l.uri) };
        statsById.set(
          l.id,
          await withTimeout(deps.readStats(ref), `stats ${l.id} (${l.tag})`),
        );
      } catch (err) {
        statsErrors.set(l.id, (err as Error).message);
        console.error(`[ledger-scale] db.stats failed on ${l.id} (${l.tag}):`, err);
      }
    }),
  );

  const standby = doc.standby ?? [];
  const rows = rowsFrom(doc.ledgers, statsById, statsErrors);
  const persistStats = async () => {
    const upd = buildStatsOnlyUpdate(doc, statsById);
    if (upd) await deps.updateRegistryDoc(upd);
  };
  const result = (status: ScaleStatus): ScaleCheckResult => ({
    status,
    bootstrap: false,
    ledgers: rows,
    standbyCount: standby.length,
  });

  const activeStats = statsById.get(active.id);
  if (!activeStats) {
    // Unknown fill on the ACTIVE ledger: never flip on a guess (#19 spirit).
    await persistStats();
    return result("stats-unavailable");
  }
  const fill = fillPctOf(activeStats);
  if (fill < SCALE_PROMPT_FILL_PCT) {
    await persistStats();
    return result("ok");
  }
  if (standby.length === 0) {
    await persistStats();
    nudgeProvisioner();
    return result(
      fill >= SCALE_CRITICAL_FILL_PCT ? "critical-no-standby" : "prompt-no-standby",
    );
  }

  // Roll forward. Validate-before-activate (F2c §7): re-verify the standby is
  // dialable NOW — F3's paste-time validate-gate ran the full probe, but a
  // paused/dead standby must never become the write target.
  const next = standby[0];
  const toTag = mintOrValidateStandbyTag(next, doc); // throws on a corrupt tag
  try {
    await withTimeout(
      deps.ping({ id: next.id, uri: decryptStoredUri(next.uri) }),
      `ping standby ${next.id}`,
    );
  } catch (err) {
    console.error(
      `[ledger-scale] standby ${next.id} failed validate-before-activate — active stays (${(fill * 100).toFixed(1)}% full):`,
      err,
    );
    await persistStats();
    nudgeProvisioner();
    return result("standby-invalid");
  }

  // ONE `now` feeds both window bounds (the F2.3 no-midnight-split precedent).
  const now = deps.now();
  const todayIst = cafeDateString(now);
  const tomorrowIst = cafeDateString(new Date(now.getTime() + ONE_DAY_MS));
  const plan = planFlip(doc, next, toTag, statsById, todayIst, tomorrowIst);
  const matched = await deps.updateRegistryDoc(buildFlipUpdate(doc, plan));
  if (matched === 0) return result("raced");

  nudgeProvisioner(); // the standby was consumed — provision the NEXT one ahead
  const { fromTag, oldTo, newFrom } = plan;
  return {
    status: "flipped",
    bootstrap: false,
    ledgers: rowsFrom(plan.newLedgers, statsById, statsErrors),
    standbyCount: plan.newStandby.length,
    flip: { fromTag, toTag, oldTo, newFrom },
  };
}

/** No registry doc = the single-cluster era: CORE doubles as the one ledger.
 *  Gauge it so the Hub can prompt the FIRST paste, but write nothing — doc
 *  creation is F3's paste-and-Connect (this side only UPDATES existing docs). */
async function bootstrapCheck(): Promise<ScaleCheckResult> {
  const c = core(); // env URI — never passes through the doc decryptor
  const tag = BOOTSTRAP_LEDGER_TAG;
  const entry: StoredLedgerEntry = { id: c.id, uri: c.uri, tag, active: true };
  const statsById = new Map<string, LedgerFillStats>();
  const errors = new Map<string, string>();
  let status: ScaleStatus = "ok";
  try {
    const s = await withTimeout(deps.readStats(c), `stats ${c.id} (bootstrap)`);
    statsById.set(c.id, s);
    const fill = fillPctOf(s);
    if (fill >= SCALE_PROMPT_FILL_PCT) {
      status =
        fill >= SCALE_CRITICAL_FILL_PCT ? "critical-no-standby" : "prompt-no-standby";
      nudgeProvisioner();
    }
  } catch (err) {
    errors.set(c.id, (err as Error).message);
    status = "stats-unavailable";
  }
  return {
    status,
    bootstrap: true,
    ledgers: rowsFrom([entry], statsById, errors),
    standbyCount: 0,
  };
}
