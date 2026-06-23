// Shared TypeScript types. Entity input types are inferred from the Zod
// schemas in @/schemas and re-exported here for a single import point.
export type {
  CreateProductInput,
  UpdateProductInput,
  CreateCategoryInput,
  UpdateCategoryInput,
  CreateCustomerInput,
  UpdateCustomerInput,
  OrderItemInput,
  CreateOrderInput,
  UpdateOrderInput,
  AddItemsInput,
  SettleOrderInput,
  LoginInput,
  ChangePasswordInput,
  ResetPasswordInput,
  CreateStaffInput,
  UpdateStaffInput,
  CreateReservationInput,
  UpdateReservationInput,
  CreateEventInput,
  UpdateEventInput,
  UpdateTableInput,
  SettingsInput,
  UpdateSettingsInput,
} from "@/schemas";

import type { GstMode } from "@/lib/constants";
import type { ImportRowStatus } from "@/lib/product-import";

import type {
  PaymentMode,
  SettlementPayMode,
  OrderStatus,
  TableStatus,
  CustomerNote,
  StaffRole,
  ReservationStatus,
  EventStatus,
  EventPayMode,
} from "@/lib/constants";

// ── Client-facing entity types ───────────────────────────────────────────────
// The plain JSON shapes returned by the API (`.lean()` docs serialized over the
// wire): ObjectId -> string, Date -> ISO string. These are what hooks/components
// consume. Server code uses the Mongoose `I*` model interfaces instead.

export interface Product {
  _id: string;
  name: string;
  category: string; // denormalized category name
  price: number;
  discount: number; // percentage 0-100
  available: boolean; // in-stock / "86" toggle — disabled in POS when false
  image: string; // Cloudinary public_id ("" if none)
  modifiers: string[];
  isActive: boolean; // false = archived (soft-deleted)
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  _id: string;
  name: string;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  _id: string;
  name: string;
  mobile: string;
  visits: number;
  totalSpend: number;
  totalDue: number;
  notes: CustomerNote;
  createdAt: string;
  updatedAt: string;
}

export interface Table {
  _id: string;
  tableNo: string;
  status: TableStatus;
  currentOrderId?: string;
  capacity: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
  modifiers: string[];
  instructions: string;
  kotRound: number; // KOT round this line was fired in (0 = not yet sent / legacy)
}

export interface Order {
  _id: string;
  orderId: string; // ORD-YYYYMMDD-NNN
  customerId?: string;
  customerName: string;
  items: OrderItem[];
  subtotal: number;
  discount: number; // flat amount at order level
  gstAmount?: number; // GST added on top (exclusive mode); 0/absent otherwise
  gstRate?: number; // GST rate snapshot at order time (0 if GST was off then)
  gstMode?: GstMode; // GST mode snapshot at order time
  total: number;
  paidAmount: number;
  payment: PaymentMode;
  splitCash?: number;
  splitOnline?: number;
  status: OrderStatus;
  receiver: string;
  tableNo?: string;
  notes?: string;
  kotRounds: number; // count of KOT rounds fired (running order); 0 for legacy
  createdAt: string;
  updatedAt: string;
}

// Password is never serialized to the client (Staff model select:false).
export interface Staff {
  _id: string;
  name: string;
  mobile: string;
  username: string;
  role: StaffRole;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Reservation {
  _id: string;
  name: string;
  mobile: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  guests: number;
  tableNo?: string;
  notes?: string;
  status: ReservationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Event {
  _id: string;
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
  createdAt: string;
  updatedAt: string;
}

// Restaurant + receipt settings (singleton). Drives the receipt/KOT header,
// footer, and GST behaviour. Admin-editable on the Settings page.
export interface Settings {
  _id: string;
  restaurantName: string;
  tagline: string;
  mobile: string;
  address: string;
  receiptHeader: string;
  receiptFooter: string;
  gstEnabled: boolean;
  gstNumber: string;
  gstRate: number;
  gstMode: GstMode;
  kotShowPrices: boolean;
  createdAt: string;
  updatedAt: string;
}

// ── Analytics shapes (dashboard + reports) ───────────────────────────────────
// Returned by /api/orders/summary and /api/reports respectively.

export interface PaymentStat {
  amount: number; // collected paidAmount for this mode
  count: number;
}

export interface ProductStat {
  name: string;
  qty: number;
  revenue: number;
}

// One hour-of-day bucket (cafe-local / IST) of completed-order sales today.
export interface HourlyStat {
  hour: number; // 0-23, cafe-local hour
  sales: number; // completed-order revenue in this hour
  orders: number; // completed orders in this hour
}

// GET /api/orders/summary — today's dashboard aggregate.
// `totalSales`/`totalOrders`/`paymentBreakdown`/`topProducts`/`collected` are
// completed-only (realized activity); `inProgress` is today's still-open (Pending)
// tabs; and `outstandingDues` is the live receivables ledger across ALL customers
// (not just today) — the true outstanding figure, distinct from a single day's dues.
export interface OrderSummary {
  totalOrders: number; // completed orders today
  totalSales: number; // completed-order revenue today
  collected: number; // paidAmount on today's completed orders (matches reports "Collected")
  inProgress: { count: number; value: number }; // open (Pending) tabs today
  outstandingDues: { total: number; customers: number }; // real ledger, all customers
  // Keyed by settlement modes only — an "Unpaid" open tab is never completed, so
  // it can never appear here (would otherwise misreport held value as collected).
  paymentBreakdown: Record<SettlementPayMode, PaymentStat>;
  topProducts: ProductStat[];
  hourly: HourlyStat[]; // contiguous hour buckets (earliest→latest sale today)
}

export interface CustomerDue {
  _id: string;
  name: string;
  mobile: string;
  totalDue: number;
}

// ── Bulk product import (CSV) ────────────────────────────────────────────────
// Returned by POST /api/products/import. Per-row verdicts power the dry-run
// preview table; the commit response reports the applied counts.

export interface ImportRowResult {
  row: number; // 1-based row number in the file (header excluded)
  name: string; // best-effort product name for display ("" if missing)
  category: string; // best-effort category for display ("" if missing)
  status: ImportRowStatus; // create | update | duplicate | error
  errors?: string[]; // present only when status === "error"
}

export interface ImportPreview {
  dryRun: true;
  totalRows: number;
  rows: ImportRowResult[];
  newCategories: string[]; // categories that will be auto-created on commit
  summary: {
    valid: number; // distinct products that would be written (create + update)
    invalid: number; // rows that failed validation
    toCreate: number;
    toUpdate: number;
    duplicates: number; // rows superseded by a later same-name row
  };
}

export interface ImportResult {
  dryRun: false;
  created: number;
  updated: number;
  skipped: number; // invalid rows that were not imported
  duplicates: number; // rows superseded by a later same-name row (last wins)
  newCategories: string[];
}

export type ImportResponse = ImportPreview | ImportResult;

// GET /api/reports?startDate&endDate — date-range analytics (reports page).
export interface Report {
  range: { startDate: string; endDate: string };
  totals: { totalOrders: number; totalSales: number; totalCollected: number };
  salesByPayment: { payment: PaymentMode; amount: number; count: number }[];
  topProducts: ProductStat[];
  dayWise: { date: string; sales: number; orders: number }[];
  customerDues: CustomerDue[];
}
