import { type Connection, type FilterQuery, type Model } from "mongoose";

import {
  ledgerFromOrderId,
  ledgersForDate,
  dayKeyRange,
  type LedgerRef,
} from "@/lib/cluster-router";
import { getConn } from "@/lib/cluster-registry";
import { getOrderModel, buildOrderId, type IOrder } from "@/models/order.ledger";

// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.4 — the cluster-scoped order READ service (the twin of F2.3's
// `order-create.ts`). Two read classes, each routed by the F2.2 router:
//
//   • TARGETED (`readOrderById`) — the `<ledgerTag>` embedded in the orderId is
//     the locator: parse it via `ledgerFromOrderId`, dial that ONE ledger, read.
//     Never scatter-gather a point read. A malformed id / a tag absent from the
//     registry resolves to `null` (the caller 404s) — same as a missing doc.
//
//   • DATE-ROUTED (`readOrdersInDayRange`) — resolve the inclusive day range via
//     `ledgersForDate`. The common case (a today-scoped list, the dashboard
//     summary's day fetch) overlaps exactly ONE ledger — the active one — and is
//     executed here directly as a per-tag `_id` prefix-range find. A range that
//     spans MULTIPLE ledgers is NOT merged here: it returns a `fanout` deferral
//     carrying the resolved legs — the cross-shard merge (Promise.allSettled +
//     per-leg pipeline + `partial:true`) is owned by F2.6's `reportFanout`.
//
// Day ranges ride the `_id` (= orderId, #5): `ORD-<tag>-YYYYMMDD-NNN` sorts by
// day then sequence within a ledger's single tag, so an `_id` range replaces
// v1's `createdAt` range (the F2c shape has no createdAt). Bounds compose from
// F2c's `buildOrderId` — the format is never re-derived here (#34).
//
// Boundary — what this service deliberately is NOT (held to P2 #44/#45):
//   • It does NOT rewrite the v1 routes. `GET /api/orders`/`[id]`/`summary` stay
//     on `connectDB()` + the default-bound v1 Order model until P2's cutover
//     (the String-orderId route rewrite + rupee→paise migration) wires them here.
//   • It does NOT decode for the client. It returns the STORED shape (Int32
//     paise / ObjectId refs / omit-empty); the shared codec presents ₹x.xx.
//   • It does NOT compose the dashboard summary. The summary's day fetch is this
//     service; its in-memory aggregation + the CORE Customer dues read are the
//     route's composition (and the CORE leg never touches a ledger, #14).
// ─────────────────────────────────────────────────────────────────────────────

// ── Injectable DB collaborators (DB-free test seam, the F2.3 pattern) ─────────
// Routing (`ledgerFromOrderId`/`ledgersForDate`) + the registry dial (`getConn`)
// stay REAL so the tests prove which cluster a read lands on via the registry's
// fake opener; only the model — the DB-touching collaborator — is injectable.
// The live socket round-trip runs against a seeded M0 in F2's integration pass.
interface ReadDeps {
  getOrderModel: (conn: Connection) => Model<IOrder>;
}
const realDeps: ReadDeps = { getOrderModel };
let deps: ReadDeps = realDeps;
/** TEST SEAM — override the DB-touching collaborators; `null` restores production. */
export function __setOrderReadDepsForTests(
  overrides: Partial<ReadDeps> | null,
): void {
  deps = overrides ? { ...realDeps, ...overrides } : realDeps;
}

// ── Targeted point read (one cluster, never scatter-gather) ───────────────────
/**
 * Read one order from the ONE ledger its `<ledgerTag>` names. Returns `null` for
 * a malformed id, a tag not in the current registry, or a missing doc — the
 * route maps all three to 404 (an unknown tag is indistinguishable from a
 * deleted/never-existed order to the client, and must not trigger a scan).
 */
export async function readOrderById(orderId: string): Promise<IOrder | null> {
  const ledger = await ledgerFromOrderId(orderId);
  if (!ledger) return null;
  const conn = await getConn(ledger);
  const order = await deps.getOrderModel(conn).findById(orderId).lean<IOrder>();
  return order ?? null;
}

