import mongoose, { Schema, type Document, type Model } from "mongoose";
import {
  PAYMENT_MODES,
  ORDER_STATUSES,
  GST_MODES,
  type PaymentMode,
  type OrderStatus,
  type GstMode,
} from "@/lib/constants";

// Embedded subdocument — never saved independently (parent Order owns it).
export interface IOrderItem {
  productId: string;
  name: string; // denormalized product name snapshot
  price: number;
  qty: number;
  // The variation this line was SOLD as, snapshotted by name — `price` above
  // is already that variation's price. Absent for an item sold one way only,
  // so a pre-variations order is unchanged. Every renderer goes through
  // orderItemLabel() so the cart, the bill, and the KOT can never disagree.
  variation?: string;
  modifiers: string[];
  instructions: string;
  kotRound: number; // KOT round this line was fired in (0 = not yet sent / legacy)
}

// Append-only void trail (CR1.3). A snapshot, not a reference: `qty` is what was
// VOIDED off the line and `price` the unit price then, so the entry still reads
// correctly after the line is reduced or gone from items[].
export interface IOrderVoid {
  productId: string;
  name: string;
  price: number;
  qty: number;
  kotRound: number;
  // Snapshotted from the voided line so the kitchen's VOID slip can name the exact
  // cover to stop making — "Tea" alone is ambiguous on a tab holding two Teas
  // prepared differently. Omitted when the line carried none.
  instructions?: string;
  modifiers?: string[];
  // Same reason as `instructions` — on a tab holding a Small and a Large of
  // the same dish, the void slip has to say WHICH size to stop making.
  variation?: string;
  reason: string;
  voidedBy: string; // staff name from the session
  at: Date;
  kotNumber?: number; // this void slip's own kitchen-ticket number
}

export interface IOrder extends Document {
  orderId: string; // ORD-YYYYMMDD-NNN
  customerId?: string;
  customerName: string; // denormalized name snapshot
  items: IOrderItem[];
  subtotal: number;
  discount: number; // amount (not percentage) at order level
  gstAmount?: number; // GST added on top when settings.gstMode === "exclusive"
  gstRate?: number; // GST rate snapshot at order time (0 if GST was off then)
  gstMode?: GstMode; // GST mode snapshot at order time
  chargeAmount?: number; // the table's extra charge as sold (untaxed, inside total)
  chargeLabel?: string; // what that charge printed as, snapshot at order time
  total: number;
  paidAmount: number;
  payment: PaymentMode;
  splitCash?: number; // for Split payment
  splitOnline?: number; // for Split payment
  status: OrderStatus;
  receiver: string; // staff name
  tableNo?: string; // optional T-1 to T-8
  notes?: string; // order-level notes
  kotRounds: number; // count of KOT rounds fired (running order); 0 for one-shot orders
  // Printed slip numbers, already resolved against the cafe's configured daily
  // start — what the paper actually said. `kotNumbers[n-1]` belongs to round n,
  // so a reprint reproduces the ticket the kitchen is holding instead of
  // issuing a second number for the same food. `billNumber` is allocated when
  // the bill is ISSUED (payment taken), so a cancelled or still-open tab never
  // burns one and the day's bill series has no gaps.
  kotNumbers?: number[];
  billNumber?: number;
  voids?: IOrderVoid[]; // absent until the first void ($push creates it)
  cancelReason?: string; // set together, only by POST /api/orders/[id]/cancel
  cancelledBy?: string;
  cancelledAt?: Date;
  // D5 — self-order provenance marker. SELF_ORDER_SOURCE ("qr", @pos/shared)
  // is the only value written today; a staff-entered order carries no `source`
  // at all (omit-empty), so this field alone answers "did a diner place this".
  source?: string;
  // CR2.2 — the OrderRequest id(s) this Order was accepted FROM. `default:
  // undefined` (not `[]`) is load-bearing, not stylistic: a unique+sparse
  // multikey index does NOT exclude documents whose field is an EMPTY array
  // — an empty array still indexes as a null entry, so a second Order with
  // `sourceRequestIds: []` would collide with the first on that same null.
  // The field must therefore be entirely ABSENT unless it carries at least
  // one real id.
  //
  // This is the DB-level double-accept fence (reciprocal-CAS-guards
  // discipline): the unique multikey index below rejects any second Order
  // that carries an already-applied request id, and the accept bridge's
  // add-round CAS additionally guards `{ sourceRequestIds: { $ne: requestId
  // } }` on the WRITE side. Any future writer of Order.items or
  // sourceRequestIds must preserve BOTH halves of this fence, or a request
  // can be double-accepted into two Orders.
  sourceRequestIds?: string[];
  createdAt: Date;
  updatedAt: Date;
}

