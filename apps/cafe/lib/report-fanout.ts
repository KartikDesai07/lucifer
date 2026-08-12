import {
  type Connection,
  type FilterQuery,
  type Model,
  type PipelineStage,
} from "mongoose";

import {
  ledgersForDate,
  dayKeyRange,
  type LedgerRef,
} from "@/lib/cluster-router";
import { getConn } from "@/lib/cluster-registry";
import {
  readOrdersInDayRange,
  orderIdDayRange,
  type RangedReadOptions,
} from "@/lib/order-read";
import {
  reduceMerge,
  compareBySortSpec,
  type MergeKind,
  type MergedData,
} from "@/lib/report-merge";
import { getOrderModel, type IOrder } from "@/models/order.ledger";
import {
  getDailyRollupModel,
  getProductDayCounterModel,
  type IDailyRollup,
  type IProductDayCounter,
} from "@/models/daily-rollup.ledger";

// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.6 — the cross-shard report fan-out (the P7-R4 signature). Two
// consumers wired on landing:
//   • F2.5's `recomputeCustomer` — imports `reportFanout` as its DEFAULT
//     (customer-rollup.ts; the F2.3→F2.5 default-flip precedent).
//   • F2.4's `{kind:'fanout',ledgers}` deferral — completed by
//     `readOrdersInDayRangeMerged` below (the plain-find scatter-gather merge;
//     a find is NOT an aggregate, so it gets its own runner over the same legs).
//
// Contract (phase-F2 §4 Step F2.6 + the P7-R4 blockquote; phase-P7 §3.2):
//   • `pipeline` is a CLOSURE `(L) => Stage[]` — each leg builds its own
//     `_id`-range stage with THAT leg's `L.tag` INSIDE the closure. One
//     route-level tag over a multi-ledger range matches NOTHING → a silently
//     EMPTY report (#74). The fan-out's job is handing L in; range authorship
//     stays with the pipeline (an all-time recompute legitimately has none).
//   • `Promise.allSettled` + per-leg `withTimeout` + `partial = some(rejected)`
//     — a paused/slow free M0 degrades to an HONEST partial result, never a
//     hang or a complete-looking undercount (F2 §2.5). The timeout wraps the
//     WHOLE leg (dial + query): a hung dial would otherwise ride
//     `serverSelectionTimeoutMS` (5s) past the 4s budget, and a route fanning
//     out must stay far inside the locked ≤8s rule (§17).
//   • Rejected legs are logged, counted into `partial`, and their in-flight
//     server-side reads left to finish harmlessly (read-only; a race loser
//     cannot be cancelled without cursor bookkeeping M0 doesn't merit).
//   • NO leg touches another cluster (#14): every closure runs on exactly one
//     `getConn(L)` connection; the merge happens HERE, in Node, never $lookup.
//
// Collection targets: `Order` binds through F2c's `getOrderModel` (#34);
// `dailyRollup`/`productDayCounter` bind through F2c's canonical accessors
// (F2.10 landed the schemas — `models/daily-rollup.ledger.ts` owns the shape
// and pins the exact collection names, so the raw branch moved onto typed
// bindings exactly as anticipated, signature untouched). `actionAudit` still
// has no schema (P6-owned, unbuilt) — it stays a raw `conn.collection(...)`
// read (the cluster-router registry-doc precedent) until P6 lands.
// ─────────────────────────────────────────────────────────────────────────────

/** LEDGER collections the fan-out can target (P7-R4). */
export const FANOUT_COLLECTIONS = [
  "Order",
  "dailyRollup",
  "productDayCounter",
  "actionAudit",
] as const;
export type FanoutCollection = (typeof FANOUT_COLLECTIONS)[number];
/** Still schema-less (P6-owned) — read raw until its writer phase lands. */
type RawFanoutCollection = "actionAudit";

/** Per-leg budget: dial + query. A leg past this is a `partial`, not a hang. */
export const FANOUT_TIMEOUT_MS = 4_000;

/** The P7-R4 spec: WHAT to read (collection), HOW each leg reads it (the
 *  per-leg pipeline closure), and HOW survivors re-reduce (merge kind). */
export interface ReportFanoutSpec<M extends MergeKind = MergeKind> {
  collection: FanoutCollection;
  pipeline: (L: LedgerRef) => PipelineStage[];
  merge: M;
}

export interface ReportFanoutResult<M extends MergeKind = MergeKind> {
  data: MergedData<M>;
  partial: boolean;
}

// ── Injectable DB collaborators (DB-free test seam — the F2.4 pattern) ────────
// Routing (`ledgersForDate`) + the registry dial (`getConn`) stay REAL so tests
// prove WHICH clusters a fan-out lands on via the opener spy; only the
// model/collection readers — the DB-touching collaborators — are injectable.
// The live socket round-trip runs against a seeded M0 in F2's integration pass.
interface FanoutDeps {
  getOrderModel: (conn: Connection) => Model<IOrder>;
  getDailyRollupModel: (conn: Connection) => Model<IDailyRollup>;
  getProductDayCounterModel: (conn: Connection) => Model<IProductDayCounter>;
  aggregateRaw: (
    conn: Connection,
    collection: RawFanoutCollection,
    pipeline: PipelineStage[],
  ) => Promise<unknown[]>;
}
const realDeps: FanoutDeps = {
  getOrderModel,
  getDailyRollupModel,
  getProductDayCounterModel,
  aggregateRaw: (conn, collection, pipeline) =>
    conn
      .collection(collection)
      .aggregate(pipeline as unknown as Record<string, unknown>[])
      .toArray(),
};
let deps: FanoutDeps = realDeps;
/** TEST SEAM — override the DB-touching collaborators; `null` restores production. */
export function __setReportFanoutDepsForTests(
  overrides: Partial<FanoutDeps> | null,
): void {
  deps = overrides ? { ...realDeps, ...overrides } : realDeps;
}

