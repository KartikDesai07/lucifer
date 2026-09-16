import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────────────────
// Hub registry connection (F3.1). The Hub is a SINGLE-cluster app — it talks to
// ONE free M0 "registry" cluster (its own, under the owner's master Atlas account,
// never a cafe DB). So it uses the simple v1-style global-cached DEFAULT mongoose
// connection — NOT the cafe's F2 multi-cluster ClusterRouter (that federation is a
// cafe-runtime concern; the registry is one tiny doc-per-cafe cluster where 512MB
// is effectively infinite, §2 decision 1).
//
// Cached on the Node global so the connection survives hot reloads in dev and is
// reused across serverless invocations (the same reliable Node-runtime pattern the
// cafe uses — see apps/cafe/lib/db.ts for why Workers' per-request I/O isolation
// ruled out a cached socket there).
// ─────────────────────────────────────────────────────────────────────────────

// strictQuery drops unknown filter keys. We do NOT enable global sanitizeFilter
// (it wraps operator objects in $eq and breaks legitimate range/$in/$regex
// queries — the exact regression the cafe hit; see apps/cafe/lib/db.ts). Injection
// is prevented by validating every input to primitives instead.
mongoose.set("strictQuery", true);

interface HubMongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

declare global {
  var _hubMongoose: HubMongooseCache | undefined;
}

const cached: HubMongooseCache = global._hubMongoose ?? {
  conn: null,
  promise: null,
};
global._hubMongoose = cached;

/**
 * The ONLY way to connect to the Hub registry. Call first in every Hub route.
 * The URI is read lazily (inside the function, not at module load) so importing
 * this module during `next build` does not crash when env is unset.
 */
export async function connectDB() {
  const HUB_MONGODB_URI = process.env.HUB_MONGODB_URI;
  if (!HUB_MONGODB_URI) {
    throw new Error("HUB_MONGODB_URI environment variable is not set");
  }

  if (cached.conn) return cached.conn;

  if (!cached.promise) {
    cached.promise = mongoose.connect(HUB_MONGODB_URI, {
      bufferCommands: false,
      // The Hub is low-traffic (owner-only back office); a small pool keeps many
      // warm serverless instances well under Atlas M0's 500-connection cap.
      maxPoolSize: 5,
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
