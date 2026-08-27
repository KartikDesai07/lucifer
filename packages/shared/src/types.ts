// Shared TypeScript types. Entity input types are inferred from the Zod
// schemas in ./schemas and re-exported here for a single import point.
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
  CancelOrderInput,
  VoidItemInput,
  LoginInput,
  ChangePasswordInput,
  ResetPasswordInput,
  CreateStaffInput,
  UpdateStaffInput,
  CreateReservationInput,
  UpdateReservationInput,
  CreateEventInput,
  UpdateEventInput,
  CreateTableInput,
  PatchTableInput,
  UpdateTableInput,
  SettingsInput,
  UpdateSettingsInput,
} from "./schemas";
// Re-exported here (not just from the barrel index.ts) so apps/cafe's
// `export type * from "@pos/shared/types"` shim also picks these up.
export type { DuePayment, DuesCollected } from "./types-analytics";

import type {
  GstMode,
  PaperWidth,
  PrintFontSize,
  PrintLogoSize,
} from "./constants";
import type { ImportRowStatus } from "./product-import";
import type { DuesCollected } from "./types-analytics";
import type { PromoCodeConfig, SelfOrderMode } from "./public";

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
} from "./constants";

// ── Client-facing entity types ───────────────────────────────────────────────
// The plain JSON shapes returned by the API (`.lean()` docs serialized over the
// wire): ObjectId -> string, Date -> ISO string. These are what hooks/components
// consume. Server code uses the Mongoose `I*` model interfaces instead.

// One named size/portion of a menu item and the price it sells at. The set lives
// embedded on the product; a variation is not a product of its own (no image, no
// stock flag, no modifier set) — it only re-prices the item it belongs to.
export interface ProductVariation {
  name: string;
  price: number;
}

export interface Product {
  _id: string;
  name: string;
  category: string; // denormalized category name
  price: number;
  // The named sizes this item sells in, each with its own price. ABSENT (never
  // `[]`) when the item is sold one way only — and when present it OVERRIDES
  // `price` for ordering: the POS makes the operator pick one, and the picked
  // price is what the line bills at. `price` stays the base/reference figure.
  variations?: ProductVariation[];
  discount: number; // percentage 0-100
  available: boolean; // in-stock / "86" toggle — disabled in POS when false
  image: string; // opaque image ref — "r2:<key>" or a legacy Cloudinary public_id ("" if none)
  modifiers: string[];
  isActive: boolean; // false = archived (soft-deleted)
  // Whether this item appears on the PUBLIC QR menu. ABSENT means visible — so a
  // cafe that never touches this sees its whole menu published, and only an
  // explicit `false` hides an item. Hiding is public-only: the item stays fully
  // orderable by staff in the POS (that is what `available` is for).
  publicVisible?: boolean;
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
  // This table's opaque PUBLIC token — what its QR sticker encodes. Absent until
  // the table is given a public URL. Never the tableNo: see @pos/shared/public
  // for why an operator-chosen, guessable label must not be a public identifier.
  publicToken?: string;
  // Where this table sits in the list the cafe arranged by hand (Tables screen →
  // Arrange), so the tables it runs busiest can be pinned to the top of both that
  // screen and the POS picker. Lower = earlier. ABSENT on any table that predates
  // arranging — Mongo sorts a missing field before every value, so an
  // un-arranged floor plan keeps plain name order with no backfill.
  displayOrder?: number;
  // Extra charge this table adds to a bill, in whole rupees, with the name it
  // prints under. Absent or 0 = the table adds nothing. The POS reads both off
  // the selected table and SNAPSHOTS them onto the order, so editing the table
  // later never rewrites a bill that was already printed.
  chargeAmount?: number;
  chargeLabel?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
  // The variation this line was SOLD as, snapshotted by name — `price` above is
  // already that variation's price. Absent for an item sold one way only, so a
  // pre-variations order is unchanged. Everything that displays a line renders it
  // through `orderItemLabel` so the cart, the bill and the KOT cannot disagree.
  variation?: string;
  modifiers: string[];
  instructions: string;
  kotRound: number; // KOT round this line was fired in (0 = not yet sent / legacy)
}

