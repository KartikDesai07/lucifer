// CB-DL-1 master-data bootstrap contract — the ONE place the route
// (app/api/bootstrap), the client provider (components/layout/MasterDataProvider),
// the device blob (lib/masters-blob), the seed (lib/masters-seed) and the live
// leg (scripts/verify-bootstrap-live) read the payload shape from.
//
// Client-safe by construction: types + constants + one pure function. No
// Mongoose, no DB, no Node-only API — the provider bundles this file.
import type { Category, Product, Settings, Staff, Table } from "@/types";

// Bump when the payload/blob shape changes; a blob with another `v` is discarded.
export const BOOTSTRAP_VERSION = 2; // CB-DL-2: Product DTO changed (category -> categoryId); v1 tab blobs are discarded

// Device storage key (the browser's persistent per-origin store — survives a
// reload, a closed tab and a restart of the app shell; cleared on logout and
// on every arrival at /login). Owner rule 2026-09-09 ("use local store
// properly"): a counter PC or tablet must paint its masters instantly on every
// launch, not only on a reload of the same tab.
export const MASTERS_BLOB_KEY = "pos.masters.v1";

// A blob older than this is ignored; the in-memory copies expire on the same clock
// (STALE_TIMES.MASTERS / GC_TIMES.MASTERS in @pos/shared/query).
export const MASTERS_BLOB_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// How long a device with NO usable stored copy waits for GET /api/bootstrap
// before the screens render anyway and fall back to their own routes. Long
// enough for a warm answer (one round trip), short enough that a cold Vercel
// function or a paused Atlas cluster never reads as "the app does not load".
export const MASTERS_HOLD_MAX_MS = 4 * 1000;

export const MASTERS_PART_KEYS = [
  "settings",
  "categories",
  "products",
  "tables",
  "staff",
] as const;
export type MastersPartKey = (typeof MASTERS_PART_KEYS)[number];

// The parts that may be written to the DEVICE store. `staff` is deliberately
// absent: it is admin-only and carries names, usernames and mobile numbers,
// so it lives in memory for the tab's life only (seeded from the bootstrap
// response, never from disk) — a shared device that was closed without a
// logout must not keep it readable.
export const MASTERS_PERSISTED_PART_KEYS = [
  "settings",
  "categories",
  "products",
  "tables",
] as const satisfies readonly MastersPartKey[];

// What GET /api/bootstrap returns inside the { success: true, data } envelope.
// `staff` is null for a non-admin session (D3: the staff part is admin-only and
// byte-equal to GET /api/staff); `settings` is null only on a cluster that has
// no Settings document yet.
export interface BootstrapPayload {
  v: number;
  at: string;
  mastersVersion: string;
  settings: Settings | null;
  categories: Category[];
  products: Product[];
  tables: Table[];
  staff: Staff[] | null;
}

// The stored blob: the payload's parts keyed by MASTERS_PART_KEYS. Parts that
// were null/absent in the payload are simply not present; the device store only
// ever holds MASTERS_PERSISTED_PART_KEYS (lib/masters-blob.ts strips the rest).
export interface MastersBlob {
  v: number;
  at: string;
  parts: Partial<Record<MastersPartKey, unknown>>;
}

export type MastersParts = Pick<BootstrapPayload, MastersPartKey>;

interface Stamped {
  updatedAt?: unknown;
}

function updatedAtMs(row: unknown): number {
  if (typeof row !== "object" || row === null) return 0;
  const raw = (row as Stamped).updatedAt;
  const ms =
    raw instanceof Date
      ? raw.getTime()
      : typeof raw === "string"
        ? Date.parse(raw)
        : Number.NaN;
  return Number.isFinite(ms) ? ms : 0;
}

function partVersion(key: MastersPartKey, part: unknown): string {
  if (Array.isArray(part)) {
    let max = 0;
    for (const row of part) max = Math.max(max, updatedAtMs(row));
    return `${key}:${part.length}:${max}`;
  }
  if (typeof part === "object" && part !== null) {
    return `${key}:1:${updatedAtMs(part)}`;
  }
  return `${key}:0:0`;
}

// Derived from the parts already loaded — costs no extra query. Folds the row
// COUNT into each part because a hard delete (category/table/staff) bumps no
// updatedAt. Format: "<key>:<count>:<maxUpdatedAtMs>|..." in MASTERS_PART_KEYS order.
export function mastersVersionOf(parts: MastersParts): string {
  return MASTERS_PART_KEYS.map((key) => partVersion(key, parts[key])).join("|");
}
