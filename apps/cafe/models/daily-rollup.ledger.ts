import { Schema, type Connection, type Model } from "mongoose";

import { PAYMENT_MODES, type PaymentMode } from "@/lib/constants";
import { assertSchemaTtlAllowed } from "@/lib/ttl-guard";

// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.10 — the LEDGER computed collections (F2c §4/§8): `dailyRollup` +
// `productDayCounter`. ONE canonical name each, F2c-OWNED, co-located ON THE
// LEDGER with the orders they summarize (co-location is what makes the optional
// same-cluster settle+rollup transaction even possible, F2c §4) — NEVER on CORE,
// never renamed (`DailySummary` is the forbidden re-invention, F2 §4 F2.10).
//
// Ownership triangle (P7-D0, RESOLVED 2026-06-27, build-rule #72):
//   • WRITER = P2's settle path (it alone holds the frozen per-bucket
//     financials), writing through these accessors — NOT BUILT YET. Until it
//     lands, these collections exist as read-side contract + recompute target.
//   • RECOMPUTE AUTHORITY = F2 (`lib/rollup-recompute.ts`): the idempotent
//     from-scratch derivation keyed by the day's order set — never blind `$inc`
//     (the Computed-Pattern "not guaranteed exact" caveat is unacceptable for
//     money/GST, F2c §4). Its financial FOLD is P2-owned and injected (the
//     gross basis is pinned with the CA at writer-build — owner flag 1).
//   • READERS = F2.6's `reportFanout` (typed bindings) + P7's reports.
//
// Shape = the P2-GUARANTEED rich shape the P7-D0 ruling locked (P2 §1/§3.4/§6;
// F2c §8's earlier scalar `gstCollected` is CORRECTED away): per cafe-day
// `{orders, gross, payment split, discount, compTotal, taxBuckets[{rate,
// taxable, gst}]}` with VOID/REFUND NETTING AS SEMANTICS, not extra fields:
// every total is the SIGNED NET of the day's docs — a refund credit note
// (a negative compensating Order, `refundOf`) nets into the day its OWN `_id`
// falls in (GST §34 accrual); a Voided/Cancelled order is EXCLUDED by status
// (it has no negative doc — summing its frozen buckets would over-state output
// tax, P7 §3.5). Money fields are therefore SIGNED Int32 paise. P2 EXTENDS this
// shape at writer-build exactly as it extends the Order doc (never forks it).
//
// Placement/lifecycle rules carried from F2c:
//   • NO index beyond `_id` (§5 austerity): `_id` = `YYYYMMDD` gives point reads
//     + day ranges; the fan-out merges cross-ledger rows (a flip day holds a row
//     on BOTH legs, each covering only its own orders — consumers sum-on-collision,
//     the F2.6 `daySeries` caveat).
//   • TTL-FORBIDDEN (build-rule #23): these are FINANCIAL summaries; the module
//     self-asserts against the shared allowlist at load, so a future TTL here
//     fails every boot/test run.
//   • `productDayCounter._id` = `<prodId>-<YYYYMMDD>` (prodId-major, per F2c §8
//     verbatim): a per-day sweep therefore cannot ride the `_id` index — the
//     recompute's stale-counter reconciliation does a fixed-layout `$regex` scan,
//     acceptable ONLY for the nightly authority job on this tiny collection
//     (products × days), never on a request path.
// ─────────────────────────────────────────────────────────────────────────────

/** Bump when the stored rollup shape changes; readers branch on it (#10/#13). */
export const DAILY_ROLLUP_SCHEMA_VERSION = 1;
export const PRODUCT_DAY_COUNTER_SCHEMA_VERSION = 1;

/** The canonical collection names (F2c §4 — F2/F4/P7 must not re-invent). The
 *  F2.6 fan-out targets these same strings; the schemas pin them explicitly so
 *  mongoose pluralization can never fork `dailyRollup` → `dailyrollups`. */
export const DAILY_ROLLUP_COLLECTION = "dailyRollup";
export const PRODUCT_DAY_COUNTER_COLLECTION = "productDayCounter";

/** `_id` shapes. Day keys are IST cafe-days (`cafeDateString`), 8 digits. */
export const DAY_KEY_RE = /^\d{8}$/;
export const PRODUCT_DAY_COUNTER_ID_RE = /^([0-9a-f]{24})-(\d{8})$/;

/** Build the counter `_id` for one product on one cafe-day. */
export function buildProductDayCounterId(
  productIdHex: string,
  yyyymmdd: string,
): string {
  return `${productIdHex}-${yyyymmdd}`;
}

// Mongoose's Int32 SchemaType emits a real BSON int32; alias for the typed
// Schema generic exactly as order.ledger.ts does (see the note there). Int32 is
// SIGNED — refund netting legitimately drives money fields negative.
const Int32 = Schema.Types.Int32 as unknown as NumberConstructor;

// ── Stored shapes ─────────────────────────────────────────────────────────────

/** One payment-mode bucket: the day's SIGNED net paise + order count for the
 *  mode (P7 report 2 reads "each mode (paise) + count"). Only modes that occur
 *  that day are stored (omit-empty, #8). */
