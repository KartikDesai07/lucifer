import cache, { TTL } from "@/lib/cache";
import { connectDB } from "@/lib/db";
import { Settings, type ISettings } from "@/models/Settings";
import { gstConfigOfSettings, type GstConfig } from "@/lib/receipt";

// Shared cache key — the settings route GET/PUT use the same key so a settings
// edit invalidates this getter too.
export const SETTINGS_CACHE_KEY = "settings";

// The cafe's singleton settings, cached. Uses one atomic upsert (no
// read-then-create race) so the "singleton" can never split into two docs.
export async function getSettings(): Promise<ISettings> {
  const hit = cache.get<ISettings>(SETTINGS_CACHE_KEY);
  if (hit) return hit;

  // Render paths (e.g. app layout metadata) call getSettings() directly,
  // without a route handler's own connectDB() first — idempotent (global
  // connection cache), so route callers that already connected pay nothing.
  await connectDB();

  // lean() returns a plain object; cast to the model interface for callers.
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
// getSettings() upserts, and a `$setOnInsert`-only upsert is NOT a no-op: with
// `timestamps: true` Mongoose adds its own `updatedAt` to the update, so every
// call mutates the document. Verified by probe — three consecutive calls
// returned three different `updatedAt` values. That is harmless from a route a
// signed-in user hit, but the root layout's metadata renders on `/login`, which
// is PUBLIC: calling getSettings() there would let anonymous traffic drive one
// write per cache window against a 512MB M0 that has no backups.
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
