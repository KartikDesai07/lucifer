import mongoose from "mongoose";

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
