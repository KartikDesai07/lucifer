import mongoose from "mongoose";

import { coreConnection, ledgerWriteConnection } from "./cluster-router";
import { memoizeUntilFailure } from "./memoize-until-failure";

// Query hardening: strictQuery drops unknown filter keys.
//
// We deliberately do NOT enable `sanitizeFilter` globally. It wraps any filter
// value that is an object containing `$` keys in `$eq`, which BREAKS the legitimate
// operator queries the app relies on — date ranges (`createdAt: { $gte, $lte }`),
// `$in` (order phone search), `$regex` (name/mobile search) — by trying to cast the
// operator object to the field's type (the "Cast to date failed" on the summary /
// orders?date / reports endpoints). Injection is prevented instead by Zod-validating
// every request input down to primitives (never a raw object that could carry an
// operator) plus escapeRegex() on search terms.
mongoose.set("strictQuery", true);

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

// Cache the connection on the Node global so it survives hot reloads in dev and
// is reused across serverless invocations. This is the standard, reliable pattern
// on a Node.js runtime (Vercel functions, a Node server, etc.) where a warm
// instance legitimately reuses one connection across requests — unlike Cloudflare
// Workers, whose per-request I/O isolation makes a cached socket unusable across
// requests (that mismatch is why the app is hosted on a Node runtime).
declare global {
  var _mongoose: MongooseCache | undefined;
}

const cached: MongooseCache = global._mongoose ?? { conn: null, promise: null };
global._mongoose = cached;

/**
 * The ONLY way to connect to MongoDB. Call this first in every API route.
 * The URI is read lazily (inside the function, not at module load) so that
 * importing this module during `next build` does not crash when env is unset.
 */
export async function connectDB() {
  const MONGODB_URI = process.env.MONGODB_URI;
  if (!MONGODB_URI) {
    throw new Error("MONGODB_URI environment variable is not set");
  }

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(MONGODB_URI, {
      bufferCommands: false,
      // Bound per-instance connections so many warm serverless instances stay
      // under Atlas M0's hard 500-connection cap (CLAUDE.md §3, migration_target).
      maxPoolSize: 10,
      minPoolSize: 0,
      maxIdleTimeMS: 270_000,
      serverSelectionTimeoutMS: 5_000,
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (error) {
    cached.promise = null;
    throw error;
  }

  return cached.conn;
}

/** A model with an index build to await: structural, so no `Model<any>` (lint). */
export interface ModelLike {
  init(): Promise<unknown>;
  createCollection(): Promise<unknown>;
  createIndexes(): Promise<unknown>;
}

/** The house rule "await the unique index before the write", made safe. Each call: connect, then mongoose's own
 *  init() (mongoose memoizes it, and resets it on dropDatabase / disconnect, as today). If init's memo is a
 *  rejection (its first run began while the connection was connecting, after a failed connect, or hit a transient
 *  error), do init's work again through the public API: createCollection (tolerates "exists", code 48; applies the
 *  schema's collection options) then createIndexes (the schema's own indexes, the same options as init's build).
 *  Only that fallback is memoized per model: a success is kept for the process, a failure is dropped so the next
 *  call tries again, and the caller's write still fails CLOSED. Unlike init, the fallback ignores `autoIndex: false`,
 *  a per-index `_autoIndex: false` and never builds search indexes; no model uses any of them (a GATE test pins it). */
export function createModelReady(connect: () => Promise<unknown>): (model: ModelLike) => Promise<void> {
  const fallbacks = new WeakMap<ModelLike, () => Promise<void>>();
  const fallbackFor = (model: ModelLike): (() => Promise<void>) => {
    let fallback = fallbacks.get(model);
    if (!fallback) {
      fallback = memoizeUntilFailure(async () => {
        await model.createCollection();
        await model.createIndexes();
      });
      fallbacks.set(model, fallback);
    }
    return fallback;
  };
  return async (model) => {
    await connect();
    try {
      await model.init();
      return;
    } catch {
      await fallbackFor(model)();
    }
  };
}

export const modelReady = createModelReady(connectDB);

export type ConnectionRole = "core" | "ledger";

/**
 * ClusterRouter seam (F1) — NOW delegated to the F2 router (Step F2.2, incremental
 * cutover). `getConnection('core')` → the CORE pool; `getConnection('ledger')` → the
 * single active LEDGER pool. Both go through `lib/cluster-router.ts` →
 * `lib/cluster-registry.ts` (`createConnection` per M0, `maxPoolSize 5`,
 * schemas-not-models, the live CORE registry doc on a 30s TTL). Until a real registry
 * doc exists (F3 paste-and-Connect), the router's single-cluster bootstrap makes CORE
 * double as the one active ledger on the existing `MONGODB_URI` — so behaviour is
 * unchanged for the current single-cluster deployment, just routed through the seam.
 *
 * `connectDB()` above stays live: the v1 routes + default-bound models still use it,
 * and the route cutover onto the router is P2's job (#44/#45). This delegation moves
 * only `getConnection` callers (today: /api/health) onto the federation path.
 */
export async function getConnection(
  role: ConnectionRole = "core",
): Promise<mongoose.Connection> {
  return role === "ledger" ? ledgerWriteConnection() : coreConnection();
}
