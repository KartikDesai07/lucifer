"use client";

import { useMemo, useState } from "react";

import type { SettlementPayMode, DiscountKind } from "@/lib/constants";
import { tableChargeOf } from "@/lib/receipt";
import { useTables } from "@/hooks/use-tables";
import { useCart, cartItemFromOrderItem, cartItemToInput, nextCartFromServerItems } from "@/hooks/use-cart";
import { usePosTotals } from "@/hooks/use-pos-totals";
import { usePosModalTotals } from "@/hooks/use-pos-modal-totals";
import { usePosPrint } from "@/hooks/use-pos-print";
import { useFreeTablePrompt } from "@/hooks/use-free-table-prompt";
import { useSettings } from "@/hooks/use-settings";
import { useCreateOrder, useAddOrderItems, useSettleOrder } from "@/hooks/use-orders";
import { useRewardSelection } from "@/hooks/use-customer-rewards";
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
  // CB-5B S9 — the reward INTENT this session is choosing (stamp cost only,
  // never an amount). Stays null while a resumed tab already carries a
  // granted reward — see use-customer-rewards.ts's `existingRewardAt`.
  const [rewardAt, setRewardAt] = useState<number | null>(null);
  const [resumedOrder, setResumedOrder] = useState<Order | null>(null);
  // Order-level note for a brand-new sale only — see buildCreatePayload and
  // Cart's `resuming` gate (a resumed tab's add-round payload carries none).
  const [notes, setNotes] = useState("");
  // CB-5D part 2 — the COUNTER's promo-code INTENT this session is choosing
  // (a code string only, never an amount — the server resolves it). Cleared
  // on the exact same lifecycle as rewardAt/notes below (resetOrder/
  // enterResume) so a stale code never silently rides onto the next
  // customer's bill.
  const [promoCode, setPromoCode] = useState<string | null>(null);

  // `undefined` = the operator has not touched the charge, so whatever the bill
  // is entitled to (the table's config for a new sale, the tab's snapshot for a
  // resumed one) stands. A NUMBER is a deliberate waiver/adjustment for this
  // bill only — 0 means waived. The distinction is the whole point: omitting it
  // from the payload lets the server re-derive the charge from the table, which
  // stays right even when this client's 30s-cached table list is stale.
  const [chargeOverride, setChargeOverride] = useState<number | undefined>();

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntent>("pay");
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [pendingResume, setPendingResume] = useState<Order | null>(null);

  // Print signals — extracted to keep this file under the line budget.
  const print = usePosPrint();
  // Free-the-table prompt after a brand-new Pay-Now sale — same reason.
  const freeTable = useFreeTablePrompt();

  // The charge this bill is entitled to before any waiver: a resumed tab keeps
  // the charge it was OPENED with (a snapshot — re-reading the table mid-service
  // would let an admin edit re-price a bill the kitchen already served), while a
  // new sale takes it from the table currently selected.
  const tables = useTables();
  const entitledCharge = useMemo(() => {
    if (resumedOrder) return resumedOrder.chargeAmount ?? 0;
    const selected = table
      ? tables.data?.find((t) => t.tableNo === table)
      : undefined;
    return tableChargeOf(selected).amount;
  }, [resumedOrder, table, tables.data]);

  const chargeLabel = useMemo(() => {
    if (resumedOrder) return resumedOrder.chargeLabel ?? "";
    const selected = table
      ? tables.data?.find((t) => t.tableNo === table)
      : undefined;
    return tableChargeOf(selected).label;
  }, [resumedOrder, table, tables.data]);

  const charge = chargeOverride ?? entitledCharge;

  // PRE-REWARD pricing, exactly like the server's own `plainTotals`
  // (app/api/orders/route.ts) and the add-round route's `billTotal`: a rung's
  // per-milestone `minBill` is gated against what the customer is spending
  // BEFORE the reward, so a reward may never fund its own gate. This pass is
  // also the only one that exists while nothing is selected.
  const plain = usePosTotals({
    subtotal,
    discountRaw,
    discountUnit,
    charge,
    settings: settings.data,
  });
  const discountKind: DiscountKind | undefined =
    discountUnit === "GST" ? "gst" : undefined;

  const reward = useRewardSelection(
    customer, plain.total, resumedOrder, rewardAt, setRewardAt,
    discountRaw, discountUnit, setDiscountRaw, setDiscountUnit,
  );

  // The figures every surface actually shows. Re-priced with the SELECTED rung
  // so the cart footer, the mobile bar and the payment modal preview the same
  // bill the server will store — before S9 wired a reward in, these were the
  // same object, and the reward-blind version silently collected the
  // undiscounted amount against a discounted order.
  const { discount, gstAmount, gstRate, gstEnabled, total } = usePosTotals({
    subtotal,
    discountRaw,
    discountUnit,
    charge,
    settings: settings.data,
    reward: reward.selectedReward,
  });

  const isBusy =
    createOrder.isPending || addItems.isPending || settleOrder.isPending;

  // Work that a browser tab/window close would silently discard: a half-built
  // round (unsent items) or a resumed open tab mid-edit. Drives useUnsavedGuard
  // on the POS page (owner report 2026-09-06).
  const dirty = newCount > 0 || resumedOrder !== null;

  const resetOrder = () => {
    clearCart();
    setTable(undefined);
    setCustomer(undefined);
    setDiscountRaw(0);
    setDiscountUnit("₹");
    setRewardAt(null);
    setChargeOverride(undefined);
    setResumedOrder(null);
    setNotes("");
    setPromoCode(null);
  };

  // Picking a different table means a different charge, so a waiver made
  // against the previous one is dropped rather than silently carried across to
  // a table the operator never waived anything for.
  const selectTable = (next: string | undefined) => {
    setTable(next);
    setChargeOverride(undefined);
  };

  const buildCreatePayload = (
    overrides: Partial<CreateOrderInput>,
  ): CreateOrderInput => ({
    customerName: customer?.name ?? "Walk-In",
    customerId: customer?._id,
    items: cart.filter((ci) => ci.kotRound === 0).map(cartItemToInput),
    subtotal,
    discount,
    // null = explicit clear; when "gst" the server ignores the number and re-derives.
    discountKind: discountKind ?? null,
    gstAmount,
    // CB-5B S9 — INTENT ONLY; `undefined` (omit) not `null` (not nullable).
    rewardAt: reward.pendingRewardAt,
    // CB-5D part 2 — INTENT ONLY, same omit-not-null rule as rewardAt above;
    // the schema field is `.optional()`, not nullable, and the server only
    // accepts this on CREATE (never add-round/settle — out of scope there).
    promoCode: promoCode ?? undefined,
    // Sent ONLY when the operator actually touched it. Omitted, the server
    // applies the table's own current charge — which is more trustworthy than
    // anything this client could echo, since the tables list here is cached for
    // 30s and could re-apply a charge an admin has already lowered.
    chargeAmount: chargeOverride,
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
  const applyTabUpdate = (
    order: Order,
    opts: { kot?: boolean; keepUnfired?: boolean; chargeSent?: boolean } = {},
  ) => {
    const { kot = true, keepUnfired = false, chargeSent = false } = opts;
    setResumedOrder(order);
    // Follow the server's table onto the header — a move lands here too, and
    // without this the POS keeps showing the table the tab was opened at.
    // The RAW setter, deliberately not `selectTable`: that one clears
    // chargeOverride, which would silently re-bill a waiver the operator
    // already promised (a move never touches money, so nothing here should
    // touch the charge either).
    setTable(order.tableNo);
    hydrate(nextCartFromServerItems(order.items, cart, keepUnfired));
    // Mirror the server's (re-clamped) discount so the live cart footer total
    // stays in sync with the stored tab total after a fire (matches enterResume).
    setDiscountRaw(order.discount);
    // Restore the kind from the server's order — else every round-trip silently drops the preset (charge-waiver bug's class).
    setDiscountUnit(order.discountKind === "gst" ? "GST" : "₹");
    // Drop the local waiver ONLY when the request that produced `order` actually
    // carried it — then the server has answered, `order` holds the charge it
    // stored, and `entitledCharge` reads straight off it. The void path carries
    // no charge (voidItemSchema is intent-only), so clearing there would throw
    // away a waiver the operator has already promised the guest and quietly
    // bill it back at settle.
    if (chargeSent) setChargeOverride(undefined);
    if (kot) print.queueKotRound(order);
  };

  const sendToKitchen = async () => {
    const newItems = cart.filter((ci) => ci.kotRound === 0).map(cartItemToInput);
    if (!newItems.length) return;
    try {
      const order = resumedOrder
        ? await addItems.mutateAsync({
            id: resumedOrder._id,
            // CB-5B S9 — the reward claim rides the add-round too, not just a
            // brand-new sale: an OPEN TAB is exactly when the counter applies
            // one. INTENT ONLY (`pendingRewardAt` is the chosen rung's `at`,
            // never an amount), and it is already `undefined` for a tab that
            // carries a reward, so the route's 409 is a backstop rather than
            // the gate. `undefined` omits the key over JSON, which is what the
            // optional schema field expects — never `null`.
            data: {
              items: newItems,
              discount,
              discountKind: discountKind ?? null,
              chargeAmount: chargeOverride,
              rewardAt: reward.pendingRewardAt,
            },
          })
        : await createOrder.mutateAsync(buildCreatePayload({}));
      // Both branches carry chargeAmount, so the waiver is now durable on the
      // order itself rather than surviving only in this browser's state.
      applyTabUpdate(order, { chargeSent: true });
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
            discountKind: discountKind ?? null,
            // Same rule as the create payload: only when they touched it.
            // Omitted leaves the tab's snapshotted charge exactly as it is.
            chargeAmount: chargeOverride,
            paidAmount: collectedAmount(result),
            // Only meaningful alongside a defined paidAmount above — lets the
            // route detect a stale modalTotals snapshot (CR1.2 regression).
            total: modalTotals.total,
          },
        });
        print.queueReceipt(updated);
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
        print.queueReceipt(order);
        // POST /api/orders occupies the table on EVERY create, so a brand-new
        // Pay-Now sale against a table would otherwise leave it Occupied
        // forever — offer to free it now, before resetOrder() below clears
        // the local `table` state this order was built against.
        if (order.tableNo) {
          freeTable.askToFreeTable({ tableNo: order.tableNo, orderId: order.orderId });
        }
      }
      setPaymentOpen(false);
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
    setDiscountUnit(order.discountKind === "gst" ? "GST" : "₹");
    // A stale in-progress pick — the resumed tab's own reward (if any)
    // surfaces via `existingRewardAt` (resumedOrder.rewardAt), not this.
    setRewardAt(null);
    // The tab's own snapshot governs from here — not the table's current config.
    setChargeOverride(undefined);
    // CB-5D part 2 — a resumed tab never carries this session's own promo
    // pick (the server only accepts promoCode on CREATE, never add-round/
    // settle), so a code typed for a different customer must not silently
    // ride onto whatever tab gets resumed next.
    setPromoCode(null);
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
    discountKind,
    chargeOverride,
    charge,
    chargeLabel,
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
    dirty,
    table,
    setTable: selectTable,
    customer,
    setCustomer,
    discountRaw,
    setDiscountRaw: reward.onManualDiscountRaw,
    discountUnit,
    setDiscountUnit: reward.onManualDiscountUnit,
    discount,
    // CB-5B S9 — the reward picker's surface for Cart/CartReward. Spread, not
    // hand-mirrored — same rationale as ...print/...freeTable below.
    ...reward,
    // The table charge for this bill: what is being charged, what it prints as,
    // and the seam for the operator to waive or adjust it.
    charge,
    chargeLabel,
    entitledCharge,
    setChargeOverride,
    gstAmount,
    gstRate,
    gstEnabled,
    total,
    notes,
    setNotes,
    // CB-5D part 2 — the promo-code control's surface for Cart/CartPromo.
    promoCode,
    setPromoCode,
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
