// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.6 — the PURE merge half of the cross-shard report fan-out (P7-R4).
// `reduceMerge(kind, legResults)` re-reduces the per-ledger aggregate outputs
// into ONE result; `compareBySortSpec` is the scatter-gather re-sort comparator
// the plain-find merge (report-fanout.ts) rides. No I/O in this file — the
// dial/timeout/allSettled half lives in `lib/report-fanout.ts`; keeping the
// reduce pure keeps every doc-shape provable DB-free (and both files inside the
// 300-line rule).
//
// The five P7-R4 kinds (phase-P7 §3.2 / phase-F2 §4 F2.6 blockquote):
//   sum        — scalar totals (gross/orders/discount): key-wise sum across every
//                doc of every leg; an ABSENT key contributes 0 (#8's `?? 0`
//                convention — omit-empty means absent, never a stored 0), a
//                PRESENT non-number is garbage → throw (never silently 0).
//   byKey      — per-rate / per-payment-mode / per-category buckets: group docs
//                by their `_id` key, sum the numeric fields per key.
//   daySeries  — concat the per-`_id` day rows, sort by `_id`. NO collision
//                merge, per spec — pre-F2.7 a day exists on exactly one ledger.
//                Once F2.7 writes the flip-day one-day window overlap, a flip
//                day can hold a row on BOTH legs; the consumer must sum-on-
//                collision or use `byKey` (recorded in phase-F2 §4 F2.6).
//   topN       — the scatter-gather top-N: concat the per-ledger top lists,
//                re-sort DESC by the metric, re-limit to N. A bare string kind
//                cannot drive the re-sort/re-limit, so this one is
//                PARAMETERIZED: `{ kind:'topN', by:<metric field>, n:<limit> }`.
//   auditEvents— concat the bucket docs' `events[]`, sort by `at`.
// ─────────────────────────────────────────────────────────────────────────────

/** The reduce kind driving `reduceMerge`. `topN` carries its metric + limit —
 *  the merge cannot re-sort/re-limit without them (P7-R4's "top-(N×k)" merge). */
export type MergeKind =
  | "sum"
  | "byKey"
  | "daySeries"
  | "auditEvents"
  | { kind: "topN"; by: string; n: number };

/** A merged keyed row (`byKey`/`daySeries`/`topN` output). `_id` is the group /
 *  day / product key exactly as the per-leg pipeline emitted it. */
export interface KeyedRow {
  _id: unknown;
  [field: string]: unknown;
}

/** The merged shape per kind. `sum` → one scalar-totals object; `auditEvents` →
 *  the flattened event list; the keyed kinds → rows. */
export type MergedData<M extends MergeKind = MergeKind> = M extends "sum"
  ? Record<string, number>
  : M extends "auditEvents"
    ? unknown[]
    : KeyedRow[];

// ── Value ordering (the in-memory re-sort) ────────────────────────────────────
// Approximates MongoDB's cross-type BSON order for the types the canonical Order
// and the rollup/audit docs actually sort by: nullish < numbers < strings <
// objects (ObjectId stringifies to its hex, so byte order is preserved) <
// booleans < Dates. Same-type scalars compare exactly as MongoDB does for
// ASCII/number/Date keys (`_id` day-and-sequence strings, `at` timestamps).
function typeRank(v: unknown): number {
  if (v === null || v === undefined) return 0;
  switch (typeof v) {
    case "number":
      return 1;
    case "string":
      return 2;
    case "object":
      return v instanceof Date ? 5 : 3;
    case "boolean":
      return 4;
    default:
      return 6;
  }
}

/** Total order over two field values (ascending). Exported for the fan-out's
 *  find-merge and for the keyed reduces below. */
export function cmpValues(a: unknown, b: unknown): number {
  const ra = typeRank(a);
  const rb = typeRank(b);
  if (ra !== rb) return ra - rb;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

/** A comparator over a Mongo sort spec (`{_id:-1}`, `{settledAt:1,...}`) for the
 *  in-memory re-sort of a scatter-gather merge: each leg sorted server-side with
 *  this same spec, the concatenation re-sorted with it here. */
export function compareBySortSpec(
  sort: Record<string, 1 | -1>,
): (a: object, b: object) => number {
  const entries = Object.entries(sort);
  return (a, b) => {
    for (const [field, dir] of entries) {
      const c = cmpValues(
        (a as Record<string, unknown>)[field],
        (b as Record<string, unknown>)[field],
      );
      if (c !== 0) return dir === -1 ? -c : c;
    }
    return 0;
  };
}

// ── Shared validation ─────────────────────────────────────────────────────────
function asDoc(item: unknown): Record<string, unknown> {
  if (item === null || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(
      "[report-merge] a leg emitted a non-document result — aggregate pipelines must emit docs",
    );
  }
  return item as Record<string, unknown>;
}

/** A summed field must be a number when PRESENT. Absent = 0 (#8); present
 *  garbage (null/string/nested) throws — pipelines `$ifNull` their omit-empty
 *  fields, and a silent 0 here would fake a complete-looking undercount. */
function asFiniteNumber(value: unknown, kind: string, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(
      `[report-merge] ${kind} merge: field '${field}' is not a finite number`,
    );
  }
  return value;
}

