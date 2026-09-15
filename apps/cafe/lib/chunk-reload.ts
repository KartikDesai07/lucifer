// Deploy-skew recovery for the staff dashboard (2026-09-11, owner: "the app
// sometimes does not load properly").
//
// This project deploys several times a day while a staff tab — the counter
// PC's above all — stays open for a whole shift. After a deploy, the old
// build's lazily-loaded chunks no longer exist on the server, so the next
// client-side navigation or dynamic import throws a ChunkLoadError inside a
// render. The error boundary's "Try again" re-renders the SAME tree against
// the SAME missing file and fails again; only a full reload — which fetches
// the new build — actually recovers. The boundaries call `armChunkReload` and
// reload the page ONCE per window (a per-tab store flag with a short lifetime),
// so a build that is genuinely broken cannot loop the tab forever.
//
// Pure and node-testable: no React, no DOM beyond the injected store.

export const CHUNK_RELOAD_FLAG_KEY = "pos.chunk-reload.v1";

// A second chunk failure inside this window after a reload means the reload
// did not help — show the normal error UI instead of reloading again.
export const CHUNK_RELOAD_COOLDOWN_MS = 60 * 1000;

const CHUNK_ERROR_RE =
  /ChunkLoadError|Loading chunk [^ ]+ failed|Loading CSS chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

/** True for the error shapes a missing build chunk produces in Chromium,
 *  Firefox and WebKit (name, or the message when the name was lost). */
export function isChunkLoadError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (typeof name === "string" && name === "ChunkLoadError") return true;
  return typeof message === "string" && CHUNK_ERROR_RE.test(message);
}

export type ChunkReloadStore = Pick<Storage, "getItem" | "setItem">;

/** The per-tab store the flag lives in, or null where storage is unavailable. */
export function chunkReloadStore(): ChunkReloadStore | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Decides whether THIS failure may trigger an automatic reload, and records
 * the decision. Returns true exactly when no reload was recorded within the
 * last CHUNK_RELOAD_COOLDOWN_MS — the caller then reloads. A missing or
 * failing store never reloads (a loop is worse than a manual reload button).
 */
export function armChunkReload(store: ChunkReloadStore | null, now: number): boolean {
  if (!store) return false;
  try {
    const raw = store.getItem(CHUNK_RELOAD_FLAG_KEY);
    const last = raw === null ? Number.NaN : Number(raw);
    if (Number.isFinite(last) && now - last < CHUNK_RELOAD_COOLDOWN_MS) return false;
    store.setItem(CHUNK_RELOAD_FLAG_KEY, String(now));
    return true;
  } catch {
    return false;
  }
}
