// Print customization S9 — this device's Now Serving choices (which language to call in, and whether to speak at
// all), kept in this device's own storage under its OWN key — never the shared device-prefs blob. The same
// safe-storage discipline as lib/print-bill-printer.ts: every storage access is guarded and never throws.
import { NOW_SERVING_LANGUAGES, type NowServingLanguage } from "@/lib/now-serving-announcer";

export const NOW_SERVING_PREFS_KEY = "pos.now-serving.v1";

export interface NowServingPrefs {
  language: NowServingLanguage;
  voice: boolean;
}

export const NOW_SERVING_PREFS_DEFAULTS: NowServingPrefs = { language: "en", voice: true };

/** Stored text to prefs: anything malformed falls back to the defaults, field by field. */
export function parseNowServingPrefs(raw: string | null): NowServingPrefs {
  if (raw === null) return { ...NOW_SERVING_PREFS_DEFAULTS };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...NOW_SERVING_PREFS_DEFAULTS };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return { ...NOW_SERVING_PREFS_DEFAULTS };
  const record = parsed as Record<string, unknown>;
  const language = record.language;
  const voice = record.voice;
  return {
    language:
      typeof language === "string" && (NOW_SERVING_LANGUAGES as readonly string[]).includes(language)
        ? (language as NowServingLanguage)
        : NOW_SERVING_PREFS_DEFAULTS.language,
    voice: typeof voice === "boolean" ? voice : NOW_SERVING_PREFS_DEFAULTS.voice,
  };
}

export function readNowServingPrefs(): NowServingPrefs {
  if (typeof window === "undefined") return { ...NOW_SERVING_PREFS_DEFAULTS };
  try {
    return parseNowServingPrefs(window.localStorage.getItem(NOW_SERVING_PREFS_KEY));
  } catch {
    return { ...NOW_SERVING_PREFS_DEFAULTS };
  }
}

/** A quota or disabled-storage failure is swallowed: the choice just lasts until the page reloads. */
export function writeNowServingPrefs(prefs: NowServingPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NOW_SERVING_PREFS_KEY, JSON.stringify({ language: prefs.language, voice: prefs.voice }));
  } catch {
    // Nothing persisted, nothing crashed.
  }
}
