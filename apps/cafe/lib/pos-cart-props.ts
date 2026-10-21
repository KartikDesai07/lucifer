import type { CartProps } from "@/components/pos/Cart";
import type { usePosTab } from "@/hooks/use-pos-tab";
import { cartMenuActions, cartMenuIssues } from "@/lib/cart-availability";
import type { VoidLine } from "@/lib/pos-cart-view";
import type { Order, Product, Table } from "@/types";

type Pos = ReturnType<typeof usePosTab>;

/** The discount's unit (U1 final fix wave: moved here from components/pos/Cart.tsx, so the pure lib modules and the
 *  hooks take it from lib, not from a component): rupees, a percentage, or "GST" = the GST-equivalent preset, whose
 *  amount is DERIVED (usePosTotals, and authoritatively the server), never typed. */
export type DiscountUnit = "₹" | "%" | "GST";

/** What only the page holds for the cart head's two cells (U1 Task 4, owner Q9): the floor for the table picker, the
 *  open tabs an occupied tile jumps to, the resume (today's prompt rules) and the move / assign opener. */
export interface CartPageInputs {
  tables: Table[] | undefined;
  openTabs: Order[];
  onResumeTab: (order: Order) => void;
  onMoveTable: () => void;
}

// Builds the POS Cart panel's props from usePosTab's state — split out of
// pos/page.tsx (CR2.3 S2's own wiring pushed it past the ~300-line budget) so
// the desktop Cart and the MobileCartBar's sheet keep rendering the exact
// SAME object, by construction, wherever it's built. Pure derivation, no
// hooks of its own.
//
// `menu` = the products list on screen (undefined until it has loaded): the
// cart notice for lines the menu can no longer sell is derived from it here,
// so pos/page.tsx gains no lines (Menu B2).
//
// `onVoidItem` opens the void dialog on the sent line the cart's Void action names (owner Q10); `page` carries what the
// head's Table and Customer cells need beyond usePosTab (owner Q9).
export function buildCartProps(
  pos: Pos,
  onVoidItem: (line: VoidLine | null) => void,
  menu: Product[] | undefined,
  page: CartPageInputs,
): CartProps {
  const menuIssues = cartMenuIssues(pos.cart, menu);
  return {
    items: pos.cart,
    // U1 Task 5 (values 5.5): the bill's "Subtotal · {n} items" and the HTML's "Send KOT · {n}" (the unsent quantity).
    count: pos.count,
    newCount: pos.newCount,
    subtotal: pos.subtotal,
    discount: pos.discount,
    gstAmount: pos.gstAmount,
    gstRate: pos.gstRate,
    // Required, so the cart footer, the mobile sticky bar and the payment modal
    // are the SAME number by construction — they cannot drift again.
    total: pos.total,
    discountRaw: pos.discountRaw,
    discountUnit: pos.discountUnit,
    onDiscountRawChange: pos.setDiscountRaw,
    onDiscountUnitChange: pos.setDiscountUnit,
    canGstDiscount: pos.gstEnabled,
    charge: pos.charge,
    chargeLabel: pos.chargeLabel,
    entitledCharge: pos.entitledCharge,
    onChargeChange: pos.setChargeOverride,
    // undefined = "untouched", which puts the bill back on the table's own
    // charge (or the tab's snapshot) rather than pinning it to a number.
    onChargeReset: () => pos.setChargeOverride(undefined),
    // CB-CHG — the staff-entered extra charges (independent of the table
    // charge above).
    extraCharges: pos.extraCharges,
    onAddExtraCharge: pos.addExtraCharge,
    onRemoveExtraCharge: pos.removeExtraCharge,
    onUpdateQty: pos.updateQty,
    onRemove: pos.removeFromCart,
    onClear: pos.clearCart,
    notes: pos.notes,
    onNotesChange: pos.setNotes,
    // CB-5B S9 — the loyalty reward picker. `customerSelected` gates the
    // whole panel (D9.3); the rest is usePosTab's `...reward` spread as-is.
    customerSelected: !!pos.customer,
    rewardLoading: pos.rewardLoading,
    stamps: pos.stamps,
    rewardOffers: pos.rewardOffers,
    selectedRewardAt: pos.selectedRewardAt,
    rewardLocked: pos.rewardLocked,
    onSelectReward: pos.onSelectReward,
    // CB-7 S5 — the diner's scratch cards, and P2's promo block (a promo-opened tab: no pickers, no GST preset).
    cardOffers: pos.cardOffers,
    selectedCardId: pos.selectedCardId,
    onSelectCard: pos.onSelectCard,
    rewardBlockedReason: pos.rewardBlockedReason,
    promoLocked: pos.promoLocked,
    manualDiscountActive: pos.manualDiscountActive,
    // CB-5D part 2 — the promo-code control (see CartPromo/use-pos-tab.ts).
    promoCode: pos.promoCode,
    onApplyPromo: pos.setPromoCode,
    onRemovePromo: () => pos.setPromoCode(null),
    onSendToKitchen: pos.sendToKitchen,
    onPayNow: pos.payNow,
    onSettle: pos.settle,
    onCloseTab: pos.requestCloseTab,
    onVoidItem,
    resumedOrderId: pos.resumedOrder?.orderId,
    resumedOrder: pos.resumedOrder,
    // The head's two cells (owner Q9): the table and the customer, set exactly as the header chips set them
    // (pos.setTable also re-derives the table charge and drops a waiver), plus the page's inputs.
    cells: {
      table: pos.table,
      onTableChange: pos.setTable,
      customer: pos.customer,
      onCustomerChange: pos.setCustomer,
      ...page,
    },
    isBusy: pos.isBusy,
    // The Send button's "Sending…", and the unanswered send's notice (Send again).
    sending: pos.sendingKitchen,
    sendNotice: pos.kitchenNotice,
    onDiscardSend: pos.discardSend,
    menuNotice: menuIssues ? { ...menuIssues, ...cartMenuActions(menuIssues, pos) } : undefined,
  };
}

/**
 * Does this sale still carry a money adjustment, even with an empty cart?
 *
 * D9.8c — `onClear` is `clearCart` (setCart([]) — items ONLY), not
 * `resetOrder`, so a discount, promo, reward or extra charge SURVIVES the
 * Clear button. "No items" therefore does not mean "nothing applied", and
 * three separate places have to agree on that or the adjustment is stranded:
 * the More menu must stay openable, the mobile bar must stay tappable, and
 * the mobile sheet must not auto-close. One predicate so they cannot drift.
 *
 * Keyed on the operator's INTENT (`discountRaw`, the GST preset) rather than
 * the derived `discount`, which usePosTotals returns as 0 whenever subtotal is
 * 0 — a surviving discount would otherwise report nothing at all.
 */
export function hasPendingAdjustment(
  input: Pick<
    CartProps,
    "promoCode" | "selectedRewardAt" | "selectedCardId" | "discountRaw" | "discountUnit" | "extraCharges"
  >,
): boolean {
  return (
    !!input.promoCode ||
    input.selectedRewardAt != null ||
    input.selectedCardId != null ||
    input.discountRaw > 0 ||
    input.discountUnit === "GST" ||
    input.extraCharges.length > 0
  );
}
