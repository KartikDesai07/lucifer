"use client";

import { useState } from "react";

import type { SettlementPayMode } from "@/lib/constants";
import { useCart, cartItemFromOrderItem, cartItemToInput, nextCartFromServerItems } from "@/hooks/use-cart";
import { usePosTotals } from "@/hooks/use-pos-totals";
import { usePosModalTotals } from "@/hooks/use-pos-modal-totals";
import { usePosPrint } from "@/hooks/use-pos-print";
import { useFreeTablePrompt } from "@/hooks/use-free-table-prompt";
import { useSettings } from "@/hooks/use-settings";
import { useCreateOrder, useAddOrderItems, useSettleOrder } from "@/hooks/use-orders";
import type { DiscountUnit } from "@/components/pos/Cart";
import type { PaymentResult } from "@/components/pos/PaymentModal";
import { collectedAmount } from "@/lib/payment-result";
import type { Customer, Order, CreateOrderInput } from "@/types";

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
  // Order-level note for a brand-new sale only — see buildCreatePayload and
  // Cart's `resuming` gate (a resumed tab's add-round payload carries none).
  const [notes, setNotes] = useState("");

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntent>("pay");
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [pendingResume, setPendingResume] = useState<Order | null>(null);

  // Print signals — extracted to keep this file under the line budget.
  const print = usePosPrint();
  // Free-the-table prompt after a brand-new Pay-Now sale — same reason.
  const freeTable = useFreeTablePrompt();

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
    setNotes("");
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
    notes: notes.trim() || undefined,
    ...overrides,
  });

  // `kot: false` skips the print signal (void ticket = void slip, not a remake
  // order); `keepUnfired: true` re-syncs after a void without dropping unsent lines
  // it never touched — the fire path must leave it false, see nextCartFromServerItems.
  const applyTabUpdate = (order: Order, opts: { kot?: boolean; keepUnfired?: boolean } = {}) => {
    const { kot = true, keepUnfired = false } = opts;
    setResumedOrder(order);
    hydrate(nextCartFromServerItems(order.items, cart, keepUnfired));
    // Mirror the server's (re-clamped) discount so the live cart footer total
    // stays in sync with the stored tab total after a fire (matches enterResume).
    setDiscountRaw(order.discount);
    setDiscountUnit("₹");
    if (kot) print.queueKotRound(order);
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
            // The operator can change the discount on a resumed tab right up to
            // settlement; the server re-clamps + recomputes the total from it.
            discount,
            paidAmount: collectedAmount(result),
            // Only meaningful alongside a defined paidAmount above — lets the
            // route detect a stale modalTotals snapshot (CR1.2 regression).
            total: modalTotals.total,
          },
        });
        print.setLastOrder(updated);
      } else {
        const order = await createOrder.mutateAsync(
          buildCreatePayload({
            status: "Completed",
            payment: result.payment,
            // Same rule as the settle branch: omit on a full payment so the
            // server prices against ITS own recomputed total. Sending the
            // modal's number here made a stale client GST view read as a
            // partial payment and hard-400 an ordinary cash sale.
            paidAmount: collectedAmount(result),
            splitCash: result.splitCash,
            splitOnline: result.splitOnline,
          }),
        );
        // POST /api/orders stamps every opening line with kotRound: 1, so a
        // counter sale is a real KOT round server-side too — queue the ticket
        // so the kitchen actually gets it (the settle branch above fires
        // nothing new, so it must NOT print a KOT).
        print.queueKotRound(order);
        // POST /api/orders occupies the table on EVERY create, so a brand-new
        // Pay-Now sale against a table would otherwise leave it Occupied
        // forever — offer to free it now, before resetOrder() below clears
        // the local `table` state this order was built against.
        if (order.tableNo) {
          freeTable.askToFreeTable({ tableNo: order.tableNo, orderId: order.orderId });
        }
      }
      setPaymentOpen(false);
      print.setShouldPrintReceipt(true);
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

  // The settle/pay modal's totals — extracted to keep this file under budget.
  const modalTotals = usePosModalTotals({
    resumedOrder,
    discount,
    settings: settings.data,
    paymentIntent,
    subtotal,
    gstAmount,
    gstRate,
    total,
    count,
  });

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
    notes,
    setNotes,
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
    // Re-syncs a server order into cart + resumedOrder (also used internally by
    // sendToKitchen); a void passes { kot: false, keepUnfired: true } — see the
    // definition for why each flag matters.
    applyTabUpdate,
    // Spread, not hand-mirrored, so pos/page.tsx's `pos.*` surface tracks whatever
    // usePosPrint/useFreeTablePrompt expose — a new field needs no matching line here.
    ...print,
    ...freeTable,
  };
}
