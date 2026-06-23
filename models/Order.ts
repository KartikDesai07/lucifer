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
  modifiers: string[];
  instructions: string;
  kotRound: number; // KOT round this line was fired in (0 = not yet sent / legacy)
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
  createdAt: Date;
  updatedAt: Date;
}

const orderItemSchema = new Schema<IOrderItem>(
  {
    productId: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    qty: { type: Number, required: true, min: 1 },
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
  },
  { timestamps: true },
);

orderSchema.index({ createdAt: -1 });
orderSchema.index({ status: 1 });
orderSchema.index({ tableNo: 1 });
orderSchema.index({ customerId: 1 });

// Reuse the compiled model across hot reloads / serverless invocations.
export const Order: Model<IOrder> =
  (mongoose.models.Order as Model<IOrder>) ??
  mongoose.model<IOrder>("Order", orderSchema);
