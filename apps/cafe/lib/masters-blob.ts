// CB-DL-1 — this device's stored copy of the master lists.
//
// Storage is the browser's persistent per-origin store (localStorage): it
// survives a reload, a closed tab, a browser restart and a relaunch of the
// desktop shell, so every launch paints its masters at once instead of holding
// the screens behind a placeholder (owner rule 2026-09-09: "use local store
// properly"; the per-tab store shipped in CB-DL-1 made that hold routine on the
// counter PC). Two rules keep a shared device safe: the admin-only `staff` part
// is NEVER written here (MASTERS_PERSISTED_PART_KEYS — it stays in memory for
// the tab's life), and the blob is cleared on logout and on every visit to
// /login.
//
// Zero React, zero DB: pure functions over one storage key, with the same
// safe-read/write discipline as lib/pos-device-prefs.ts — a corrupt value, a
// disabled store, or a quota-exceeded write degrades to "no blob" instead of
// throwing into a render.
import {
  BOOTSTRAP_VERSION,
  MASTERS_BLOB_KEY,
  MASTERS_BLOB_MAX_AGE_MS,
  MASTERS_PERSISTED_PART_KEYS,
  type MastersBlob,
  type MastersPartKey,
} from "@/lib/bootstrap-contract";

// The slice of the Storage API this module uses. Injectable so the unit test
// can drive read/write/clear against a fake without a DOM.
export type MastersStorage = Pick<
  Storage,
  "getItem" | "setItem" | "removeItem"
>;

function storageOrNull(storage?: MastersStorage): MastersStorage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Storage access itself can throw (privacy modes, site-data blocked).
    return null;
  }
}

/** True for a part the device store may hold — `staff` is not one of them. */
export function isPersistedPart(key: MastersPartKey): boolean {
  return (MASTERS_PERSISTED_PART_KEYS as readonly string[]).includes(key);
}

/** The blob with every non-persisted part removed — what actually reaches disk. */
export function persistedBlob(blob: MastersBlob): MastersBlob {
  const parts: MastersBlob["parts"] = {};
  for (const key of MASTERS_PERSISTED_PART_KEYS) {
    if (Object.hasOwn(blob.parts, key)) parts[key] = blob.parts[key];
  }
  return { v: blob.v, at: blob.at, parts };
}

/** Validates a parsed blob and returns a FRESH literal — never the parsed
 * object — so no caller can hold a reference carrying extra keys. Rejects a
 * blob written by another payload version, one whose `at` is unusable, one
 * older than MASTERS_BLOB_MAX_AGE_MS, and one stamped in the future (a clock
 * change must not make a blob immortal). Parts are copied with Object.hasOwn
 * (repo memory `object-literal-allowlist-prototype-keys`: a plain object's
 * inherited `constructor`/`toString` would otherwise sail through an `in`
 * test) and only for the persisted keys — a `staff` part that somehow reached
 * disk is dropped on the way back in, never seeded. */
export function normalizeMastersBlob(
  value: unknown,
  now: number,
): MastersBlob | null {
  if (typeof value !== "object" || value === null) return null;
  const o = value as Record<string, unknown>;
  if (o.v !== BOOTSTRAP_VERSION) return null;
  if (typeof o.at !== "string") return null;
  const at = Date.parse(o.at);
  if (!Number.isFinite(at)) return null;
  if (at > now) return null;
  if (now - at > MASTERS_BLOB_MAX_AGE_MS) return null;
  if (typeof o.parts !== "object" || o.parts === null) return null;
  const stored = o.parts as Record<string, unknown>;
  const parts: MastersBlob["parts"] = {};
  for (const key of MASTERS_PERSISTED_PART_KEYS) {
    if (Object.hasOwn(stored, key)) parts[key] = stored[key];
  }
  return { v: BOOTSTRAP_VERSION, at: o.at, parts };
}

function removeQuietly(store: MastersStorage): void {
  try {
    store.removeItem(MASTERS_BLOB_KEY);
  } catch {
    // Storage disabled — there is nothing readable to clear anyway.
  }
}

/** This device's master copy, or null when there is none, it is unreadable, it
 * was written by another payload version, or it has aged out. A stored value
 * that parses but fails validation is removed on the spot: in a persistent
 * store it would otherwise sit there costing a JSON.parse on every load. */
export function readMastersBlob(
  now: number = Date.now(),
  storage?: MastersStorage,
): MastersBlob | null {
  const store = storageOrNull(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(MASTERS_BLOB_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    const blob = normalizeMastersBlob(parsed, now);
    if (blob === null) removeQuietly(store);
    return blob;
  } catch {
    return null;
  }
}

/** Replaces this device's master copy with the PERSISTED parts of `blob`. A
 * failed write (quota, disabled store) removes whatever was there before, so
 * the next load re-fetches instead of seeding a copy older than this one. */
export function writeMastersBlob(
  blob: MastersBlob,
  storage?: MastersStorage,
): void {
  const store = storageOrNull(storage);
  if (!store) return;
  try {
    store.setItem(MASTERS_BLOB_KEY, JSON.stringify(persistedBlob(blob)));
  } catch {
    removeQuietly(store);
  }
}

/** Read-modify-write of ONE part. Re-reads the stored blob first (repo memory
 * `shared-blob-whole-object-writers-clobber`: a writer that serializes a
 * snapshot it captured earlier silently reverts every sibling part written
 * since). When there is no usable blob, a fresh one carrying just this part is
 * written — the other parts are then absent, which the seed simply skips. A
 * non-persisted part (`staff`) is ignored outright. */
export function upsertMastersPart(
  key: MastersPartKey,
  value: unknown,
  at: string,
  storage?: MastersStorage,
): void {
  if (!isPersistedPart(key)) return;
  const store = storageOrNull(storage);
  if (!store) return;
  const existing = readMastersBlob(Date.now(), store);
  const parts: MastersBlob["parts"] = { ...(existing?.parts ?? {}) };
  parts[key] = value;
  writeMastersBlob({ v: BOOTSTRAP_VERSION, at, parts }, store);
}

/** Drops this device's master copy (logout, and on arrival at /login). */
export function clearMastersBlob(storage?: MastersStorage): void {
  const store = storageOrNull(storage);
  if (!store) return;
  removeQuietly(store);
}
