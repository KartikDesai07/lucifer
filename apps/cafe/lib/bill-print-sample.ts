import { computeOrderTotals } from "@/lib/receipt";
import type { GstConfig } from "@/lib/receipt";
import type { Order, OrderItem } from "@/types";

// The Bill print page shows a sample bill through the REAL bill renderer
// (components/pos/OrderReceipt.tsx), so it needs a real, fully priced Order.
// The money comes only from computeOrderTotals, with no arithmetic here, so
// the sample can never disagree with a bill a customer is handed.

export const SAMPLE_ORDER_ID = "ORD-SAMPLE-001";
const SAMPLE_DOC_ID = "sample-bill";
const SAMPLE_CUSTOMER = "Guest";
const SAMPLE_STAFF = "Staff";
const SAMPLE_KOT_ROUND = 1;

// Whole rupees, like SAMPLE_ITEM_PRICE in lib/gst-sample-bill.ts.
export const SAMPLE_BILL_ITEMS: readonly OrderItem[] = [
  {
    productId: "sample-chai",
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
