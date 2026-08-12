import {
  Schema,
  Types,
  type Connection,
  type Model,
} from "mongoose";
import {
  PAYMENT_MODES,
  ORDER_STATUSES,
  GST_MODES,
  type PaymentMode,
  type OrderStatus,
  type GstMode,
} from "@/lib/constants";

// ─────────────────────────────────────────────────────────────────────────────
// F2c — the CANONICAL Order model (the storage source-of-truth).
//
// This module OWNS the v2 Order shape + index set (build-rule #34 / F2c §5/§8).
// F2's ClusterRouter and F4 REFERENCE it and must NOT re-derive the v1 index
// list. It is exported as a SCHEMA, not a connection-bound model (build-rule #21
// "export schemas, not models"): the federation registers it per-LEDGER via
// `getOrderModel(ledgerConn)`. Importing this file has ZERO side effects on the
// default mongoose connection.
//
// Transition note (the F1 `getConnection` seam precedent): the still-live v1
// `models/Order.ts` (default-connection bound model, rupee money, `createdAt`,
// `findById`) keeps the running cafe app green. F2 (registry cutover) + P2 (the
// String-`orderId` route rewrite + rupee→paise migration, build-rules #44/#45)
// wire the routes onto THIS model and retire the v1 binding. F2c does not touch
// the routes — doing so is P2's job and a known no-backup-tier landmine.
//
// The byte/type/index/omit-empty decisions below are each questioned + chosen in
// phase-F2c-storage-optimized-data-model.md §3/§5/§8. Money is BSON Int32 PAISE
// everywhere (#6); refs are ObjectId not hex strings (#7); optionals are OMITTED
// not stored as 0/'' (#8); enum strings + top-level keys stay readable (#9); a
// schema-version `v` gates lazy migrate-on-read (#10). Presentation back to
// ₹x.xx / readable enums is the shared codec (packages/shared/src/codec.ts, #13).
// ─────────────────────────────────────────────────────────────────────────────

/** Bump when the stored Order shape changes; the codec branches on it (#10/#13). */
export const ORDER_SCHEMA_VERSION = 1;

// Mongoose's Int32 SchemaType (8.12+) emits a real BSON int32 (proven in
// order.ledger.test: `.instance === 'Int32'` + a rupee-float/over-cap CastError),
// but its TS SchemaDefinition typing isn't yet part of the `number`-field union,
// so a typed `new Schema<T>` rejects it. Alias it to `NumberConstructor` for the
// generic; the RUNTIME value is the unchanged real Int32 SchemaType.
const Int32 = Schema.Types.Int32 as unknown as NumberConstructor;

// ── orderId (= _id) format ───────────────────────────────────────────────────
// `ORD-<ledgerTag>-YYYYMMDD-NNN` (build-rule #5). The orderId IS the `_id`: this
// drops the ObjectId `_id`, the separate unique `orderId` index, AND `createdAt`
// (exact settle time is `settledAt`). `<ledgerTag>` is the time-shard locator the
// F2 router parses to target ONE cluster; the `YYYYMMDD` prefix sorts by day so
// `_id`-prefix ranges replace v1's `createdAt` range queries. P2's route rewrite
// (#44) validates by this regex instead of `mongoose.isValidObjectId`.
export const ORDER_ID_RE = /^ORD-([A-Z0-9]+)-(\d{8})-(\d{3,})$/;

/** Build a canonical orderId from its parts. `seq` is zero-padded to ≥3 digits. */
export function buildOrderId(
  ledgerTag: string,
  yyyymmdd: string,
  seq: number,
): string {
  return `ORD-${ledgerTag}-${yyyymmdd}-${String(seq).padStart(3, "0")}`;
}

/** The router's shard locator: the `<ledgerTag>` of an orderId, or null if malformed. */
export function ledgerTagOf(orderId: string): string | null {
  return ORDER_ID_RE.exec(orderId)?.[1] ?? null;
}

