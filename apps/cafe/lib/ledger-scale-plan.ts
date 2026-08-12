import { buildOrderId, ledgerTagOf } from "@/models/order.ledger";
import {
  CLUSTER_REGISTRY_ID,
  CORE_TAG,
  type StoredClusterRegistry,
} from "@/lib/cluster-router";

// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.7 — the PURE half of the auto-scale roll-forward (the report-merge
// split precedent): fill math, ledger-tag minting, the flip plan with the
// FLIP-DAY one-day window overlap, and the registry-doc update builders. No IO
// here — `lib/ledger-scale.ts` owns dialing, stats, ping, and persistence.
//
// Manifest-write invariants this module encodes:
//   • ONE-DAY OVERLAP (the phase-F2 §4 F2.7 FLIP-DAY blockquote): the retiring
//     ledger's `to` = start of TOMORROW, the promoted standby's `from` = start
//     of TODAY — so on flip day `ledgersForDate(D,D)` resolves BOTH legs and
//     reads route through the F2.6 merge instead of silently hiding the
//     pre-flip morning. Day D+1 resolves to the new ledger alone again (the
//     router's half-open `[from,to)` overlap math handles the overlap as-is).
//   • SINGLE-OP CAS FLIP: the flip is ONE `$set` of both whole arrays, guarded
//     by "the expected active is still active AND the chosen standby is still
//     first AND the standby array hasn't changed size". MongoDB forbids `$push`
//     on `ledgers` combined with `$set` on `ledgers.$[x].…` (path-prefix
//     conflict), and a two-op sequence could strand the doc with 0 or 2 active
//     ledgers mid-crash — which bricks write placement (`activeLedger` throws).
//     A lost CAS returns `raced` and the next Hub run completes the flip.
//   • NO DATA MIGRATION: the plan only rewrites the manifest doc — old orders
//     stay where they are (the 10 GB/7-day transfer cap, F2 §2.12e).
// ─────────────────────────────────────────────────────────────────────────────

export type StoredLedgerEntry = StoredClusterRegistry["ledgers"][number];
export type StoredStandbyEntry = NonNullable<
  StoredClusterRegistry["standby"]
>[number];

// ── Fill thresholds (F2 §2.7 / F2c §7) ────────────────────────────────────────
/** M0's hard storage quota. Usable is ~430–450 MB; thresholds keep slack. */
export const M0_QUOTA_BYTES = 512 * 1024 * 1024;
/** Roll writes forward (or prompt the owner) at ~70% (~360 MB). */
export const SCALE_PROMPT_FILL_PCT = 0.7;
/** ~85% (~435 MB) with no standby = alarm — a full M0 hard-rejects writes. */
export const SCALE_CRITICAL_FILL_PCT = 0.85;

/** `db.stats()` slice the fill gauge reads. Atlas bills Free/Flex tiers on the
 *  UNCOMPRESSED `dataSize + indexSize` (F2c §2) — NEVER `storageSize` alone. */
export interface LedgerFillStats {
  dataSize: number;
  indexSize: number;
}

/** The conservative billed-bytes metric (F2c §2): data + indexes, uncompressed. */
export function billedBytesOf(stats: LedgerFillStats): number {
  return stats.dataSize + stats.indexSize;
}

export function fillPctOf(stats: LedgerFillStats): number {
  return billedBytesOf(stats) / M0_QUOTA_BYTES;
}

/** Fill rounded to 4 dp for persistence/display; decisions use the exact ratio. */
export function roundedFillPct(stats: LedgerFillStats): number {
  return Math.round(fillPctOf(stats) * 10_000) / 10_000;
}

// ── Ledger-tag minting (the §3.5 A-series: 'A' → 'A2' → 'A3' → …) ─────────────
/** A tag is valid iff an orderId built with it round-trips through F2c's
 *  canonical helpers (#34 — the format is never re-derived here): uppercase
 *  alphanumeric, non-empty, no separators. */
export function isValidLedgerTag(tag: string): boolean {
  return tag.length > 0 && ledgerTagOf(buildOrderId(tag, "20260101", 1)) === tag;
}

/**
 * Mint the next A-series tag: `A` when unseen, else `A<max+1>` (`A` counts as 1).
 * Uniqueness is the only HARD invariant (a duplicate tag makes
 * `ledgerFromOrderId` ambiguous). Lexicographic tag order intentionally breaks
 * at `A10` (`'A10' < 'A2'`) and nothing depends on it: point reads are
 * tag-targeted, day ranges are per-leg, and cross-tag `_id` sort is already
 * documented tag-major/non-chronological (order-read / report-fanout).
 */
