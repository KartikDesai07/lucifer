import { computeOrderTotals } from "@/lib/receipt";
import type { GstConfig } from "@/lib/receipt";
import type { Order, OrderItem } from "@/types";

// The Bill print page shows a sample bill through the REAL bill renderer
// (components/pos/OrderReceipt.tsx), so it needs a real, fully priced Order.
// The money comes only from computeOrderTotals, with no arithmetic here, so
// the sample can never disagree with a bill a customer is handed.

export const SAMPLE_ORDER_ID = "ORD-SAMPLE-001";
const SAMPLE_DOC_ID = "sample-bill";
const SAMPLE_KITCHEN_DOC_ID = "sample-kitchen-ticket";
const SAMPLE_CUSTOMER = "Guest";
const SAMPLE_STAFF = "Staff";
const SAMPLE_KOT_ROUND = 1;
const SAMPLE_CHAI_ID = "sample-chai";
// The kitchen ticket's sample: a table, an order note and a note on a dish, so
// every "show" toggle on that page has something to print or hide.
export const SAMPLE_KITCHEN_TABLE = "T4";
export const SAMPLE_KITCHEN_NOTE = "Serve the chai first";
export const SAMPLE_KITCHEN_INSTRUCTION = "Less sugar";
// A ticket is not a bill, so no GST is applied to it.
const SAMPLE_KITCHEN_GST: GstConfig = { gstEnabled: false, gstRate: 0, gstMode: "inclusive" };

// Whole rupees, like SAMPLE_ITEM_PRICE in lib/gst-sample-bill.ts.
export const SAMPLE_BILL_ITEMS: readonly OrderItem[] = [
  {
    productId: SAMPLE_CHAI_ID,
    name: "Masala chai",
    price: 40,
    qty: 2,
    modifiers: [],
    instructions: "",
    kotRound: SAMPLE_KOT_ROUND,
  },
  {
    productId: "sample-sandwich",
    name: "Veg sandwich",
    price: 120,
    qty: 1,
    modifiers: [],
    instructions: "",
    kotRound: SAMPLE_KOT_ROUND,
  },
];

export function sampleBillOrder(cfg: GstConfig, billNumber: number, createdAt: string): Order {
  const totals = computeOrderTotals({
    items: SAMPLE_BILL_ITEMS,
    discount: 0,
    discountKind: undefined,
    charge: 0,
    cfg,
  });
  return {
    _id: SAMPLE_DOC_ID,
    orderId: SAMPLE_ORDER_ID,
    customerName: SAMPLE_CUSTOMER,
    items: [...SAMPLE_BILL_ITEMS],
    subtotal: totals.subtotal,
    discount: totals.discount,
    gstAmount: totals.gstAmount,
    // The same GST snapshot rule app/api/orders/route.ts stamps on a new order.
    gstRate: cfg.gstEnabled ? cfg.gstRate : 0,
    gstMode: cfg.gstMode,
    total: totals.total,
    paidAmount: totals.total,
    payment: "Cash",
    status: "Completed",
    receiver: SAMPLE_STAFF,
    kotRounds: SAMPLE_KOT_ROUND,
    billNumber,
    createdAt,
    updatedAt: createdAt,
  };
}

// The Kitchen ticket page sample (components/pos/KOTReceipt.tsx renders it):
// the same two dishes with a note on the chai, still being made, priced by
// computeOrderTotals with GST off like any order before it is billed.
export function sampleKitchenOrder(createdAt: string): Order {
  const items = SAMPLE_BILL_ITEMS.map((item) =>
    item.productId === SAMPLE_CHAI_ID ? { ...item, instructions: SAMPLE_KITCHEN_INSTRUCTION } : item,
  );
  const totals = computeOrderTotals({
    items,
    discount: 0,
    discountKind: undefined,
    charge: 0,
    cfg: SAMPLE_KITCHEN_GST,
  });
  return {
    _id: SAMPLE_KITCHEN_DOC_ID,
    orderId: SAMPLE_ORDER_ID,
    customerName: SAMPLE_CUSTOMER,
    tableNo: SAMPLE_KITCHEN_TABLE,
    notes: SAMPLE_KITCHEN_NOTE,
    items,
    subtotal: totals.subtotal,
    discount: totals.discount,
    gstAmount: totals.gstAmount,
    gstRate: 0,
    gstMode: SAMPLE_KITCHEN_GST.gstMode,
    total: totals.total,
    paidAmount: 0,
    payment: "Cash",
    status: "Pending",
    receiver: SAMPLE_STAFF,
    kotRounds: SAMPLE_KOT_ROUND,
    createdAt,
    updatedAt: createdAt,
  };
}
