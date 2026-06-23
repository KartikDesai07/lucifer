"use client";

import { useCallback, useState } from "react";

import type { SettlementPayMode } from "@/lib/constants";
import {
  useCart,
  cartItemFromOrderItem,
  cartItemToInput,
} from "@/hooks/use-cart";
import { usePosTotals } from "@/hooks/use-pos-totals";
import { useSettings } from "@/hooks/use-settings";
import {
  useCreateOrder,
  useAddOrderItems,
  useSettleOrder,
} from "@/hooks/use-orders";
import type { DiscountUnit } from "@/components/pos/Cart";
import type { PaymentResult } from "@/components/pos/PaymentModal";
import type { Customer, Order, OrderItem, CreateOrderInput } from "@/types";

type PaymentIntent = "pay" | "settle";

// Owns the "order being built / tab being run" state + the create / add-round /
// settle orchestration, so the POS page is left with rendering + print wiring.
// The page reacts to shouldPrintReceipt / shouldPrintKot to drive react-to-print.
export function usePosTab(receiver: string) {
  const settings = useSettings();
  const createOrder = useCreateOrder();
  const addItems = useAddOrderItems();
  const settleOrder = useSettleOrder();
  const {
    cart,
    count,
    subtotal,
    newCount,
    addToCart,
    updateQty,
    removeFromCart,
    clearCart,
    hydrate,
  } = useCart();

  const [table, setTable] = useState<string | undefined>();
  const [customer, setCustomer] = useState<Customer | undefined>();
  const [discountRaw, setDiscountRaw] = useState(0);
  const [discountUnit, setDiscountUnit] = useState<DiscountUnit>("₹");
  const [resumedOrder, setResumedOrder] = useState<Order | null>(null);

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntent>("pay");
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [pendingResume, setPendingResume] = useState<Order | null>(null);

  // Print signals — the page owns the print refs and clears these after printing.
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  const [kotRoundItems, setKotRoundItems] = useState<OrderItem[] | null>(null);
  const [kotRoundLabel, setKotRoundLabel] = useState<string | undefined>();
  const [shouldPrintReceipt, setShouldPrintReceipt] = useState(false);
  const [shouldPrintKot, setShouldPrintKot] = useState(false);

  const { discount, gstAmount, gstRate, total } = usePosTotals({
    subtotal,
    discountRaw,
    discountUnit,
    settings: settings.data,
  });

  const isBusy =
    createOrder.isPending || addItems.isPending || settleOrder.isPending;

  const resetOrder = () => {
    clearCart();
    setTable(undefined);
    setCustomer(undefined);
    setDiscountRaw(0);
    setDiscountUnit("₹");
    setResumedOrder(null);
  };

  const buildCreatePayload = (
    overrides: Partial<CreateOrderInput>,
  ): CreateOrderInput => ({
    customerName: customer?.name ?? "Walk-In",
    customerId: customer?._id,
    items: cart.filter((ci) => ci.kotRound === 0).map(cartItemToInput),
    subtotal,
    discount,
    gstAmount,
    total,
    paidAmount: 0,
    payment: "Unpaid",
    status: "Pending",
    receiver,
    tableNo: table as CreateOrderInput["tableNo"],
    ...overrides,
  });

  // Refresh local state from the server's order after a fire — re-hydrate so the
  // just-fired items lock and the "New" section empties — then queue the round KOT.
  const applyTabUpdate = (order: Order) => {
    setResumedOrder(order);
    hydrate(order.items.map((it, i) => cartItemFromOrderItem(it, i)));
    setLastOrder(order);
    setKotRoundItems(order.items.filter((it) => it.kotRound === order.kotRounds));
    setKotRoundLabel(`Round ${order.kotRounds}`);
    setShouldPrintKot(true);
  };

  const sendToKitchen = async () => {
    const newItems = cart.filter((ci) => ci.kotRound === 0).map(cartItemToInput);
    if (!newItems.length) return;
    try {
      const order = resumedOrder
        ? await addItems.mutateAsync({
            id: resumedOrder._id,
            data: { items: newItems, discount },
          })
        : await createOrder.mutateAsync(buildCreatePayload({}));
      applyTabUpdate(order);
    } catch {
      /* hook toasts; nothing local mutated, staff can retry */
    }
  };

  const payNow = () => {
    setPaymentIntent("pay");
    setPaymentOpen(true);
  };
  const settle = () => {
    setPaymentIntent("settle");
    setPaymentOpen(true);
  };

  const confirmPayment = async (result: PaymentResult) => {
    try {
      if (paymentIntent === "settle" && resumedOrder) {
        const updated = await settleOrder.mutateAsync({
          id: resumedOrder._id,
          data: {
            payment: result.payment as SettlementPayMode,
            splitCash: result.splitCash,
            splitOnline: result.splitOnline,
            customerId: customer?._id,
          },
        });
        setLastOrder(updated);
      } else {
        const order = await createOrder.mutateAsync(
          buildCreatePayload({
            status: "Completed",
            payment: result.payment,
            paidAmount: result.paidAmount,
            splitCash: result.splitCash,
            splitOnline: result.splitOnline,
          }),
        );
        setLastOrder(order);
      }
      setPaymentOpen(false);
      setShouldPrintReceipt(true);
      resetOrder();
    } catch {
      /* hook rolled back + toasted; leave the modal open */
    }
  };

  const enterResume = (order: Order) => {
    setResumedOrder(order);
    setTable(order.tableNo);
    // Minimal customer for display + the modal's Due/Credit guard; the settle
    // endpoint treats the order's own customerId as authoritative.
    setCustomer(
      order.customerId
        ? ({ _id: order.customerId, name: order.customerName } as Customer)
        : undefined,
    );
    setDiscountRaw(order.discount);
    setDiscountUnit("₹");
    hydrate(order.items.map((it, i) => cartItemFromOrderItem(it, i)));
  };

  // Resuming replaces the cart wholesale. If a fresh (unsent) cart is in
  // progress, confirm first so those local items aren't silently discarded
  // (mirrors the close-tab guard).
  const requestResume = (order: Order) => {
    if (newCount > 0) setPendingResume(order);
    else enterResume(order);
  };
  const confirmResume = () => {
    if (pendingResume) enterResume(pendingResume);
    setPendingResume(null);
  };
  const cancelResume = () => setPendingResume(null);

  const requestCloseTab = () => {
    if (newCount > 0) setCloseConfirmOpen(true);
    else resetOrder();
  };
  const confirmCloseTab = () => {
    setCloseConfirmOpen(false);
    resetOrder();
  };

  // Reprint the whole current order's KOT (no round filter).
  const reprintKot = () => {
    setKotRoundItems(null);
    setKotRoundLabel(undefined);
    setShouldPrintKot(true);
  };

  // Stable so the page's print effects only re-run when a print signal flips.
  const clearPrintReceipt = useCallback(() => setShouldPrintReceipt(false), []);
  const clearPrintKot = useCallback(() => setShouldPrintKot(false), []);

  // The settle modal is driven by the tab's STORED totals (authoritative); the
  // pay modal by the live cart.
  const settling = paymentIntent === "settle" && resumedOrder;
  const modalTotals = settling
    ? {
        subtotal: resumedOrder.subtotal,
        discount: resumedOrder.discount,
        gstAmount: resumedOrder.gstAmount ?? 0,
        gstRate: resumedOrder.gstRate,
        total: resumedOrder.total,
        itemCount: resumedOrder.items.reduce((n, it) => n + it.qty, 0),
        confirmLabel: "Settle",
      }
    : {
        subtotal,
        discount,
        gstAmount,
        gstRate,
        total,
        itemCount: count,
        confirmLabel: "Place Order",
      };

  return {
    settings,
    cart,
    count,
    subtotal,
    newCount,
    table,
    setTable,
    customer,
    setCustomer,
    discountRaw,
    setDiscountRaw,
    discountUnit,
    setDiscountUnit,
    discount,
    gstAmount,
    gstRate,
    total,
    addToCart,
    updateQty,
    removeFromCart,
    clearCart,
    resumedOrder,
    isBusy,
    sendToKitchen,
    payNow,
    settle,
    confirmPayment,
    requestResume,
    confirmResume,
    cancelResume,
    pendingResume,
    requestCloseTab,
    confirmCloseTab,
    paymentOpen,
    setPaymentOpen,
    modalTotals,
    closeConfirmOpen,
    setCloseConfirmOpen,
    lastOrder,
    kotRoundItems,
    kotRoundLabel,
    shouldPrintReceipt,
    clearPrintReceipt,
    shouldPrintKot,
    clearPrintKot,
    reprintKot,
  };
}
