"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import type { SettlementPayMode, DiscountKind } from "@/lib/constants";
import { tableChargeOf } from "@/lib/receipt";
import { chargesFromOrder } from "@pos/shared/order-charges";
import type { ExtraChargeEntry } from "@/components/pos/CartExtraCharges";
import { useTables } from "@/hooks/use-tables";
import { useCart, cartItemFromOrderItem, cartItemToInput } from "@/hooks/use-cart";
import { usePosTotals } from "@/hooks/use-pos-totals";
import { usePosModalTotals } from "@/hooks/use-pos-modal-totals";
import { usePosPrint } from "@/hooks/use-pos-print";
import { useFreeTablePrompt } from "@/hooks/use-free-table-prompt";
import { useSettings } from "@/hooks/use-settings";
import { useCreateOrder, useAddOrderItems } from "@/hooks/use-orders";
import { useRewardSelection } from "@/hooks/use-customer-rewards";
import { useSettleFlow } from "@/hooks/use-settle-flow";
import { usePosSend } from "@/hooks/use-pos-send";
import { moneyEditedSince } from "@/lib/pending-writes";
import { kitchenSentMessage, kotRoundOfSend } from "@/lib/pos-send";
import type { DiscountUnit } from "@/components/pos/Cart";
import type { PaymentResult } from "@/components/pos/PaymentModal";
import { collectedAmount } from "@/lib/payment-result";
import type { Customer, Order, CreateOrderInput, SettleOrderInput } from "@/types";

type PaymentIntent = "pay" | "settle";

