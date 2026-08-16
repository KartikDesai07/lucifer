// ─────────────────────────────────────────────────────────────────────────────
// F2c — the shared storage⇄presentation codec (build-rule #13 / F2c §6/§13).
//
// The store is COMPACT (Int32 paise, ObjectId refs, omitted defaults, a schema
// version `v`); the user must still see ₹x.xx, full names, and readable enums.
// This codec is the ONE conversion layer, applied SERVER-SIDE at the API boundary
// right after the `.lean()` read (decode) and before a write (encode). It is a
// pure POJO remap — no Mongoose, no I/O — so it is safe to import on the client
// for the formatting primitives, and it carries no `.lean()`-dropping-virtuals
// hazard (Mongoose `aliases` are a BANNED pattern here — #13).
//
// Ownership: F2c births this file with the money/id/`v` PRIMITIVES + the Order
// decode/encode. P1 (build-rule #39) EXTENDS it with the menu codec and wires the
// `transform`/`coerceForWrite` hooks into `lib/crud-route.ts`. Versioning is
// append-only: never delete an old `v` branch; keep a golden fixture of every
// historical shape in codec.test.ts (there are no M0 backups to recover a
// mis-decode — F2c §6).
// ─────────────────────────────────────────────────────────────────────────────

import type {
  PaymentMode,
  OrderStatus,
  GstMode,
} from "./constants";

// ── Money primitives (shared by menu + order — #39) ──────────────────────────

/** Integer PAISE → rupees number for presentation (12050 → 120.5). */
export function paiseToRupees(paise: number): number {
  return paise / 100;
}

/**
 * Rupees → integer PAISE for storage (120.5 → 12050), round-half-up to the whole
 * paise. Used to coerce rupee-denominated client INPUT to the stored Int32 paise.
 * (Exact per-bucket GST/discount arithmetic is P2's engine; this is the boundary
 * coercion only.) `+ Number.EPSILON` defends the binary-float edge where e.g.
 * `19.99 * 100` is `1998.9999999999998`.
 */
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100 + Number.EPSILON);
}

// ── Id primitive ─────────────────────────────────────────────────────────────

/**
 * Normalize a stored id to a hex string for the client. A `.lean()` read (without
 * mongoose-lean-virtuals, which we deliberately avoid) yields a BSON ObjectId;
 * an already-stringified value passes through. `null`/`undefined` → undefined so
 * omit-empty optionals stay omitted in the DTO.
 */
