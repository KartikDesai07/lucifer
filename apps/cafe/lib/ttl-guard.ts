import mongoose, { type Schema } from "mongoose";

import {
  assertTtlIndexesAllowed,
  type DeclaredIndex,
} from "@pos/shared/ttl-guard";

// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.10 — the cafe-side adapter for the shared TTL allowlist guard
// (build-rule #23 / F2c §7 guarantee 4). The RULE lives in
// `@pos/shared/ttl-guard` (#31 — the Hub consults the same list before F3.7
// creates the one legal TTL index, on `heartbeats`); this shim only maps a
// Mongoose schema onto it: `schema.indexes()` tuples (which also carry any
// field-level `expires:` shorthand — mongoose lowers it into an index with
// `expireAfterSeconds`) → the shared `DeclaredIndex` shape, plus the schema's
// real COLLECTION name (the allowlist keys on collections, not model names).
//
// Call sites — every schema-REGISTRATION chokepoint, at module load, so a
// forbidden TTL fails the process (and every test run) instantly, never at
// first query: `lib/cluster-registry.ts` walks its SCHEMAS map + the canonical
// orderSchema; `models/daily-rollup.ledger.ts` self-asserts its two LEDGER
// financial schemas. A new model is covered the moment it joins either path.
// ─────────────────────────────────────────────────────────────────────────────

/** The collection a schema will actually bind to: the pinned `collection`
 *  option (the LEDGER computed collections pin exact names — `dailyRollup`,
 *  `productDayCounter`), else mongoose's default pluralization of the model
 *  name (v1 models: `Order` → `orders`). */
export function collectionNameFor(modelName: string, schema: Schema): string {
  const pinned = schema.get("collection");
  if (typeof pinned === "string" && pinned.length > 0) return pinned;
  return mongoose.pluralize()?.(modelName) ?? modelName;
}

/**
 * Throw (build-rule #23) if `schema` declares a TTL index and its collection is
 * not on the shared ephemeral allowlist — or declares a TTL MongoDB would
 * silently ignore. Non-TTL schemas pass through untouched.
 */
export function assertSchemaTtlAllowed(modelName: string, schema: Schema): void {
  const indexes: DeclaredIndex[] = schema
    .indexes()
    .map(([key, options]) => ({ key, options }) as DeclaredIndex);
  assertTtlIndexesAllowed(collectionNameFor(modelName, schema), indexes);
}