export function nextLedgerTag(existingTags: string[]): string {
  let max = 0;
  for (const t of existingTags) {
    const m = /^A(\d*)$/.exec(t);
    if (m) max = Math.max(max, m[1] ? parseInt(m[1], 10) : 1);
  }
  return max === 0 ? "A" : `A${max + 1}`;
}

/** Mint a fresh A-series tag unused by any ledger or pre-minted standby — the
 *  SINGLE mint path over a registry doc. F2.8's provisioner mints ahead through
 *  this exact function (never a forked derivation). */
export function mintNextStandbyTag(doc: StoredClusterRegistry): string {
  const standbyTags = (doc.standby ?? []).flatMap((s) =>
    s.tag === undefined ? [] : [s.tag],
  );
  return nextLedgerTag([...doc.ledgers.map((l) => l.tag), ...standbyTags]);
}

/**
 * The tag the promoted standby will carry: a pre-minted `standby.tag` (F2.8's
 * provisioner mints ahead) is validated and used VERBATIM; a tagless standby
 * (the manual paste flow) gets the next A-series tag. Throws — refusing the
 * flip — on a malformed/reserved/colliding pre-minted tag: promoting it would
 * corrupt orderId routing on a no-backup tier.
 */
export function mintOrValidateStandbyTag(
  standby: StoredStandbyEntry,
  doc: StoredClusterRegistry,
): string {
  if (standby.tag !== undefined) {
    const tag = standby.tag;
    const ledgerTags = doc.ledgers.map((l) => l.tag);
    if (!isValidLedgerTag(tag) || tag === CORE_TAG || ledgerTags.includes(tag)) {
      throw new Error(
        `[ledger-scale] standby ${standby.id} carries an unusable pre-minted tag "${tag}" (malformed, reserved, or already a ledger tag) — refusing to flip`,
      );
    }
    return tag;
  }
  return mintNextStandbyTag(doc);
}

// ── Manifest inspection ───────────────────────────────────────────────────────
/** The single active ledger entry. ≠1 active = a corrupt manifest — throw (the
 *  router's `activeLedger` parity; never "fix" a corrupt doc automatically). */
export function activeEntryOf(doc: StoredClusterRegistry): StoredLedgerEntry {
  const actives = doc.ledgers.filter((l) => l.active === true);
  if (actives.length !== 1) {
    throw new Error(
      `[ledger-scale] expected exactly one active ledger, found ${actives.length} — refusing to scale-check a corrupt manifest`,
    );
  }
  return actives[0];
}

function docIdOf(doc: StoredClusterRegistry): string {
  return doc._id ?? CLUSTER_REGISTRY_ID;
}

/** One registry-doc write, ready for `collection.updateOne`. */
export interface RegistryUpdate {
  filter: Record<string, unknown>;
  update: Record<string, unknown>;
  arrayFilters?: Record<string, unknown>[];
}

// ── Result rows (pure assembly over gauged entries) ───────────────────────────
export interface LedgerScaleRow {
  id: string;
  tag: string;
  active: boolean;
  fillPct?: number;
  /** The billed `dataSize + indexSize` bytes (F2c §2), when stats were read. */
  sizeBytes?: number;
  statsError?: string;
}

export function rowsFrom(
  ledgers: StoredLedgerEntry[],
  statsById: Map<string, LedgerFillStats>,
  errors: Map<string, string>,
): LedgerScaleRow[] {
  return ledgers.map((l) => {
    const s = statsById.get(l.id);
    return {
      id: l.id,
      tag: l.tag,
      active: l.active === true,
      ...(s ? { fillPct: roundedFillPct(s), sizeBytes: billedBytesOf(s) } : {}),
      ...(errors.has(l.id) ? { statsError: errors.get(l.id) } : {}),
    };
  });
}

// ── The flip plan ─────────────────────────────────────────────────────────────
export interface FlipPlan {
  fromTag: string;
  toTag: string;
  /** Retiring active's new `to` = start of TOMORROW (the one-day overlap). */
  oldTo: string;
  /** Promoted standby's `from` = start of TODAY. */
  newFrom: string;
  activeId: string;
  standbyId: string;
  standbyCountAtRead: number;
  newLedgers: StoredLedgerEntry[];
  newStandby: StoredStandbyEntry[];
}