export function idToString(id: unknown): string | undefined {
  if (id === null || id === undefined) return undefined;
  return typeof id === "string" ? id : String(id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Order shapes. `Stored*` = the compact BSON doc as read by `.lean()` (paise,
// ObjectId-or-hex ids, omit-empty optionals, `v`). `Decoded*` = the readable,
// client-ready DTO (rupees, string ids, presentation defaults restored).
// ─────────────────────────────────────────────────────────────────────────────

export interface StoredOrderItem {
  productId: unknown; // ObjectId (lean) or hex string
  name: string;
  price: number; // paise
  qty: number;
  modifiers?: string[];
  instructions?: string;
  kotRound?: number;
}

export interface StoredOrder {
  _id: string; // orderId
  customerId?: unknown; // ObjectId (lean) or hex string
  customerName: string;
  items: StoredOrderItem[];
  subtotal: number; // paise
  total: number; // paise
  paidAmount: number; // paise
  discount?: number; // paise
  gstAmount?: number; // paise
  gstRate?: number; // whole percent
  gstMode?: GstMode;
  // The table's extra charge as it was at sale time (paise) and the name it was
  // sold under. Snapshotted, never re-read from the Table: the table's config
  // can change tomorrow, a printed bill cannot.
  chargeAmount?: number; // paise
  chargeLabel?: string;
  payment: PaymentMode;
  status: OrderStatus;
  splitCash?: number; // paise
  splitOnline?: number; // paise
  receiver: string;
  tableNo?: string;
  notes?: string;
  kotRounds?: number;
  // Printed slip numbers — plain counts, NOT money, so they never touch the
  // paise codec. Absent when the cafe prints no numbers.
  kotNumbers?: number[];
  billNumber?: number;
  settledAt?: Date | string;
  frozen?: boolean;
  idemKey?: string;
  source?: string;
  externalRef?: string;
  v?: number;
}

export interface DecodedOrderItem {
  productId?: string;
  name: string;
  price: number; // rupees
  qty: number;
  modifiers: string[];
  instructions: string;
  kotRound: number;
}

export interface DecodedOrder {
  orderId: string;
  customerId?: string;
  customerName: string;
  items: DecodedOrderItem[];
  subtotal: number; // rupees
  total: number; // rupees
  paidAmount: number; // rupees
  discount: number; // rupees (restored to 0 when omitted)
  gstAmount?: number; // rupees
  gstRate?: number; // whole percent
  gstMode?: GstMode;
  chargeAmount?: number; // rupees — absent when the bill carried no table charge
  chargeLabel?: string;
  payment: PaymentMode;
  status: OrderStatus;
  splitCash?: number; // rupees
  splitOnline?: number; // rupees
  receiver: string;
  tableNo?: string;
  notes?: string;
  kotRounds: number;
  kotNumbers?: number[]; // printed ticket numbers, one per fired round
  billNumber?: number; // printed bill number, allocated when payment is taken
  settledAt?: string; // ISO
  frozen: boolean;
  source?: string;
  externalRef?: string;
  v: number;
}

/** The latest stored Order schema version this codec encodes to (mirror of the model). */
export const ORDER_CODEC_VERSION = 1;

// ── Decode (stored → readable DTO) ────────────────────────────────────────────

function decodeOrderItem(item: StoredOrderItem): DecodedOrderItem {
  return {
    productId: idToString(item.productId),
    name: item.name,
    price: paiseToRupees(item.price),
    qty: item.qty,
    // Restore presentation defaults for omit-empty fields (#8 — absent ≠ wrong) so
    // the user always sees full readable data (F2c §6).
    modifiers: item.modifiers ?? [],
    instructions: item.instructions ?? "",
    kotRound: item.kotRound ?? 0,
  };
}

/**
 * Decode one lean Order doc to the readable DTO. Branches on `v` (append-only —
 * never delete an old branch; #13/§6). A pre-`v` legacy doc is treated as v1.
 */
export function decodeOrder(stored: StoredOrder): DecodedOrder {
  const v = stored.v ?? 1;
  // Single live shape today; the switch is the seam for future migrate-on-read.
  switch (v) {
    case 1:
    default:
      return decodeOrderV1(stored, v);
  }
}

function decodeOrderV1(stored: StoredOrder, v: number): DecodedOrder {
  const decoded: DecodedOrder = {
    orderId: stored._id,
    customerName: stored.customerName,
    items: stored.items.map(decodeOrderItem),
    subtotal: paiseToRupees(stored.subtotal),
    total: paiseToRupees(stored.total),
    paidAmount: paiseToRupees(stored.paidAmount),
    discount: paiseToRupees(stored.discount ?? 0),
    payment: stored.payment,
    status: stored.status,
    receiver: stored.receiver,
    kotRounds: stored.kotRounds ?? 0,
    frozen: stored.frozen ?? false,
    v,
  };
  // Genuinely-optional fields: present only when the store carried them (the UI
  // distinguishes "no GST" / "not a split" / "walk-in" from a zero).
  const customerId = idToString(stored.customerId);
  if (customerId !== undefined) decoded.customerId = customerId;
  if (stored.gstAmount !== undefined) decoded.gstAmount = paiseToRupees(stored.gstAmount);
  if (stored.gstRate !== undefined) decoded.gstRate = stored.gstRate;
  if (stored.gstMode !== undefined) decoded.gstMode = stored.gstMode;
  if (stored.chargeAmount !== undefined) {
    decoded.chargeAmount = paiseToRupees(stored.chargeAmount);
  }
  if (stored.chargeLabel !== undefined) decoded.chargeLabel = stored.chargeLabel;
  if (stored.splitCash !== undefined) decoded.splitCash = paiseToRupees(stored.splitCash);
  if (stored.splitOnline !== undefined) decoded.splitOnline = paiseToRupees(stored.splitOnline);
  if (stored.tableNo !== undefined) decoded.tableNo = stored.tableNo;
  if (stored.notes !== undefined) decoded.notes = stored.notes;
  // Counts, not money — copied straight across. The array is cloned so a
  // decoded DTO can never alias (and mutate) the lean document behind it.
  if (stored.kotNumbers !== undefined) decoded.kotNumbers = [...stored.kotNumbers];
  if (stored.billNumber !== undefined) decoded.billNumber = stored.billNumber;
  if (stored.source !== undefined) decoded.source = stored.source;
  if (stored.externalRef !== undefined) decoded.externalRef = stored.externalRef;
  if (stored.settledAt !== undefined) {
    decoded.settledAt =
      stored.settledAt instanceof Date
        ? stored.settledAt.toISOString()
        : new Date(stored.settledAt).toISOString();
  }
  return decoded;
}

// ── Encode (rupee input → compact stored partial) ─────────────────────────────
// Produces the money-in-paise, omit-empty partial a write path persists. Ids are
// left as hex STRINGS — the Mongoose ObjectId schema type casts them on write, so
// the pure codec needs no BSON. Optionals at default/empty are OMITTED (never set
// to 0/'' ) so the omit-empty storage win holds (#8). The write path supplies
// `_id` (the orderId) + `v` + status/lifecycle fields; this covers the money +
// snapshot payload P2/F4 feed into `getOrderModel(conn).create(...)`.

export interface EncodeOrderItemInput {
  productId?: string;
  name: string;
  price: number; // rupees
  qty: number;
  modifiers?: string[];
  instructions?: string;
  kotRound?: number;
}

export interface EncodeOrderInput {
  customerId?: string;
  customerName: string;
  items: EncodeOrderItemInput[];
  subtotal: number; // rupees
  total: number; // rupees
  paidAmount: number; // rupees
  discount?: number; // rupees
  gstAmount?: number; // rupees
  gstRate?: number; // whole percent
  gstMode?: GstMode;
  chargeAmount?: number; // rupees
  chargeLabel?: string;
  payment: PaymentMode;
  splitCash?: number; // rupees
  splitOnline?: number; // rupees
  receiver: string;
  tableNo?: string;
  notes?: string;
  source?: string;
  externalRef?: string;
}

function encodeOrderItemForWrite(item: EncodeOrderItemInput): StoredOrderItem {
  const out: StoredOrderItem = {
    productId: item.productId,
    name: item.name,
    price: rupeesToPaise(item.price),
    qty: item.qty,
  };
  if (item.modifiers && item.modifiers.length > 0) out.modifiers = item.modifiers;
  if (item.instructions) out.instructions = item.instructions;
  if (item.kotRound) out.kotRound = item.kotRound;
  return out;
}

/**
 * Encode a rupee-denominated order payload to the compact stored partial (paise +
 * omit-empty). The caller adds `_id`/`v`/`status`/`settledAt`/`frozen` and casts
 * `customerId`/`item.productId` strings to ObjectId via the Mongoose schema.
 */
export function encodeOrderForWrite(
  input: EncodeOrderInput,
): Partial<StoredOrder> {
  const out: Partial<StoredOrder> = {
    customerName: input.customerName,
    items: input.items.map(encodeOrderItemForWrite),
    subtotal: rupeesToPaise(input.subtotal),
    total: rupeesToPaise(input.total),
    paidAmount: rupeesToPaise(input.paidAmount),
    payment: input.payment,
    receiver: input.receiver,
  };
  if (input.customerId) out.customerId = input.customerId;
  if (input.discount) out.discount = rupeesToPaise(input.discount);
  if (input.gstAmount) out.gstAmount = rupeesToPaise(input.gstAmount);
  if (input.gstRate) out.gstRate = input.gstRate;
  if (input.gstMode) out.gstMode = input.gstMode;
  // Amount and label travel together or not at all. A stored label with no
  // amount would print a named line worth nothing; an amount with no label
  // would print a bare figure the customer cannot question. The amount is the
  // gate, so a charge the operator removed (0) takes its name with it.
  if (input.chargeAmount) {
    out.chargeAmount = rupeesToPaise(input.chargeAmount);
    if (input.chargeLabel) out.chargeLabel = input.chargeLabel;
  }
  // Splits are meaningful ONLY for a Split payment: store BOTH legs (even a 0 leg,
  // e.g. an all-online split) for faithful reconstruction, and omit both otherwise
  // so a stray `splitCash:0` on a Cash order can't leak (#8 — `minimize` does NOT
  // strip a top-level scalar 0). Keying on the field merely being defined would
  // both leak non-split zeros and fail to guarantee the legitimate split-zero.
  if (input.payment === "Split") {
    out.splitCash = rupeesToPaise(input.splitCash ?? 0);
    out.splitOnline = rupeesToPaise(input.splitOnline ?? 0);
  }
  if (input.tableNo) out.tableNo = input.tableNo;
  if (input.notes) out.notes = input.notes;
  if (input.source) out.source = input.source;
  if (input.externalRef) out.externalRef = input.externalRef;
  return out;
}
