import { z } from "zod";
import {
  PAYMENT_MODES,
  SETTLEMENT_PAY_MODES,
  ORDER_STATUSES,
  ORDER_REASON_MIN_LEN,
  ORDER_REASON_MAX_LEN,
  ORDER_NOTES_MAX_LEN,
  TABLE_CHARGE_LABEL_MAX_LEN,
  VARIATION_NAME_MAX_LEN,
  VARIATION_NAME_MESSAGE,
  VARIATION_NAME_PATTERN,
} from "../constants";
import { tableNoSchema } from "./table.schema";

export const orderItemSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1),
  price: z.number().min(0),
  qty: z.number().int().min(1),
  // The variation this line is sold as (a name the PRODUCT actually carries —
  // the route verifies that against the product document, so a client cannot
  // print a size onto a bill that the menu does not offer). Optional: an item
  // sold one way carries none, which is every order placed before variations.
  variation: z
    .string()
    .trim()
    .max(VARIATION_NAME_MAX_LEN)
    .regex(VARIATION_NAME_PATTERN, VARIATION_NAME_MESSAGE)
    .optional(),
  modifiers: z.array(z.string()).default([]),
  instructions: z.string().optional().default(""),
});

// Base shape. Money fields (subtotal/gstAmount/total/paidAmount) are accepted but
// are NOT trusted — the server recomputes them from items + the cafe's GST config
// (see app/api/orders + lib/receipt.computeOrderTotals). They stay here so the
// shared client type keeps compiling and the POS can show a live preview.
const orderObject = z.object({
  customerName: z.string().trim().min(1, "Customer name is required"),
  customerId: z.string().optional(),
  items: z.array(orderItemSchema).min(1, "Cart cannot be empty"),
  subtotal: z.number().min(0),
  discount: z.number().min(0).default(0), // amount (not percentage)
  gstAmount: z.number().min(0).optional(), // GST added on top (exclusive mode)
  // The table's extra charge as the operator left it for THIS bill — they may
  // waive or adjust it at the counter, so this is intent, like `discount`, and
  // the server re-clamps it. The label rides along to be snapshotted with it;
  // it is the table's name for the charge, not something the client invents.
  chargeAmount: z.number().min(0).optional(),
  chargeLabel: z.string().trim().max(TABLE_CHARGE_LABEL_MAX_LEN).optional(),
  total: z.number().min(0),
  // Omitted means "pay in full against the server's own recomputed total" — this
  // MUST stay optional or the client cannot express full payment without
  // asserting a number the server might disagree with (CR1.2 regression: the
  // client always sent a number, so a stale/mispriced total silently became a
  // customer due or a false "select a customer" 400 on a plain cash sale).
  paidAmount: z.number().min(0).optional(),
  payment: z.enum(PAYMENT_MODES),
  splitCash: z.number().min(0).optional(),
  splitOnline: z.number().min(0).optional(),
  status: z.enum(ORDER_STATUSES).default("Pending"),
  receiver: z.string().min(1),
  // Shape only. The route checks the table EXISTS against the live collection —
  // a cafe's floor plan is data, not a compile-time enum (CR1.1).
  tableNo: tableNoSchema.optional(),
  notes: z.string().trim().max(ORDER_NOTES_MAX_LEN).optional(),
});

// Due/Credit are unpaid-at-counter sales, so a customer must be attached for the
// balance to be tracked against someone. (Split sum / paid-vs-total are checked
// server-side against the recomputed total, not here.) "Unpaid" is the held
// open-tab state and must stay Pending — a completed sale always carries a real
// settlement mode.
export const createOrderSchema = orderObject.superRefine((data, ctx) => {
  if ((data.payment === "Due" || data.payment === "Credit") && !data.customerId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["customerId"],
      message: "Select a customer for Due or Credit orders",
    });
  }
  if (data.payment === "Unpaid" && data.status !== "Pending") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["status"],
      message: "An unpaid open tab must be Pending",
    });
  }
  // Cancelling is an admin action on an EXISTING order (POST /api/orders/[id]/
  // cancel writes the reason + who + when). A born-cancelled order would carry no
  // trail at all, and creating one is the one way a cashier could reach the status
  // without passing the admin guard — the create route persists `data.status`.
  if (data.status === "Cancelled") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["status"],
      message: "An order cannot be created as Cancelled",
    });
  }
});

// Why a cancel/void happened. Required (see ORDER_REASON_* in constants): the
// reason is the entire audit trail these two actions leave behind. `.trim()` runs
// before the length checks, so whitespace can't satisfy the minimum.
const orderReasonSchema = z
  .string()
  .trim()
  .min(ORDER_REASON_MIN_LEN, "Give a reason (a few words is enough)")
  .max(ORDER_REASON_MAX_LEN, `Keep the reason under ${ORDER_REASON_MAX_LEN} characters`);

