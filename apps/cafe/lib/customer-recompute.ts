import mongoose, { Types, type PipelineStage } from "mongoose";

import { type LedgerRef } from "@/lib/cluster-router";
import { reportFanout as f26ReportFanout } from "@/lib/report-fanout";
import { duesPaidTotal } from "@/lib/due-payment";
import { getRollupDeps } from "@/lib/customer-rollup";

// ─────────────────────────────────────────────────────────────────────────────
// recomputeCustomer — the AUTHORITY (F2 §2.6 / the P7-D0-F2 CORE analogue).
// Fans out over EVERY ledger, re-derives the totals from scratch, `$set`s them on
// CORE. Its dependency is F2.6's `reportFanout` — BUILT 2026-07-03 and wired as
// the DEFAULT here (the F2.3→F2.5 default-flip precedent: the seam stays
// injectable for tests; `setReportFanout(null)` restores the REAL fan-out).
//
// SPLIT FROM `customer-rollup.ts` (CR1.4): that module's UNIT BOUNDARY header
// note is the source of truth for the paise/rupee boundary and now also covers
// `duesPaidTotal` — read it there. Short version: `totals.duePaise` is paise
// (the ledger's stored shape); `duesPaidTotal` (CORE, DuePayment) is ALREADY
// rupees, so it is subtracted AFTER the `/100` below, never before and never
// combined with the paise side of the expression.
//
// This module shares `customer-rollup.ts`'s `deps` (getCustomerWriter /
// invalidateCustomersCache) via `getRollupDeps()` rather than owning a second
// copy — `applyCustomerRollup` and `recomputeCustomer` must be overridable
// TOGETHER by one `__setCustomerRollupDepsForTests` call, exactly as before
// the split.
//
// `duesPaidTotalFetcher` (below) is the same kind of seam as `reportFanout`:
// `duesPaidTotal` is a real CORE aggregate, and this module is an orchestrator
// (house rule #1), so its unit tests drive it through a fake port rather than a
// live Mongo connection. Re-exported from `customer-rollup.ts` alongside
// `setReportFanout` so both seams are reachable from the one public path.
// ─────────────────────────────────────────────────────────────────────────────

/** The merged all-ledger sums the fan-out must resolve (paise, per the stored shape). */
export interface RecomputedTotals {
  visits: number;
  spendPaise: number;
  duePaise: number;
}

/** The P7-R4 fan-out contract this seam consumes: a per-collection spec with a
 *  per-leg `pipeline(L)` closure and a merge kind; resolves merged data + the
 *  honest `partial` flag. F2.6's `reportFanout` must conform. */
export interface RecomputeFanoutSpec {
  collection: "Order";
  pipeline: (L: LedgerRef) => PipelineStage[];
  merge: "sum";
}
export type ReportFanout = (
  spec: RecomputeFanoutSpec,
  from: Date | string,
  to: Date | string,
) => Promise<{ data: unknown; partial: boolean }>;

// "All time" expressed as day keys, not a null convention: '00000000'/'99999999'
// bound every possible YYYYMMDD, so today's `ledgersForDate` overlap math already
// resolves them to EVERY ledger — no F2.6 signature widening required.
export const ALL_TIME_FROM = "00000000";
export const ALL_TIME_TO = "99999999";

let reportFanout: ReportFanout = f26ReportFanout;
/** TEST SEAM — inject a fake fan-out; `null` restores the REAL F2.6 one. */
export function setReportFanout(fn: ReportFanout | null): void {
  reportFanout = fn ?? f26ReportFanout;
}

// House rule #1 (DB-free by default): `duesPaidTotal` hits CORE for real, so the
// AUTHORITY that calls it needs the same kind of fake-port seam `reportFanout`
// already has, or every recomputeCustomer unit test would need a live Mongo
// connection just to prove the $set shape. `null` restores the REAL duesPaidTotal.
export type DuesPaidTotalFetcher = (customerId: string) => Promise<number>;
let duesPaidTotalFetcher: DuesPaidTotalFetcher = duesPaidTotal;
export function setDuesPaidTotalFetcher(fn: DuesPaidTotalFetcher | null): void {
  duesPaidTotalFetcher = fn ?? duesPaidTotal;
}

export type RecomputeResult =
  | { applied: true; totals: RecomputedTotals }
  // partial: a ledger was down/slow — an incomplete sum must NEVER overwrite the
  // authority target (it would clobber correct totals with an undercount).
  | { applied: false; reason: "partial" | "customer-missing" };

/** Per-leg pipeline: `$match` on the customer (rides the partial `{customerId:1}`
 *  index — equality implies `$exists`) + a `$group` mirroring `ledgerContribution`
 *  exactly (Unpaid → zero; CANCELLED → zero; due = max(0, total − paidAmount)).
 *  `total`/`paidAmount` are REQUIRED on the canonical Order — no `$ifNull` (#8
 *  covers omitted OPTIONALS). `L` is the P7-R4 closure shape; an all-time sum needs
 *  no per-leg `_id` day range, so the leg is unused (#74 bites day-bounded pipelines). */