// ── The five reduces ──────────────────────────────────────────────────────────
function mergeSum(docs: Record<string, unknown>[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const doc of docs) {
    for (const [field, value] of Object.entries(doc)) {
      if (field === "_id") continue; // the $group discriminator, not a total
      out[field] = (out[field] ?? 0) + asFiniteNumber(value, "sum", field);
    }
  }
  return out;
}

// Group rows by their `_id` (string keys direct; non-string keys — numbers,
// compound `$group` docs, ObjectIds — via JSON, which is stable across legs
// because every leg runs the SAME pipeline shape, so compound-key field order
// matches). Output is ordered by that key for determinism.
function mergeByKey(docs: Record<string, unknown>[]): KeyedRow[] {
  const rows = new Map<string, { key: unknown; acc: Record<string, number> }>();
  for (const doc of docs) {
    const key = doc._id;
    const mapKey =
      typeof key === "string" ? `s:${key}` : `j:${JSON.stringify(key) ?? "u"}`;
    let row = rows.get(mapKey);
    if (!row) {
      row = { key, acc: {} };
      rows.set(mapKey, row);
    }
    for (const [field, value] of Object.entries(doc)) {
      if (field === "_id") continue;
      row.acc[field] = (row.acc[field] ?? 0) + asFiniteNumber(value, "byKey", field);
    }
  }
  return [...rows.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, { key, acc }]) => ({ _id: key, ...acc }));
}

function mergeDaySeries(docs: Record<string, unknown>[]): KeyedRow[] {
  // Concat + sort by `_id`, per spec — no collision merge (see the header's
  // F2.7 flip-day caveat). Stable: equal `_id`s keep leg order.
  return docs
    .map((d) => d as KeyedRow)
    .sort((a, b) => cmpValues(a._id, b._id));
}

function mergeTopN(
  docs: Record<string, unknown>[],
  by: string,
  n: number,
): KeyedRow[] {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`[report-merge] topN merge: n must be a positive integer, got ${n}`);
  }
  if (!by) throw new Error("[report-merge] topN merge: 'by' metric field required");
  // Absent metric = 0 (#8 — a leg that never sold a product omits the field);
  // present garbage throws via asFiniteNumber. Validated EAGERLY per doc, never
  // inside the sort comparator — sort() skips the comparator for length-1
  // input, which would let a single garbage doc through unvalidated.
  const ranked = docs.map((d) => ({
    row: d as KeyedRow,
    m: d[by] === undefined ? 0 : asFiniteNumber(d[by], "topN", by),
  }));
  return ranked
    .sort((a, b) => b.m - a.m || cmpValues(a.row._id, b.row._id))
    .slice(0, n)
    .map((r) => r.row);
}

function mergeAuditEvents(docs: Record<string, unknown>[]): unknown[] {
  const events: unknown[] = [];
  for (const doc of docs) {
    // actionAudit is BUCKETED (P6): each doc carries `events[]`. A doc without
    // an events array is a wrong pipeline (a misspelled $project), not an empty
    // bucket ($push always materializes the array) — fail loud.
    if (!Array.isArray(doc.events)) {
      throw new Error(
        "[report-merge] auditEvents merge: a doc has no events[] — project the bucket's events array",
      );
    }
    events.push(...doc.events);
  }
  return events.sort((a, b) =>
    cmpValues(
      (a as Record<string, unknown> | null)?.at,
      (b as Record<string, unknown> | null)?.at,
    ),
  );
}

// ── The dispatch ──────────────────────────────────────────────────────────────
/**
 * Re-reduce the fulfilled legs' aggregate outputs into one merged result.
 * `legResults` is one array of docs per SURVIVING leg (rejected legs are the
 * fan-out's `partial` flag, never fed here). Zero legs / zero docs merge to the
 * honest empty (`{}` / `[]`) — an all-empty result is a real answer, not an
 * error. Garbage doc shapes throw BEFORE any caller writes (the F2.5 pre-write
 * throw convention).
 */
export function reduceMerge<M extends MergeKind>(
  merge: M,
  legResults: unknown[][],
): MergedData<M>;
export function reduceMerge(merge: MergeKind, legResults: unknown[][]): MergedData {
  const docs = legResults.flat().map(asDoc);
  if (merge === "sum") return mergeSum(docs);
  if (merge === "byKey") return mergeByKey(docs);
  if (merge === "daySeries") return mergeDaySeries(docs);
  if (merge === "auditEvents") return mergeAuditEvents(docs);
  if (typeof merge === "object" && merge !== null && merge.kind === "topN") {
    return mergeTopN(docs, merge.by, merge.n);
  }
  throw new Error(`[report-merge] unknown merge kind: ${JSON.stringify(merge)}`);
}
