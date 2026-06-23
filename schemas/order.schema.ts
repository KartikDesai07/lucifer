import { z } from "zod";
import {
  PAYMENT_MODES,
  SETTLEMENT_PAY_MODES,
  ORDER_STATUSES,
  TABLE_NUMBERS,
} from "@/lib/constants";

export const orderItemSchema = z.object({
  productId: z.string().min(1),
  name: z.string().min(1),
  price: z.number().min(0),
  qty: z.number().int().min(1),
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
  total: z.number().min(0),
  paidAmount: z.number().min(0),
  payment: z.enum(PAYMENT_MODES),
  splitCash: z.number().min(0).optional(),
  splitOnline: z.number().min(0).optional(),
  status: z.enum(ORDER_STATUSES).default("Pending"),
  receiver: z.string().min(1),
  tableNo: z.enum(TABLE_NUMBERS).optional(),
  notes: z.string().optional(),
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
});

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
  })
  .strict();

// POST /api/orders/[id]/settle — take payment on an open tab. paidAmount is
// derived server-side from the order's stored total, so only the mode + splits
// (and optionally a customer to attach) are accepted.
export const settleOrderSchema = z
  .object({
    payment: z.enum(SETTLEMENT_PAY_MODES),
    splitCash: z.number().min(0).optional(),
    splitOnline: z.number().min(0).optional(),
    customerId: z.string().optional(),
  })
  .strict();

export type OrderItemInput = z.infer<typeof orderItemSchema>;
export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type UpdateOrderInput = z.infer<typeof updateOrderSchema>;
export type AddItemsInput = z.infer<typeof addItemsSchema>;
export type SettleOrderInput = z.infer<typeof settleOrderSchema>;
