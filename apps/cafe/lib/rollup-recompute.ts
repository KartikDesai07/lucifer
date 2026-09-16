import { type Connection, type Model } from "mongoose";

import { ledgersForDate, type LedgerRef } from "@/lib/cluster-router";
import { getConn } from "@/lib/cluster-registry";
import { orderIdDayRange } from "@/lib/order-read";
import { getOrderModel, type IOrder } from "@/models/order.ledger";
import {
  getDailyRollupModel,
  getProductDayCounterModel,
  buildProductDayCounterId,
  DAY_KEY_RE,
  DAILY_ROLLUP_SCHEMA_VERSION,
  PRODUCT_DAY_COUNTER_SCHEMA_VERSION,
  type IDailyRollup,
  type IProductDayCounter,
} from "@/models/daily-rollup.ledger";

// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.10 — the `dailyRollup` RECOMPUTE AUTHORITY (F2c §4 / build-rule
// #72): the idempotent from-scratch derivation of one cafe-day's rollup +
// product-day counters, keyed by the day's ORDER SET — never a blind `$inc`
// (the Computed-Pattern "not guaranteed exact" caveat is unacceptable for
// money/GST; a full replace derived from raw orders survives throttling with
// no engine guarantees, and raw orders stay the source of truth).
//
// SPLIT OWNERSHIP, honestly named (the F2.5 `setReportFanout` precedent):
//   • F2 owns the MECHANICS here — leg resolution (a flip day legitimately
//     spans TWO ledgers; each leg's row covers only its own orders, the F2.6
//     daySeries contract), the bounded per-leg `_id`-range read, the
//     idempotent replace-write, the stale-counter reconciliation.
//   • P2 owns the FINANCIAL FOLD (orders → rollup fields + counters): the
//     gross basis / status filters / tax-bucket netting are frozen-settle
//     semantics pinned with the CA at writer-build (P7-D0). Until P2 wires
//     `setDayRollupFold`, this module REFUSES with `fold-unbuilt` — exactly
//     how `recomputeCustomer` refused before F2.6 landed. NEVER invent the
//     arithmetic here.
//
// ENTRY IS SCHEDULED-CALLER-ONLY (#26): nothing in the cafe app calls this on
// a timer — the nightly reconcile is wired by F3's Hub cron (or the db-hygiene
// workflow) alongside P2's settle-time incremental write; the P7-D0 golden
// reconcile then asserts incremental == recompute, zero drift.
//
// CONCURRENCY = CONVERGENCE, NOT LOCKING (the F2.5 recomputeCustomer contract):
// the single Hub scheduler is the designed serializer. Should two recomputes of
// the same day still interleave (a manual run racing the cron), the worst end
// state is a mix of two SELF-CONSISTENT snapshots of the day (one run's rollup
// row + the other's counters/stale-sweep) until the next run converges — raw
// orders are the source of truth, so nothing is ever lost, only transiently
// stale. A distributed lock buys nothing a nightly re-run doesn't already.
// ─────────────────────────────────────────────────────────────────────────────

/** What the P2-owned fold must produce for one leg's slice of a day. */
export interface DayRollupFoldOutput {
  rollup: Omit<IDailyRollup, "_id" | "v">;
  counters: Array<{
    productId: string; // 24-hex ObjectId of the product
    sold: number; // SIGNED int units
    revenue: number; // SIGNED int paise
  }>;
}

export interface DayRollupFold {
  /** Optional `.select()` projection for the per-leg order read — the fold
   *  declares what it needs; absent = full stored docs. */
  projection?: string;
  /** Pure derivation over ONE leg's orders for the day (already `.lean()`,
   *  stored paise/ObjectId shape). Must be a pure function of the order set —
   *  that purity is what makes the replace-write idempotent. */
  fold: (orders: IOrder[], day: string) => DayRollupFoldOutput;
}

let dayRollupFold: DayRollupFold | null = null;
/** PRODUCTION SEAM — P2's settle phase wires the real financial fold here
 *  (build-rule #72); `null` restores the unbuilt-refusal default. */
export function setDayRollupFold(fold: DayRollupFold | null): void {
  dayRollupFold = fold;
}

