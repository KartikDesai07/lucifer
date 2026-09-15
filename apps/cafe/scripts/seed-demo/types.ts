/**
 * Demo-data seeder — the ONE shared contract between the pure planners
 * (menu/people data, rng, orders-plan, extras-plan), the writers (seed-core,
 * orders-write, finalize) and the CLI (index.ts). Every module imports its
 * types from here; nothing redeclares a shape.
 *
 * Money is RUPEES (whole numbers) everywhere in this package — the live v1
 * routes write `models/Order.ts` (rupee Number fields, `createdAt`), NOT the
 * paise ledger in `models/order.ledger.ts`. Dates: `dayKey` = cafe-local (IST)
 * "YYYY-MM-DD" from `cafeDateString`; instants are UTC `Date`s.
 */
import type { Types } from "mongoose";
import type { GstConfig } from "@/lib/receipt";
import type { PrintConfig } from "@/lib/print";
import type { CustomerNote, PaymentMode, OrderStatus, SettlementPayMode, EventPayMode, EventStatus, ReservationStatus, GstMode } from "@/lib/constants";

// ── Static demo content (menu-data.ts / people-data.ts) ──────────────────────
export interface DemoVariation {
  name: string;
  price: number; // rupees
}
export interface DemoProduct {
  name: string; // unique across the whole menu
  category: string; // must equal a DemoCategory.name
  price: number; // rupees; when `variations` exist this equals the FIRST variation's price
  imageFile?: string; // exact file name inside the images folder (e.g. "Mango.png"); absent = no image
  variations?: DemoVariation[];
  modifiers?: string[];
  available?: boolean; // default true; false = "86'd" (out of stock)
  discount?: number; // percent 0..100; default 0
  weight: number; // popularity weight for the order planner (1 = rare … 10 = best-seller)
  publicVisible?: boolean; // omit = visible on the QR menu
}
export interface DemoCategory {
  name: string;
  order: number; // display order 1..n
}
export interface DemoCustomer {
  name: string;
  mobile: string; // 10 digits, unique
  notes: CustomerNote;
}
export interface DemoStaffMember {
  name: string; // printed receiver name
  username: string; // login, lowercase [a-z0-9._@-]+
  mobile: string;
  weight: number; // share of orders rung up by this person
}

// ── Seeded random numbers (rng.ts) ───────────────────────────────────────────
export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [min, max] (inclusive). */
  int(min: number, max: number): number;
  /** One element, uniform. Throws on an empty array. */
  pick<T>(items: readonly T[]): T;
  /** One element, by weight (weights ≤ 0 are never picked). Throws when every weight is ≤ 0. */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T;
  /** True with probability p (0..1). */
  chance(p: number): boolean;
  /** New shuffled copy (Fisher–Yates). */
  shuffle<T>(items: readonly T[]): T[];
}

// ── What the writers hand the planners (ids come from the DB) ────────────────
export interface PlannedProduct {
  _id: Types.ObjectId;
  name: string;
  price: number;
  variations?: DemoVariation[];
  modifiers: string[];
  available: boolean;
  discount: number;
  weight: number;
}
export interface PlannedTable {
  tableNo: string;
  capacity: number;
  chargeAmount?: number; // rupees, when this table carries an extra charge
  chargeLabel?: string;
}
export interface PlannedCustomer {
  _id: Types.ObjectId;
  name: string;
  mobile: string;
  notes: CustomerNote;
}
export interface PlannedStaff {
  _id: Types.ObjectId;
  name: string;
  weight: number;
}
export interface PlanContext {
  products: PlannedProduct[];
  tables: PlannedTable[];
  customers: PlannedCustomer[];
  staff: PlannedStaff[];
  gst: GstConfig; // from lib/settings gstConfigOf(settings)
  print: PrintConfig; // from lib/print printConfigOf(settings)
  days: string[]; // dayKeys oldest → today (today = last), each "YYYY-MM-DD" IST
  now: Date; // the instant the seeder runs (today's orders stop here)
  rng: Rng;
}