// PUT /api/orders/[id] edits only non-money metadata. Money + status are
// server-owned and mutated exclusively through the audited /items (fire a round)
// and /settle (take payment) endpoints, so a client can never rewrite an order's
// total/paidAmount/payment or force it Completed via the generic update. .strict()
// rejects any other key outright.
export const updateOrderSchema = orderObject
  .pick({ customerName: true, customerId: true, tableNo: true, notes: true })
  .partial()
  .strict();

// POST /api/orders/[id]/items — fire another KOT round on an open tab. Only the
// new round's items; kotRound is stamped server-side, never supplied by the
// client. An optional discount updates the running tab's order-level discount
// (the server re-clamps + recomputes the total); omit it to keep the current one.
export const addItemsSchema = z
  .object({
    items: z.array(orderItemSchema).min(1, "Add at least one item"),
    discount: z.number().min(0).optional(),
    // A charge waiver made while the tab is running has to travel with the
    // round that follows it, or it lives only in one browser's state: the
    // operator waives, fires the round, and the server — which never heard
    // about it — carries the original charge forward and bills it at settle.
    // Same omit-means-unchanged rule as `discount` above.
    chargeAmount: z.number().min(0).optional(),
  })
  .strict();

// POST /api/orders/[id]/settle — take payment on an open tab. paidAmount is no
// longer always server-derived from the stored total: it's derived from the
// mode AND (for Cash/Online) the amount actually collected now — omit it to
// pay in full, as before. Any unpaid remainder becomes the attached customer's
// due, same as a Due/Credit sale. Split is always exact-total (never partial).
// An optional settle-time discount (flat rupees, not a percentage) re-clamps
// and recomputes the total server-side from the order's stored items.
export const settleOrderSchema = z
  .object({
    payment: z.enum(SETTLEMENT_PAY_MODES),
    splitCash: z.number().min(0).optional(),
    splitOnline: z.number().min(0).optional(),
    customerId: z.string().optional(),
    discount: z.number().min(0).optional(), // flat rupees; server re-clamps + recomputes
    // Settle-time waiver/adjustment of the table charge. Omit to keep whatever
    // the tab was opened with — the same omit=unchanged discipline as
    // `discount`, so an Orders-page settle that knows nothing about charges
    // cannot silently drop one off a bill the kitchen already served.
    chargeAmount: z.number().min(0).optional(),
    paidAmount: z.number().min(0).optional(), // amount actually collected now; omit = pay in full
    // The total the operator actually SAW when they asserted a deliberate
    // partial `paidAmount`. Only meaningful alongside a defined `paidAmount` —
    // lets the route detect a stale client view (CR1.2 regression) instead of
    // pricing a partial payment against a bill the operator never looked at.
    total: z.number().min(0).optional(),
  })
  .strict();

// POST /api/orders/[id]/cancel — admin-only. Terminal: the order keeps its money
// and items but stops being a sale. A dedicated route, not a field on the generic
// PUT, because the verb split IS the authorization boundary (CR1.1): PUT stays
// staff-accessible metadata-only, and per-field authz inside one handler is a
// footgun when middleware doesn't cover /api at all.
export const cancelOrderSchema = z.object({ reason: orderReasonSchema }).strict();

// POST /api/orders/[id]/items/void — void or qty-reduce ONE already-fired line on
// an open tab. The client sends INTENT, never money (CR1.2 decision 1): which line
// and how many, and the server prices the result from the tab's own GST snapshot.
//
// `index` addresses the line in the order's stored items[] (embedded subdocs carry
// no _id), and the two echoes assert WHAT THE OPERATOR WAS LOOKING AT so a stale
// view 409s instead of quietly doing something else — the same discipline as the
// settle payload's `total` (CR1.2 decision 3):
//   • `lineKey` — the whole line's identity (orderLineKey). A bare productId echo
//     was not enough: another device splicing a line out shifts the indices, and the
//     echo still matched a DIFFERENT line of the same dish, voiding the wrong one.
//   • `expectedVoids` — the trail length the operator's view was built on. The route
//     guards the write on THIS rather than on its own re-read, so a retried request
//     whose first attempt actually landed matches nothing and 409s, instead of
//     silently voiding a second unit off the line.
export const voidItemSchema = z
  .object({
    index: z.number().int().min(0),
    lineKey: z.string().min(1),
    qty: z.number().int().min(1), // how many to void off the line, not the line's new qty
    expectedVoids: z.number().int().min(0),
    reason: orderReasonSchema,
  })
  .strict();

// POST /api/orders/[id]/table — move a live tab to another table (the guests got
// up and sat somewhere else). Intent only: the destination table's NAME. There is
// deliberately NO money field — the order's table-charge snapshot is frozen at
// sale time and a move never re-prices it; the POS cart's charge seam is the one
// place an operator may change what a running tab is charged.
export const moveOrderTableSchema = z.object({ tableNo: tableNoSchema }).strict();

export type OrderItemInput = z.infer<typeof orderItemSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type AddItemsInput = z.infer<typeof addItemsSchema>;
export type SettleOrderInput = z.infer<typeof settleOrderSchema>;
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;
export type VoidItemInput = z.infer<typeof voidItemSchema>;
export type MoveOrderTableInput = z.infer<typeof moveOrderTableSchema>;