/** The cafe-day (`YYYYMMDD`) an orderId belongs to, or null if malformed. */
export function orderDayOf(orderId: string): string | null {
  return ORDER_ID_RE.exec(orderId)?.[2] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Interfaces — the STORED shape (what lives in BSON). Money fields are integer
// PAISE; `_id`/`customerId`/`item.productId` are ObjectId; optionals are absent
// (`?`) rather than zero/empty. The readable rupee/ string-id DTO the client sees
// is produced by the codec, not by these types.
// ─────────────────────────────────────────────────────────────────────────────

/** Embedded order line — never saved independently (the parent Order owns it). */
export interface IOrderItem {
  productId: Types.ObjectId; // ObjectId ref, not a hex string (#7)
  name: string; // price-at-sale name snapshot — required for standalone reprint (#12)
  price: number; // Int32 PAISE
  qty: number; // Int32
  modifiers?: string[]; // omit when empty (#8)
  instructions?: string; // omit when empty
  kotRound?: number; // Int32 — omit when 0 (KOT round this line was fired in)
}

export interface IOrder {
  _id: string; // = orderId, `ORD-<ledgerTag>-YYYYMMDD-NNN` (#5)
  customerId?: Types.ObjectId; // ObjectId, omit on walk-ins (#7/#8)
  customerName: string; // denormalized snapshot, kept for standalone receipts (#12)
  items: IOrderItem[];
  subtotal: number; // Int32 PAISE
  total: number; // Int32 PAISE
  paidAmount: number; // Int32 PAISE
  discount?: number; // Int32 PAISE — omit when 0/absent (reports must $ifNull, #8)
  gstAmount?: number; // Int32 PAISE — omit when absent
  gstRate?: number; // WHOLE PERCENT (build-rule #38, NOT basis-points); omit when 0
  gstMode?: GstMode; // GST mode snapshot at order time; omit when absent
  payment: PaymentMode;
  status: OrderStatus;
  splitCash?: number; // Int32 PAISE — omit when not a Split
  splitOnline?: number; // Int32 PAISE — omit when not a Split
  receiver: string; // staff name snapshot
  tableNo?: string; // T-1..T-8 — omit when absent (occupancy SoT, P3 #50)
  notes?: string; // omit when absent
  kotRounds?: number; // Int32 — count of KOT rounds fired; omit when 0
  settledAt?: Date; // exact settle instant (replaces `createdAt`); omit when unsettled
  frozen?: boolean; // set true at settlement — the immutability marker; absent = live
  // F4 offline exactly-once (#11, F4 §3): the field + index are owned by THIS
  // canonical shape; F4 wires the create-route dedupe (findOne→claim-seq→create).
  idemKey?: string; // RFC-4122 UUID (POS v4 / P10 ingest v5); omit when absent
  seqClaimed?: boolean; // set once the ledger sequence has been claimed
  // P10 external-ingest dedupe (omit-empty; build-rule #95/P10-CH). The full
  // aggregator/QR block (externalChannelRef/paySource/delivery/…) is fleshed out
  // by P10; F2c carries the two fields the unconditional dedupe index needs.
  source?: string; // e.g. 'web' | 'swiggy' | 'zomato'; omit for in-house orders
  externalRef?: string; // the channel's order id; omit for in-house orders
  v: number; // schema version (#10)
}

// ─────────────────────────────────────────────────────────────────────────────
// Schemas. `Schema.Types.Int32` forces a real BSON int32 — Mongoose's `Number`
// maps to BSON Double by default, which would silently defeat the paise win
// (#6 / F2c §3.2 / §11). The order.ledger.test asserts `.instance === 'Int32'`
// on every money path AND that a rupee-float / over-cap value raises a CastError
// (a BSON-serialize round-trip is NOT a valid guard — it encodes any integer as
// Int32, so it can't tell Int32 from a plain Number). The authoritative on-server
// `$type` check runs against a seeded M0 in F2 (F2c §1/§10).
//
// Omit-empty (#8): optionals carry NO `default:` (an absent field = 0 bytes, no
// null slot), and `minimize:true` drops empty embedded objects. Array paths get
// `default: undefined` to suppress Mongoose's automatic empty-`[]` materialization.
// ─────────────────────────────────────────────────────────────────────────────

const orderItemSchema = new Schema<IOrderItem>(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    price: { type: Int32, required: true },
    qty: { type: Int32, required: true, min: 1 },
    modifiers: { type: [String], default: undefined },
    instructions: { type: String },
    kotRound: { type: Int32 },
  },
  { _id: false, minimize: true },
);

const orderSchema = new Schema<IOrder>(
  {
    _id: { type: String, required: true }, // = orderId (#5)
    customerId: { type: Schema.Types.ObjectId },
    customerName: { type: String, required: true },
    items: { type: [orderItemSchema], required: true },
    subtotal: { type: Int32, required: true },
    total: { type: Int32, required: true },
    paidAmount: { type: Int32, required: true },
    discount: { type: Int32 },
    gstAmount: { type: Int32 },
    gstRate: { type: Int32 }, // whole percent (#38)
    gstMode: { type: String, enum: [...GST_MODES] },
    payment: { type: String, enum: [...PAYMENT_MODES], required: true },
    status: {
      type: String,
      enum: [...ORDER_STATUSES],
      required: true,
      default: "Pending",
    },
    splitCash: { type: Int32 },
    splitOnline: { type: Int32 },
    receiver: { type: String, required: true },
    tableNo: { type: String },
    notes: { type: String },
    kotRounds: { type: Int32 },
    settledAt: { type: Date },
    frozen: { type: Boolean },
    idemKey: { type: String },
    seqClaimed: { type: Boolean },
    source: { type: String },
    externalRef: { type: String },
    v: { type: Int32, required: true, default: ORDER_SCHEMA_VERSION },
  },
  {
    _id: false, // we supply `_id` (the orderId string) explicitly — no auto ObjectId
    minimize: true, // drop empty embedded objects (#8)
    timestamps: false, // NO createdAt/updatedAt (#5) — orderId carries the day, settledAt the exact time
    versionKey: false, // drop Mongoose's __v; we keep our own readable `v`
  },
);

