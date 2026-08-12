import { MongoClient } from "mongodb";

import { CLUSTER_REGISTRY_COLLECTION, clusterList } from "./lib.mjs";

// The IO half shared by keepalive.mjs and backup-manifest.mjs: read the CORE
// `clusterRegistry` singleton doc and enumerate every owned cluster. A CORE
// read ERROR throws (exit 1 — never guess a topology, #19); a doc that is
// definitively ABSENT is the honest bootstrap single-cluster era.

const DEFAULT_TIMEOUT_MS = 15_000;

function clientFor(uri, timeoutMs) {
  return new MongoClient(uri, {
    serverSelectionTimeoutMS: timeoutMs,
    connectTimeoutMS: timeoutMs,
  });
}

/** `{ bootstrap, rows }` — CORE (env URI) + ledgers + standby (stored URIs). */
export async function loadClusterRows(coreUri, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const client = clientFor(coreUri, timeoutMs);
  try {
    // Empty-filter findOne: one singleton doc per cafe on the URI's own db
    // (registry-io.ts parity — the string `_id` dodges ObjectId typing).
    const doc = await client
      .db()
      .collection(CLUSTER_REGISTRY_COLLECTION)
      .findOne({});
    return clusterList(coreUri, doc);
  } finally {
    await client.close();
  }
}

/** One `{ping:1}` round-trip — the Atlas auto-pause dodge. Throws on failure. */
export async function pingCluster(uri, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const client = clientFor(uri, timeoutMs);
  try {
    await client.db().command({ ping: 1 });
  } finally {
    await client.close();
  }
}