export interface IPaymentBucket {
  mode: PaymentMode;
  amount: number; // Int32 paise, SIGNED net
  orders: number; // Int32 count
}

/** One GST-rate bucket (rate-wise taxable + tax — the P2 §1 guarantee that
 *  makes P7's Tax Summary rollup-direct). SIGNED: refund notes net negative. */
export interface ITaxBucket {
  rate: number; // WHOLE PERCENT int (build-rule #38 — NOT basis-points/paise)
  taxable: number; // Int32 paise, SIGNED net
  gst: number; // Int32 paise, SIGNED net
}

export interface IDailyRollup {
  _id: string; // cafe-day `YYYYMMDD` — point read for day-end, `$gte/$lte` ranges
  orders: number; // Int32 — the day's order count (writer-pinned status basis)
  /** Int32 paise, SIGNED net. BASIS (pre/post-discount, Σtotal vs Σtaxable) is
   *  DELIBERATELY UNPINNED here — P7-D0 pins it with the CA at writer-build;
   *  `gross`+`discount`+`compTotal` ride separately so both gross- and
   *  net-of-discount derive either way. */
  gross: number;
  discount?: number; // Int32 paise — omit when 0 (#8; readers `$ifNull`)
  compTotal?: number; // Int32 paise — comp is a WRITE-OFF, never in discount (#43)
  payments?: IPaymentBucket[]; // omit when empty
  taxBuckets?: ITaxBucket[]; // omit when empty (GST off / zero-rated day)
  v: number; // schema version (#10)
}

export interface IProductDayCounter {
  _id: string; // `<prodId hex>-<YYYYMMDD>` (F2c §8 verbatim — prodId-major)
  sold: number; // Int32 units, SIGNED net (a refund with returns nets qty out)
  revenue: number; // Int32 paise, SIGNED net
  v: number;
}

// ── Schemas (Int32 paise #6, omit-empty #8, no createdAt/__v — same regime as
//    order.ledger.ts; embedded buckets are `_id:false` subdocs) ────────────────

const paymentBucketSchema = new Schema<IPaymentBucket>(
  {
    mode: { type: String, enum: [...PAYMENT_MODES], required: true },
    amount: { type: Int32, required: true },
    orders: { type: Int32, required: true },
  },
  { _id: false, minimize: true },
);

const taxBucketSchema = new Schema<ITaxBucket>(
  {
    rate: { type: Int32, required: true },
    taxable: { type: Int32, required: true },
    gst: { type: Int32, required: true },
  },
  { _id: false, minimize: true },
);

const dailyRollupSchema = new Schema<IDailyRollup>(
  {
    _id: { type: String, required: true },
    orders: { type: Int32, required: true },
    gross: { type: Int32, required: true },
    discount: { type: Int32 },
    compTotal: { type: Int32 },
    payments: { type: [paymentBucketSchema], default: undefined },
    taxBuckets: { type: [taxBucketSchema], default: undefined },
    v: { type: Int32, required: true, default: DAILY_ROLLUP_SCHEMA_VERSION },
  },
  {
    _id: false, // we supply the day key
    collection: DAILY_ROLLUP_COLLECTION, // pin — never pluralized/forked
    minimize: true,
    timestamps: false,
    versionKey: false,
  },
);

const productDayCounterSchema = new Schema<IProductDayCounter>(
  {
    _id: { type: String, required: true },
    sold: { type: Int32, required: true },
    revenue: { type: Int32, required: true },
    v: {
      type: Int32,
      required: true,
      default: PRODUCT_DAY_COUNTER_SCHEMA_VERSION,
    },
  },
  {
    _id: false,
    collection: PRODUCT_DAY_COUNTER_COLLECTION,
    minimize: true,
    timestamps: false,
    versionKey: false,
  },
);

// TTL-FORBIDDEN (build-rule #23): financial summaries retain like the orders
// they derive from. Asserted at module load — and doubly: these schemas declare
// no indexes at all (`_id` is the only access path, F2c §5).
assertSchemaTtlAllowed("DailyRollup", dailyRollupSchema);
assertSchemaTtlAllowed("ProductDayCounter", productDayCounterSchema);

// ── Accessors (schemas-not-models, #21 — same contract as `getOrderModel`) ────
/**
 * Register/return the model on a specific LEDGER connection (the federation
 * hands the routed `conn` in; never bind to the default mongoose connection).
 * Idempotent per connection.
 */
export function getDailyRollupModel(conn: Connection): Model<IDailyRollup> {
  return (
    (conn.models.DailyRollup as Model<IDailyRollup> | undefined) ??
    conn.model<IDailyRollup>("DailyRollup", dailyRollupSchema)
  );
}

export function getProductDayCounterModel(
  conn: Connection,
): Model<IProductDayCounter> {
  return (
    (conn.models.ProductDayCounter as Model<IProductDayCounter> | undefined) ??
    conn.model<IProductDayCounter>("ProductDayCounter", productDayCounterSchema)
  );
}

export { dailyRollupSchema, productDayCounterSchema };