/**
 * Build the post-flip arrays. The promoted entry keeps the standby's ENCRYPTED
 * uri verbatim (the write side never decrypts into the doc); its `empty` flag
 * is dropped (orders land on it within one router TTL). Fresh stats are stamped
 * onto every ledger whose `db.stats()` succeeded this run.
 */
export function planFlip(
  doc: StoredClusterRegistry,
  standby: StoredStandbyEntry,
  toTag: string,
  statsById: Map<string, LedgerFillStats>,
  todayIst: string,
  tomorrowIst: string,
): FlipPlan {
  const active = activeEntryOf(doc);
  const newLedgers = doc.ledgers.map((l) => {
    const s = statsById.get(l.id);
    const stamped = s
      ? { ...l, fillPct: roundedFillPct(s), sizeBytes: billedBytesOf(s) }
      : { ...l };
    return l.id === active.id
      ? { ...stamped, active: false, to: tomorrowIst }
      : stamped;
  });
  newLedgers.push({
    id: standby.id,
    uri: standby.uri,
    tag: toTag,
    from: todayIst,
    to: null,
    active: true,
  });
  return {
    fromTag: active.tag,
    toTag,
    oldTo: tomorrowIst,
    newFrom: todayIst,
    activeId: active.id,
    standbyId: standby.id,
    standbyCountAtRead: (doc.standby ?? []).length,
    newLedgers,
    newStandby: (doc.standby ?? []).slice(1),
  };
}

/** The CAS-guarded single-op flip write (see the header block for why it must
 *  be one wholesale `$set`). matchedCount 0 = another writer changed the doc
 *  since our read (a concurrent flip or an F3 paste) — report `raced`, retry
 *  on the next Hub run; never blind-write over an unknown manifest. */
export function buildFlipUpdate(
  doc: StoredClusterRegistry,
  plan: FlipPlan,
): RegistryUpdate {
  return {
    filter: {
      _id: docIdOf(doc),
      ledgers: { $elemMatch: { id: plan.activeId, active: true } },
      "standby.0.id": plan.standbyId,
      standby: { $size: plan.standbyCountAtRead },
    },
    update: {
      $set: { ledgers: plan.newLedgers, standby: plan.newStandby },
    },
  };
}

/** The guarded standby-arm write (F2.8's provisioner): append ONE warm empty
 *  entry iff the standby slot is still EMPTY (`standby.0` absent matches both a
 *  missing and an empty array — we only provision when unarmed, F2c §7 keeps
 *  exactly one spare) AND no ledger took the pre-minted tag meanwhile (the
 *  paste-then-flip race can mint the SAME tag from the same doc state). The tag
 *  clause is spelled `$not:{$elemMatch}` — universal negation over the array;
 *  the terser `"ledgers.tag":{$ne:tag}` is equivalent per the manual ("array
 *  with no element equal") but notoriously misread as existential.
 *  matchedCount 0 = a concurrent paste/flip changed the doc — the caller
 *  re-reads and re-decides (the `buildFlipUpdate` CAS discipline). */
export function buildStandbyPushUpdate(
  doc: StoredClusterRegistry,
  entry: StoredStandbyEntry & { tag: string },
): RegistryUpdate {
  return {
    filter: {
      _id: docIdOf(doc),
      "standby.0": { $exists: false },
      ledgers: { $not: { $elemMatch: { tag: entry.tag } } },
    },
    update: { $push: { standby: entry } },
  };
}

/** The non-flip heartbeat write: per-entry `fillPct`/`sizeBytes` `$set` via
 *  arrayFilters keyed by ledger id — never a wholesale array replace, so it can
 *  never clobber a concurrent flip or paste. `null` when no stats were read. */
export function buildStatsOnlyUpdate(
  doc: StoredClusterRegistry,
  statsById: Map<string, LedgerFillStats>,
): RegistryUpdate | null {
  const sets: Record<string, unknown> = {};
  const arrayFilters: Record<string, unknown>[] = [];
  doc.ledgers.forEach((l) => {
    const s = statsById.get(l.id);
    if (!s) return;
    const k = `l${arrayFilters.length}`;
    sets[`ledgers.$[${k}].fillPct`] = roundedFillPct(s);
    sets[`ledgers.$[${k}].sizeBytes`] = billedBytesOf(s);
    arrayFilters.push({ [`${k}.id`]: l.id });
  });
  if (arrayFilters.length === 0) return null;
  return { filter: { _id: docIdOf(doc) }, update: { $set: sets }, arrayFilters };
}