// One append-only entry in an order's void trail (CR1.3): a snapshot of what was
// taken OFF an open tab after the kitchen had already been told to make it. `qty`
// is the quantity VOIDED (not what remains) and `price` the unit price at the time,
// so the trail stays readable even after the line itself is gone from items[].
export interface OrderVoid {
  productId: string;
  name: string;
  price: number;
  qty: number;
  kotRound: number;
  // Snapshotted from the voided line so the kitchen's VOID slip can name the exact
  // cover to stop — "Tea" alone is useless when the tab holds two Teas prepared
  // differently. Absent when the line carried none (omit-empty).
  instructions?: string;
  modifiers?: string[];
  // Same reason as `instructions`: on a tab holding a Small and a Large of the
  // same dish, the slip has to name WHICH one to stop making.
  variation?: string;
  reason: string;
  voidedBy: string; // staff name from the session, never client-supplied
  at: string;
  // This void slip's own number, from the same daily kitchen-ticket series as
  // the round tickets — a void slip is paper the kitchen has to reconcile too.
  // Absent when the cafe does not number tickets, or excludes voids from it.
  kotNumber?: number;
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
  // The table's extra charge as it was sold, and the name it printed under —
  // snapshotted at sale time so editing the table later cannot rewrite an
  // already-printed bill. Folded into `total` and NOT part of the taxable base,
  // so anything reasoning about tax has to lift it out first (lib/receipt).
  chargeAmount?: number;
  chargeLabel?: string;
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
  // What the printed slips actually said. `kotNumbers[n-1]` is round n's ticket
  // number; `billNumber` is issued when payment is taken. Both already carry
  // the cafe's configured daily start, so they are reprinted verbatim and never
  // recomputed. Absent when the cafe prints no numbers.
  kotNumbers?: number[];
  billNumber?: number;
  // Absent until the first void / the cancel — an order that never had either
  // carries none of these fields (nothing to show, nothing stored).
  voids?: OrderVoid[];
  cancelReason?: string;
  cancelledBy?: string; // staff name from the session
  cancelledAt?: string;
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
//
// `logo`/`fssai` are typed non-optional (they carry a "" default on the
// model), but a pre-existing Mongo doc created before this field existed
// won't actually have them, AND `getSettings()` reads via `.lean()` (model
// defaults are a Mongoose document feature, not applied to a lean read) — so
// every consumer must still read them as `settings?.logo ?? ""` /
// `settings?.fssai ?? ""`, never assume the field is present.
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
  // CR2.2c — codes a diner can type on the QR ordering screen. Optional:
  // an existing Settings doc (and every fixture) predates it.
  promoCodes?: PromoCodeConfig[];
  logo: string;
  fssai: string;

  // The PRODUCT's mark (browser tab, login screen) — the restaurant's own mark
  // is `logo` above. Optional on purpose, and it is the same hazard the print
  // block below documents: this field is NEW, so every Settings document written
  // before it has none, and `getSettings()` reads via `.lean()` (model defaults
  // are a document feature, not applied to a lean read). Read it as
  // `settings?.productLogo` and let lib/images.ts return null for the absent
  // case — never assume a string is there.
  productLogo?: string;

  // Print customization. Every one of these carries the same hazard as
  // logo/fssai above and then some: they are NEW, so every Settings document
  // written before this feature has none of them, and a lean read returns
  // undefined rather than the model default. Read them through
  // `printConfigOf()` (apps/cafe/lib/print.ts) — never off the raw object, or
  // an existing cafe's receipt silently loses its logo and address the moment
  // this ships.
  billShowNumber?: boolean;
  billNumberStart?: number;
  billShowLogo?: boolean;
  billLogoSize?: PrintLogoSize;
  billShowAddress?: boolean;
  billShowMobile?: boolean;
  billShowGstNumber?: boolean;
  billShowFssai?: boolean;
  billPaperWidth?: PaperWidth;
  billFontSize?: PrintFontSize;

  kotShowPrices?: boolean;
  kotShowTotal?: boolean;
  kotShowNumber?: boolean;
  kotNumberStart?: number;
  kotNumberVoidSlips?: boolean;
  kotShowLogo?: boolean;
  kotShowRestaurantName?: boolean;
  kotShowTable?: boolean;
  kotShowStaff?: boolean;
  kotShowTime?: boolean;
  kotShowNotes?: boolean;
  kotPaperWidth?: PaperWidth;
  kotFontSize?: PrintFontSize;

  // Self-order (QR) — CR2. Same lean-read hazard as the print block above:
  // these are NEW, so a pre-CR2 Settings document has none of them. Read as
  // `settings?.field ?? default`, never assume presence.
  selfOrderMode?: SelfOrderMode;
  allowTableChange?: boolean;
  showPastOrdersToDiner?: boolean;

  // CR2.3b — Telegram kill switch (§21.6): sends stop, connections stay.
  telegramPaused?: boolean;

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
  // Money taken today against a customer's PRE-EXISTING due (CR1.4) — a
  // separate line from `collected`, never merged into it: collected stays
  // order-paidAmount-only (P7 pins that definition), so conflating the two
  // would double-count on the day an order is both settled and its due paid.
  duesCollected: DuesCollected;
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
  // totalCollected stays order-paidAmount-only (see OrderSummary.duesCollected
  // above); duesCollected is a separate line, never merged into it.
  totals: {
    totalOrders: number;
    totalSales: number;
    totalCollected: number;
    duesCollected: number;
  };
  salesByPayment: { payment: PaymentMode; amount: number; count: number }[];
  topProducts: ProductStat[];
  dayWise: { date: string; sales: number; orders: number }[];
  customerDues: CustomerDue[];
}
