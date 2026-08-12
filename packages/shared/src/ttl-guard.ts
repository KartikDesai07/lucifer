import { HEARTBEATS_COLLECTION } from "./heartbeat";

// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.10 — the TTL ALLOWLIST guard (build-rule #23 / F2c §7 guarantee 4),
// single-homed here (#31) because both apps register schemas and must agree:
//   • the cafe runtime asserts every schema it registers (cluster-registry's
//     SCHEMAS walk + the LEDGER model accessors) carries no forbidden TTL;
//   • the Hub (F3.7's heartbeat ingest — the ONE place a TTL index is created
//     today) consults the same allowlist before creating it.
//
// WHY default-deny: GST §36 (CGST) mandates 72 months' retention on accounts —
// orders / invoices / payments / GST events may be cold-tiered to R2 but NEVER
// expired. A TTL index deletes silently and permanently on a no-backup tier, so
// the rule is enforced where an index is DECLARED, not trusted to review. Any
// collection not explicitly allowlisted is treated as financial/retained.
//
// P2 extends this guard with the "no hard-delete on financial collections"
// check (its §3.12 credit-note rule); P6 ADDS `authLog` (its flat plain-`at`
// TTL'd login log — CORE, no money) to the allowlist when it lands. Extend the
// list in THIS file only — a second list in an app would fork the rule.
// ─────────────────────────────────────────────────────────────────────────────

/** Collections a TTL index may legally exist on — genuinely ephemeral,
 *  non-financial data only. Everything else is default-DENY. */
export const TTL_ALLOWED_COLLECTIONS = [
  // Hub-side gauge samples (7d, `@pos/shared/heartbeat` owns the index spec).
  HEARTBEATS_COLLECTION,
] as const;

export function isTtlAllowedCollection(collection: string): boolean {
  return (TTL_ALLOWED_COLLECTIONS as readonly string[]).includes(collection);
}

/** One declared index, mongoose-agnostic (this package carries no mongoose):
 *  mongoose's `schema.indexes()` tuples `[key, options]` map onto this shape,
 *  as does a raw `createIndex(key, options)` call site. */
export interface DeclaredIndex {
  key: Readonly<Record<string, unknown>>;
  options?: { expireAfterSeconds?: unknown } & Readonly<Record<string, unknown>>;
}

function isTtl(ix: DeclaredIndex): boolean {
  return ix.options?.expireAfterSeconds !== undefined;
}

/**
 * Assert every TTL-bearing index in `indexes` is legal for `collection`:
 *   • the collection must be allowlisted (default-deny — the #23 retention rule);
 *   • the index must be a SINGLE-FIELD non-`_id` index with a non-negative
 *     finite `expireAfterSeconds` — MongoDB REJECTS a compound/`_id` TTL at
 *     creation (`CannotCreateIndex: TTL indexes are single-field indexes` —
 *     verified live on 8.0, F2.10 arbitration probe). Failing HERE moves that
 *     error from live index build (deploy-time autoIndex) to schema
 *     registration, where every test run sees it.
 * The field's Date-ness cannot be checked here (no type info crosses this
 * boundary): MongoDB never expires docs whose indexed value is not a BSON date
 * — the registering schema owns that half of the contract.
 * Non-TTL indexes pass through untouched. Throws on the first violation.
 */
export function assertTtlIndexesAllowed(
  collection: string,
  indexes: readonly DeclaredIndex[],
): void {
  for (const ix of indexes) {
    if (!isTtl(ix)) continue;

    const fields = Object.keys(ix.key);
    if (!isTtlAllowedCollection(collection)) {
      throw new Error(
        `[ttl-guard] TTL index {${fields.join(",")}} on '${collection}' is FORBIDDEN ` +
          "(build-rule #23): only ephemeral non-financial collections " +
          `(${TTL_ALLOWED_COLLECTIONS.join(", ")}) may expire documents — ` +
          "GST §36 mandates 72-month retention on financial records; " +
          "cold-tier to R2 instead of TTL-deleting.",
      );
    }

    const expire = ix.options?.expireAfterSeconds;
    if (
      typeof expire !== "number" ||
      !Number.isFinite(expire) ||
      expire < 0
    ) {
      throw new Error(
        `[ttl-guard] TTL index on '${collection}' has invalid expireAfterSeconds ` +
          `(${String(expire)}) — must be a finite non-negative number.`,
      );
    }
    if (fields.length !== 1 || fields[0] === "_id") {
      throw new Error(
        `[ttl-guard] TTL index {${fields.join(",")}} on '${collection}' is not a ` +
          "single-field non-_id index — MongoDB rejects it at creation " +
          "(CannotCreateIndex, 'TTL indexes are single-field indexes'); fail at " +
          "registration instead of at live index build (F2 §3.10).",
      );
    }
  }
}