// ── Injectable DB collaborators (DB-free test seam — the F2.4/F2.6 pattern) ───
// Routing (`ledgersForDate`) + the registry dial (`getConn`) stay REAL so tests
// prove WHICH cluster each leg lands on via the opener spy; only the model
// bindings — the DB-touching collaborators — are injectable.
interface RecomputeDeps {
  getOrderModel: (conn: Connection) => Model<IOrder>;
  getDailyRollupModel: (conn: Connection) => Model<IDailyRollup>;
  getProductDayCounterModel: (conn: Connection) => Model<IProductDayCounter>;
}
const realDeps: RecomputeDeps = {
  getOrderModel,
  getDailyRollupModel,
  getProductDayCounterModel,
};
let deps: RecomputeDeps = realDeps;
/** TEST SEAM — override the DB-touching collaborators; `null` restores production. */
export function __setRollupRecomputeDepsForTests(
  overrides: Partial<RecomputeDeps> | null,
): void {
  deps = overrides ? { ...realDeps, ...overrides } : realDeps;
}

export type RecomputeDayLegResult =
  | {
      leg: LedgerRef;
      applied: true;
      /** Orders folded on this leg (0 = the day's row/counters were REMOVED —
       *  an empty set idempotently recomputes to absence, not zero-rows). */
      orders: number;
      counters: number;
    }
  | {
      leg: LedgerRef;
      applied: false;
      // fold-unbuilt: P2 hasn't wired the financial fold (the refusal default).
      // fold-invalid: the fold returned non-integer/garbage — never written.
      // leg-failed: the read or write threw (down/paused M0); logged, other
      //             legs proceed independently (no cross-leg transaction, #14).
      reason: "fold-unbuilt" | "fold-invalid" | "leg-failed";
    };

export interface RecomputeDayResult {
  day: string;
  /** True iff EVERY resolved leg applied (vacuously true for a day predating
   *  all windows — nothing to recompute is a success, not an error). */
  applied: boolean;
  legs: RecomputeDayLegResult[];
}

// BSON int32 bounds. This pre-write validation is the ONLY range guard on this
// path: empirically (Mongo 8.0 + mongoose 8, F2.10 review arbitration probe),
// `Model.replaceOne` does NOT reject an uncastable Int32 — it silently STRIPS
// the path from the replacement, upserting the doc with the field ABSENT (a
// vanished required `gross` on a financial row). Never rely on query-path
// casting here. (`bulkWrite` replaceOne ops DO validate — same probe.)
const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;

/** Reject a fold output that would write garbage (the `asRecomputedTotals`
 *  precedent): every numeric must be a finite integer WITHIN Int32 range
 *  (SIGNED is fine — netting), counters keyed by real ObjectId hex. */
function foldOutputError(out: DayRollupFoldOutput): string | null {
  const r = out.rollup;
  const nums: Array<[string, unknown]> = [
    ["orders", r.orders],
    ["gross", r.gross],
    ...(r.discount !== undefined ? [["discount", r.discount] as [string, unknown]] : []),
    ...(r.compTotal !== undefined ? [["compTotal", r.compTotal] as [string, unknown]] : []),
    ...(r.payments ?? []).flatMap((p, i): Array<[string, unknown]> => [
      [`payments[${i}].amount`, p.amount],
      [`payments[${i}].orders`, p.orders],
    ]),
    ...(r.taxBuckets ?? []).flatMap((t, i): Array<[string, unknown]> => [
      [`taxBuckets[${i}].rate`, t.rate],
      [`taxBuckets[${i}].taxable`, t.taxable],
      [`taxBuckets[${i}].gst`, t.gst],
    ]),
    ...out.counters.flatMap((c, i): Array<[string, unknown]> => [
      [`counters[${i}].sold`, c.sold],
      [`counters[${i}].revenue`, c.revenue],
    ]),
  ];
  for (const [path, v] of nums) {
    if (typeof v !== "number" || !Number.isInteger(v)) {
      return `non-integer ${path} (${String(v)})`;
    }
    if (v < INT32_MIN || v > INT32_MAX) {
      return `out-of-Int32-range ${path} (${String(v)})`;
    }
  }
  if (r.orders < 0) return `negative orders count (${r.orders})`;
  for (const c of out.counters) {
    if (!/^[0-9a-f]{24}$/.test(c.productId)) {
      return `counters productId is not ObjectId hex ('${c.productId}')`;
    }
  }
  return null;
}

/** Anchored filter for THIS day's counter ids. `_id` is prodId-major (F2c §8),
 *  so a day sweep cannot ride the index — a fixed-layout regex scan, acceptable
 *  only because this runs as the nightly authority job over a tiny collection
 *  (products × days), never on a request path (see daily-rollup.ledger.ts). */
function dayCounterIdRegex(day: string): RegExp {
  return new RegExp(`^[0-9a-f]{24}-${day}$`);
}

