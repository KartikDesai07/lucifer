import { readSettings } from "@/lib/settings";
import { resolveAppearance, type ResolvedAppearance } from "@pos/shared/appearance";

// CR2.4 S3 — the ONE function app/m/layout.tsx and both /m pages call to get
// the diner-facing theme (A1/A13.5): its only @/lib import is readSettings,
// pinned by lib/appearance-paths.test.ts (S6) so this file can never grow a
// second reach into Settings/DB internals.
//
// A DB hiccup must never 500 the diner page: mirrors app/layout.tsx's own
// generateMetadata try/catch idiom (readSettings() failing there falls back to
// static metadata; here it falls back to resolveAppearance(undefined), i.e.
// DEFAULT_APPEARANCE's values). Both branches return resolveAppearance(...) —
// a FRESH ResolvedAppearance built key-by-key (A19), never the module-level
// DEFAULT_APPEARANCE object itself, so a future caller that normalizes a field
// in place on this function's return value can never mutate the shared
// constant for the life of the isolate. This function never spreads the
// settings doc either, so it can never leak a field (promoCodes,
// selfOrderMode, showPastOrdersToDiner, telegram*) this surface has no
// business mentioning.
export async function readPublicAppearance(): Promise<ResolvedAppearance> {
  try {
    const settings = await readSettings();
    return resolveAppearance(settings?.appearance);
  } catch {
    return resolveAppearance(undefined);
  }
}
