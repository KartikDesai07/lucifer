import mongoose from "mongoose";

// Global query hardening (defense-in-depth, CLAUDE.md §8). Applied once at module
// load: sanitizeFilter strips `$`/dotted operators smuggled into filter VALUES,
// strictQuery drops unknown keys — so any present/future filter built from request
// input can't become NoSQL operator injection.
mongoose.set("sanitizeFilter", true);
mongoose.set("strictQuery", true);

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

// Cache the connection on the Node global so it survives hot reloads in dev and
// is reused across serverless invocations (Atlas M0 has a hard connection cap).
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
      // Bound per-isolate connections so many warm serverless instances stay
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