// ── Planner output: plain objects shaped EXACTLY like models/Order.ts docs ────
export interface PlannedOrderItem {
  productId: Types.ObjectId;
  name: string;
  price: number; // unit price as sold (the variation's price when one was picked)
  qty: number;
  variation?: string;
  modifiers: string[];
  instructions: string;
  kotRound: number; // 1 = opening round, 2 = a later round
}
export interface PlannedOrderVoid {
  productId: Types.ObjectId;
  name: string;
  price: number;
  qty: number;
  kotRound: number;
  instructions?: string;
  modifiers?: string[];
  variation?: string;
  reason: string;
  voidedBy: string;
  at: Date;
  kotNumber?: number;
}
export interface PlannedOrder {
  orderId: string; // ORD-YYYYMMDD-NNN (NNN = 3-digit, time-ordered within the day)
  customerId?: Types.ObjectId;
  customerName: string; // the customer's name, or "Walk-In"
  items: PlannedOrderItem[];
  subtotal: number;
  discount: number;
  discountKind?: "gst";
  gstAmount: number;
  gstRate: number; // 0 when GST is off
  gstMode: GstMode;
  chargeAmount?: number;
  chargeLabel?: string;
  total: number;
  paidAmount: number;
  payment: PaymentMode;
  splitCash?: number;
  splitOnline?: number;
  status: OrderStatus;
  receiver: string;
  staffId: Types.ObjectId;
  tableNo?: string;
  notes?: string;
  kotRounds: number;
  kotNumbers?: number[];
  billNumber?: number;
  voids?: PlannedOrderVoid[];
  cancelReason?: string;
  cancelledBy?: string;
  cancelledAt?: Date;
  source?: string; // "qr" for a self-order accepted from a request
  sourceRequestIds?: Types.ObjectId[]; // ONLY when non-empty — never []
  createdAt: Date;
  updatedAt: Date;
}
export interface PlannedRequestItem {
  productId: Types.ObjectId;
  name: string;
  price: number;
  qty: number;
  variation?: string;
  modifiers: string[];
  instructions: string;
}
export interface PlannedOrderRequest {
  _id: Types.ObjectId;
  shortCode: string;
  status: "pending" | "accepted" | "rejected";
  targetKind: "table" | "parcel";
  tableNo?: string;
  items: PlannedRequestItem[];
  quotedSubtotal: number;
  quotedCharge: number;
  quotedChargeLabel?: string;
  quotedTotal: number;
  note?: string;
  mobile: string;
  name: string;
  acceptedOrderId?: string;
  acceptedAt?: Date;
  rejectedReason?: string;
  actor?: string;
  acceptedKotRound?: number;
  kotPrintedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
/** Counter documents the live routes continue from: key → seq (e.g. "order-20260913" → 27). */
export type PlannedCounters = Record<string, number>;
export interface PlannedTableState {
  tableNo: string;
  status: "Occupied" | "Reserved";
  currentOrderId?: string; // the Pending order's orderId when Occupied
}
export interface OrdersPlan {
  orders: PlannedOrder[];
  requests: PlannedOrderRequest[];
  counters: PlannedCounters;
  tableStates: PlannedTableState[];
}

// ── Extras (extras-plan.ts): events, reservations, due payments ──────────────
export interface PlannedEvent {
  name: string;
  mobile: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  eventName: string;
  notes?: string;
  payable: number;
  advance: number;
  payMode: EventPayMode;
  status: EventStatus;
  createdAt: Date;
  updatedAt: Date;
}
export interface PlannedReservation {
  name: string;
  mobile: string;
  date: string;
  time: string;
  guests: number;
  tableNo?: string;
  notes?: string;
  status: ReservationStatus;
  createdAt: Date;
  updatedAt: Date;
}
export interface PlannedDuePayment {
  customerId: Types.ObjectId;
  amount: number; // whole rupees, ≤ the customer's outstanding due at `createdAt`
  mode: SettlementPayMode; // "Cash" | "Online" only (the dues-receipt modes)
  note?: string;
  receivedBy: string;
  clientRef: string; // UUID
  createdAt: Date;
  updatedAt: Date;
}
export interface ExtrasPlan {
  events: PlannedEvent[];
  reservations: PlannedReservation[];
  duePayments: PlannedDuePayment[];
  reservedTable?: PlannedTableState; // one table marked Reserved for a booking tonight (never a table already Occupied)
}

// ── Customer ledger (finalize.ts) — the reconcile-route formula, in code ─────
export interface CustomerRollup {
  visits: number;
  totalSpend: number;
  totalDue: number;
}

// ── Run summary printed by index.ts (and parsed by the console printer) ──────
export interface SeedDemoSummary {
  slug: string;
  dbName: string;
  days: { from: string; to: string; count: number };
  categories: number;
  products: number;
  imagesUploaded: number;
  imagesSkipped: number; // products that wanted an image but got none (no R2 / missing file)
  tables: number;
  staff: number;
  customers: number;
  orders: { total: number; completed: number; pending: number; cancelled: number; selfOrder: number };
  sales: number; // rupees, Completed orders' total
  duePayments: number;
  events: number;
  reservations: number;
  orderRequests: number;
  verify: { passed: number; failed: number };
}
