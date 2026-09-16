import cache, { TTL } from "@/lib/cache";
import { connectDB } from "@/lib/db";
import { Settings, type ISettings } from "@/models/Settings";
import { gstConfigOfSettings, type GstConfig } from "@/lib/receipt";

// Shared cache key — the settings route GET/PUT use the same key so a settings
// edit invalidates this getter too.
export const SETTINGS_CACHE_KEY = "settings";

// The cafe's singleton settings, cached — READ FIRST, create only when the
// cluster genuinely has no Settings document yet.
//
// Why the read comes first (CB-DL-1 S0): the create branch below is a
// `$setOnInsert`-only upsert, which is NOT a no-op on an existing document —
// with `timestamps: true` Mongoose adds its own `updatedAt` to the update, so
// the OLD unconditional-upsert version rewrote `updatedAt` on EVERY cache miss
// (verified by probe — three consecutive calls returned three different
// `updatedAt` values). That is one needless M0 write per cache window on a
// 512MB cluster with no backups, and it made any updatedAt-derived master-data
// version churn forever.
//
// The atomic-singleton property is preserved: two racers that both read `null`
// each run one upsert on the EMPTY filter `{}`, which matches any document, so
// the loser's upsert matches the winner's freshly inserted doc and returns it —
// the collection can still never split into two settings documents.
export async function getSettings(): Promise<ISettings> {
  const hit = cache.get<ISettings>(SETTINGS_CACHE_KEY);
  if (hit) return hit;

  // Render paths (e.g. app layout metadata) call getSettings() directly,
  // without a route handler's own connectDB() first — idempotent (global
  // connection cache), so route callers that already connected pay nothing.
  await connectDB();

  // lean() returns a plain object; cast to the model interface for callers.
  const existing = (await Settings.findOne().lean()) as ISettings | null;
  if (existing) {
    cache.set(SETTINGS_CACHE_KEY, existing, TTL.SETTINGS);
    return existing;
  }

  const doc = (await Settings.findOneAndUpdate(
    {},
    { $setOnInsert: {} },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean()) as unknown as ISettings;

  cache.set(SETTINGS_CACHE_KEY, doc, TTL.SETTINGS);
  return doc;
}

// Read-ONLY twin of getSettings(), for render paths that must not write.
//
// getSettings() can still WRITE: on a cluster with no Settings document yet it
// falls through to a `$setOnInsert` upsert, and such an upsert is not a no-op
// even against an existing doc (with `timestamps: true` Mongoose adds its own
// `updatedAt` — probe-verified: three consecutive calls of the old
// always-upsert version returned three different `updatedAt` values). Creating
// the singleton is fine from a route a signed-in user hit, but the root
// layout's metadata renders on `/login`, which is PUBLIC: anonymous traffic
// must never be able to drive a write against a 512MB M0 that has no backups.
// This twin therefore never writes at all.
//
// Returns null when the cafe has no Settings document yet (a freshly provisioned
// cluster) — callers on a render path must degrade, never create it. Shares the
// cache key with getSettings() so a settings save invalidates both.
export async function readSettings(): Promise<ISettings | null> {
  const hit = cache.get<ISettings>(SETTINGS_CACHE_KEY);
  if (hit) return hit;

  await connectDB();
  const doc = (await Settings.findOne().lean()) as ISettings | null;
  if (doc) cache.set(SETTINGS_CACHE_KEY, doc, TTL.SETTINGS);
  return doc;
}

// Just the GST fields the bill math needs. A real ISettings doc always has
// these populated (schema defaults, never undefined), so this delegates to
// the client-safe twin (`lib/receipt.gstConfigOfSettings`) — its `??`
// fallbacks never trigger here, keeping one source of truth for both.
export function gstConfigOf(settings: ISettings): GstConfig {
  return gstConfigOfSettings(settings);
}

export function invalidateSettingsCache() {
  cache.del(SETTINGS_CACHE_KEY);
}
