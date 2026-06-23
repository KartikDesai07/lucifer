import cache, { TTL } from "@/lib/cache";
import { Settings, type ISettings } from "@/models/Settings";
import type { GstConfig } from "@/lib/receipt";

// Shared cache key — the settings route GET/PUT use the same key so a settings
// edit invalidates this getter too.
export const SETTINGS_CACHE_KEY = "settings";

// The cafe's singleton settings, cached. Uses one atomic upsert (no
// read-then-create race) so the "singleton" can never split into two docs.
export async function getSettings(): Promise<ISettings> {
  const hit = cache.get<ISettings>(SETTINGS_CACHE_KEY);
  if (hit) return hit;

  // lean() returns a plain object; cast to the model interface for callers.
  const doc = (await Settings.findOneAndUpdate(
    {},
    { $setOnInsert: {} },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean()) as unknown as ISettings;

  cache.set(SETTINGS_CACHE_KEY, doc, TTL.SETTINGS);
  return doc;
}

// Just the GST fields the bill math needs.
export function gstConfigOf(settings: ISettings): GstConfig {
  return {
    gstEnabled: settings.gstEnabled,
    gstRate: settings.gstRate,
    gstMode: settings.gstMode,
  };
}

export function invalidateSettingsCache() {
  cache.del(SETTINGS_CACHE_KEY);
}