// ── Date-routed ranged read (single-ledger direct; multi-ledger defers) ───────
export interface RangedReadOptions {
  /** Extra FIELD conditions (status/tableNo/payment/customerId-`$in`…), ANDed
   *  with the day-range `_id` bound. The range OWNS `_id`: a filter carrying
   *  `_id` or a root `$`-operator (`$or`/`$and`/…, which could nest an `_id`
   *  condition and silently narrow the result below the range) is REJECTED with
   *  a throw — a wrong filter is a caller bug; fail loud, never return a
   *  silently-narrowed list. Field-level operators in values are fine. */
  filter?: Omit<FilterQuery<IOrder>, "_id">;
  /** Sort spec. Defaults to `{ _id: -1 }` — day + sequence, newest first, the
   *  v2 replacement for v1's `createdAt: -1` (#5). */
  sort?: Record<string, 1 | -1>;
  /** Optional result cap. No default here: the summary read needs the WHOLE
   *  day; LIST routes must bound it themselves (≤ their MAX_LIMIT, §17). */
  limit?: number;
}

export type RangedOrdersRead =
  /** 0 or 1 overlapping ledgers — executed here. Zero legs (a range predating
   *  every window) is an honest empty list, not an error. */
  | { kind: "direct"; ledgers: LedgerRef[]; orders: IOrder[] }
  /** ≥2 overlapping ledgers — NOT merged here. F2.6's `reportFanout` owns the
   *  cross-shard merge; the resolved legs are returned for the handoff. */
  | { kind: "fanout"; ledgers: LedgerRef[] };

/**
 * The `_id` range covering all orderIds of ledger `tag` whose day segment lies
 * in `[loDay, hiDay]` (inclusive, `YYYYMMDD` keys). Bounds compose from F2c's
 * `buildOrderId` (#34) in the exact shape F2.6's per-leg pipelines are specced
 * to use (P7-R4): `-000` is ≤ every zero-padded sequence, and the `~` (0x7E,
 * above every digit) upper bound keeps 4+-digit sequences inside the range —
 * `"1000" < "999~"` lexicographically, so a >999-order day is fully covered.
 * Exported as the ONE home of the bound shape: F2.6's per-leg find merge
 * (`report-fanout.ts`) builds each leg's range from THIS function (#74), so the
 * direct read and the fan-out legs can never disagree about the bounds.
 */
export function orderIdDayRange(
  tag: string,
  loDay: string,
  hiDay: string,
): { $gte: string; $lt: string } {
  return {
    $gte: buildOrderId(tag, loDay, 0),
    $lt: `${buildOrderId(tag, hiDay, 999)}~`,
  };
}

/**
 * Read orders whose cafe-day lies in the inclusive range `[from, to]` (Date,
 * `YYYY-MM-DD`, or `YYYYMMDD` — the router's normalization). Exactly one
 * overlapping ledger → the query runs here, on that ledger only (a today-scoped
 * list touches ONLY the active ledger). Multiple ledgers → a `fanout` deferral
 * (F2.6). Results are the stored shape, `lean()`, newest-first by default.
 */
export async function readOrdersInDayRange(
  from: Date | string,
  to: Date | string,
  opts: RangedReadOptions = {},
): Promise<RangedOrdersRead> {
  // Enforce "the range owns _id" at the door (review-confirmed hardening): a
  // top-level `_id` would be clobbered ambiguously, and a root `$`-operator can
  // smuggle a nested `_id` that ANDs with the range and silently narrows it.
  // Neither can WIDEN past the range (MongoDB ANDs top-level conditions), but a
  // silently-empty list is still a wrong answer — refuse loudly instead.
  const filter = opts.filter ?? {};
  for (const key of Object.keys(filter)) {
    if (key === "_id" || key.startsWith("$")) {
      throw new Error(
        `[order-read] filter key '${key}' is not composable with the day-range ` +
          "_id bound — the range owns _id; pass field conditions only",
      );
    }
  }

  const ledgers = await ledgersForDate(from, to);
  if (ledgers.length > 1) return { kind: "fanout", ledgers };
  if (ledgers.length === 0) return { kind: "direct", ledgers, orders: [] };

  const ledger = ledgers[0];
  // Same normalization ledgersForDate used — the scanned `_id` range and the
  // resolved leg can never disagree about which days the query means.
  const { lo, hi } = dayKeyRange(from, to);
  const query: FilterQuery<IOrder> = {
    ...filter,
    _id: orderIdDayRange(ledger.tag, lo, hi),
  };

  const conn = await getConn(ledger);
  const find = deps
    .getOrderModel(conn)
    .find(query)
    .sort(opts.sort ?? { _id: -1 });
  if (opts.limit !== undefined) find.limit(opts.limit);
  const orders = await find.lean<IOrder[]>();
  return { kind: "direct", ledgers, orders };
}