async function recomputeLeg(
  L: LedgerRef,
  day: string,
  fold: DayRollupFold,
): Promise<RecomputeDayLegResult> {
  const conn = await getConn(L);

  // Bounded read: this LEG's slice of the day — its own tag (#74), `_id` range.
  const find = deps
    .getOrderModel(conn)
    .find({ _id: orderIdDayRange(L.tag, day, day) });
  if (fold.projection !== undefined) find.select(fold.projection);
  const orders = await find.lean<IOrder[]>();

  const Rollup = deps.getDailyRollupModel(conn);
  const Counter = deps.getProductDayCounterModel(conn);

  if (orders.length === 0) {
    // Idempotent empty-set recompute: absence, not zero-rows (omit-empty at the
    // collection level) — also heals a day whose orders were all cold-tiered
    // away wrongly leaving stale summaries.
    await Rollup.deleteOne({ _id: day });
    await Counter.deleteMany({ _id: dayCounterIdRegex(day) });
    return { leg: L, applied: true, orders: 0, counters: 0 };
  }

  const out = fold.fold(orders, day);
  const invalid = foldOutputError(out);
  if (invalid) {
    console.error(
      `[rollup-recompute] fold output rejected for ${day} on ${L.id}: ${invalid}`,
    );
    return { leg: L, applied: false, reason: "fold-invalid" };
  }

  // Idempotent replace-write: the row is a pure function of the day's order
  // set. replaceOne (not $inc/$set-merge) so a re-run or a raced double-run
  // converges on identical bytes.
  await Rollup.replaceOne(
    { _id: day },
    { ...out.rollup, v: DAILY_ROLLUP_SCHEMA_VERSION },
    { upsert: true },
  );

  const keepIds = out.counters.map((c) =>
    buildProductDayCounterId(c.productId, day),
  );
  // The replacement MUST carry `_id`: mongoose validates a bulkWrite replaceOne
  // replacement as a FULL document (unlike `Model.replaceOne`, which runs no
  // validators — the same asymmetry the Int32 range guard above exists for), so
  // omitting the required `_id` fails every op on a real M0 (seeded-M0 pass,
  // 2026-07-05). The server accepts it because it equals the filter's `_id`.
  const counterOps = out.counters.map((c, i) => ({
    replaceOne: {
      filter: { _id: keepIds[i] },
      replacement: {
        _id: keepIds[i],
        sold: c.sold,
        revenue: c.revenue,
        v: PRODUCT_DAY_COUNTER_SCHEMA_VERSION,
      },
      upsert: true,
    },
  }));
  if (counterOps.length > 0) await Counter.bulkWrite(counterOps);
  // Reconcile stale counters: a product that left the day's order set (voided
  // order, corrected import) must drop to ABSENT, or its stale sold/revenue
  // would survive the "exact" recompute.
  await Counter.deleteMany({
    _id: { $regex: dayCounterIdRegex(day), $nin: keepIds },
  });

  return { leg: L, applied: true, orders: orders.length, counters: keepIds.length };
}

/**
 * Recompute ONE cafe-day (`YYYYMMDD`) from scratch on every ledger whose window
 * overlaps it. Legs run independently (`allSettled` — no cross-leg atomicity
 * exists, #14): a down leg is reported `leg-failed` and NEVER blocks or dirties
 * the others; re-running after it recovers converges (idempotent). Refuses all
 * legs with `fold-unbuilt` until P2 wires the financial fold.
 */
export async function recomputeDayRollup(
  day: string,
): Promise<RecomputeDayResult> {
  if (!DAY_KEY_RE.test(day)) {
    throw new Error(`[rollup-recompute] invalid day key: ${day}`);
  }

  const legs = await ledgersForDate(day, day);
  // A day predating every ledger window resolves to zero legs — nothing to
  // recompute is a vacuous success (and needs no fold), never an error.
  if (legs.length === 0) return { day, applied: true, legs: [] };

  const fold = dayRollupFold;
  if (!fold) {
    return {
      day,
      applied: false,
      legs: legs.map((leg) => ({
        leg,
        applied: false as const,
        reason: "fold-unbuilt" as const,
      })),
    };
  }

  const settled = await Promise.allSettled(
    legs.map((L) => recomputeLeg(L, day, fold)),
  );
  const results: RecomputeDayLegResult[] = settled.map((part, i) => {
    if (part.status === "fulfilled") return part.value;
    console.error(
      `[rollup-recompute] leg ${legs[i].id} (${legs[i].tag}) failed for ${day}:`,
      part.reason,
    );
    return { leg: legs[i], applied: false, reason: "leg-failed" };
  });

  return {
    day,
    applied: results.every((r) => r.applied),
    legs: results,
  };
}
