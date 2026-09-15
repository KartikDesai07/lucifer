import mongoose, { Schema, Types, type Document, type Model } from "mongoose";
import {
  PAYMENT_MODES,
  ORDER_STATUSES,
  GST_MODES,
  DISCOUNT_KINDS,
  type PaymentMode,
  type OrderStatus,
  type GstMode,
  type DiscountKind,
} from "@/lib/constants";
import { LOYALTY_REWARD_KINDS, type LoyaltyRewardKind } from "@pos/shared/public-diner";

// Embedded subdocument — never saved independently (parent Order owns it).
export interface IOrderItem {
  productId: Types.ObjectId;
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
  // CB-5B — this line was GIVEN as a loyalty reward (a free dish claimed off the
  // stamp ladder). `price` above stays the dish's REAL price, so the bill shows
  // the customer what they got and what it was worth, the kitchen ticket prints
  // it like any other line, and the void trail records its true value. Exactly
  // ONE reader treats it differently: computeOrderTotals' subtotal reducer skips
  // it, and because the tax base is derived FROM that subtotal, untotalled and
  // untaxed both follow from that single skip. Server-set only — `orderItemSchema`
  // in packages/shared deliberately has no `reward` key, so a client can never
  // declare one of its own lines free.
  reward?: boolean;
  // CB-5B — the marker printed beside a reward line ("Reward — free"). Stored,
  // not re-derived at print time: a reprint years later must reproduce the
  // paper as issued, and the live REWARD_ITEM_LINE_NOTE constant may have been
  // reworded since. Live-probed: without the schema path below, strict:true
  // dropped this silently on every claim while `reward` itself stored fine.
  note?: string;
}

// Append-only void trail (CR1.3). A snapshot, not a reference: `qty` is what was
// VOIDED off the line and `price` the unit price then, so the entry still reads
// correctly after the line is reduced or gone from items[].
export interface IOrderVoid {
  productId: Types.ObjectId;
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
  // CB-5B — the voided line was a loyalty reward (a free dish). Carried onto the
  // trail so the VOID slip can say so and staff reading the trail can tell a
  // comped dish from a sold one; `price` above stays the dish's real value, the
  // same snapshot discipline as every other field here.
  reward?: boolean;
  reason: string;
  voidedBy: string; // staff name from the session
  at: Date;
  kotNumber?: number; // this void slip's own kitchen-ticket number
}

export interface IOrder extends Document {
  orderId: string; // ORD-YYYYMMDD-NNN
  customerId?: Types.ObjectId;
  customerName: string; // denormalized name snapshot
  items: IOrderItem[];
  subtotal: number;
  discount: number; // amount (not percentage) at order level
  discountKind?: DiscountKind; // "gst" = GST-equivalent preset (server re-derives); absent = manual
  // CB-5B — the reward reprint snapshot, present only when discountKind ===
  // "reward". The years-later reprint contract (same reasoning as the GST
  // snapshot below): a re-pricing writer rebuilds `reward` from THESE five
  // fields, never from the live milestone ladder, so an owner editing the
  // ladder mid-service cannot re-price an already-open tab. NO `default:` on
  // any of them (the discountKind omit-empty discipline) — see the schema
  // for why `rewardItem` also must not be `required: true`.
  rewardAt?: number; // WHICH rung was claimed (the milestone's stamp count)
  rewardKind?: LoyaltyRewardKind;
  rewardValue?: number;
  rewardItem?: string; // "" is legal (flat/percent rewards carry no item name)
  // CB-5B D8/D11 — the free dish, as a REFERENCE plus a count. `rewardItem`
  // above is only its display name; a re-pricing writer resolves the actual
  // Product from THIS id, because a name breaks the moment a dish is renamed,
  // deleted, or duplicated. Absent on flat/percent rewards and on every
  // pre-D8 order, which is exactly how a reader tells "no dish" from "a dish".
  rewardItemProductId?: string;
  rewardQty?: number;
  // stamps DEBITED — the COST this order's redemption spent. Stored, never
  // re-derived: deriving it live from the current ladder would refund the
  // WRONG number on cancel after the owner retunes the milestone's `at`.
  rewardStamps?: number;
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
  receiver: string; // staff name — the printed NAME snapshot, kept as-is
  staffId?: Types.ObjectId; // the staff account that rang this up (session-stamped)
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
  // CB-DL-2: stored as ObjectIds (the OrderRequest _id); every writer and CAS
  // filter goes through the model, which casts the hex strings it is handed.
  sourceRequestIds?: Types.ObjectId[];
  createdAt: Date;
  updatedAt: Date;
}

const orderVoidSchema = new Schema<IOrderVoid>(
  {
    productId: { type: Schema.Types.ObjectId, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    qty: { type: Number, required: true, min: 1 },
    kotRound: { type: Number, required: true },
    instructions: { type: String },
    modifiers: { type: [String], default: undefined },
    variation: { type: String },
    reward: { type: Boolean },
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
    productId: { type: Schema.Types.ObjectId, required: true },
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
    // No default: an ordinary sold line carries no key at all (the omit-empty
    // ledger discipline, same as `variation` above). Only ever true.
    reward: { type: Boolean },
    // The reward line's printed marker. Declared here as well as on
    // IOrderItem — a field that exists only on the interface is silently
    // discarded by strict:true (the CB-5B session-33 bug: 200 OK, success
    // toast, nothing stored, whole suite green). Live-probed: without this
    // path `note` vanished on every claim while `reward` beside it stored.
    // Stored rather than re-derived at print time, so a reprint reproduces
    // the paper as issued even if the constant is reworded later.
    note: { type: String },
  },
  { _id: false }, // embedded — no _id needed
);

const orderSchema = new Schema<IOrder>(
  {
    // unique:true creates the index — no separate index() needed for orderId.
    orderId: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId },
    customerName: { type: String, required: true },
    items: { type: [orderItemSchema], required: true },
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    discountKind: { type: String, enum: [...DISCOUNT_KINDS] },
    // CB-5B reward snapshot — no `default:` on any path (mirrors
    // discountKind's own omit-empty discipline immediately above). rewardItem
    // is deliberately NOT `required: true`: Mongoose's String `required`
    // rejects "" outright, and the PUT paths run with `runValidators: true`,
    // but "" is a legal item name for a flat/percent reward (no dish attached).
    rewardAt: { type: Number },
    rewardKind: { type: String, enum: [...LOYALTY_REWARD_KINDS] },
    rewardValue: { type: Number },
    rewardItem: { type: String },
    // CB-5B D8/D11 — no `default:` (same omit-empty discipline as the four
    // above). Stored as a plain String, not an ObjectId ref: this is a
    // reprint SNAPSHOT of what was claimed, and it must survive the product
    // being deleted later — a ref would invite a populate() that resurrects
    // a live price onto an already-issued reward.
    rewardItemProductId: { type: String },
    rewardQty: { type: Number },
    rewardStamps: { type: Number },
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
    // The staff account that rang this up — `receiver` above stays the printed
    // NAME snapshot; this is the id link, optional and unindexed (no reader
    // queries by it today).
    staffId: { type: Schema.Types.ObjectId },
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
    sourceRequestIds: { type: [Schema.Types.ObjectId], default: undefined },
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
