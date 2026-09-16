// CB-DL-1 — seeding the five master TanStack keys from a bootstrap payload or
// from this tab's stored copy (lib/masters-blob.ts).
//
// Pure and node-testable: no React, no DOM, no fetch. The five query keys are
// imported from the hooks that own them (they are plain arrays), so this file
// can never drift from the keys the screens actually read.
import type { QueryClient } from "@tanstack/react-query";
import { SETTINGS_KEYS } from "@/hooks/use-settings";
import { CATEGORY_KEYS } from "@/hooks/use-categories";
import { PRODUCT_KEYS } from "@/hooks/use-products";
import { TABLE_KEYS } from "@/hooks/use-tables";
import { STAFF_KEYS } from "@/hooks/use-staff";
import {
  BOOTSTRAP_VERSION,
  MASTERS_PART_KEYS,
  type BootstrapPayload,
  type MastersBlob,
  type MastersPartKey,
} from "@/lib/bootstrap-contract";

// One part key -> the ONE query key the corresponding hook reads. The archived
// products view (["products","archived"]) is deliberately absent: the bootstrap
// carries the active list only.
export const MASTERS_QUERY_KEYS: Record<MastersPartKey, readonly string[]> = {
  settings: SETTINGS_KEYS.all,
  categories: CATEGORY_KEYS.all,
  products: PRODUCT_KEYS.all,
  tables: TABLE_KEYS.all,
  staff: STAFF_KEYS.all,
};

/** The parts of a payload worth storing: present and non-null only. A
 * non-admin session gets `staff: null` (the staff part is admin-only), and a
 * cluster with no Settings document yet gets `settings: null` — neither must
 * be seeded, or the hook would serve `null` as if it were an answer. */
export function partsOfPayload(p: BootstrapPayload): MastersBlob["parts"] {
  const parts: MastersBlob["parts"] = {};
  for (const key of MASTERS_PART_KEYS) {
    const value: unknown = p[key];
    if (value !== null && value !== undefined) parts[key] = value;
  }
  return parts;
}

/** The blob to store for a payload — stamped with the payload's own `at`, so
 * the tab's copy carries the SERVER's timestamp, not the browser's clock. */
export function blobOfPayload(p: BootstrapPayload): MastersBlob {
  return { v: BOOTSTRAP_VERSION, at: p.at, parts: partsOfPayload(p) };
}

/** Writes each present part into its query key and returns the parts actually
 * seeded.
 *
 * By DEFAULT a part is skipped when the key already holds data whose
 * `dataUpdatedAt` is at or after the blob's `at`: that data is the same age or
 * fresher (a mutation in this tab, or a re-seed from a newer bootstrap), and
 * overwriting it would silently roll the screen back. That is the rule for
 * seeding from the tab's STORED copy, whose age is only ever a lower bound.
 *
 * With `opts.force` every present non-null part is written regardless. That is
 * for the bootstrap RESPONSE, which is the authoritative refresh (the owner's
 * one master call per page load): a client whose clock runs ahead would
 * otherwise stamp its own copy in the future and keep older data forever.
 *
 * `setQueryData`'s `updatedAt` option is what makes the comparison meaningful —
 * and it also lets each hook's own staleTime govern the next refetch, which
 * `initialData` without `initialDataUpdatedAt` would not. */
export function seedMasters(
  qc: QueryClient,
  blob: MastersBlob,
  opts?: { force?: boolean },
): MastersPartKey[] {
  const at = Date.parse(blob.at);
  if (!Number.isFinite(at)) return [];
  const force = opts?.force === true;
  const seeded: MastersPartKey[] = [];
  for (const key of MASTERS_PART_KEYS) {
    const value: unknown = blob.parts[key];
    if (value === null || value === undefined) continue;
    const queryKey = MASTERS_QUERY_KEYS[key];
    if (!force) {
      const existingAt = qc.getQueryState(queryKey)?.dataUpdatedAt;
      if (existingAt !== undefined && existingAt >= at) continue;
    }
    qc.setQueryData(queryKey, value, { updatedAt: at });
    seeded.push(key);
  }
  return seeded;
}
