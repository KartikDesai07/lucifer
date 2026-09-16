// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.9 — the PURE half of the DB-hygiene CI scripts (keep-alive +
// backup): cluster enumeration from the registry doc, the backup stagger plan,
// object-key naming, and prune cutoffs. No driver imports — `node --test
// lib.test.mjs` runs with zero installs. IO lives in registry.mjs /
// keepalive.mjs / backup-manifest.mjs.
//
// Plain .mjs (not TS): these run on a bare GitHub runner with a single
// `npm install` of the mongodb driver — no tsx, no workspace install.
// ─────────────────────────────────────────────────────────────────────────────

/** Must match `CLUSTER_REGISTRY_COLLECTION` in apps/cafe/lib/cluster-router.ts
 *  (scripts can't import the TS module; keep the two in sync). */
export const CLUSTER_REGISTRY_COLLECTION = "clusterRegistry";

/** An archived ledger retired within this many IST days is still dumped
 *  NIGHTLY: the non-revoking roll-forward (F2.7) lets stale-cache writes trail
 *  onto the retiring ledger, and its final days of orders must not wait up to
 *  a week for their first backup. Older archives are immutable (settled orders
 *  never change — F2 §6), so weekly re-dumps lose nothing. */
export const RECENT_RETIRE_NIGHTLY_DAYS = 8;

// ── IST calendar (fixed UTC+5:30, no DST — the cafe day, F2.3 precedent) ──────
const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/** IST calendar date (`YYYY-MM-DD`) + weekday (0=Sun..6=Sat) of an instant. */
export function istParts(now) {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    weekday: shifted.getUTCDay(),
  };
}

/** Normalize a registry day key (`YYYY-MM-DD` or `YYYYMMDD`) to `YYYY-MM-DD`. */
export function normalizeDayKey(s) {
  const digits = String(s).replace(/\D/g, "");
  if (digits.length !== 8) throw new Error(`unusable day key: ${s}`);
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/** Whole days from `a` to `b` (both `YYYY-MM-DD`); negative when `b` < `a`. */
export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

// ── URI hygiene ───────────────────────────────────────────────────────────────
/** Registry-stored URIs pass through the F3 vault seam (identity today). If a
 *  stored URI is no longer a dialable mongodb:// string, the vault has landed
 *  and these CI scripts need its decrypt wired — fail fast, NEVER echo the
 *  value (it may be ciphertext of a credentialed URI). */
export function assertDialableUri(uri, label) {
  if (typeof uri !== "string" || !/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw new Error(
      `${label}: stored URI is not a dialable mongodb:// / mongodb+srv:// string — ` +
        `if the F3 vault has landed, wire its decrypt into scripts/db-hygiene (see README.md)`,
    );
  }
}

/** Credential-stripped URI for logs. */
export function redactUri(uri) {
  return String(uri).replace(/\/\/[^@/]*@/, "//***@");
}

// ── Cluster enumeration (mirror of the runtime's placement view) ──────────────
/**
 * Every cluster this cafe owns, from the CORE registry doc: CORE itself
 * (env-authoritative — the doc's `core` field is an informational mirror,
 * apps/cafe/lib/cluster-router.ts), every ledger, and every standby (an armed
 * standby idles until its flip — skipping it would let it auto-pause and fail
 * F2.7's validate-before-activate). `doc` null = the bootstrap single-cluster
 * era; a doc that EXISTS but has no ledgers is corrupt — throw, never guess
 * (the router's #19 parity).
 */
export function clusterList(coreUri, doc) {
  if (!coreUri) {
    throw new Error("CORE_MONGODB_URI / MONGODB_URI is not set");
  }
  const rows = [{ id: "core", tag: "C", role: "core", uri: coreUri }];
  if (!doc) return { bootstrap: true, rows };
  if (!Array.isArray(doc.ledgers) || doc.ledgers.length === 0) {
    throw new Error("registry doc exists but has no ledgers — refusing to guess");
  }
  for (const l of doc.ledgers) {
    rows.push({
      id: l.id,
      tag: l.tag,
      role: "ledger",
      active: l.active === true,
      ...(l.to == null ? {} : { to: l.to }),
      uri: l.uri,
    });
  }
  for (const s of doc.standby ?? []) {
    rows.push({
      id: s.id,
      ...(s.tag === undefined ? {} : { tag: s.tag }),
      role: "standby",
      uri: s.uri,
    });
  }
  return { bootstrap: false, rows };
}

// ── The backup stagger plan ───────────────────────────────────────────────────
/**
 * Which clusters to dump tonight (F2 §4 F2.9: nightly per-cluster, "staggered
 * to stay under the 10 GB-out / 7-day per-cluster cap"):
 *   • CORE, the active ledger, any standby, and RECENTLY-retired archives →
 *     every night (live/settling data; a standby is ~empty so its dump is
 *     bytes). 7 nightly gzip dumps of even a FULL 512 MB M0 stay far under
 *     that cluster's own 10 GB weekly egress.
 *   • old archives (immutable) → once a week, each on a stable weekday slot
 *     (position among old archives mod 7) so N archives never pile onto one
 *     night. Slots stay stable because the registry appends new ledgers.
 * `forceAll` (manual workflow_dispatch) dumps everything — the restore drill.
 */
export function backupSetFor(rows, now, forceAll = false) {
  const { date, weekday } = istParts(now);
  let oldArchiveIdx = -1;
  return rows.map((row) => {
    let due = true;
    let reason = "nightly";
    if (row.role === "ledger" && row.active !== true) {
      const recentlyRetired =
        row.to != null &&
        daysBetween(normalizeDayKey(row.to), date) <= RECENT_RETIRE_NIGHTLY_DAYS;
      if (recentlyRetired) {
        reason = "nightly (recently retired — trailing writes still unbacked)";
      } else {
        oldArchiveIdx += 1;
        const slot = oldArchiveIdx % 7;
        due = slot === weekday;
        reason = due
          ? `weekly (immutable archive, slot ${slot})`
          : `skipped (immutable archive, slot ${slot}, today is weekday ${weekday})`;
      }
    }
    if (forceAll) {
      due = true;
      reason = "forced (workflow_dispatch force_all)";
    }
    return { ...row, due, reason };
  });
}

// ── Artifact naming + retention ───────────────────────────────────────────────
/** Local dump file name. Tag is unique across the federation (the F2.7 hard
 *  invariant); a tagless manually-pasted standby falls back to its id. */
export function backupFileName(row, dateStr) {
  return `${row.tag ?? row.id}-${dateStr}.archive.gz`;
}

/** Object-store key: `<prefix>/<tag>/<YYYY-MM-DD>.archive.gz.enc`. The date
 *  suffix is what the prune step parses — keep the shape in sync with
 *  `dateFromBackupKey`. */
export function backupKey(prefix, row, dateStr) {
  return `${prefix}/${row.tag ?? row.id}/${dateStr}.archive.gz.enc`;
}

/** Objects whose key date sorts strictly below this IST date get pruned. */
export function pruneBeforeDate(now, retentionDays) {
  const days = Number(retentionDays);
  if (!Number.isFinite(days) || days < 1) {
    throw new Error(`unusable retentionDays: ${retentionDays}`);
  }
  return istParts(new Date(now.getTime() - days * 86_400_000)).date;
}

/** The `YYYY-MM-DD` embedded in a backup key, or null for foreign objects
 *  (prune must never delete anything it didn't name itself). */
export function dateFromBackupKey(key) {
  const m = /(\d{4}-\d{2}-\d{2})\.archive\.gz\.enc$/.exec(String(key));
  return m ? m[1] : null;
}