const orderVoidSchema = new Schema<IOrderVoid>(
  {
    productId: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    qty: { type: Number, required: true, min: 1 },
    kotRound: { type: Number, required: true },
    instructions: { type: String },
    modifiers: { type: [String], default: undefined },
    variation: { type: String },
    reason: { type: String, required: true },
    voidedBy: { type: String, required: true },
    at: { type: Date, required: true },
    // The number printed on this void's own kitchen slip, drawn from the same
    // daily ticket series. Absent when the cafe does not number its tickets, or
    // numbers them but chooses not to number voids.
    kotNumber: { type: Number },
  },
  { _id: false }, // embedded — no _id needed
);

const orderItemSchema = new Schema<IOrderItem>(
  {
    productId: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    qty: { type: Number, required: true, min: 1 },
    // No default: an item sold one way only carries no key at all (mirrors
    // `instructions`/`modifiers` above in spirit, but this one is genuinely
    // absent — not even an empty string — for every pre-variations order).
    variation: { type: String },
    modifiers: { type: [String], default: [] },
    instructions: { type: String, default: "" },
    kotRound: { type: Number, default: 0 },
  },
  { _id: false }, // embedded — no _id needed
);

const orderSchema = new Schema<IOrder>(
  {
    // unique:true creates the index — no separate index() needed for orderId.
    orderId: { type: String, required: true, unique: true },
    customerId: { type: String },
    customerName: { type: String, required: true },
    items: { type: [orderItemSchema], required: true },
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    // GST config snapshot — the tax actually charged on this order, so receipts
    // stay correct even after the cafe later changes its GST rate/mode.
    gstRate: { type: Number },
    gstMode: { type: String, enum: [...GST_MODES] },
    // Table-charge snapshot — the extra charge folded into `total` and the name
    // it was sold under, frozen at sale time so editing the table later cannot
    // rewrite a printed bill. No defaults: a bill with no charge carries
    // neither field (omit-empty), and the amount is what gates the label.
    chargeAmount: { type: Number },
    chargeLabel: { type: String },
    total: { type: Number, required: true },
    paidAmount: { type: Number, required: true },
    payment: { type: String, enum: [...PAYMENT_MODES], required: true },
    splitCash: { type: Number },
    splitOnline: { type: Number },
    status: { type: String, enum: [...ORDER_STATUSES], default: "Pending" },
    receiver: { type: String, required: true },
    tableNo: { type: String },
    notes: { type: String },
    kotRounds: { type: Number, default: 0 },
    // No defaults: a cafe with slip numbering switched off stores neither
    // field, and `default: []` on every order would be pure waste on a 512MB M0
    // (same reasoning as `voids` below).
    kotNumbers: { type: [Number], default: undefined },
    billNumber: { type: Number },
    // No `default: []` — the overwhelming majority of orders never get a void, and
    // an empty array on every row is pure waste on a 512MB M0. `$push` creates it.
    voids: { type: [orderVoidSchema], default: undefined },
    cancelReason: { type: String },
    cancelledBy: { type: String },
    cancelledAt: { type: Date },
    source: { type: String },
    // See the IOrder comment above — `default: undefined`, NEVER `[]`.
    sourceRequestIds: { type: [String], default: undefined },
  },
  { timestamps: true },
);

orderSchema.index({ createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ tableNo: 1 });
orderSchema.index({ customerId: 1 });
orderSchema.index({ sourceRequestIds: 1 }, { unique: true, sparse: true });

// Reuse the compiled model across hot reloads / serverless invocations.
export const Order: Model<IOrder> =
  (mongoose.models.Order as Model<IOrder>) ??
  mongoose.model<IOrder>("Order", orderSchema);