// ── Index set (F2c §5 + build-rule #11; ≤5 incl. the P10-CH exception) ────────
// `_id` (= orderId) is the identity index — free, point lookups + `ORD-<tag>-`
// day-prefix ranges; no declaration needed. Every other index is PARTIAL so it
// covers only the tiny relevant slice, never years of closed orders.
//
// IMPORTANT — `partialFilterExpression` operator restriction (a real spec defect
// corrected here): MongoDB allows only `$eq` (field:value)/`$gt`/`$gte`/`$lt`/
// `$lte`/`$exists:true`/`$type`/`$and`/`$or`/`$in` in a partial filter. It does
// NOT allow `$ne` or `$exists:false`. F2c §5 / F4 / build-rules #11/#45 wrote the
// idemKey filter as `{ frozen: { $ne: true } }`, which would THROW at index
// creation. `{ idemKey: { $exists: true } }` is the valid REPLACEMENT (NOT an
// equivalent: under `$ne:true` a frozen order drops OUT of the index; under
// `$exists:true` with `idemKey` retained it stays IN).
//
// Chosen invariant: `idemKey` is RETAINED for the order's lifetime, so the unique
// partial index covers every idemKey-carrying order — the accepted size tradeoff
// in exchange for the cross-settle exactly-once that F4's `findOne({idemKey})`
// dedupe depends on. HARD RULE: do NOT `$unset` idemKey at freeze/cold-tier —
// stripping it would make a replayed refund credit note (created `frozen:false`
// WITH its idemKey, then frozen same-write — build-rule #45) escape the dedupe and
// DOUBLE-INSERT on a no-backup tier. Any future index BOUNDING must come from
// cold-tiering whole settled orders out of the live ledger (F2/F2c §7), NOT from
// unsetting idemKey. (Whether to bound at all is an F4/F2 lifecycle decision; the
// `frozen:$ne:true` wording in #11/#45 + F2c §5 is SUPERSEDED — see memory/handoff.)

// Live floor board: open tabs by table. Open = status "Pending" (held/unsettled).
orderSchema.index(
  { tableNo: 1 },
  { partialFilterExpression: { status: "Pending" }, name: "tableNo_open" },
);

// Customer history: only orders attached to a customer.
orderSchema.index(
  { customerId: 1 },
  {
    partialFilterExpression: { customerId: { $exists: true } },
    name: "customerId_present",
  },
);

// F4 offline exactly-once: unique idemKey over all idemKey-carrying orders. See
// the operator-restriction note above for why this is `$exists:true` (a valid
// replacement) and not `{ frozen: { $ne: true } }` (invalid), and why idemKey is
// never unset.
orderSchema.index(
  { idemKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idemKey: { $exists: true } },
    name: "idemKey_unique_partial",
  },
);

// P10-CH (build-rule #95/#96): the durable cross-settle external-id dedupe index.
// UNIQUE, partial ONLY on `externalRef` existing — NOT lifecycle-scoped, so a
// settled-then-replayed webhook still collides and returns the existing order
// rather than escaping the (lifecycle-scoped) idemKey partial to double-insert.
orderSchema.index(
  { source: 1, externalRef: 1 },
  {
    unique: true,
    partialFilterExpression: { externalRef: { $exists: true } },
    name: "source_externalRef_unique",
  },
);

// ── Accessor (schemas-not-models, #21) ───────────────────────────────────────
/**
 * Register/return the Order model on a specific LEDGER connection. The federation
 * (F2 ClusterRouter) calls this with the routed ledger connection; never bind the
 * Order schema to the default mongoose connection. Idempotent per connection.
 */
export function getOrderModel(conn: Connection): Model<IOrder> {
  return (
    (conn.models.Order as Model<IOrder> | undefined) ??
    conn.model<IOrder>("Order", orderSchema)
  );
}

export { orderSchema, orderItemSchema };
