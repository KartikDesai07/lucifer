// Menu redesign (owner, 2026-09-30) — the shape of what a NON-admin PUT may
// touch. Pure, DB-free: crud-route.ts's createItemRoute is the only caller.
//
// R1 (arbitration ruling): a non-admin PUT continues only when the config
// names an allow-list AND the parsed body has AT LEAST ONE key AND EVERY
// parsed key is in that list. An empty body (0 keys) is refused — there is
// nothing a staff PUT could legitimately mean by sending no fields at all.

// Staff may only flip the in-stock / out-of-stock toggle. Restoring an
// archived item ({isActive:true}) is deliberately NOT here — it stays
// admin-only via the DELETE-only softDelete path and this allow-list.
export const STAFF_PRODUCT_FIELDS = ["available"] as const;

// Object.hasOwn, not `in`: a payload cannot reach through the prototype to
// claim a field is present (this repo has a live history of prototype-key
// bypasses — the same discipline as buildUpdate's nullClearsFields check).
export function isStaffScopedUpdate(
  data: unknown,
  allowed: readonly string[],
): boolean {
  if (typeof data !== "object" || data === null) return false;
  const keys = Object.keys(data as Record<string, unknown>).filter((k) =>
    Object.hasOwn(data as Record<string, unknown>, k),
  );
  if (keys.length === 0) return false;
  return keys.every((k) => allowed.includes(k));
}