let fanoutTimeoutMs = FANOUT_TIMEOUT_MS;
/** TEST SEAM — shrink the per-leg timeout so hang tests run in ms; `null` restores. */
export function __setFanoutTimeoutForTests(ms: number | null): void {
  fanoutTimeoutMs = ms ?? FANOUT_TIMEOUT_MS;
}

// ── The leg runner (shared by the aggregate fan-out and the find merge) ───────
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`[report-fanout] ${label} timed out after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function runLegs<T>(
  legs: LedgerRef[],
  run: (L: LedgerRef) => Promise<T>,
): Promise<{ ok: T[]; partial: boolean }> {
  const parts = await Promise.allSettled(
    legs.map((L) => withTimeout(run(L), fanoutTimeoutMs, `ledger ${L.id} (${L.tag})`)),
  );
  const ok: T[] = [];
  let partial = false;
  parts.forEach((part, i) => {
    if (part.status === "fulfilled") {
      ok.push(part.value);
    } else {
      partial = true; // honest degradation — never a fake-complete result (#4/§2.5)
      console.error(
        `[report-fanout] leg ${legs[i].id} (${legs[i].tag}) failed — result marked partial:`,
        part.reason,
      );
    }
  });
  return { ok, partial };
}

// ── The P7-R4 aggregate fan-out ───────────────────────────────────────────────
/**
 * Fan an aggregation out over every ledger whose window overlaps `[from, to]`
 * (Date / `YYYY-MM-DD` / `YYYYMMDD` — the router's normalization; F2.5 passes
 * `'00000000'/'99999999'` for all-time) and `reduceMerge` the survivors.
 * Returns `{ data, partial }`; `partial:true` means at least one leg was
 * down/slow and the merge is an UNDERCOUNT — consumers that write (the
 * recompute authority) must refuse it; consumers that render must banner it.
 */
export async function reportFanout<M extends MergeKind>(
  spec: ReportFanoutSpec<M>,
  from: Date | string,
  to: Date | string,
): Promise<ReportFanoutResult<M>> {
  const legs = await ledgersForDate(from, to);
  const { ok, partial } = await runLegs(legs, async (L) => {
    const pipeline = spec.pipeline(L); // L.tag lives INSIDE the closure (#74)
    const conn = await getConn(L);
    if (spec.collection === "Order") {
      // The canonical binding (#34) — same path `ledgerModel(L,'Order')` takes.
      return deps.getOrderModel(conn).aggregate(pipeline).exec() as Promise<unknown[]>;
    }
    if (spec.collection === "dailyRollup") {
      return deps.getDailyRollupModel(conn).aggregate(pipeline).exec() as Promise<unknown[]>;
    }
    if (spec.collection === "productDayCounter") {
      return deps.getProductDayCounterModel(conn).aggregate(pipeline).exec() as Promise<unknown[]>;
    }
    return deps.aggregateRaw(conn, spec.collection, pipeline);
  });
  return { data: reduceMerge(spec.merge, ok), partial };
}

// ── The F2.4 deferral completion (plain-find scatter-gather merge) ────────────
export interface MergedOrdersRead {
  orders: IOrder[];
  /** The legs the range resolved to (1 = ran direct; ≥2 = merged fan-out). */
  ledgers: LedgerRef[];
  /** True iff a fan-out leg failed — the list is missing that ledger's rows. */
  partial: boolean;
}

/**
 * `readOrdersInDayRange`, completed: the single-ledger case returns its direct
 * result untouched (one leg, no timeout machinery, `partial:false` — a lone
 * leg's failure THROWS, exactly as F2.4 ships); a multi-ledger range runs the
 * SAME `_id`-day-range find per leg — EACH leg's own tag (#74 applies to finds
 * too) — then concat → re-sort (the caller's sort spec, `{_id:-1}` default) →
 * re-limit. Per-leg `limit` keeps every leg ≤ the cap so the merged re-limit is
 * correct (scatter-gather top-k). Routes should call THIS, not
 * `readOrdersInDayRange`-then-merge — one call site, no opts drift between the
 * resolution and the merge. Results stay the STORED paise/ObjectId shape.
 */
export async function readOrdersInDayRangeMerged(
  from: Date | string,
  to: Date | string,
  opts: RangedReadOptions = {},
): Promise<MergedOrdersRead> {
  const read = await readOrdersInDayRange(from, to, opts); // validates the filter
  if (read.kind === "direct") {
    return { orders: read.orders, ledgers: read.ledgers, partial: false };
  }

  const sort = opts.sort ?? { _id: -1 };
  const { lo, hi } = dayKeyRange(from, to); // the SAME normalization the legs rode
  const { ok, partial } = await runLegs(read.ledgers, async (L) => {
    const query: FilterQuery<IOrder> = {
      ...(opts.filter ?? {}),
      _id: orderIdDayRange(L.tag, lo, hi),
    };
    const conn = await getConn(L);
    const find = deps.getOrderModel(conn).find(query).sort(sort);
    if (opts.limit !== undefined) find.limit(opts.limit);
    return find.lean<IOrder[]>();
  });

  const orders = ok.flat().sort(compareBySortSpec(sort));
  return {
    orders: opts.limit !== undefined ? orders.slice(0, opts.limit) : orders,
    ledgers: read.ledgers,
    partial,
  };
}
