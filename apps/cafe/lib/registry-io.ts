import { getConn, type ClusterRef } from "@/lib/cluster-registry";
import { core, CLUSTER_REGISTRY_COLLECTION } from "@/lib/cluster-router";
import type { StoredClusterRegistry } from "@/lib/cluster-router";
import type { LedgerFillStats, RegistryUpdate } from "@/lib/ledger-scale-plan";

// ─────────────────────────────────────────────────────────────────────────────
// The SINGLE raw IO path to the CORE `clusterRegistry` singleton doc, shared by
// the registry WRITE side's consumers (F2.7 `lib/ledger-scale.ts`, F2.8
// `lib/provisioners/atlas.ts`) so the doc-read/-write driver glue is never
// forked. Extracted verbatim from F2.7's real deps; F2.2's router keeps its own
// READ path (TTL cache + decrypt + bootstrap fallback — different semantics).
// F3 owns the typed write-side schema + vault. F2.9 adds the shared
// `readDbFillStats` gauge (scaleCheck + heartbeat — same discipline).
// ─────────────────────────────────────────────────────────────────────────────

/** The raw driver `Db` handle of a cluster ref (dial via the F2.1 registry). */
export async function rawDbOf(ref: ClusterRef) {
  const db = (await getConn(ref)).db;
  if (!db) throw new Error(`[registry-io] no db handle on ${ref.id}`);
  return db;
}

/** The conservative fill gauge (F2c §2): `db.command({dbStats:1})` on the
 *  ref's OWN db — the ledger URI's db is the only user database on a
 *  federation cluster, so it IS the quota-relevant figure. Shared by F2.7's
 *  `scaleCheck` and F2.9's heartbeat, never forked. Garbage numbers THROW —
 *  they must never drive (or suppress) a flip, nor report a fake fill. */
export async function readDbFillStats(ref: ClusterRef): Promise<LedgerFillStats> {
  const res = await (await rawDbOf(ref)).command({ dbStats: 1 });
  const dataSize = Number(res.dataSize);
  const indexSize = Number(res.indexSize);
  const usable = (n: number) => Number.isFinite(n) && n >= 0;
  if (!usable(dataSize) || !usable(indexSize)) {
    throw new Error(`[registry-io] unusable dbStats from ${ref.id}`);
  }
  return { dataSize, indexSize };
}

/** Read the singleton registry doc from CORE. Empty-filter findOne — one doc
 *  per cafe (§3.5; physical isolation #30, no tenantId filter), and it dodges
 *  the driver typing `_id` as ObjectId (ours is the string `cluster-registry`). */
export async function readStoredRegistryDoc(): Promise<StoredClusterRegistry | null> {
  const doc = await (await rawDbOf(core()))
    .collection(CLUSTER_REGISTRY_COLLECTION)
    .findOne({});
  return (doc as StoredClusterRegistry | null) ?? null;
}

/** Apply ONE registry-doc update (a `ledger-scale-plan` builder's output).
 *  Returns matchedCount — 0 means the update's guard filter lost (a concurrent
 *  writer changed the doc); callers re-read and re-decide, never blind-write. */
export async function applyRegistryUpdate({
  filter,
  update,
  arrayFilters,
}: RegistryUpdate): Promise<number> {
  const res = await (await rawDbOf(core()))
    .collection(CLUSTER_REGISTRY_COLLECTION)
    .updateOne(filter, update, arrayFilters ? { arrayFilters } : {});
  return res.matchedCount;
}
