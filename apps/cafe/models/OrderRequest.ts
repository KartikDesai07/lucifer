import mongoose, { Schema, type Document, type Model } from "mongoose";

// CR2.2 — a diner's self-order (QR) BEFORE it becomes a real Order. Staff
// review the tray and either accept it (minting an Order that carries this
// request's id — see models/Order.ts's `sourceRequestIds`) or reject it.
//
// Deliberately NOT in the federated registry (FEDERATED_MODELS / cluster-
// registry SCHEMAS / cluster-router CORE_MODELS) — this is a plain
// default-bound model, v1-grade like models/DuePayment.ts and
// models/Table.ts. A request is pre-money (nothing is owed until it becomes
// an Order), so it never needs the ledger's paise/sharding discipline.

// Embedded subdocument — mirrors models/Order.ts's IOrderItem field set
// (minus `kotRound`, which only exists once an item has been fired to the
// kitchen; a request has no KOT rounds yet).
export interface IOrderRequestItem {
  productId: string;
  name: string; // denormalized product name snapshot
  price: number;
  qty: number;
  variation?: string;
  modifiers: string[];
  instructions: string;
}

export const ORDER_REQUEST_STATUSES = [
  "pending",
  "accepting",
  "accepted",
  "rejected",
] as const;
export type OrderRequestStatus = (typeof ORDER_REQUEST_STATUSES)[number];

export const ORDER_REQUEST_TARGET_KINDS = ["table", "parcel"] as const;
export type OrderRequestTargetKind = (typeof ORDER_REQUEST_TARGET_KINDS)[number];

export interface IOrderRequest extends Document {
  shortCode: string; // opaque diner-facing status-check code (PUBLIC_CODE_PATTERN)
  // "accepting" is a TRANSIENT status, not a real end state: it exists so the
  // accept bridge can claim a request with a single atomic
  // `findOneAndUpdate({status:"pending"}, {status:"accepting"})` CAS before it
  // does the (non-atomic) work of minting an Order — any second accept
  // attempt sees "accepting" and fails the same CAS instead of racing to
  // create two Orders off one request.
  status: OrderRequestStatus;
  targetKind: OrderRequestTargetKind;
  tableNo?: string; // present only for targetKind "table" — absent for "parcel"
  items: IOrderRequestItem[];
  // §1 — the exact totals the diner consented to on the menu page. The Order
  // minted on accept carries these prices forward; accept RE-VALIDATES them
  // against the live product/table state rather than trusting them blindly
  // (a diner's request can go stale between placing it and staff accepting).
  quotedSubtotal: number;
  quotedCharge: number;
  quotedChargeLabel?: string;
  quotedTotal: number;
  note?: string;
  // Promo codes — CR2.2c. Omit-empty, matching quotedChargeLabel's own
  // discipline: a request with no applied code carries neither key at all.
  // `promoCode` is the NORMALIZED (uppercase) code resolvePromoDiscount
  // matched, never the diner's raw typed text.
  promoCode?: string;
  quotedDiscount?: number;
  // `mobile` must NEVER appear in any public (unauthenticated) response —
  // lib/customer-privacy.ts owns masking on staff-facing surfaces; this field
  // exists so staff can reach a diner, not so a diner can be looked up by
  // another diner.
  mobile: string;
  name: string;
  // ── Resolution — set once, together, by whichever path resolves the
  // request (accept or reject). All optional, no defaults (omit-empty): a
  // still-pending request carries none of them.
  acceptedOrderId?: string;
  acceptedAt?: Date;
  rejectedReason?: string;
  actor?: string; // staff name who accepted/rejected, from the session
  // CR2.3 D9 — the self-order auto-print marker, set once by finalizeAccept
  // (order-request-accept-core.ts) alongside the resolution block above, and
  // claimed exactly once by lib/pos-pulse.ts's claimKotPrint. No defaults
  // (omit-empty): a staff-entered or not-yet-printed request carries neither
  // key. `acceptedKotRound` is the Order's `kotRounds` AT THE MOMENT this
  // request's accept finalized — never re-derived later, since a replayed
  // accept can find the winner order several rounds ahead by then.
  acceptedKotRound?: number;
  kotPrintedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const orderRequestItemSchema = new Schema<IOrderRequestItem>(
  {
    productId: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    qty: { type: Number, required: true, min: 1 },
    // No default: mirrors orderItemSchema (models/Order.ts) — an item sold
    // one way only carries no key at all.
    variation: { type: String },
    modifiers: { type: [String], default: [] },
    instructions: { type: String, default: "" },
  },
  { _id: false }, // embedded — no _id needed
);

// Exported as a SCHEMA (not only the default-bound model), matching the
// codebase's schemas-not-models convention for anything that might one day
// join the federation (models/Table.ts, models/Counter.ts) — this model is
// NOT registered anywhere federated today; see the file-level comment.
export const orderRequestSchema = new Schema<IOrderRequest>(
  {
    // unique:true creates the index — no separate index() needed for shortCode.
    shortCode: { type: String, required: true, unique: true },
    status: { type: String, enum: [...ORDER_REQUEST_STATUSES], default: "pending" },
    targetKind: { type: String, enum: [...ORDER_REQUEST_TARGET_KINDS], required: true },
    tableNo: { type: String },
    items: { type: [orderRequestItemSchema], required: true },
    quotedSubtotal: { type: Number, required: true },
    quotedCharge: { type: Number, required: true },
    quotedChargeLabel: { type: String },
    quotedTotal: { type: Number, required: true },
    note: { type: String },
    // Promo codes — CR2.2c. No defaults — omit-empty, mirrors quotedChargeLabel.
    promoCode: { type: String },
    quotedDiscount: { type: Number },
    mobile: { type: String, required: true },
    name: { type: String, required: true },
    acceptedOrderId: { type: String },
    acceptedAt: { type: Date },
    rejectedReason: { type: String },
    actor: { type: String },
    // CR2.3 D9 — no defaults, mirrors the resolution block above.
    acceptedKotRound: { type: Number },
    kotPrintedAt: { type: Date },
  },
  { timestamps: true },
);

// Serves the staff tray (pending requests, newest first) and lazy pruning of
// old resolved rows — no TTL index (see below), so a sweep needs this to
// avoid a COLLSCAN.
orderRequestSchema.index({ status: 1, createdAt: -1 });

// NO TTL index: ttl-guard's default-deny (build-rule #23 / GST §36) allows
// exactly one registry TTL index platform-wide (Heartbeat) — everything else,
// including a pre-money request row, is retained. This model is never walked
// by the registry's module-load TTL sweep (lib/cluster-registry.ts / the
// LEDGER self-assert), since it is deliberately NOT federated, so its own
// test pins `assertSchemaTtlAllowed` directly (see order-request-model.test.ts).

// Reuse the compiled model across hot reloads / serverless invocations.
export const OrderRequest: Model<IOrderRequest> =
  (mongoose.models.OrderRequest as Model<IOrderRequest>) ??
  mongoose.model<IOrderRequest>("OrderRequest", orderRequestSchema);