// Owns the "order being built / tab being run" state + the create / add-round /
// settle orchestration, so the POS page is left with rendering + print wiring.
// The page reacts to shouldPrintReceipt / shouldPrintKot to drive react-to-print.
export function usePosTab(receiver: string) {
  const settings = useSettings();
  const createOrder = useCreateOrder();
  const addItems = useAddOrderItems();
  // The one foreground Send to Kitchen / Pay Now (hooks/use-pos-send.ts); its
  // lock freezes the cart's edits in flight and while a send is unconfirmed.
  const send = usePosSend();
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
    resync,
  } = useCart(send.isLocked);
  // The tab on screen: a late answer never frees or refreshes a different one.
  const tabIdRef = useRef<string | null>(null);

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
  // CB-5D part 2 — the COUNTER's promo-code INTENT (a code only, never an amount;
  // the server resolves it). Cleared with rewardAt/notes (resetOrder/enterResume)
  // so a stale code never silently rides onto the next customer's bill.
  const [promoCode, setPromoCode] = useState<string | null>(null);

  // `undefined` = untouched: the bill's entitlement (the table's config for a new
  // sale, the tab's snapshot for a resumed one) stands. A NUMBER is a deliberate
  // waiver/adjustment for this bill only (0 = waived). Omitting it lets the
  // server re-derive the charge, right even when this client's table list is stale.
  const [chargeOverride, setChargeOverride] = useState<number | undefined>();

  // CB-CHG (plan §5C/§5B) — the staff-entered extra charges (label + amount; the
  // server stamps type "extra"). Independent of chargeOverride (the TABLE charge
  // only). Cleared in resetOrder(); re-seeded from the server's charges in
  // enterResume()/applyTabUpdate(). NOT cleared by selectTable — changing table
  // is not an extra-charge change (only the table entry is table-scoped).
  const [extraCharges, setExtraCharges] = useState<ExtraChargeEntry[]>([]);
  const addExtraCharge = (entry: ExtraChargeEntry) =>
    setExtraCharges((prev) => [...prev, entry]);
  const removeExtraCharge = (index: number) =>
    setExtraCharges((prev) => prev.filter((_, i) => i !== index));

  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentIntent, setPaymentIntent] = useState<PaymentIntent>("pay");
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [pendingResume, setPendingResume] = useState<Order | null>(null);

  // Print signals and the post-Pay-Now free-table prompt — extracted for the line budget.
  const print = usePosPrint();
  const freeTable = useFreeTablePrompt();

  // The charge before any waiver: a resumed tab keeps the one it was OPENED with
  // (re-reading the table would let an admin edit re-price a served bill); a new
  // sale takes it from the table currently selected.
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

  // CB-CHG — usePosTotals adds this ON TOP of `charge` (the table charge),
  // uncapped, per owner decision 8. `type` is never sent to the server; it's
  // supplied here only because chargesTotal takes an OrderCharge[].
  const extraChargesForTotals = useMemo(
    () => extraCharges.map((e) => ({ type: "extra" as const, label: e.label, amount: e.amount })),
    [extraCharges],
  );

  // PRE-REWARD pricing, exactly like the server's `plainTotals` (orders route)
  // and the add-round route's `billTotal`: a rung's `minBill` is gated against
  // the spend BEFORE the reward, so a reward never funds its own gate. It is
  // also the only pass while nothing is selected.
  const plain = usePosTotals({
    subtotal,
    discountRaw,
    discountUnit,
    charge,
    extraCharges: extraChargesForTotals,
    settings: settings.data,
  });
  const discountKind: DiscountKind | undefined =
    discountUnit === "GST" ? "gst" : undefined;

  const reward = useRewardSelection(
    customer, plain.total, resumedOrder, rewardAt, setRewardAt,
    discountRaw, discountUnit, setDiscountRaw, setDiscountUnit,
  );

  // The figures every surface shows, re-priced with the SELECTED rung so cart,
  // mobile bar and payment modal preview the bill the server will store (a
  // reward-blind copy once collected the undiscounted amount).
  const { discount, gstAmount, gstRate, gstEnabled, total } = usePosTotals({
    subtotal,
    discountRaw,
    discountUnit,
    charge,
    extraCharges: extraChargesForTotals,
    settings: settings.data,
    reward: reward.selectedReward,
  });

  // The one foreground settle (hooks/use-settle-flow.ts). Its handlers run only
  // after the server's answer; onSettled prints the tab's one bill.
  const settleFlow = useSettleFlow({
    onSettled: (order) => {
      print.queueReceipt(order);
      setPaymentOpen(false);
      resetOrder();
    },
    // Changed on another device: refresh in place, keeping money edited since.
    onChanged: (order) => {
      if (resumedOrder?._id === order._id) applyTabUpdate(order, { kot: false, keepUnfired: true, keepMoney: moneyEditedSince({ discountRaw, discountUnit, chargeOverride, extraCharges }, resumedOrder) });
    },
    onFinished: () => {
      setPaymentOpen(false);
      resetOrder();
    },
  });

  const isBusy =
    createOrder.isPending || addItems.isPending || settleFlow.busy || send.sending !== null || send.frozen !== null;
  // The popup's spinner: in flight only, so its Send again is never a dead button (M3).
  const paymentBusy = settleFlow.busy || send.sending !== null;

  // Work that a browser tab/window close would silently discard: a half-built
  // round (unsent items) or a resumed open tab mid-edit. Drives useUnsavedGuard
  // on the POS page (owner report 2026-09-06).
  const dirty = newCount > 0 || resumedOrder !== null;

  const resetOrder = () => {
    send.reset(); // first: an unconfirmed send's freeze would refuse clearCart
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
    setExtraCharges([]);
    tabIdRef.current = null;
  };
  // R-d — Discard an unconfirmed send (after its confirm): the whole order goes.
  const discard = () => { setPaymentOpen(false); resetOrder(); };

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
    // CB-CHG — the complete new extra set (replace, not append — decision 6).
    // Present = this bill's extras from here on; the server stamps type:"extra"
    // and never touches the table entry (applyExtraCharges).
    extraCharges,
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
  // `keepMoney: true` (an unasked-for refresh) leaves edited discount/extras alone.
  const applyTabUpdate = (
    order: Order,
    opts: { kot?: boolean; keepUnfired?: boolean; keepMoney?: boolean } = {},
  ) => {
    if (order._id !== tabIdRef.current) return;
    const { kot = true, keepUnfired = false, keepMoney = false } = opts;
    setResumedOrder(order);
    // Follow the server's table onto the header — a move lands here too, and
    // without this the POS keeps showing the table the tab was opened at.
    // The RAW setter, deliberately not `selectTable`: that one clears
    // chargeOverride, which would silently re-bill a waiver the operator
    // already promised (a move never touches money, so nothing here should
    // touch the charge either).
    setTable(order.tableNo);
    resync(order.items, keepUnfired);
    // A tab that gained a customer elsewhere: without it the Due/Credit picker
    // is hidden while no customer is set — a dead end (shape as enterResume).
    if (order.customerId && customer?._id !== order.customerId) {
      setCustomer({ _id: order.customerId, name: order.customerName } as Customer);
    }
    // Never drops the local waiver: a void/move carries no charge, and a send
    // frees the whole cart (resetOrder) only once the server has stored it.
    if (!keepMoney) {
      // Mirror the server's (re-clamped) discount so the live cart footer total
      // stays in sync with the stored tab total after a fire (matches enterResume).
      setDiscountRaw(order.discount);
      // Restore the kind from the server's order — else every round-trip silently drops the preset (charge-waiver bug's class).
      setDiscountUnit(order.discountKind === "gst" ? "GST" : "₹");
      // CB-CHG — re-seed the local extras from what the server actually stored
      // (fire, void re-sync, move all derive charges[] from the order they
      // have). `type` is never sent to the server, so it is dropped here too.
      setExtraCharges(
        chargesFromOrder(order)
          .filter((c) => c.type === "extra")
          .map((c) => ({ label: c.label, amount: c.amount })),
      );
    }
    if (kot) print.queueKotRound(order);
  };

  const sendToKitchen = () => {
    const newItems = cart.filter((ci) => ci.kotRound === 0).map(cartItemToInput);
    if (!newItems.length) return;
    const startedFor = resumedOrder?._id ?? null;
    // CB-5B S9 — the reward claim rides the add-round too: an OPEN TAB is exactly
    // when the counter applies one. INTENT ONLY (`pendingRewardAt` is the rung's
    // `at`), already `undefined` — omitted over JSON, never `null` — for a tab
    // that carries a reward, so the route's 409 is a backstop. CB-CHG — the
    // complete new extra set (replace, decision 6).
    const round = resumedOrder
      ? { id: resumedOrder._id, data: { items: newItems, discount, discountKind: discountKind ?? null, chargeAmount: chargeOverride, extraCharges, rewardAt: reward.pendingRewardAt } }
      : null;
    const create = buildCreatePayload({});
    // One confirmed request: the cart is freed only on the server's answer, and
    // the ticket prints from ITS order — the round this key landed as (M5).
    void send.run({
      kind: "kitchen",
      scope: round?.id ?? "create",
      request: (idemKey) =>
        round ? addItems.mutateAsync({ id: round.id, data: { ...round.data, idemKey } }) : createOrder.mutateAsync({ ...create, idemKey }),
      confirm: (order, idemKey) => {
        const printed = kotRoundOfSend(order, round !== null, idemKey);
        print.queueKotRound(order, printed);
        toast.success(kitchenSentMessage(order, round ? printed : null));
        if (tabIdRef.current === startedFor) resetOrder();
      },
    });
  };

  const payNow = () => {
    setPaymentIntent("pay");
    setPaymentOpen(true);
  };
  const settle = () => {
    setPaymentIntent("settle");
    setPaymentOpen(true);
  };

  // ONE settle payload, sent by the one foreground settle (use-settle-flow).
  const settlePayload = (result: PaymentResult, tab: Order): SettleOrderInput => ({
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
    // CB-CHG — the complete new extra set (replace, decision 6).
    extraCharges,
    paidAmount: collectedAmount(result),
    // Only meaningful alongside a defined paidAmount above — lets the
    // route detect a stale modalTotals snapshot (CR1.2 regression).
    total: modalTotals.total,
    // The tab this bill was priced from: the route refuses once it has moved
    // (lib/settle-guard.ts), so a re-send can never close a bigger bill.
    expectedTotal: tab.total,
    expectedVoids: tab.voids?.length ?? 0,
  });

  const confirmPayment = async (result: PaymentResult) => {
    if (paymentIntent === "settle" && resumedOrder) {
      // One confirmed request; the flow's handlers close the popup and print.
      await settleFlow.submit(resumedOrder, settlePayload(result, resumedOrder));
      return;
    } else {
      const sale = buildCreatePayload({
        status: "Completed",
        payment: result.payment,
        // Same rule as the settle branch: omit on a full payment so the server
        // prices against ITS own recomputed total (a stale client GST view once
        // read as a partial payment and hard-400'd an ordinary cash sale).
        paidAmount: collectedAmount(result),
        splitCash: result.splitCash,
        splitOnline: result.splitOnline,
      });
      // One confirmed request (lib/pos-send.ts); "Couldn't confirm" keeps the
      // popup open on Send again — the same sale with the same key (R13).
      await send.run({
        kind: "pay",
        scope: "create",
        request: (idemKey) => createOrder.mutateAsync({ ...sale, idemKey }),
        confirm: (order) => {
          // POST /api/orders stamps every opening line with kotRound: 1, so a
          // counter sale is a real KOT round too — queue the ticket so the
          // kitchen gets it (the settle branch fires nothing new: no KOT there).
          print.queueKotRound(order);
          print.queueReceipt(order);
          // The create occupies the table, so offer to free it now — before
          // resetOrder() below clears the `table` this sale was built against.
          if (order.tableNo) freeTable.askToFreeTable({ tableNo: order.tableNo, orderId: order.orderId });
          toast.success(`Order ${order.orderId} placed`);
          setPaymentOpen(false);
          resetOrder();
        },
      });
    }
  };

  const enterResume = (order: Order) => {
    send.reset();
    tabIdRef.current = order._id;
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
    // CB-CHG — the resumed tab's own extras (label + amount only; `type` is
    // never sent to the server, so it is dropped here too).
    setExtraCharges(
      chargesFromOrder(order)
        .filter((c) => c.type === "extra")
        .map((c) => ({ label: c.label, amount: c.amount })),
    );
    hydrate(order.items.map((it, i) => cartItemFromOrderItem(it, i)));
  };

  // Resuming replaces the cart wholesale. If a fresh (unsent) cart is in
  // progress, confirm first so those local items aren't silently discarded
  // (mirrors the close-tab guard).
  const requestResume = (order: Order) => {
    if (send.isLocked()) return;
    if (newCount > 0) setPendingResume(order);
    else enterResume(order);
  };
  const confirmResume = () => {
    if (pendingResume) enterResume(pendingResume);
    setPendingResume(null);
  };
  const cancelResume = () => setPendingResume(null);

  // Every close of the payment popup: never in flight; an unconfirmed Pay Now
  // closes only through its confirmed Discard (R13, R-d); a finished notice ends the tab.
  const onPaymentOpenChange = (next: boolean) => {
    if (next) return setPaymentOpen(true);
    if (send.holds("pay")) return discard();
    if (isBusy) return;
    if (!settleFlow.dismiss(resumedOrder?._id)) return;
    setPaymentOpen(false);
  };

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
    extraCharges,
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
    // CB-CHG — the staff-entered extra charges' surface for Cart/CartExtraCharges.
    extraCharges,
    addExtraCharge,
    removeExtraCharge,
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
    paymentBusy,
    sendingKitchen: send.sending === "kitchen",
    kitchenNotice: send.kitchenNotice,
    discardSend: discard,
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
    onPaymentOpenChange,
    paymentNotice: resumedOrder ? settleFlow.noticeFor(resumedOrder._id) : send.payNotice,
    modalTotals,
    closeConfirmOpen,
    setCloseConfirmOpen,
    // Re-syncs a server order into cart + resumedOrder (the tab on screen only);
    // a void passes { kot: false, keepUnfired: true } — see the definition.
    applyTabUpdate,
    // Spread, not hand-mirrored, so pos/page.tsx's `pos.*` surface tracks whatever
    // usePosPrint/useFreeTablePrompt expose — a new field needs no matching line here.
    ...print,
    ...freeTable,
  };
}