function customerSumPipeline(customerId: Types.ObjectId) {
  return (_L: LedgerRef): PipelineStage[] => {
    // Mirrors ledgerContribution's two zero-contribution cases. Keeping them in
    // step is load-bearing: this pipeline is the RECOMPUTE AUTHORITY, so a case it
    // misses would not merely under-project — it would overwrite correct totals
    // with an order the incremental path (correctly) never counted (CR1.3).
    const unlessZeroRated = (expr: unknown) => ({
      $cond: [
        {
          $or: [
            { $eq: ["$payment", "Unpaid"] },
            { $eq: ["$status", "Cancelled"] },
          ],
        },
        0,
        expr,
      ],
    });
    return [
      { $match: { customerId } },
      {
        $group: {
          _id: null,
          visits: { $sum: unlessZeroRated(1) },
          spendPaise: { $sum: unlessZeroRated("$total") },
          duePaise: {
            $sum: unlessZeroRated({
              $max: [0, { $subtract: ["$total", "$paidAmount"] }],
            }),
          },
        },
      },
    ];
  };
}

/** Validate the merged fan-out payload before it may touch the authority target:
 *  absent field → 0 (an all-empty 'sum' merge is honestly zero, the #8 `?? 0`
 *  convention); a non-finite/non-number → throw (never write garbage). */
function asRecomputedTotals(data: unknown): RecomputedTotals {
  if (data !== null && data !== undefined && typeof data !== "object") {
    throw new Error("[customer-recompute] fan-out returned a non-object merge");
  }
  const d = (data ?? {}) as Record<string, unknown>;
  const num = (key: keyof RecomputedTotals): number => {
    const v = d[key] ?? 0;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`[customer-recompute] fan-out merge field '${key}' is not a finite number`);
    }
    return v;
  };
  return { visits: num("visits"), spendPaise: num("spendPaise"), duePaise: num("duePaise") };
}

/**
 * Recompute ONE customer's totals from scratch across all ledgers and `$set` them
 * on CORE. Refuses to write on a `partial` fan-out. Markers (`appliedOrders`) are
 * left untouched: clearing them would re-open re-application for orders whose
 * apply already landed. A transient race (an in-flight best-effort apply landing
 * after this `$set`) self-heals on the next recompute run — the stated
 * eventual-consistency contract (§2.6), not a defect.
 *
 * CR1.4 (§1 DUES RESURRECTION): the ledger fan-out has no idea a DuePayment was
 * ever collected, so `totals.duePaise` alone is the customer's due BEFORE any
 * cash changed hands. `duesPaidTotal` (CORE, rupees) is fetched and subtracted
 * here — but only on THIS path, after the `partial` refusal, so a fan-out that
 * isn't going to write doesn't pay for a query it will throw away.
 */
export async function recomputeCustomer(
  customerId: string,
): Promise<RecomputeResult> {
  if (!mongoose.isValidObjectId(customerId)) {
    throw new Error(`[customer-recompute] invalid customerId: ${customerId}`);
  }

  const { data, partial } = await reportFanout(
    {
      collection: "Order",
      pipeline: customerSumPipeline(new Types.ObjectId(customerId)),
      merge: "sum",
    },
    ALL_TIME_FROM,
    ALL_TIME_TO,
  );
  if (partial) return { applied: false, reason: "partial" };

  const totals = asRecomputedTotals(data);
  // Fetched only now (post-partial-refusal): the write is about to happen, so
  // the resurrection guard's query is no longer speculative (§1 / CR1.3 lesson —
  // guarding only the OTHER re-deriver is not guarding the invariant).
  const duesPaid = await duesPaidTotalFetcher(customerId);
  const deps = getRollupDeps();
  const writer = await deps.getCustomerWriter();
  const res = await writer.updateOne(
    { _id: new Types.ObjectId(customerId) },
    {
      // paise → v1 rupees (customer-rollup.ts's unit-boundary header); floored
      // at 0 like v1's clampLedger so the authority never persists a negative
      // ledger. duesPaid is already rupees (CORE), so it is subtracted AFTER
      // the /100 — never before, and never combined with the paise side of
      // the expression.
      $set: {
        visits: Math.max(0, totals.visits),
        totalSpend: Math.max(0, totals.spendPaise / 100),
        totalDue: Math.max(0, totals.duePaise / 100 - duesPaid),
      },
    },
  );
  if (res.matchedCount === 0) return { applied: false, reason: "customer-missing" };
  deps.invalidateCustomersCache();
  return { applied: true, totals };
}
